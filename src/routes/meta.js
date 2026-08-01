import { Router } from "express";

export function createMetaRouter() {
  const router = Router();

  router.get("/:provider", async (req, res) => {
    try {
      const loader = req.app.locals.providerLoader;
      const provider = loader.getProvider(req.params.provider);

      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      if (!provider.modules.meta?.getMeta) {
        return res
          .status(404)
          .json({ error: "Provider has no meta module" });
      }

      const { link } = req.query;
      if (!link) {
        return res
          .status(400)
          .json({ error: "Missing query parameter: link" });
      }

      const signal = AbortSignal.timeout(30000);

      const meta = await provider.modules.meta.getMeta({
        link,
        provider: provider.name,
        signal,
        providerContext: loader.createContext(),
      });

      res.json({ provider: provider.name, ...meta });
    } catch (err) {
      req.app.locals.logger.error(`Meta error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
