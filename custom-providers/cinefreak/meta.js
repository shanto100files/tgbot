const BASE_URL = "https://cinefreak.net";

export async function getMeta({ link, provider, signal, providerContext }) {
  const { axios, cheerio } = providerContext;
  const url = link.startsWith("http") ? link : `${BASE_URL}${link}`;

  const res = await axios.get(url, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });
  const $ = cheerio.load(res.data);

  const title = $("h1.page-title, h1.entry-title, h1").first().text().trim().replace(/\s*-\s*CineFreak$/i, "");
  const image = $("img.wp-post-image, .entry-content img").first().attr("src") || "";
  const synopsis = $(".entry-content p").first().text().trim();

  const ratingMatch = $(".entry-content").text().match(/IMDb Rating[:\s-]*(\d+\.?\d*)/);
  const rating = ratingMatch ? ratingMatch[1] : "";

  const tags = [];
  $(".badge a, .entry-content .tag a").each((i, el) => {
    const tag = $(el).text().trim();
    if (tag) tags.push(tag);
  });

  const directLinks = [];
  const sectionTitle = { current: "Links" };

  // Find all generate.php links and extract context from surrounding elements
  $("a[href*='generate.php']").each((i, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Walk up to find the card/container
    let container = $(el).closest(".download-item, .card, .movie-box, div");
    
    // Try to get episode info from surrounding context
    let epInfo = "";
    let qualityInfo = "";

    // Look at parent and siblings for episode/season text
    for (let depth = 0; depth < 5 && container.length; depth++) {
      const ctxText = container.text().replace(/\s+/g, " ");
      
      // Extract episode info: "S05 • Episode 97-100" or "Episode 97"
      const epMatch = ctxText.match(/(?:S(\d+)[\s•\-]*)?Episode[s]?\s+(\d+(?:\s*[-–]\s*\d+)?)/i)
        || ctxText.match(/(?:Season\s+\d+[\s•\-]*)?Ep\.?\s*(\d+(?:\s*[-–]\s*\d+)?)/i);
      if (epMatch && !epInfo) {
        const seasonNum = epMatch[1] || ctxText.match(/S(\d+)/i)?.[1];
        const season = seasonNum ? `S${seasonNum.padStart(2, "0")} ` : "";
        epInfo = `${season}Ep ${epMatch[2] || epMatch[1]}`;
      }

      // Extract quality from context
      const qMatch = ctxText.match(/\b(SD|HD|FHD|UHD)?\s*(480p|720p|1080p|2160p|4K)\b/i);
      if (qMatch && !qualityInfo) {
        qualityInfo = qMatch[0].trim();
      }

      if (epInfo || qualityInfo) break;
      container = container.parent();
    }

    // Get button text as fallback
    const btnText = $(el).text().trim();

    // Build title
    let linkTitle = epInfo || qualityInfo || btnText || "Download";
    if (epInfo && qualityInfo) linkTitle = `${epInfo} • ${qualityInfo}`;

    directLinks.push({
      title: linkTitle,
      link: href.replace(BASE_URL, ""),
      quality: qualityInfo || "unknown",
    });
  });

  // Fallback: if no generate.php links, look for other download patterns
  if (directLinks.length === 0) {
    $("a[href*='hubcloud'], a[href*='cinecloud'], a[href*='nexdrive']").each((i, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href) {
        directLinks.push({
          title: text || "Download",
          link: href.replace(BASE_URL, ""),
          quality: "unknown",
        });
      }
    });
  }

  // Group by quality if possible, otherwise single group
  const qualityGroups = {};
  for (const dl of directLinks) {
    const q = dl.quality || "unknown";
    if (!qualityGroups[q]) qualityGroups[q] = [];
    qualityGroups[q].push(dl);
  }

  const linkList = [];
  const groupKeys = Object.keys(qualityGroups);
  
  if (groupKeys.length > 1 || (groupKeys.length === 1 && groupKeys[0] !== "unknown")) {
    // Multiple quality groups
    for (const [quality, links] of Object.entries(qualityGroups)) {
      linkList.push({ title: quality, quality, directLinks: links });
    }
  } else {
    // Single group - use episode-based grouping
    const epGroups = {};
    for (const dl of directLinks) {
      // Extract episode range for grouping
      const epMatch = dl.title.match(/Ep\s+(\d+)(?:\s*[-–]\s*(\d+))?/i);
      const groupKey = epMatch ? (epMatch[2] ? `${epMatch[1]}-${epMatch[2]}` : epMatch[1]) : "all";
      if (!epGroups[groupKey]) epGroups[groupKey] = [];
      epGroups[groupKey].push(dl);
    }

    const epKeys = Object.keys(epGroups);
    if (epKeys.length > 1) {
      for (const [ep, links] of Object.entries(epGroups)) {
        linkList.push({ title: `Episode ${ep}`, quality: "unknown", directLinks: links });
      }
    } else {
      linkList.push({ title: "Links", quality: "unknown", directLinks });
    }
  }

  const isSeries = url.includes("web-series") || url.includes("season") || $(".entry-content").text().toLowerCase().includes("season");
  const type = isSeries ? "series" : "movie";

  return {
    title,
    image,
    synopsis: synopsis.substring(0, 500),
    imdbId: "",
    type,
    tags,
    rating,
    linkList,
    webUrl: url,
  };
}
