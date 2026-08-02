import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json());

// --- Provider Loader ---
const DIST_DIR = path.join(__dirname, "_providers", "dist");
const MANIFEST_PATH = path.join(__dirname, "_providers", "manifest.json");
const providers = new Map();
let manifest = [];

async function loadProviders() {
  if (!fs.existsSync(DIST_DIR)) {
    console.log("No _providers/dist found. Run: node setup.js");
    return;
  }

  if (fs.existsSync(MANIFEST_PATH)) {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  }

  const entries = fs.readdirSync(DIST_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    try {
      const provider = { name, modules: {} };
      const mods = ["catalog", "posts", "meta", "stream", "episodes"];
      for (const mod of mods) {
        const fp = path.join(DIST_DIR, name, `${mod}.js`);
        if (fs.existsSync(fp)) {
          const imported = await import(`file://${fp}?t=${Date.now()}`);
          provider.modules[mod] = imported;
        }
      }
      const me = manifest.find((m) => m.value === name);
      if (me) {
        provider.displayName = me.display_name;
        provider.version = me.version;
        provider.type = me.type;
        provider.disabled = me.disabled;
      } else {
        provider.displayName = name;
        provider.version = "1.0";
        provider.type = "custom";
        provider.disabled = false;
      }
      providers.set(name, provider);
    } catch (err) {
      console.error(`Failed to load ${name}: ${err.message}`);
    }
  }
  console.log(`Loaded ${providers.size} providers`);
}

function createContext() {
  return {
    axios,
    commonHeaders: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
    cheerio,
  };
}

// --- Routes ---

// Health
app.get("/health", (req, res) => {
  res.json({ status: "ok", providers: providers.size, time: new Date().toISOString() });
});

// Providers list
app.get("/api/providers", (req, res) => {
  const list = [];
  for (const [name, p] of providers) {
    list.push({
      display_name: p.displayName,
      value: name,
      version: p.version,
      type: p.type,
      disabled: p.disabled,
    });
  }
  res.json(list);
});

// Search
app.get("/api/search/:provider", async (req, res) => {
  try {
    const provider = providers.get(req.params.provider);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    if (!provider.modules.posts?.getSearchPosts) return res.status(404).json({ error: "No search" });

    const { q, page = 1 } = req.query;
    if (!q) return res.status(400).json({ error: "Missing q" });

    const signal = AbortSignal.timeout(30000);
    const posts = await provider.modules.posts.getSearchPosts({
      searchQuery: q,
      page: Number(page),
      providerValue: provider.name,
      signal,
      providerContext: createContext(),
    });
    res.json({ provider: provider.name, query: q, page: Number(page), posts });
  } catch (err) {
    console.error(`Search error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Meta
app.get("/api/meta/:provider", async (req, res) => {
  try {
    const provider = providers.get(req.params.provider);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    if (!provider.modules.meta?.getMeta) return res.status(404).json({ error: "No meta" });

    const { link } = req.query;
    if (!link) return res.status(400).json({ error: "Missing link" });

    const signal = AbortSignal.timeout(30000);
    const meta = await provider.modules.meta.getMeta({
      link,
      provider: provider.name,
      signal,
      providerContext: createContext(),
    });
    res.json({ provider: provider.name, ...meta });
  } catch (err) {
    console.error(`Meta error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Stream
app.get("/api/stream/:provider", async (req, res) => {
  try {
    const provider = providers.get(req.params.provider);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    if (!provider.modules.stream?.getStream) return res.status(404).json({ error: "No stream" });

    const link = req.query.link;
    const type = req.query.type || "movie";
    if (!link) return res.status(400).json({ error: "Missing link" });

    console.log(`Stream: ${provider.name} -> ${link}`);
    const signal = AbortSignal.timeout(60000);
    const streams = await provider.modules.stream.getStream({
      link,
      type,
      signal,
      providerContext: createContext(),
    });
    console.log(`Stream result: ${streams?.length || 0} streams`);
    res.json({ provider: provider.name, link, type, streams });
  } catch (err) {
    console.error(`Stream error: ${err.message}`);
    res.status(500).json({ error: err.message, hint: "Provider may be blocking. Try another." });
  }
});

// Episodes
app.get("/api/episodes/:provider", async (req, res) => {
  try {
    const provider = providers.get(req.params.provider);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    if (!provider.modules.episodes?.getEpisodes) return res.status(404).json({ error: "No episodes" });

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing url" });

    const signal = AbortSignal.timeout(30000);
    const episodes = await provider.modules.episodes.getEpisodes({
      url,
      signal,
      providerContext: createContext(),
    });
    res.json({ provider: provider.name, episodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catalog
app.get("/api/catalog/:provider", async (req, res) => {
  try {
    const provider = providers.get(req.params.provider);
    if (!provider) return res.status(404).json({ error: "Provider not found" });
    if (!provider.modules.catalog?.getCatalog) return res.status(404).json({ error: "No catalog" });

    const { filter = "", page = 1 } = req.query;
    const signal = AbortSignal.timeout(30000);
    const catalog = await provider.modules.catalog.getCatalog({
      filter,
      page: Number(page),
      providerValue: provider.name,
      signal,
      providerContext: createContext(),
    });
    res.json({ provider: provider.name, catalog });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generic proxy (for fetching external URLs)
app.get("/api/proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: "Missing url" });
  try {
    const resp = await axios.get(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 20000,
    });
    res.json({ html: resp.data, url: target, status: resp.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    endpoints: [
      "GET /health",
      "GET /api/providers",
      "GET /api/search/:provider?q=",
      "GET /api/meta/:provider?link=",
      "GET /api/stream/:provider?link=&type=",
      "GET /api/episodes/:provider?url=",
      "GET /api/catalog/:provider",
      "GET /api/proxy?url=",
    ],
  });
});

// --- Start ---
console.log("Loading providers...");
await loadProviders();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n=== Cinepix Phone Server ===`);
  console.log(`Local:  http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Providers: ${providers.size}`);
  console.log(`\nFor public URL: cloudflared tunnel --url http://localhost:${PORT}\n`);
});
