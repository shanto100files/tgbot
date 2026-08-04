import { Router } from "express";

export function createProvidersRouter() {
  const router = Router();

  router.get("/", (req, res) => {
    const loader = req.app.locals.providerLoader;
    const manifest = loader.getManifest();
    const allNames = loader.getProviderNames();

    const providers = allNames.map((name) => {
      const p = loader.getProvider(name);
      const manifestEntry = manifest.find((m) => m.value === name);
      return {
        value: name,
        display_name: p.displayName || manifestEntry?.display_name || name,
        type: p.type || manifestEntry?.type || "custom",
        disabled: p.disabled ?? manifestEntry?.disabled ?? false,
        modules: Object.keys(p.modules),
      };
    });

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
