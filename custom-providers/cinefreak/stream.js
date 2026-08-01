const BASE_URL = "https://cinefreak.net";

export async function getStream({ link, type, signal, providerContext }) {
  const { axios, cheerio } = providerContext;
  const streams = [];

  if (link.includes("generate.php")) {
    try {
      // Step 1: Clean link - remove extra text, ensure valid URL
      let cleanLink = link.trim();
      
      // Remove any text after the base64 padding (= or ==)
      const equalsIndex = cleanLink.indexOf("=");
      if (equalsIndex !== -1) {
        // Keep up to 2 padding chars and remove everything after
        const afterEquals = cleanLink.substring(equalsIndex + 1);
        const extraChars = afterEquals.replace(/[=]/g, "").length;
        if (extraChars > 0) {
          // Has extra chars after padding, likely bad input
          cleanLink = cleanLink.substring(0, equalsIndex + 1);
        }
      }

      // Ensure full URL
      if (!cleanLink.startsWith("http")) {
        cleanLink = `${BASE_URL}${cleanLink.startsWith("/") ? "" : "/"}${cleanLink}`;
      }

      // Parse URL
      const urlObj = new URL(cleanLink);
      const id = urlObj.searchParams.get("id");

      if (!id) {
        streams.push({ server: "CineFreak", link: cleanLink, type: "mp4", quality: "1080" });
        return streams;
      }

      // Step 2: Decode base64 to get cinecloud URL
      const cinecloudUrl = Buffer.from(id, "base64").toString("utf-8");

      // Step 3: Fetch cinecloud page
      const res = await axios.get(cinecloudUrl, {
        signal,
        timeout: 20000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
      });

      const $ = cheerio.load(res.data);

      // Step 4: Extract iframe src
      const iframeSrc = $("iframe").attr("src");

      if (iframeSrc) {
        // Step 5: Parse the actual video URL from iframe params
        const iframeUrl = new URL(iframeSrc);
        const videoUrl = iframeUrl.searchParams.get("id");

        if (videoUrl) {
          const cleanUrl = decodeURIComponent(videoUrl);

          streams.push({
            server: "CineFreak R2",
            link: cleanUrl,
            type: cleanUrl.includes(".mkv") ? "mkv" : "mp4",
            quality: "720",
            headers: {
              Referer: "https://stream.yagaverse.net/",
              Origin: "https://stream.yagaverse.net",
            },
          });
        }

        // Get subtitle if available
        const subParam = iframeUrl.searchParams.get("sub[0]");
        if (subParam) {
          streams.push({
            server: "Subtitle",
            link: decodeURIComponent(subParam),
            type: "srt",
            quality: "subtitle",
          });
        }
      }

      // If no streams found, return the cinecloud URL as fallback
      if (streams.length === 0) {
        streams.push({
          server: "CineFreak Cloud",
          link: cinecloudUrl,
          type: "mp4",
          quality: "720",
        });
      }
    } catch (err) {
      streams.push({
        server: "CineFreak",
        link: link,
        type: "mp4",
        quality: "1080",
        error: err.message,
      });
    }
  } else {
    streams.push({
      server: "CineFreak",
      link: link.startsWith("http") ? link : `${BASE_URL}${link}`,
      type: "mp4",
      quality: "1080",
    });
  }

  return streams;
}
