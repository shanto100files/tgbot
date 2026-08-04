import axios from "axios";
import { upsertPosts, upsertDownloadLinks, getDB } from "./db.js";

const API = "http://localhost:3000/api";
const PAGES = 30;
const TIMEOUT = 20000;
const META_TIMEOUT = 15000;
const CONCURRENCY = 5;

function extractSize(text) {
  const m = text.match(/[\[(\s]([0-9.]+\s*[KMGT]?B\/?E?)[\])\s]/i);
  return m ? m[1] : "";
}

function extractQuality(text) {
  const m = text.match(/(480p|720p|1080p|2160p|4k|DS4K)/i);
  return m ? m[1].toLowerCase() : "";
}

function extractLanguage(text) {
  const langs = [];
  if (/\bHindi\b/i.test(text)) langs.push("Hindi");
  if (/\bEnglish\b/i.test(text)) langs.push("English");
  if (/\bDual Audio\b|\bDual\b/i.test(text)) langs.push("Dual");
  if (/\bMulti Audio\b|\bMULTI\b|\bMulti\b/i.test(text)) langs.push("Multi");
  if (/\bTamil\b/i.test(text)) langs.push("Tamil");
  if (/\bTelugu\b/i.test(text)) langs.push("Telugu");
  if (/\bBengali\b|\bBangla\b/i.test(text)) langs.push("Bangla");
  if (/\bKorean\b/i.test(text)) langs.push("Korean");
  if (/\bSpanish\b/i.test(text)) langs.push("Spanish");
  if (/\bJapanese\b/i.test(text)) langs.push("Japanese");
  return langs.join(", ");
}

function extractYear(text) {
  const m = text.match(/[\(\[]?(20[0-2]\d|19\d\d)[\)\]]?/);
  return m ? m[1] : "";
}

function cleanTitle(raw) {
  let t = raw.replace(/^Download\s+/i, "").trim();
  t = t.replace(/\[[0-9.]+\s*[KMGT]?B\/?E?\]/gi, "");
  t = t.replace(/\{[^}]+\}/g, "");
  t = t.replace(/\(Direct Files\)/gi, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function classifyCloudType(link) {
  if (!link) return "unknown";
  if (link.includes("hubcloud")) return "hubcloud";
  if (link.includes("hubcdn")) return "hubcdn";
  if (link.includes("hubdrive") || link.includes("drivehub")) return "hubdrive";
  if (link.includes("cinecloud") || link.includes("cinefreak")) return "cinecloud";
  if (link.includes("gadgetsweb") || link.includes("yagaverse")) return "cinecloud";
  if (link.includes("pixeldrain")) return "pixeldrain";
  if (link.includes("r2.dev") || link.includes("cloudflarestorage")) return "cfstorage";
  if (link.includes("googleusercontent") || link.includes("video-downloads")) return "gdrive";
  if (link.includes("cloud.unblocked") || link.includes("new5.")) return "vcloud";
  if (link.includes("nexdrive")) return "nexdrive";
  if (link.includes("mega.nz") || link.includes("mega.co")) return "mega";
  if (link.includes("mediafire")) return "mediafire";
  return "other";
}

// Fetch meta for a post, with retry
async function fetchMeta(provider, link, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const { data } = await axios.get(`${API}/meta/${provider}`, {
        params: { link },
        timeout: META_TIMEOUT,
      });
      return data;
    } catch (e) {
      if (i < retries) await new Promise(r => setTimeout(r, 1000));
    }
  }
  return null;
}

// Process a batch of posts - extract download links from meta
async function processPostMeta(provider, post) {
  const meta = await fetchMeta(provider, post.link);
  if (!meta) return [];

  const dlLinks = [];
  for (const group of (meta.linkList || [])) {
    for (const dl of (group.directLinks || [])) {
      if (dl.link && dl.link.startsWith("http")) {
        dlLinks.push({
          provider,
          post_link: post.link,
          quality_title: group.title || "",
          quality: group.quality || extractQuality(group.title),
          link_title: dl.title || "",
          cloud_link: dl.link,
          cloud_type: classifyCloudType(dl.link),
        });
      }
    }
  }

  // Also extract download links from page HTML (some providers embed links in text)
  if (meta.webUrl) {
    try {
      const { data: html } = await axios.get(meta.webUrl, { timeout: 15000 });
      if (typeof html === "string") {
        const linkRegex = /href\s*=\s*["'](https?:\/\/[^"']*(?:hubcloud|hubdrive|hubcdn|cinecloud|pixeldrain|r2\.dev|cloudflarestorage|googleusercontent|gadgetsweb|yagaverse)[^"']*)/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
          const url = match[1];
          if (!dlLinks.some(l => l.cloud_link === url)) {
            dlLinks.push({
              provider,
              post_link: post.link,
              quality_title: meta.title || "",
              quality: extractQuality(meta.title || ""),
              link_title: "Direct",
              cloud_link: url,
              cloud_type: classifyCloudType(url),
            });
          }
        }
      }
    } catch {}
  }

  return dlLinks;
}

// --- Single provider full scrape ---
async function scrapeProvider(provider, filters, onProgress) {
  const startTime = Date.now();
  let totalPosts = 0;
  let totalLinks = 0;
  let metaFails = 0;
  const META_FAIL_THRESHOLD = 5;

  for (const filter of filters) {
    let emptyPage = 0;
    for (let page = 1; page <= PAGES; page++) {
      try {
        const { data } = await axios.get(`${API}/posts/${provider}`, {
          params: { filter: filter.filter, page },
          timeout: TIMEOUT,
        });
        const posts = data.posts || [];
        if (!posts.length) {
          emptyPage++;
          if (emptyPage >= 2) break;
          continue;
        }
        emptyPage = 0;

        // Save posts to DB - store relative link for meta fetch
        const dbPosts = posts.map(p => ({
          provider,
          title: cleanTitle(p.title),
          fileName: p.title,
          link: p.link || "",
          image: p.image || "",
          quality: extractQuality(p.title),
          size: extractSize(p.title),
          language: extractLanguage(p.title),
          type: p.title.toLowerCase().includes("season") ? "tv" : "movie",
          year: extractYear(p.title),
        }));
        upsertPosts(dbPosts);
        totalPosts += posts.length;

        // Process ALL posts for meta (not just first 10!)
        // Process in parallel batches - skip meta if provider broken
        if (metaFails < META_FAIL_THRESHOLD) {
          for (let i = 0; i < posts.length; i += CONCURRENCY) {
            const batch = posts.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(post => processPostMeta(provider, post))
            );
            let batchFails = 0;
            for (const links of results) {
              if (links.length) {
                upsertDownloadLinks(links);
                totalLinks += links.length;
              } else {
                batchFails++;
              }
            }
            if (batchFails >= CONCURRENCY) metaFails += batchFails;
            if (metaFails >= META_FAIL_THRESHOLD) {
              console.log(`[SCRAPE] ${provider}: meta broken, skipping remaining meta`);
              break;
            }
          }
        }

        if (onProgress) onProgress(provider, filter.title, page, PAGES, totalPosts, totalLinks);
      } catch (e) {
        if (e.response?.status === 404) break;
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[SCRAPE] ${provider} done: ${totalPosts} posts, ${totalLinks} links in ${elapsed}s`);
  return { provider, posts: totalPosts, links: totalLinks, elapsed };
}

// --- FULL PARALLEL SCRAPE ---
export async function fullScrape(onProgress) {
  console.log("[SCRAPER] Starting full parallel scrape (4 providers x 30 pages)...");
  const startTime = Date.now();

  const providerConfigs = [
    {
      name: "cinefreak",
      filters: [
        { title: "Latest", filter: "/" },
        { title: "Dual Audio", filter: "/dual-audio/" },
        { title: "Hindi Movies", filter: "/hindi-movies/" },
        { title: "English Movies", filter: "/english-movies/" },
        { title: "Hindi Dubbed", filter: "/hindi-dubbed-movies/" },
        { title: "Web Series", filter: "/web-series/" },
      ],
    },
    {
      name: "vega",
      filters: [
        { title: "New", filter: "" },
        { title: "Netflix", filter: "web-series/netflix" },
        { title: "Prime", filter: "web-series/amazon-prime-video" },
        { title: "Action", filter: "category/movies-by-genres/action" },
        { title: "Comedy", filter: "category/movies-by-genres/comedy" },
        { title: "Drama", filter: "category/movies-by-genres/drama" },
        { title: "Horror", filter: "category/movies-by-genres/horror" },
        { title: "Sci-Fi", filter: "category/movies-by-genres/sci-fi" },
      ],
    },
    {
      name: "hdhub4u",
      filters: [
        { title: "Latest", filter: "/" },
        { title: "Web Series", filter: "/category/web-series" },
        { title: "Hollywood", filter: "/category/hollywood-movies" },
        { title: "South", filter: "/category/south-hindi-movies" },
        { title: "Bollywood", filter: "/category/bollywood-movies" },
      ],
    },
    {
      name: "4khdhub",
      filters: [
        { title: "Home", filter: "/" },
        { title: "Series", filter: "/category/series" },
        { title: "Anime", filter: "/category/anime" },
        { title: "4K HDR", filter: "/category/-2160p-HDR" },
        { title: "4K SDR", filter: "/category/-2160p-SDR" },
      ],
    },
  ];

  // Run ALL 4 providers IN PARALLEL
  const results = await Promise.all(
    providerConfigs.map(config =>
      scrapeProvider(config.name, config.filters, onProgress)
    )
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalPosts = results.reduce((sum, r) => sum + r.posts, 0);
  const totalLinks = results.reduce((sum, r) => sum + r.links, 0);

  console.log(`[SCRAPER] ALL DONE in ${elapsed}s. Posts: ${totalPosts}, Links: ${totalLinks}`);
  for (const r of results) {
    console.log(`  ${r.provider}: ${r.posts} posts, ${r.links} links (${r.elapsed}s)`);
  }

  return { total: totalPosts, links: totalLinks, providers: results };
}
