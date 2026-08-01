const BASE_URL = "https://cinefreak.net";

export async function getMeta({ link, provider, signal, providerContext }) {
  const { axios, cheerio } = providerContext;
  const url = link.startsWith("http") ? link : `${BASE_URL}${link}`;

  const res = await axios.get(url, { signal });
  const $ = cheerio.load(res.data);

  const title = $("h1.page-title").text().trim();
  const image = $("img.wp-post-image").attr("src") || "";
  const synopsis = $(".entry-content p").first().text().trim();

  // Extract rating from page content
  const ratingMatch = $(".entry-content").text().match(/IMDb Rating[:\s-]*(\d+\.?\d*)/);
  const rating = ratingMatch ? ratingMatch[1] : "";

  // Extract genre tags
  const tags = [];
  $(".badge.badge-outline a").each((i, el) => {
    const tag = $(el).text().trim();
    if (tag && !["Dual Audio", "English Movies", "WEB-DL", "Hindi Movies"].includes(tag)) {
      tags.push(tag);
    }
  });

  // Extract download links with quality info
  const linkList = [];
  let currentQuality = "";
  let directLinks = [];

  $(".entry-content h4, .entry-content h3").each((i, el) => {
    const text = $(el).text().trim();
    // Match quality patterns like "480p [400 MB]", "720p [1.5 GB]", etc.
    const qualityMatch = text.match(/(480p|720p|1080p|2160p|4K)\s*\[([^\]]+)\]/i);
    if (qualityMatch) {
      // Save previous quality block
      if (currentQuality && directLinks.length > 0) {
        linkList.push({
          title: currentQuality,
          quality: qualityMatch[1],
          directLinks: [...directLinks],
        });
        directLinks = [];
      }
      currentQuality = text;
    }
  });

  // Find all download links
  const downloadLinks = [];
  $("a[href*='generate.php']").each((i, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href) {
      // Extract quality from nearby h4
      const parentH4 = $(el).closest("div").prevAll("h4").first().text();
      const qualityMatch = parentH4.match(/(480p|720p|1080p|2160p|4K)/i);
      const quality = qualityMatch ? qualityMatch[1] : "unknown";
      
      downloadLinks.push({
        title: text || `Download ${quality}`,
        link: href.replace(BASE_URL, ""),
        type: "movie",
        quality,
      });
    }
  });

  // Group by quality
  const qualityGroups = {};
  downloadLinks.forEach(dl => {
    if (!qualityGroups[dl.quality]) {
      qualityGroups[dl.quality] = [];
    }
    qualityGroups[dl.quality].push(dl);
  });

  Object.keys(qualityGroups).forEach(quality => {
    linkList.push({
      title: quality,
      quality,
      directLinks: qualityGroups[quality],
    });
  });

  // Determine type (movie or series)
  const isSeries = url.includes("web-series") || $(".entry-content").text().toLowerCase().includes("season");
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
