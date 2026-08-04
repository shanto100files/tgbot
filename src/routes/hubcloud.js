import { Router } from "express";

export function createHubcloudRouter() {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ error: "Missing 'url' parameter" });
      }

      const logger = req.app.locals.logger;
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      };

      // --- Nexdrive / generic cloud link ---
      if (url.includes("nexdrive") || url.includes("vcloud") || url.includes("cinecloud") || url.includes("hubcloud") || url.includes("fastdl") || url.includes("gdtot") || url.includes("gdrive")) {
        const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
        headers.Referer = `https://${host}/`;

        logger.info(`Cloud resolve: ${url}`);

        const pageResp = await fetch(url.startsWith("http") ? url : `https://${url}`, { headers, redirect: "follow" });
        if (!pageResp.ok) {
          return res.status(502).json({ error: `Page ${pageResp.status}` });
        }
        const pageHtml = await pageResp.text();

        // Extract all download links
        const links = [];
        const junk = ["wp-content", "wp-includes", "wp-json", "xmlrpc", "/feed", "googleapis", "gtag", "googletagmanager", "oembed", "emoji", "litespeed", "jquery", "bootstrap", "fontawesome", "cloudflare", "cdn-cgi", "challenge-platform", ".css", ".js", ".png", ".jpg", ".gif", ".svg", ".woff", ".ttf", ".ico", "schema.org", "w.org", "fonts.googleapis"];

        // Step 1: Try hubcloud.php pattern (gamerxyt.com)
        const phpMatch = pageHtml.match(/var\s+url\s*=\s*['"]([^'"]*hubcloud\.php[^'"]*)/i);
        if (phpMatch) {
          let phpUrl = phpMatch[1].replace(/&amp;/g, "&");
          logger.info(`Hubcloud PHP: ${phpUrl}`);
          try {
            const phpResp = await fetch(phpUrl, { headers, redirect: "follow" });
            if (phpResp.ok) {
              const phpHtml = await phpResp.text();
              // Extract links from PHP response
              const phpPatterns = [
                /href="(https?:\/\/[^"]*\.(?:mp4|mkv|m3u8)[^"]*)"/gi,
                /href="(https?:\/\/[^"]*(?:r2\.cloudflarestorage|fastdl|gdtot|gdrive|mega\.nz|mediafire)[^"]*)"/gi,
                /"(https?:\/\/[^"]*(?:r2\.cloudflarestorage|video-downloads\.googleapis)[^"]*\.(?:mp4|mkv)[^"]*)"/gi,
                /file\s*[:=]\s*["'](https?:\/\/[^"']*\.(?:mp4|mkv|m3u8)[^"']*)/gi,
                /src\s*[:=]\s*["'](https?:\/\/[^"']*\.(?:mp4|mkv|m3u8)[^"']*)/gi,
              ];
              for (const pat of phpPatterns) {
                let m;
                while ((m = pat.exec(phpHtml)) !== null) {
                  const url = m[1].replace(/&amp;/g, "&");
                  if (!links.includes(url) && !junk.some(j => url.includes(j))) {
                    links.push(url);
                  }
                }
              }
              if (links.length) {
                const title = pageHtml.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() || "";
                logger.info(`Hubcloud PHP resolved: ${links.length} links`);
                return res.json({ success: true, links, title });
              }
            }
          } catch {}
        }

        // Step 2: Try direct page patterns
        const patterns = [
          /href="(https?:\/\/[^"]*\.(?:mp4|mkv|m3u8)[^"]*)"/gi,
          /href="(https?:\/\/[^"]*(?:r2\.cloudflarestorage|fastdl|gdtot|gdrive|mega\.nz|mediafire)[^"]*)"/gi,
          /"(https?:\/\/[^"]*(?:r2\.cloudflarestorage|fastdl\.zip|gdtot|gdrive|video-downloads\.googleapis)[^"]*\.(?:mp4|mkv)[^"]*)"/gi,
        ];

        for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(pageHtml)) !== null) {
            const link = match[1].replace(/&amp;/g, "&");
            if (!links.includes(link) && !junk.some(j => link.includes(j))) {
              links.push(link);
            }
          }
        }

        if (links.length > 0) {
          const title = pageHtml.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() || "";
          logger.info(`Cloud resolved: ${links.length} links found`);
          return res.json({ success: true, links, title });
        }

        // Try sportverse/php pattern (original hubcloud)
        const phpMatch2 = pageHtml.match(/href="(https:\/\/sportverse\.cc\/hubcloud\.php[^"]+)"/);
        if (phpMatch2) {
          let phpUrl2 = phpMatch2[1].replace(/&amp;/g, "&");
          const phpResp2 = await fetch(phpUrl2, { headers, redirect: "follow" });
          if (phpResp2.ok) {
            const phpHtml2 = await phpResp2.text();
            const r2Match = phpHtml2.match(/href="(https:\/\/[^"]*r2\.cloudflarestorage\.com[^"]+)"/);
            if (r2Match) {
              const directUrl = r2Match[1].replace(/&amp;/g, "&");
              const fileName = pageHtml.match(/<title>([^<]+)<\/title>/)?.[1] || "";
              return res.json({ success: true, links: [directUrl], title: fileName.trim() });
            }
          }
        }

        return res.status(502).json({ error: "No download links found" });
      }

      // --- Other URLs: try to follow redirects ---
      try {
        logger.info(`Generic resolve: ${url}`);
        const resp = await fetch(url.startsWith("http") ? url : `https://${url}`, {
          headers,
          redirect: "follow",
        });
        const finalUrl = resp.url || url;
        const contentType = resp.headers.get("content-type") || "";

        if (contentType.includes("video") || finalUrl.match(/\.(mp4|mkv|m3u8)/)) {
          return res.json({ success: true, links: [finalUrl], title: "" });
        }

        const html = await resp.text();
        const videoMatch = html.match(/(?:src|href)=["'](https?:\/\/[^"']*\.(?:mp4|mkv|m3u8)[^"']*)/);
        if (videoMatch) {
          return res.json({ success: true, links: [videoMatch[1]], title: "" });
        }

        return res.status(502).json({ error: "No direct link found" });
      } catch (e) {
        return res.status(502).json({ error: e.message });
      }

      return res.status(400).json({ error: "Unsupported URL" });
    } catch (err) {
      req.app.locals.logger.error(`Hubcloud resolve error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
