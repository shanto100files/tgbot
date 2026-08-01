import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const VEGA_PROVIDERS_DIR = path.join(PROJECT_ROOT, "_providers");
const DIST_DIR = path.join(VEGA_PROVIDERS_DIR, "dist");
const MANIFEST_PATH = path.join(VEGA_PROVIDERS_DIR, "manifest.json");
const CUSTOM_PROVIDERS_DIR = path.join(PROJECT_ROOT, "custom-providers");

export class ProviderLoader {
  constructor(logger) {
    this.logger = logger;
    this.providers = new Map();
    this.manifest = [];
  }

  async loadAll() {
    this.providers.clear();
    this.manifest = [];

    // Load Vega providers from dist/
    if (fs.existsSync(DIST_DIR)) {
      await this.loadVegaProviders();
    } else {
      this.logger.warn(
        "No _providers/dist found. Run setup first: npm run setup"
      );
    }

    // Load custom providers
    if (fs.existsSync(CUSTOM_PROVIDERS_DIR)) {
      await this.loadCustomProviders();
    }

    this.logger.info(
      `Loaded ${this.providers.size} providers: ${[...this.providers.keys()].join(", ")}`
    );
  }

  async loadVegaProviders() {
    // Read manifest
    if (fs.existsSync(MANIFEST_PATH)) {
      this.manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
    }

    // Find all provider directories in dist/
    const entries = fs.readdirSync(DIST_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const providerName = entry.name;
      try {
        await this.loadProvider(providerName, path.join(DIST_DIR, providerName));
      } catch (err) {
        this.logger.error(`Failed to load provider ${providerName}: ${err.message}`);
      }
    }
  }

  async loadCustomProviders() {
    const entries = fs.readdirSync(CUSTOM_PROVIDERS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const providerName = entry.name;
      if (this.providers.has(providerName)) continue; // skip if vega already loaded
      try {
        await this.loadProvider(providerName, path.join(CUSTOM_PROVIDERS_DIR, providerName));
      } catch (err) {
        this.logger.error(`Failed to load custom provider ${providerName}: ${err.message}`);
      }
    }
  }

  async loadProvider(name, dirPath) {
    const provider = { name, modules: {} };
    const modules = ["catalog", "posts", "meta", "stream", "episodes"];

    for (const mod of modules) {
      const filePath = path.join(dirPath, `${mod}.js`);
      if (fs.existsSync(filePath)) {
        // Dynamic import with cache busting
        const fileUrl = `file://${filePath}?t=${Date.now()}`;
        const imported = await import(fileUrl);
        provider.modules[mod] = imported;
      }
    }

    // Get manifest info if available
    const manifestEntry = this.manifest.find((m) => m.value === name);
    if (manifestEntry) {
      provider.displayName = manifestEntry.display_name;
      provider.version = manifestEntry.version;
      provider.type = manifestEntry.type;
      provider.disabled = manifestEntry.disabled;
    } else {
      provider.displayName = name;
      provider.version = "1.0";
      provider.type = "custom";
      provider.disabled = false;
    }

    this.providers.set(name, provider);
  }

  getProvider(name) {
    return this.providers.get(name);
  }

  getProviderNames() {
    return [...this.providers.keys()];
  }

  getManifest() {
    return this.manifest.filter((m) => !m.disabled);
  }

  createContext() {
    return {
      axios,
      Aes: null,
      commonHeaders: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
      cheerio,
      openWebView: async () => {
        throw new Error("openWebView not supported in server mode");
      },
    };
  }
}
