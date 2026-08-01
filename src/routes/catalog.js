import { Router } from "express";

export function createCatalogRouter() {
  const router = Router();

  router.get("/:provider", async (req, res) => {
    try {
      const loader = req.app.locals.providerLoader;
      const provider = loader.getProvider(req.params.provider);
      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      if (!provider.modules.catalog) {
        return res
          .status(404)
          .json({ error: "Provider has no catalog module" });
      }

      const catalog = provider.modules.catalog.catalog || [];
      const genres = provider.modules.catalog.genres || [];

      res.json({ provider: provider.name, catalog, genres });
    } catch (err) {
      req.app.locals.logger.error(`Catalog error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
