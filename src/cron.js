import { fullScrapeRun } from "./scraper.js";

let scrapeInterval = null;
let isScraping = false;

export function startAutoScrape(intervalHours = 24) {
  const ms = intervalHours * 60 * 60 * 1000;
  console.log(`[CRON] Auto-scrape every ${intervalHours}h`);

  // Don't auto-scrape on startup - manual trigger only

  scrapeInterval = setInterval(async () => {
    if (!isScraping) await runScrape();
  }, ms);
}

export async function runScrape() {
  if (isScraping) {
    console.log("[CRON] Already scraping, skip");
    return null;
  }

  isScraping = true;
  console.log("[CRON] Starting scrape...");

  try {
    const stats = await fullScrapeRun();
    isScraping = false;
    return stats;
  } catch (err) {
    console.error("[CRON] Scrape error:", err.message);
    isScraping = false;
    return null;
  }
}

export function stopAutoScrape() {
  if (scrapeInterval) {
    clearInterval(scrapeInterval);
    scrapeInterval = null;
  }
}
