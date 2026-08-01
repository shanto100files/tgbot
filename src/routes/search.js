import { Router } from "express";

export function createSearchRouter() {
  const router = Router();

  router.get("/:provider", async (req, res) => {
    try {
      const loader = req.app.locals.providerLoader;
      const provider = loader.getProvider(req.params.provider);

      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      if (!provider.modules.posts?.getSearchPosts) {
        return res
          .status(404)
          .json({ error: "Provider does not support search" });
      }

      const { q, page = 1 } = req.query;
      if (!q) {
        return res
          .status(400)
          .json({ error: "Missing search query parameter: q" });
      }

      const signal = AbortSignal.timeout(30000);

      const posts = await provider.modules.posts.getSearchPosts({
        searchQuery: q,
        page: Number(page),
        providerValue: provider.name,
        signal,
        providerContext: loader.createContext(),
      });

      res.json({ provider: provider.name, query: q, page: Number(page), posts });
    } catch (err) {
      req.app.locals.logger.error(`Search error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
