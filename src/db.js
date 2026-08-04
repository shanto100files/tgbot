import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "cache.db");

let db;

export function initDB() {
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      fileName TEXT DEFAULT '',
      link TEXT NOT NULL,
      image TEXT DEFAULT '',
      quality TEXT DEFAULT '',
      size TEXT DEFAULT '',
      language TEXT DEFAULT '',
      type TEXT DEFAULT 'movie',
      year TEXT DEFAULT '',
      imdb_rating TEXT DEFAULT '',
      genre TEXT DEFAULT '',
      scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, link)
    );

    CREATE TABLE IF NOT EXISTS download_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER,
      provider TEXT NOT NULL,
      post_link TEXT NOT NULL,
      quality_title TEXT DEFAULT '',
      quality TEXT DEFAULT '',
      link_title TEXT DEFAULT '',
      cloud_link TEXT NOT NULL,
      cloud_type TEXT DEFAULT '',
      resolved_link TEXT DEFAULT '',
      resolved_at DATETIME,
      scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, post_link, cloud_link)
    );

    CREATE INDEX IF NOT EXISTS idx_posts_title ON posts(title);
    CREATE INDEX IF NOT EXISTS idx_posts_provider ON posts(provider);
    CREATE INDEX IF NOT EXISTS idx_dl_provider ON download_links(provider);
    CREATE INDEX IF NOT EXISTS idx_dl_cloud_link ON download_links(cloud_link);
    CREATE INDEX IF NOT EXISTS idx_dl_resolved ON download_links(resolved_link);
  `);

  console.log("[DB] Initialized:", DB_PATH);
  return db;
}

export function getDB() {
  if (!db) initDB();
  return db;
}

export function upsertPosts(posts) {
  const d = getDB();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO posts (provider, title, fileName, link, image, quality, size, language, type, year, imdb_rating, genre, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const insertMany = d.transaction((items) => {
    for (const p of items) {
      stmt.run(p.provider, p.title, p.fileName || "", p.link, p.image || "", p.quality || "", p.size || "", p.language || "", p.type || "movie", p.year || "", p.imdb_rating || "", p.genre || "");
    }
  });
  insertMany(posts);
  return posts.length;
}

export function upsertDownloadLinks(links) {
  const d = getDB();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO download_links (provider, post_link, quality_title, quality, link_title, cloud_link, cloud_type, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const insertMany = d.transaction((items) => {
    for (const l of items) {
      stmt.run(l.provider, l.post_link, l.quality_title || "", l.quality || "", l.link_title || "", l.cloud_link, l.cloud_type || "");
    }
  });
  insertMany(links);
  return links.length;
}

export function searchPosts(query, limit = 50) {
  const d = getDB();
  const q = `%${query}%`;
  return d.prepare(`
    SELECT * FROM posts
    WHERE title LIKE ? OR fileName LIKE ? OR link LIKE ?
    ORDER BY scraped_at DESC
    LIMIT ?
  `).all(q, q, q, limit);
}

export function getDownloadLinks(postLink) {
  const d = getDB();
  return d.prepare(`
    SELECT * FROM download_links WHERE post_link = ?
  `).all(postLink);
}

export function searchPostsWithLinks(query, limit = 30) {
  const d = getDB();
  const q = `%${query}%`;
  const lowerQ = query.toLowerCase();
  const posts = d.prepare(`
    SELECT *,
      CASE
        WHEN LOWER(title) LIKE ? THEN 1
        WHEN LOWER(title) LIKE ? THEN 2
        WHEN LOWER(fileName) LIKE ? THEN 3
        ELSE 4
      END as relevance
    FROM posts
    WHERE LOWER(title) LIKE ? OR LOWER(fileName) LIKE ? OR LOWER(link) LIKE ?
    ORDER BY relevance ASC, scraped_at DESC
    LIMIT ?
  `).all(`${lowerQ}%`, `%${lowerQ}%`, `%${lowerQ}%`, q, q, q, limit);

  // Attach download links
  for (const post of posts) {
    post.downloads = d.prepare(`
      SELECT * FROM download_links WHERE post_link = ?
    `).all(post.link);
  }

  return posts;
}

export function updateResolvedLink(cloudLink, resolvedLink) {
  const d = getDB();
  d.prepare(`
    UPDATE download_links SET resolved_link = ?, resolved_at = CURRENT_TIMESTAMP WHERE cloud_link = ?
  `).run(resolvedLink, cloudLink);
}

export function getResolvedLink(cloudLink) {
  const d = getDB();
  const row = d.prepare(`
    SELECT resolved_link FROM download_links WHERE cloud_link = ? AND resolved_link != ''
  `).get(cloudLink);
  return row?.resolved_link || null;
}

export function getStats() {
  const d = getDB();
  const total = d.prepare("SELECT COUNT(*) as count FROM posts").get().count;
  const links = d.prepare("SELECT COUNT(*) as count FROM download_links").get().count;
  const resolved = d.prepare("SELECT COUNT(*) as count FROM download_links WHERE resolved_link != ''").get().count;
  const providers = d.prepare("SELECT provider, COUNT(*) as count FROM posts GROUP BY provider ORDER BY count DESC").all();
  const latest = d.prepare("SELECT MAX(scraped_at) as latest FROM posts").get().latest;
  return { total, links, resolved, providers, latest };
}

export function clearAll() {
  const d = getDB();
  d.prepare("DELETE FROM posts").run();
  d.prepare("DELETE FROM download_links").run();
}
