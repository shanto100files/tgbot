import { Router } from "express";

export function createResolveRouter() {
  const router = Router();

  /**
   * GET /api/resolve?url=encoded_url
   * Resolves any link by following redirects and extracting final URL
   */
  router.get("/", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ error: "Missing parameter: url" });
      }

      const logger = req.app.locals.logger;
      const axios = (await import("axios")).default;
      const cheerio = (await import("cheerio")).default;

      logger.info(`Resolving: ${url}`);
      const result = await resolveLink(url, axios, cheerio);
      res.json(result);
    } catch (err) {
      req.app.locals.logger.error(`Resolve error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/resolve
   * Body: { url: "string", provider: "optional" }
   */
  router.post("/", async (req, res) => {
    try {
      const { url, provider } = req.body;
      if (!url) {
        return res.status(400).json({ error: "Missing body parameter: url" });
      }

      const logger = req.app.locals.logger;
      const axios = (await import("axios")).default;
      const cheerio = (await import("cheerio")).default;

      logger.info(`Resolving [${provider || "auto"}]: ${url}`);
      const result = await resolveLink(url, axios, cheerio, provider);
      res.json(result);
    } catch (err) {
      req.app.locals.logger.error(`Resolve error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

async function resolveLink(url, axios, cheerio, provider) {
  const result = {
    original: url,
    resolved: null,
    finalUrl: null,
    type: null,
    quality: null,
    headers: {},
    success: false,
  };

  try {
    // Step 1: Handle cinefreak-style base64 links
    if (url.includes("generate.php") || url.includes("id=")) {
      try {
        const urlObj = new URL(url);
        const id = urlObj.searchParams.get("id");
        if (id) {
          const decoded = Buffer.from(id, "base64").toString("utf-8");
          result.resolved = decoded;
          url = decoded;
        }
      } catch (e) {
        // Not a valid URL with base64, continue with original
      }
    }

    // Step 2: Determine headers based on URL domain
    const urlHost = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    const extraHeaders = {};
    if (urlHost.includes('hubcloud') || urlHost.includes('nexdrive') || urlHost.includes('cinecloud')) {
      extraHeaders.Referer = `https://${urlHost}/`;
      extraHeaders.Origin = `https://${urlHost}`;
    }

    // Step 3: Follow redirects with multiple attempts
    const attempts = [
      // Attempt 1: Follow all redirects
      async () => {
        const res = await axios.get(url, {
          maxRedirects: 10,
          timeout: 20000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            ...extraHeaders,
          },
        });
        return res;
      },
      // Attempt 2: HEAD request first
      async () => {
        const headRes = await axios.head(url, {
          maxRedirects: 10,
          timeout: 15000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            ...extraHeaders,
          },
        });
        return headRes;
      },
    ];

    let lastRes = null;
    for (const attempt of attempts) {
      try {
        lastRes = await attempt();
        if (lastRes) break;
      } catch (e) {
        continue;
      }
    }

    if (lastRes) {
      // Get final URL after redirects
      const finalUrl =
        lastRes.request?.res?.responseUrl ||
        lastRes.request?.path ||
        lastRes.headers?.location ||
        url;

      result.finalUrl = finalUrl;

      // Detect content type
      const contentType = lastRes.headers?.["content-type"] || "";
      if (contentType.includes("video")) {
        result.type = "video";
      } else if (contentType.includes("audio")) {
        result.type = "audio";
      } else if (finalUrl.includes(".mkv")) {
        result.type = "mkv";
      } else if (finalUrl.includes(".mp4")) {
        result.type = "mp4";
      } else if (finalUrl.includes(".m3u8")) {
        result.type = "m3u8";
      } else {
        result.type = "mp4"; // default
      }

      // Try to extract from HTML if not direct video
      if (typeof lastRes.data === "string" && !contentType.includes("video")) {
        const $ = cheerio.load(lastRes.data);

        // Look for video sources
        const videoSrc =
          $("video").attr("src") ||
          $("video source").attr("src") ||
          $("meta[property='og:video']").attr("content") ||
          $("meta[property='og:video:url']").attr("content");

        if (videoSrc) {
          result.finalUrl = videoSrc;
          result.success = true;
        }

        // Look for download links
        const downloadLink =
          $('a[href*="download"]').attr("href") ||
          $('a[href*=".mp4"]').attr("href") ||
          $('a[href*=".mkv"]').attr("href");

        if (downloadLink && !result.success) {
          result.finalUrl = downloadLink;
          result.success = true;
        }

        // Check for JavaScript redirects
        const scriptContent = $("script").text();
        const redirectMatch = scriptContent.match(
          /window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/
        );
        if (redirectMatch && !result.success) {
          result.finalUrl = redirectMatch[1];
          result.success = true;
        }
      } else if (contentType.includes("video")) {
        result.success = true;
      }

      // Set headers for the resolved link
      result.headers = {
        Referer: new URL(result.finalUrl || url).origin,
        Origin: new URL(result.finalUrl || url).origin,
      };
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}
