import { Router } from "express";

export function createPostsRouter() {
  const router = Router();

  router.get("/:provider", async (req, res) => {
    try {
      const loader = req.app.locals.providerLoader;
      const logger = req.app.locals.logger;
      const provider = loader.getProvider(req.params.provider);

      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      if (!provider.modules.posts?.getPosts) {
        return res
          .status(404)
          .json({ error: "Provider has no posts module" });
      }

      const { filter = "/category/popular-movies", page = 1 } = req.query;
      const signal = AbortSignal.timeout(30000);

      const posts = await provider.modules.posts.getPosts({
        filter,
        page: Number(page),
        providerValue: provider.name,
        signal,
        providerContext: loader.createContext(),
      });

      res.json({ provider: provider.name, page: Number(page), posts });
    } catch (err) {
      req.app.locals.logger.error(`Posts error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
