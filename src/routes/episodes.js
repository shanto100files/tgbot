import { Router } from "express";

export function createEpisodesRouter() {
  const router = Router();

  router.get("/:provider", async (req, res) => {
    try {
      const loader = req.app.locals.providerLoader;
      const provider = loader.getProvider(req.params.provider);

      if (!provider) {
        return res.status(404).json({ error: "Provider not found" });
      }

      if (!provider.modules.episodes?.getEpisodes) {
        return res.status(404).json({
          error: "Provider has no episodes module",
        });
      }

      const { url } = req.query;
      if (!url) {
        return res
          .status(400)
          .json({ error: "Missing query parameter: url" });
      }

      const signal = AbortSignal.timeout(30000);

      const episodes = await provider.modules.episodes.getEpisodes({
        url,
        providerContext: loader.createContext(),
      });

      res.json({ provider: provider.name, episodes });
    } catch (err) {
      req.app.locals.logger.error(`Episodes error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
