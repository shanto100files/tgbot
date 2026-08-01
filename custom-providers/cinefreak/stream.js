const BASE_URL = "https://cinefreak.net";

export async function getStream({ link, type, signal, providerContext }) {
  const { axios, cheerio } = providerContext;
  const streams = [];

  if (link.includes("generate.php")) {
    try {
      // Extract the base64 id from generate.php?id=...
      const urlObj = new URL(link.startsWith("http") ? link : `${BASE_URL}${link}`);
      const id = urlObj.searchParams.get("id");

      if (id) {
        // Decode base64 to get actual file URL
        const decoded = Buffer.from(id, "base64").toString("utf-8");

        // decoded is like: https://new5.cinecloud.site/f/xxxxx
        // This is a GDrive clone - fetch it to get direct link
        try {
          const res = await axios.get(decoded, {
            signal,
            timeout: 15000,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          const $ = cheerio.load(res.data);

          // Look for direct download link
          const directLink =
            $('a[href*="download"]').attr("href") ||
            $('a[href*=".mp4"]').attr("href") ||
            $('a[href*=".mkv"]').attr("href") ||
            $('meta[property="og:video"]').attr("content") ||
            $('video source').attr("src") ||
            decoded; // fallback to decoded URL

          streams.push({
            server: "CineFreak GDrive",
            link: directLink,
            type: directLink.includes(".mkv") ? "mkv" : "mp4",
            quality: "1080",
          });
        } catch (e) {
          // If fetch fails, return decoded URL directly
          streams.push({
            server: "CineFreak Direct",
            link: decoded,
            type: "mp4",
            quality: "1080",
          });
        }
      }
    } catch (err) {
      streams.push({
        server: "CineFreak",
        link: link,
        type: "mp4",
        quality: "1080",
      });
    }
  } else {
    // Direct link
    streams.push({
      server: "CineFreak",
      link: link.startsWith("http") ? link : `${BASE_URL}${link}`,
      type: "mp4",
      quality: "1080",
    });
  }

  return streams;
}
