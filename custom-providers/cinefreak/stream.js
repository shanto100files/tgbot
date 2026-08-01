const BASE_URL = "https://cinefreak.net";

export async function getStream({ link, type, signal, providerContext }) {
  const { axios, cheerio } = providerContext;
  const streams = [];

  if (link.includes("generate.php")) {
    try {
      // Step 1: Extract base64 id from generate.php
      const urlObj = new URL(link.startsWith("http") ? link : `${BASE_URL}${link}`);
      const id = urlObj.searchParams.get("id");

      if (!id) {
        streams.push({ server: "CineFreak", link, type: "mp4", quality: "1080" });
        return streams;
      }

      // Step 2: Decode base64 to get cinecloud URL
      const cinecloudUrl = Buffer.from(id, "base64").toString("utf-8");

      // Step 3: Fetch cinecloud page to get iframe
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
          // Clean up the video URL
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

        // Also get subtitle if available
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
