import { getStats, clearAll } from "./db.js";
import { fullScrape } from "./scrapers.js";

export async function fullScrapeRun(onProgress, forceClear = false) {
  console.log("[SCRAPER] Starting full parallel scrape...");
  const start = Date.now();

  if (forceClear) {
    clearAll();
    console.log("[SCRAPER] Cleared old data");
  }

  const result = await fullScrape(onProgress);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const stats = getStats();
  console.log(`[SCRAPER] Complete in ${elapsed}s. Total: ${stats.total} posts, ${stats.links} links, ${stats.resolved} resolved`);
  return stats;
}
