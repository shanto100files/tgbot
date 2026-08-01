import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createLogger } from "./src/logger.js";
import { ProviderLoader } from "./src/providerLoader.js";
import { createProvidersRouter } from "./src/routes/providers.js";
import { createCatalogRouter } from "./src/routes/catalog.js";
import { createPostsRouter } from "./src/routes/posts.js";
import { createSearchRouter } from "./src/routes/search.js";
import { createMetaRouter } from "./src/routes/meta.js";
import { createStreamRouter } from "./src/routes/stream.js";
import { createEpisodesRouter } from "./src/routes/episodes.js";
import { createResolveRouter } from "./src/routes/resolve.js";
import { createHubcloudRouter } from "./src/routes/hubcloud.js";

const logger = createLogger();
const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api/", limiter);

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// --- Provider Loader ---
const providerLoader = new ProviderLoader(logger);
await providerLoader.loadAll();

// Make loader available to routes
app.locals.providerLoader = providerLoader;
app.locals.logger = logger;

// --- Routes ---
app.use("/api/providers", createProvidersRouter());
app.use("/api/catalog", createCatalogRouter());
app.use("/api/posts", createPostsRouter());
app.use("/api/search", createSearchRouter());
app.use("/api/meta", createMetaRouter());
app.use("/api/stream", createStreamRouter());
app.use("/api/episodes", createEpisodesRouter());
app.use("/api/resolve", createResolveRouter());
app.use("/api/hubcloud", createHubcloudRouter());

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    providers: providerLoader.getProviderNames().length,
    timestamp: new Date().toISOString(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    availableEndpoints: [
      "GET  /api/providers",
      "GET  /api/catalog/:provider",
      "GET  /api/posts/:provider?filter=&page=",
      "GET  /api/search/:provider?q=&page=",
      "GET  /api/meta/:provider?link=",
      "GET  /api/stream/:provider?link=&type=",
      "GET  /api/episodes/:provider?url=",
      "GET  /api/resolve?url=",
      "POST /api/resolve { url, provider }",
      "GET  /health",
    ],
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error(err.message, { stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

// --- Start ---
app.listen(PORT, "0.0.0.0", () => {
  logger.info(`🚀 Vega API Server running on http://localhost:${PORT}`);
  logger.info(`📡 Providers loaded: ${providerLoader.getProviderNames().length}`);
});
