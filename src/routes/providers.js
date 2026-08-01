import { Router } from "express";

export function createProvidersRouter() {
  const router = Router();

  router.get("/", (req, res) => {
    const loader = req.app.locals.providerLoader;
    const providers = loader.getManifest();
    res.json(providers);
  });

  router.get("/:name", (req, res) => {
    const loader = req.app.locals.providerLoader;
    const provider = loader.getProvider(req.params.name);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found" });
    }
    res.json({
      name: provider.name,
      displayName: provider.displayName,
      version: provider.version,
      type: provider.type,
      disabled: provider.disabled,
      modules: Object.keys(provider.modules),
    });
  });

  return router;
}
