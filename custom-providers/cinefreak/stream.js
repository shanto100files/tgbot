const BASE_URL = "https://cinefreak.net";

export async function getStream({ link, type, signal, providerContext }) {
  const { axios, cheerio } = providerContext;
  const streams = [];

  if (link.includes("generate.php")) {
    try {
      let cleanLink = link.trim();
      if (!cleanLink.startsWith("http")) {
        cleanLink = `${BASE_URL}${cleanLink.startsWith("/") ? "" : "/"}${cleanLink}`;
      }

      const urlObj = new URL(cleanLink);
      const id = urlObj.searchParams.get("id");

      if (!id) {
        return [{ server: "CineFreak", link: cleanLink, type: "mp4" }];
      }

      const cinecloudUrl = Buffer.from(id, "base64").toString("utf-8");

      // Try cinecloud page
      try {
        const res = await axios.get(cinecloudUrl, {
          signal,
          timeout: 15000,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Referer": BASE_URL + "/",
          },
          maxRedirects: 5,
        });

        const pageText = typeof res.data === "string" ? res.data : "";

        // Check if 404
        if (pageText.includes("404") || pageText.includes("File Not Found") || pageText.includes("File not found")) {
          // cinecloud dead, try direct link format variations
          const altUrls = [
            cinecloudUrl.replace("/f/", "/s/"),
            cinecloudUrl.replace("/f/", "/v/"),
            cinecloudUrl.replace("new5.cinecloud.site", "new5.cinecloud.site").replace("/f/", "/d/"),
          ];

          for (const altUrl of altUrls) {
            try {
              const altRes = await axios.get(altUrl, { signal, timeout: 10000, headers: { "Referer": BASE_URL + "/" }, maxRedirects: 5 });
              const altText = typeof altRes.data === "string" ? altRes.data : "";
              if (!altText.includes("404") && !altText.includes("File Not Found")) {
                const $alt = cheerio.load(altText);
                const iframeSrc = $alt("iframe").attr("src");
                if (iframeSrc) {
                  const videoUrl = new URL(iframeSrc).searchParams.get("id") || iframeSrc;
                  streams.push({ server: "CineFreak", link: decodeURIComponent(videoUrl), type: "mkv" });
                  return streams;
                }
              }
            } catch {}
          }

          return streams;
        }

        const $ = cheerio.load(pageText);

        // Extract iframe
        const iframeSrc = $("iframe").attr("src");
        if (iframeSrc) {
          try {
            const iframeUrl = new URL(iframeSrc);
            const videoUrl = iframeUrl.searchParams.get("id");
            if (videoUrl) {
              streams.push({
                server: "CineFreak",
                link: decodeURIComponent(videoUrl),
                type: decodeURIComponent(videoUrl).includes(".mkv") ? "mkv" : "mp4",
              });
            }
            const subParam = iframeUrl.searchParams.get("sub[0]");
            if (subParam) {
              streams.push({ server: "Subtitle", link: decodeURIComponent(subParam), type: "srt" });
            }
          } catch {}
        }

        // Check for direct video/source tags
        const videoSrc = $("video source, video").attr("src");
        if (videoSrc) {
          streams.push({ server: "CineFreak", link: videoSrc, type: "mp4" });
        }

        // Check for download links in buttons
        $("a[href]").each((i, el) => {
          const href = $(el).attr("href") || "";
          if (href.includes("pixeldrain") || href.includes("r2.dev") || href.includes("cloudflarestorage") || href.includes("googleusercontent") || href.includes(".mkv") || href.includes(".mp4")) {
            streams.push({ server: "CineFreak", link: href, type: href.includes(".mp4") ? "mp4" : "mkv" });
          }
        });
      } catch (fetchErr) {
        // cinecloud fetch failed
      }

      if (!streams.length) {
        streams.push({ server: "CineFreak (Storage Down)", link: cinecloudUrl, type: "mp4" });
      }
    } catch (err) {
      streams.push({ server: "CineFreak", link: link, type: "mp4" });
    }
  } else {
    streams.push({
      server: "CineFreak",
      link: link.startsWith("http") ? link : `${BASE_URL}${link}`,
      type: "mp4",
    });
  }

  return streams;
}
