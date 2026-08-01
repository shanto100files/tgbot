import { Router } from "express";

export function createStreamRouter() {
  const router = Router();

  router.get("/:provider", async (req, res) => {
    try {
      const loader = req.app.locals.providerLoader;
      const provider = loader.getProvider(req.params.provider);

      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      if (!provider.modules.stream?.getStream) {
        return res
          .status(404)
          .json({ error: "Provider has no stream module" });
      }

      const { link, type = "movie" } = req.query;
      if (!link) {
        return res
          .status(400)
          .json({ error: "Missing query parameter: link" });
      }

      const signal = AbortSignal.timeout(30000);

      const streams = await provider.modules.stream.getStream({
        link,
        type,
        signal,
        providerContext: loader.createContext(),
      });

      res.json({ provider: provider.name, streams });
    } catch (err) {
      req.app.locals.logger.error(`Stream error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
