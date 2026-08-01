import { Router } from "express";

export function createHubcloudRouter() {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url) {
        return res.status(400).json({ error: "Missing 'url' parameter" });
      }

      const decodedUrl = url.startsWith("http") ? url : `https://hubcloud.cx${url}`;
      const logger = req.app.locals.logger;

      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Referer": "https://hubcloud.cx/",
      };

      logger.info(`Hubcloud resolve: ${decodedUrl}`);

      const pageResp = await fetch(decodedUrl, { headers, redirect: "follow" });
      if (!pageResp.ok) {
        return res.status(502).json({ error: `Hubcloud page ${pageResp.status}` });
      }
      const pageHtml = await pageResp.text();

      const phpMatch = pageHtml.match(/href="(https:\/\/sportverse\.cc\/hubcloud\.php[^"]+)"/);
      if (!phpMatch) {
        return res.status(502).json({ error: "No sportverse link found" });
      }

      let phpUrl = phpMatch[1].replace(/&amp;/g, "&");

      const phpResp = await fetch(phpUrl, { headers, redirect: "follow" });
      if (!phpResp.ok) {
        return res.status(502).json({ error: `Sportverse ${phpResp.status}` });
      }
      const phpHtml = await phpResp.text();

      const r2Match = phpHtml.match(/href="(https:\/\/[^"]*r2\.cloudflarestorage\.com[^"]+)"/);
      if (r2Match) {
        const directUrl = r2Match[1].replace(/&amp;/g, "&");
        const fileName = pageHtml.match(/<title>([^<]+)<\/title>/)?.[1] || "";
        logger.info(`Hubcloud resolved: ${fileName}`);
        return res.json({ success: true, directUrl, fileName: fileName.trim() });
      }

      return res.status(502).json({ error: "No R2 link found" });
    } catch (err) {
      req.app.locals.logger.error(`Hubcloud resolve error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
