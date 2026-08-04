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

    let epInfo = "";
    let qualityInfo = "";

    // Get quality from link's own text first (e.g., "HD 720p", "SD 480p")
    const linkText = $(el).text().trim();
    const linkQMatch = linkText.match(/\b(SD|HD|FHD|UHD)?\s*(480p|720p|1080p|2160p|4K)\b/i);
    if (linkQMatch) qualityInfo = linkQMatch[0].trim();

    // Also try the quality-box/container around the link
    if (!qualityInfo) {
      const qualityBox = $(el).closest(".quality-grid, .quality-box");
      if (qualityBox.length) {
        const qText = qualityBox.text().replace(/\s+/g, " ");
        const qMatch = qText.match(/\b(SD|HD|FHD|UHD)?\s*(480p|720p|1080p|2160p|4K)\b/i);
        if (qMatch) qualityInfo = qMatch[0].trim();
      }
    }

    // Walk up to .ep-card for episode info
    const card = $(el).closest(".ep-card");
    if (card.length) {
      const cardText = card.text().replace(/\s+/g, " ");
      const epMatch = cardText.match(/(?:S(\d+)[\s•\-]*)?Episode[s]?\s+(\d+(?:\s*[-–]\s*\d+)?)/i);
      if (epMatch) {
        const seasonNum = epMatch[1] || cardText.match(/S(\d+)/i)?.[1];
        const season = seasonNum ? `S${seasonNum.padStart(2, "0")} ` : "";
        epInfo = `${season}Ep ${epMatch[2] || epMatch[1]}`;
      }
    }

    let linkTitle = epInfo || qualityInfo || "Download";
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

  // Group by episode range
  const epGroups = {};
  for (const dl of directLinks) {
    const epMatch = dl.title.match(/Ep\s+(\d+)(?:\s*[-–]\s*(\d+))?/i);
    const groupKey = epMatch
      ? (epMatch[2] ? `${epMatch[1]}-${epMatch[2]}` : epMatch[1])
      : "all";
    if (!epGroups[groupKey]) epGroups[groupKey] = [];
    epGroups[groupKey].push(dl);
  }

  const linkList = [];
  const epKeys = Object.keys(epGroups);
  if (epKeys.length > 1) {
    for (const [ep, links] of Object.entries(epGroups)) {
      // Collect unique qualities in this group
      const qualities = [...new Set(links.map(l => l.quality).filter(q => q && q !== "unknown"))];
      const qualityStr = qualities.length === 1 ? ` • ${qualities[0]}` : "";
      linkList.push({ title: `Episode ${ep}${qualityStr}`, quality: qualities[0] || "unknown", directLinks: links });
    }
  } else {
    // Fallback: group by quality
    const qualityGroups = {};
    for (const dl of directLinks) {
      const q = dl.quality || "unknown";
      if (!qualityGroups[q]) qualityGroups[q] = [];
      qualityGroups[q].push(dl);
    }
    for (const [quality, links] of Object.entries(qualityGroups)) {
      linkList.push({ title: quality, quality, directLinks: links });
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
