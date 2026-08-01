import { Router } from "express";

export function createStreamRouter() {
  const router = Router();

  // GET handler
  router.get("/:provider", async (req, res) => {
    await handleStream(req, res);
  });

  // POST handler - better for complex links with & characters
  router.post("/:provider", async (req, res) => {
    await handleStream(req, res);
  });

  async function handleStream(req, res) {
    try {
      const loader = req.app.locals.providerLoader;
      const logger = req.app.locals.logger;
      const provider = loader.getProvider(req.params.provider);

      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      if (!provider.modules.stream?.getStream) {
        return res
          .status(404)
          .json({ error: "Provider has no stream module" });
      }

      // Support both GET query params and POST body
      const link = req.query.link || req.body?.link;
      const type = req.query.type || req.body?.type || "movie";

      if (!link) {
        return res
          .status(400)
          .json({ error: "Missing parameter: link" });
      }

      logger.info(`Stream request: provider=${req.params.provider}, link=${link}, type=${type}`);

      const signal = AbortSignal.timeout(60000);

      const streams = await provider.modules.stream.getStream({
        link,
        type,
        signal,
        providerContext: loader.createContext(),
      });

      logger.info(`Stream response: ${streams?.length || 0} streams found`);
      res.json({ provider: provider.name, link, type, streams });
    } catch (err) {
      req.app.locals.logger.error(`Stream error [${req.params.provider}]: ${err.message}`);
      res.status(500).json({
        error: err.message,
        provider: req.params.provider,
        hint: "The provider's external server may be blocking requests or the link format is wrong. Try a different provider.",
      });
    }
  }

  return router;
}
