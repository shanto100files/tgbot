import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import sharp from "sharp";
import { getDB, getDownloadLinks, updateResolvedLink, getResolvedLink } from "./src/db.js";
import { ensureWorkingDomain, detectNewDomainFromRedirect, fixLinkDomain, getDomainCache, setDomainCache } from "./src/domains.js";

// --- Create collage from up to 3 images ---
async function createCollage(imageUrls) {
  const validUrls = imageUrls.filter(u => u && u.startsWith("http")).slice(0, 3);
  if (!validUrls.length) return null;

  try {
    const images = await Promise.all(
      validUrls.map(url => axios.get(url, { responseType: "arraybuffer", timeout: 10000 }).then(r => r.data))
    );

    const W = 200, H = 300;
    const count = images.length;

    if (count === 1) {
      return await sharp(images[0]).resize(W, H, { fit: "cover" }).png().toBuffer();
    }

    // Create side-by-side collage
    const totalW = W * count;
    const collage = sharp({ create: { width: totalW, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } } });

    const composites = [];
    for (let i = 0; i < count; i++) {
      const resized = await sharp(images[i]).resize(W, H, { fit: "cover" }).toBuffer();
      composites.push({ input: resized, left: i * W, top: 0 });
    }

    return await collage.composite(composites).png().toBuffer();
  } catch (e) {
    console.log(`[COLLAGE] Error: ${e.message}`);
    return null;
  }
}

const BOT_TOKEN = "8383924215:AAGCgKOMFqYs792iEpOXF92JTWQSaqFZ7CI";
const API_BASE = "http://localhost:3000/api";
const TMDB_KEY = "7300351df93ae28d50e92aba76a55a3c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const VEGA_API = "https://rude-danell-first100-642ab0e0.koyeb.app";
const CINEPIX_API = "https://cinepix.top";
const CONCURRENCY = 8;

function classifyCloudType(link) {
  if (!link) return "unknown";
  if (link.includes("hubcloud")) return "hubcloud";
  if (link.includes("hubcdn")) return "hubcdn";
  if (link.includes("hubdrive") || link.includes("drivehub")) return "hubdrive";
  if (link.includes("cinecloud") || link.includes("cinefreak")) return "cinecloud";
  if (link.includes("gadgetsweb") || link.includes("yagaverse")) return "cinecloud";
  if (link.includes("generate.php")) return "cinecloud";
  if (link.includes("pixeldrain")) return "pixeldrain";
  if (link.includes("r2.dev") || link.includes("cloudflarestorage")) return "cfstorage";
  if (link.includes("googleusercontent") || link.includes("video-downloads")) return "gdrive";
  if (link.includes("cloud.unblocked") || link.includes("new5.")) return "vcloud";
  if (link.includes("nexdrive")) return "nexdrive";
  if (link.includes("mega.nz") || link.includes("mega.co")) return "mega";
  if (link.includes("mediafire")) return "mediafire";
  return "other";
}

const CLOUD_SHORT = {
  cinecloud: "c-cloud", hubcloud: "h-cloud", hubdrive: "h-drive",
  hubcdn: "h-cdn", nexdrive: "n-drive", vcloud: "v-cloud",
  cfstorage: "r2", gdrive: "g-drive", pixeldrain: "pd",
  mega: "mega", mediafire: "mf", other: "link",
};

// Site এর ৮টি provider
const SITE_PROVIDERS = ["vega", "uhd", "movies4u", "a111477", "4khdhub", "topmovies", "luxMovies", "movieBoxWeb"];

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Callback data store (64 byte limit bypass)
const store = new Map();
let storeId = 0;
function save(data) { const id = ++storeId; store.set(id, data); if (store.size > 2000) store.delete(store.keys().next().value); return id; }
function get(id) { return store.get(id); }

// --- Helpers ---
async function showTyping(chatId) { try { await bot.sendChatAction(chatId, "typing"); } catch {} }

async function loadingAnim(chatId, text) {
  const steps = ["🔍", "🔎", "📡", "🌐", "✨"];
  const msg = await bot.sendMessage(chatId, `${steps[0]} ${text}`);
  let i = 0;
  const iv = setInterval(async () => { i = (i + 1) % steps.length; try { await bot.editMessageText(`${steps[i]} ${text}`, { chat_id: chatId, message_id: msg.message_id }); } catch {} }, 600);
  return { msg, stop: () => clearInterval(iv) };
}

function esc(t) { return String(t || "").replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&"); }

function extractSize(text) {
  const m = text.match(/\[([0-9.]+\s*[KMGT]?B\/?E?)\]/i);
  return m ? m[1] : "";
}

function extractLanguage(text) {
  const langs = [];
  if (/\bHindi\b/i.test(text)) langs.push("Hindi");
  if (/\bEnglish\b/i.test(text)) langs.push("English");
  if (/\bDual Audio\b/i.test(text)) langs.push("Dual");
  if (/\bMulti Audio\b|\bMULTI\b/i.test(text)) langs.push("Multi");
  if (/\bTamil\b/i.test(text)) langs.push("Tamil");
  if (/\bTelugu\b/i.test(text)) langs.push("Telugu");
  if (/\bBengali\b|\bBangla\b/i.test(text)) langs.push("Bangla");
  return langs.join("|");
}

const PAGE_SIZE = 10;

function buildPageText(query, total, page) {
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  return `✅ *"${esc(query)}"* - ${total}টি link\n📄 দেখাচ্ছে ${start}-${end} (${page}/${Math.ceil(total / PAGE_SIZE)})\n\nসিলেক্ট করুন:`;
}

function buildPageButtons(allFiles, page, parentId) {
  const total = allFiles.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;
  const pageFiles = allFiles.slice(start, start + PAGE_SIZE);

  const PROV_SHORT = { vega: "V", uhd: "U", movies4u: "M4U", a111477: "A7", "4khdhub": "4K", topmovies: "TM", luxMovies: "LX", movieBoxWeb: "MB", cinefreak: "CF" };

  const buttons = [];
  for (const file of pageFiles) {
    // Use pre-extracted size/language from DB or extract from fileName
    const raw = (file.fileName || "").replace(/^Download\s+/i, "").trim();
    const size = file.size || extractSize(raw);
    const lang = file.language || extractLanguage(raw);
    const prov = PROV_SHORT[file.provider] || file.provider?.slice(0, 3) || "?";

    // Build name
    let name = raw.replace(/\[[0-9.]+\s*[KMGT]?B\/?E?\]/gi, "").replace(/\{[^}]+\}/g, "").replace(/\(Direct Files\)/i, "").trim();
    name = name.replace(/\s+/g, " ").trim();
    if (!name) name = file.quality || "Link";

    const sizeStr = size ? `[${size}]` : "[—]";
    const langStr = lang ? ` ${lang}` : "";
    const btn = `${sizeStr} ${name}${langStr} [${prov}]`.slice(0, 55);
    const id = save({ url: file.url || file.link, title: name.slice(0, 50) });
    buttons.push([{ text: btn, callback_data: `s:${id}` }]);
  }

  // Navigation row
  const nav = [];
  if (page > 1) {
    nav.push({ text: `◀️ আগের`, callback_data: `g:${parentId}:${page - 1}` });
  }
  nav.push({ text: `${page}/${totalPages}`, callback_data: `noop` });
  if (page < totalPages) {
    nav.push({ text: `পরের ▶️`, callback_data: `g:${parentId}:${page + 1}` });
  }
  if (nav.length > 1) buttons.push(nav);

  return buttons;
}

// --- TMDB ---
async function searchTMDB(query) {
  try {
    const { data } = await axios.get(`${TMDB_BASE}/search/multi`, {
      params: { api_key: TMDB_KEY, query, language: "en-US", page: 1 },
      timeout: 10000,
    });
    const results = data.results || [];
    // movies and tv only
    const filtered = results.filter(r => r.media_type === "movie" || r.media_type === "tv");
    if (!filtered.length) return null;
    const r = filtered[0];
    const title = r.title || r.name;
    const year = (r.release_date || r.first_air_date || "").slice(0, 4);
    const poster = r.poster_path ? `${TMDB_IMG}${r.poster_path}` : null;
    const rating = r.vote_average;
    const overview = r.overview;
    const mediaType = r.media_type;
    return { title, year, poster, rating, overview, mediaType };
  } catch { return null; }
}

// --- API ---
async function getAllProviders() {
  const { data } = await axios.get(`${API_BASE}/providers`);
  return data.filter(p => !p.disabled);
}

async function searchProvider(p, q) {
  try {
    const { data } = await axios.get(`${API_BASE}/search/${p.value}`, { params: { q, page: 1 }, timeout: 15000 });
    return (data.posts || []).map(r => ({ ...r, prov: p.value, provName: p.display_name || p.value }));
  } catch { return []; }
}

async function aggregateSearch(q, searchPage = 0) {
  const allProviders = await getAllProviders();
  // All 4 providers - cinefreak now uses WP REST API
  const targetProviders = ["vega", "4khdhub", "hdhub4u", "cinefreak"];
  const matched = allProviders.filter(p => targetProviders.includes(p.value) && p.modules?.includes("posts"));

  // Search all 4 providers
  const results = [];
  for (const p of matched) {
    try {
      const r = await searchProvider(p, q);
      results.push(...r);
    } catch {}
  }

  // Sort by relevance
  const lowerQ = q.toLowerCase();
  results.sort((a, b) => {
    const aStart = (a.title || "").toLowerCase().startsWith(lowerQ) ? 0 : 1;
    const bStart = (b.title || "").toLowerCase().startsWith(lowerQ) ? 0 : 1;
    return aStart - bStart;
  });

  return results.slice(0, 15);
}

async function getMeta(prov, link) {
  try {
    const { data } = await axios.get(`${API_BASE}/meta/${prov}`, { params: { link }, timeout: 20000 });
    return data;
  } catch { return null; }
}

async function getStream(prov, link, type) {
  try {
    const { data } = await axios.post(`${API_BASE}/stream/${prov}`, { link, type }, { timeout: 30000 });
    return data.streams || [];
  } catch { return []; }
}

async function resolveCloud(url) {
  try {
    const { data } = await axios.get(`${API_BASE}/hubcloud`, { params: { url }, timeout: 30000 });
    return data;
  } catch { return null; }
}

async function vegaSearch(query, type = "movie", year = "") {
  try {
    const params = { q: query, type };
    if (year) params.year = year;
    const { data } = await axios.get(`${CINEPIX_API}/api/vega-search`, { params, timeout: 60000 });
    return data.files || [];
  } catch { return []; }
}

async function streamFromUrl(url) {
  try {
    console.log(`[STREAM] Calling: ${url.substring(0, 120)}...`);
    const { data } = await axios.get(url, { timeout: 30000 });
    console.log(`[STREAM] Got ${data.streams?.length || 0} streams`);
    return data.streams || [];
  } catch (e) {
    const status = e.response?.status || "unknown";
    console.log(`[STREAM] Error ${status}: ${e.message}`);
    return [];
  }
}

function isStreamable(file) {
  // Skip files with relative paths (broken links)
  const url = file.url || "";
  if (url.includes("link=%2F") || url.includes("link=/")) return false;
  return true;
}

// --- Commands ---
bot.onText(/\/start/, async (msg) => {
  await showTyping(msg.chat.id);
  bot.sendMessage(msg.chat.id,
    "🎬 *Movie & Series Scraper Bot*\n\nমুভি বা সিরিজের নাম লিখুন।\nসব provider থেকে একসাথে রেজাল্ট আসবে।\n\n*Examples:*\n`Inception`\n`Breaking Bad`\n\n/commands - সব কমান্ড",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/commands/, async (msg) => {
  await showTyping(msg.chat.id);
  bot.sendMessage(msg.chat.id,
    "*📖 Commands:*\n\n/start - শুরু\n/providers - provider লিস্ট\n/movie <নাম> - মুভি সার্চ\n/series <নাম> - সিরিজ সার্চ\n\nযেকোনো টেক্সট লিখলেও সার্চ হবে।",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/providers/, async (msg) => {
  const chatId = msg.chat.id;
  const anim = await loadingAnim(chatId, "Provider লোড হচ্ছে...");
  try {
    const providers = await getAllProviders();
    anim.stop();
    if (!providers.length) return bot.editMessageText("😔 কোনো provider নেই।", { chat_id: chatId, message_id: anim.msg.message_id });
    let list = `*📦 ${providers.length}টি Provider:*\n\n`;
    providers.forEach((p, i) => {
      const icon = p.type === "movie" ? "🎬" : p.type === "series" ? "📺" : "📁";
      const mods = p.modules || [];
      const f = [];
      if (mods.includes("posts")) f.push("🔍");
      if (mods.includes("stream")) f.push("▶️");
      if (mods.includes("episodes")) f.push("📺");
      list += `${i + 1}. ${icon} ${esc(p.display_name || p.value)} ${f.join("")}\n`;
    });
    bot.editMessageText(list, { chat_id: chatId, message_id: anim.msg.message_id, parse_mode: "Markdown" });
  } catch { anim.stop(); bot.editMessageText("❌ সমস্যা।", { chat_id: chatId, message_id: anim.msg.message_id }); }
});

bot.onText(/\/movie (.+)/, async (msg, m) => handleSearch(msg.chat.id, m[1], "movie"));
bot.onText(/\/series (.+)/, async (msg, m) => handleSearch(msg.chat.id, m[1], "series"));

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  await handleSearch(msg.chat.id, msg.text, null);
});

// --- Detect Bengali/Bangla content ---
function isBengaliQuery(query, tmdb) {
  const q = query.toLowerCase();
  if (/bangla|bengali|বাংলা|বাঙালি/i.test(q)) return true;
  if (tmdb?.overview && /bangla|bengali/i.test(tmdb.overview)) return true;
  return false;
}

// --- SEARCH → Live search, collage of 3 provider images ---
async function handleSearch(chatId, query, forcedType, searchPage = 0) {
  await showTyping(chatId);

  try {
    // Detect Bengali
    const bangla = /bangla|bengali|বাংলা|বাঙালি/i.test(query);

    // Live search from all providers
    const liveResults = await aggregateSearch(query, searchPage);
    let posts = liveResults.map(r => ({
      provider: r.prov,
      title: r.title,
      fileName: r.title,
      link: r.link,
      quality: r.quality || "",
      image: r.image || "",
    }));

    // If Bengali - prioritize cinefreak results at top
    if (bangla && posts.length) {
      posts.sort((a, b) => {
        if (a.provider === "cinefreak" && b.provider !== "cinefreak") return -1;
        if (a.provider !== "cinefreak" && b.provider === "cinefreak") return 1;
        return 0;
      });
    }

    if (!posts.length) {
      return bot.sendMessage(chatId, `😔 *"${esc(query)}"* - আর কোনো result নেই।`, { parse_mode: "Markdown" });
    }

    const PROV_SHORT = { cinefreak: "CF", vega: "V", hdhub4u: "H4U", "4khdhub": "4K" };

    // Strict relevance filter: all query words must appear in title
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const relevant = posts.filter(p => {
      const t = p.title.toLowerCase();
      // Must contain majority of query words (at least 70%)
      const matchCount = queryWords.filter(w => t.includes(w)).length;
      return matchCount >= Math.ceil(queryWords.length * 0.7);
    });

    // Use relevant results for display, fallback to all if nothing matches
    const displayPosts = relevant.length >= 2 ? relevant : posts;
    posts = displayPosts;

    // Sort: Bengali first if bangla query, else by relevance
    if (bangla && posts.length) {
      posts.sort((a, b) => {
        if (a.provider === "cinefreak" && b.provider !== "cinefreak") return -1;
        if (a.provider !== "cinefreak" && b.provider === "cinefreak") return 1;
        return 0;
      });
    }

    if (!posts.length) {
      return bot.sendMessage(chatId, `😔 *"${esc(query)}"* - আর কোনো result নেই।`, { parse_mode: "Markdown" });
    }

    // Collect unique images from RELEVANT results only
    const seen = new Set();
    const collageImages = [];
    for (const p of posts) {
      if (p.image && !seen.has(p.image)) {
        seen.add(p.image);
        collageImages.push(p.image);
        if (collageImages.length === 3) break;
      }
    }

    const banglaTag = bangla ? " [BD]" : "";
    const text = `✅ *"${esc(query)}"*${banglaTag} - ${posts.length}টি result\n\nসিলেক্ট করো:`;

    // Build buttons (max 20)
    const buttons = [];
    for (const post of posts.slice(0, 20)) {
      const prov = PROV_SHORT[post.provider] || post.provider?.slice(0, 3) || "?";
      const lang = extractLanguage(post.title);
      const langTag = lang ? ` [${lang}]` : "";
      const label = `${post.title.slice(0, 38)}${langTag} [${prov}]`.slice(0, 55);
      const id = save({ post, query });
      buttons.push([{ text: label, callback_data: `d:${id}` }]);
    }

    // Try collage (need 2+ images)
    if (collageImages.length >= 2) {
      const collageBuf = await createCollage(collageImages);
      if (collageBuf) {
        await bot.sendPhoto(chatId, collageBuf, {
          caption: text,
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: buttons },
        });
        return;
      }
    }

    // Fallback: first image or text only
    const firstImage = posts.find(p => p.image)?.image;
    if (firstImage) {
      await bot.sendPhoto(chatId, firstImage, {
        caption: text,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons },
      });
    } else {
      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons },
      });
    }
  } catch (err) {
    bot.sendMessage(chatId, `❌ ${err.message}`);
  }
}

// --- CALLBACK ---
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  try {
    const parts = query.data.split(":");
    const act = parts[0];

    // noop
    if (act === "noop") return bot.answerCallbackQuery(query.id);

    // more:ID - load more results from next providers
    if (act === "more") {
      bot.answerCallbackQuery(query.id, { text: "🔄 Load More..." });
      const data = get(id);
      if (!data) return bot.answerCallbackQuery(query.id, { text: "⏰ Expired" });
      return handleSearch(chatId, data.query, null, data.searchPage || 0);
    }

    // nav:ID - navigate cards
    if (act === "nav") {
      bot.answerCallbackQuery(query.id);
      const data = get(id);
      if (!data) return bot.answerCallbackQuery(query.id, { text: "⏰ Expired" });
      const { cards, cardIndex, query: q } = data;
      if (!cards || !cards[cardIndex]) return bot.answerCallbackQuery(query.id, { text: "⏰ Expired" });

      const PROV_SHORT = { cinefreak: "CF", vega: "V", hdhub4u: "H4U", "4khdhub": "4K" };
      const card = cards[cardIndex];
      const image = card.find(p => p.image)?.image;

      const buttons = [];
      for (const post of card) {
        const prov = PROV_SHORT[post.provider] || post.provider?.slice(0, 3) || "?";
        const lang = extractLanguage(post.title);
        const langTag = lang ? ` [${lang}]` : "";
        const label = `${post.title.slice(0, 38)}${langTag} [${prov}]`.slice(0, 55);
        const pid = save({ post, query: q });
        buttons.push([{ text: label, callback_data: `d:${pid}` }]);
      }

      // Nav buttons
      const navRow = [];
      if (cardIndex > 0) {
        const prevId = save({ query: q, cards, cardIndex: cardIndex - 1 });
        navRow.push({ text: "◀️ Prev", callback_data: `nav:${prevId}` });
      }
      navRow.push({ text: `${cardIndex + 1}/${cards.length}`, callback_data: "noop" });
      if (cardIndex < cards.length - 1) {
        const nextId = save({ query: q, cards, cardIndex: cardIndex + 1 });
        navRow.push({ text: "▶️ Next", callback_data: `nav:${nextId}` });
      }
      buttons.push(navRow);

      const text = `✅ *"${esc(q)}"* - Card ${cardIndex + 1}/${cards.length}\n\nসিলেক্ট করো:`;

      if (image) {
        return bot.sendPhoto(chatId, image, {
          caption: text, parse_mode: "Markdown",
          reply_markup: { inline_keyboard: buttons },
        });
      }
      bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons },
      });
    }

    // g:filesId:page - goto page
    if (act === "g") {
      const filesId = parseInt(parts[1]);
      const page = parseInt(parts[2]);
      const data = get(filesId);
      if (!data) return bot.answerCallbackQuery(query.id, { text: "⏰ Expired" });
      bot.answerCallbackQuery(query.id);
      const msgText = buildPageText(data.query, data.allFiles.length, page);
      const buttons = buildPageButtons(data.allFiles, page, filesId);
      return bot.editMessageText(msgText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons },
      });
    }

    const id = parseInt(parts[1]);
    const data = get(id);
    if (!data) return bot.answerCallbackQuery(query.id, { text: "⏰ Expired, search again." });

    // d:ID - fetch meta and show download links with season tabs + pagination
    if (act === "d") {
      bot.answerCallbackQuery(query.id, { text: "📥 Links লোড হচ্ছে..." });
      const post = data.post;
      const prov = post.provider;

      // Live fetch meta from provider
      let downloads = [];
      try {
        const { data: meta } = await axios.get(`${API_BASE}/meta/${prov}`, {
          params: { link: post.link },
          timeout: 25000,
        });
        for (const group of (meta.linkList || [])) {
          for (const dl of (group.directLinks || [])) {
            if (dl.link) {
              downloads.push({
                quality_title: group.title || "",
                quality: group.quality || "",
                link_title: dl.title || "",
                cloud_link: dl.link,
                cloud_type: classifyCloudType(dl.link),
              });
            }
          }
        }
      } catch (e) {
        console.log(`[META] ${prov} meta error: ${e.message}`);
      }

      if (!downloads.length) {
        return bot.sendMessage(chatId, `😔 *${esc(post.title)}* - কোনো download link পাওয়া যায়নি।`, { parse_mode: "Markdown" });
      }

      // Deduplicate by cloud_link
      const seen = new Set();
      const unique = downloads.filter(d => {
        if (seen.has(d.cloud_link)) return false;
        seen.add(d.cloud_link);
        return true;
      });

      // Store downloads for pagination
      const dlId = save({ downloads: unique, post, query: data.query, season: "all", page: 0 });

      // Show with season tabs + pagination
      return showDownloadPage(chatId, dlId, query.message.message_id);
    }

    // dlpage:ID:SEASON:PAGE - pagination for download links
    if (act === "dlpage") {
      bot.answerCallbackQuery(query.id);
      const dlData = get(id);
      if (dlData) {
        dlData.season = parts[2] || "all";
        dlData.page = parseInt(parts[3]) || 0;
      }
      return showDownloadPage(chatId, id, query.message.message_id);
    }

    // dl:ID - resolve cloud link to direct link
    if (act === "dl") {
      bot.answerCallbackQuery(query.id, { text: "⏳ Direct link বানাচ্ছে..." });
      await handleCloudResolve(chatId, data);
    }

    // Legacy handlers
    if (act === "s") {
      bot.answerCallbackQuery(query.id, { text: "⏳ Stream লোড হচ্ছে..." });
      await handleStreamGet(chatId, data);
    }
    else if (act === "r") {
      bot.answerCallbackQuery(query.id, { text: "⏳ Quality লোড হচ্ছে..." });
      await handleQualitySelect(chatId, data);
    }
    if (act === "f") {
      bot.answerCallbackQuery(query.id, { text: "⏳ Files লোড হচ্ছে..." });
      await handleFileSelect(chatId, data);
    }
    if (act === "c") {
      bot.answerCallbackQuery(query.id, { text: "⏳ Resolve হচ্ছে..." });
      await handleCloudResolve(chatId, data);
    }
    if (act === "q") {
      bot.answerCallbackQuery(query.id, { text: "⏳ Stream লোড হচ্ছে..." });
      await handleStreamGet(chatId, data);
    }
  } catch (err) {
    bot.sendMessage(chatId, `❌ ${err.message}`);
  }
});

// --- SHOW DOWNLOAD PAGE with season tabs + pagination ---
function showDownloadPage(chatId, dlId, msgId) {
  const data = get(dlId);
  if (!data) return;

  const { downloads, post, query, season, page } = data;
  const DL_PAGE_SIZE = 10;

  // Extract seasons
  const seasonSet = new Set();
  for (const dl of downloads) {
    const m = (dl.quality_title || "").match(/S(\d+)/i);
    if (m) seasonSet.add(`S${m[1].padStart(2, "0")}`);
  }
  const seasons = [...seasonSet].sort();

  // Filter by season
  let filtered = downloads;
  if (season && season !== "all") {
    filtered = downloads.filter(d => (d.quality_title || "").toLowerCase().includes(season.toLowerCase()));
  }

  // Pagination
  const total = filtered.length;
  const totalPages = Math.ceil(total / DL_PAGE_SIZE);
  const pageItems = filtered.slice(page * DL_PAGE_SIZE, (page + 1) * DL_PAGE_SIZE);

  // Build buttons
  const buttons = [];

  // Season tabs (if series)
  if (seasons.length > 1) {
    const seasonRow = [];
    seasonRow.push({ text: season === "all" ? "✅ All" : "All", callback_data: `dlpage:${dlId}` });
    for (const s of seasons) {
      const active = season === s;
      seasonRow.push({ text: active ? `✅ ${s}` : s, callback_data: `dlpage:${dlId}:${s}:0` });
    }
    // Split into rows of 4
    for (let i = 0; i < seasonRow.length; i += 4) {
      buttons.push(seasonRow.slice(i, i + 4));
    }
  }

  // Download links
  for (const dl of pageItems) {
    const cloud = CLOUD_SHORT[dl.cloud_type] || dl.cloud_type?.slice(0, 6) || "?";

    // Extract episode number from link_title, quality_title, or post title
    let ep = "";
    const epMatch = (dl.link_title || "").match(/Episode-?(\d+)/i)
      || (dl.quality_title || "").match(/Episode-?(\d+)/i);
    if (epMatch) {
      ep = `E${epMatch[1].padStart(2, "0")}`;
    } else {
      // Try to get episode range from post title (e.g., "[Episode 97-104]" or "Chapter 12")
      const postTitle = post?.title || "";
      const epRange = postTitle.match(/\[Episode[s]?\s+(\d+)-(\d+)\]/i)
        || postTitle.match(/Episode[s]?\s+(\d+)-(\d+)/i);
      if (epRange) {
        ep = `Ep${epRange[1]}-${epRange[2]}`;
      } else {
        // Try chapter/episode number from title
        const chapMatch = postTitle.match(/Chapter\s+(\d+)/i) || postTitle.match(/Episode\s+(\d+)/i);
        if (chapMatch) ep = `E${chapMatch[1].padStart(2, "0")}`;
      }
    }

    const sizeMatch = (dl.link_title || "").match(/([\d.]+\s*[KMGT]B)/i);
    const size = sizeMatch ? sizeMatch[1] : "";
    const q = dl.quality_title || dl.quality || "";
    const shortQ = q.replace(/\{[^}]+\}/g, "").replace(/\[.*?\]/g, "").trim().slice(0, 25);
    const label = ep
      ? `${shortQ} ${ep} [${size}] [${cloud}]`
      : `${shortQ} [${size}] [${cloud}]`;
    const lid = save({ cloud_link: dl.cloud_link, cloud_type: dl.cloud_type, post });
    buttons.push([{ text: label.slice(0, 50), callback_data: `dl:${lid}` }]);
  }

  // Pagination nav
  if (totalPages > 1) {
    const nav = [];
    if (page > 0) nav.push({ text: "◀️", callback_data: `dlpage:${dlId}:${season}:${page - 1}` });
    nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages - 1) nav.push({ text: "▶️", callback_data: `dlpage:${dlId}:${season}:${page + 1}` });
    buttons.push(nav);
  }

  // Back
  const bid = save({ post, query });
  buttons.push([{ text: "◀️ Back", callback_data: `d:${bid}`}]);

  const text = `📥 *${esc(post.title)}*\n${season !== "all" ? `📋 Season: ${season}\n` : ""}${total}টি link | Page ${page + 1}/${totalPages || 1}`;

  if (msgId) {
    return bot.editMessageText(text, {
      chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    }).catch(() => {
      bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } });
    });
  }
  bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } });
}
async function handleQualitySelect(chatId, data) {
  await showTyping(chatId);
  const anim = await loadingAnim(chatId, `"${esc(data.n)}" quality খুঁজছি...`);

  const [meta, tmdb] = await Promise.all([
    getMeta(data.p, data.l),
    searchTMDB(data.n),
  ]);
  anim.stop();

  if (!meta || !meta.linkList?.length) {
    return bot.editMessageText("😔 কোনো quality option পাওয়া যায়নি।", {
      chat_id: chatId, message_id: anim.msg.message_id,
    });
  }

  try { await bot.deleteMessage(chatId, anim.msg.message_id); } catch {}

  let info = `🎬 *${esc(meta.title || data.n)}*\n`;
  if (tmdb?.rating || meta.rating) info += `⭐ ${tmdb?.rating || meta.rating}`;
  if (tmdb?.year) info += ` | ${tmdb.year}`;
  if (meta.tags?.length) info += ` | ${meta.tags.slice(0, 3).join(", ")}`;
  if (meta.cast?.length) info += `\n🎭 ${meta.cast.slice(0, 3).join(", ")}`;
  if (tmdb?.overview || meta.synopsis) info += `\n\n_${esc((tmdb?.overview || meta.synopsis || "").slice(0, 200))}_`;
  info += `\n\n📺 *${meta.linkList.length}টি quality:*\nসিলেক্ট করুন:`;

  const buttons = [];
  for (const item of meta.linkList) {
    const quality = item.quality || item.title;
    const link = item.directLinks?.[0]?.link || item.episodesLink;
    if (!link) continue;
    const id = save({ p: data.p, l: link, n: `${meta.title} ${quality}`, t: data.t || "movie" });
    buttons.push([{ text: `${quality} ⬇️`, callback_data: `q:${id}` }]);
  }

  if (!buttons.length) {
    return bot.sendMessage(chatId, "😔 কোনো download link পাওয়া যায়নি।");
  }

  bot.sendMessage(chatId, info, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
}

// --- CLOUD RESOLVE (hubcloud/nexdrive → direct links) ---
async function handleCloudResolve(chatId, data) {
  await showTyping(chatId);
  const cloudLink = data.cloud_link || data.url || "";
  const cloudType = data.cloud_type || "";
  const post = data.post || {};
  const title = post.title || data.title || "";

  const anim = await loadingAnim(chatId, `⏳ ${title.slice(0, 40)} resolve হচ্ছে...`);

  // Check resolved cache first
  const cached = getResolvedLink(cloudLink);
  if (cached) {
    anim.stop();
    try { await bot.deleteMessage(chatId, anim.msg.message_id); } catch {}
    const host = new URL(cached).hostname;
    return bot.sendMessage(chatId, `✅ *${esc(title.slice(0, 60))}*\n\n📥 Direct Link:`, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: `📥 Download (${host})`, url: cached }]] },
    });
  }

  let link = cloudLink;
  try { link = await fixLinkDomain(cloudType, cloudLink); } catch {}

  // Collect ALL direct links
  let allLinks = [];
  const junk = ["wp-content", "wp-includes", "wp-json", "xmlrpc", "/feed", "googleapis", "gtag", "googletagmanager", "oembed", "emoji", "litespeed", "jquery", "bootstrap", "fontawesome", "cloudflare", "cdn-cgi", "challenge-platform", ".css", ".js", ".png", ".jpg", ".gif", ".svg", ".woff", ".ttf", ".ico", "schema.org", "w.org", "fonts.googleapis"];

  try {
    const res = await axios.get(link, {
      timeout: 15000,
      maxRedirects: 10,
      validateStatus: () => true,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" },
    });

    const finalUrl = res.request?.res?.responseUrl || res.request?.responseURL || link;
    const html = typeof res.data === "string" ? res.data : "";

    // Extract ALL direct links from page
    const patterns = [
      /href="(https?:\/\/[^"]*\.(?:mp4|mkv|m3u8)[^"]*)"/gi,
      /href="(https?:\/\/[^"]*(?:r2\.cloudflarestorage|fastdl|gdtot|gdrive|mega\.nz|mediafire)[^"]*)"/gi,
      /"(https?:\/\/[^"]*(?:r2\.cloudflarestorage|fastdl\.zip|gdtot|gdrive|video-downloads\.googleapis)[^"]*\.(?:mp4|mkv)[^"]*)"/gi,
      /"(https?:\/\/[^"]*\.(?:mp4|mkv|m3u8)[^"]*)"/gi,
      /src="(https?:\/\/[^"]*\.(?:mp4|mkv|m3u8|m4s)[^"]*)"/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1].replace(/&amp;/g, "&");
        if (!allLinks.includes(url) && !junk.some(j => url.includes(j))) {
          allLinks.push(url);
        }
      }
    }

    // For hubdrive/hubcloud - also check inner hubcloud links
    if (cloudType === "hubdrive" || cloudType === "hubcloud") {
      const innerLinks = html.match(/href="(https?:\/\/[^"]*(?:hubcloud|cinecloud|nexdrive)[^"]*)"/gi) || [];
      for (const inner of innerLinks) {
        const innerUrl = inner.match(/href="([^"]+)"/)?.[1];
        if (innerUrl && innerUrl !== cloudLink) {
          try {
            const innerRes = await axios.get(innerUrl, {
              timeout: 12000,
              maxRedirects: 5,
              validateStatus: () => true,
              headers: { "User-Agent": "Mozilla/5.0" },
            });
            const innerHtml = typeof innerRes.data === "string" ? innerRes.data : "";
            for (const pattern of patterns) {
              let m;
              while ((m = pattern.exec(innerHtml)) !== null) {
                const url = m[1].replace(/&amp;/g, "&");
                if (!allLinks.includes(url) && !junk.some(j => url.includes(j))) {
                  allLinks.push(url);
                }
              }
            }
          } catch {}
        }
      }
    }

    if (finalUrl !== link) {
      setDomainCache({ [cloudType]: new URL(finalUrl).hostname });
    }
  } catch (e) {
    console.log(`[RESOLVE] Error: ${e.message}`);
  }

  // Try hubcloud API as fallback
  if (!allLinks.length && (cloudType === "hubcloud" || cloudType === "hubdrive")) {
    try {
      const streamUrl = `${VEGA_API}/api/hubcloud?url=${encodeURIComponent(link)}`;
      const { data } = await axios.get(streamUrl, { timeout: 20000 });
      if (data?.links?.length) {
        allLinks.push(...data.links.filter(l => !allLinks.includes(l)));
      }
    } catch {}
  }

  // Try hubcloud router as fallback
  if (!allLinks.length) {
    try {
      const { data } = await axios.get(`${API_BASE}/hubcloud`, { params: { url: link }, timeout: 20000 });
      if (data?.links?.length) {
        allLinks.push(...data.links.filter(l => !allLinks.includes(l)));
      }
    } catch {}
  }

  anim.stop();

  if (!allLinks.length) {
    try { await bot.deleteMessage(chatId, anim.msg.message_id); } catch {}
    return bot.sendMessage(chatId, `😔 *${esc(title.slice(0, 50))}*\n\nDirect link resolve করা যায়নি। অন্য quality try করো।`, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: "noop" }]] },
    });
  }

  // Cache first link
  try { updateResolvedLink(cloudLink, allLinks[0]); } catch {}

  try { await bot.deleteMessage(chatId, anim.msg.message_id); } catch {}

  // Show ALL direct links as buttons
  const buttons = allLinks.map((url, i) => {
    const host = new URL(url).hostname.replace("www.", "");
    const name = url.match(/\.(mp4|mkv|m3u8)/i)?.[1]?.toUpperCase() || "Link";
    return [{ text: `📥 ${name} ${i + 1} (${host})`, url }];
  });

  bot.sendMessage(chatId, `✅ *${esc(title.slice(0, 60))}*\n\n📥 *${allLinks.length}টি Direct Link:*`, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
}

// --- FILE SELECT (from vega-search) ---
async function handleFileSelect(chatId, data) {
  await showTyping(chatId);
  const anim = await loadingAnim(chatId, `"${esc(data.quality)}" files লোড হচ্ছে...`);

  try {
    const buttons = [];
    for (const file of data.files.slice(0, 10)) {
      const name = (file.fileName || "Link").replace(/[,.()\[\]{}!@#$%^&*=+|\\:;'"<>?/`~–—]/g, "").replace(/\s+/g, " ").trim().slice(0, 45);
      const id = save({ url: file.url, title: name });
      buttons.push([{ text: `${name}`, callback_data: `s:${id}` }]);
    }
    anim.stop();
    try { await bot.deleteMessage(chatId, anim.msg.message_id); } catch {}

    bot.sendMessage(chatId, `📥 *${esc(data.title)}* - ${data.quality}\n\n${data.files.length}টি file:\nলিংক সিলেক্ট করুন:`, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (err) {
    anim.stop();
    bot.sendMessage(chatId, `❌ ${err.message}`);
  }
}

// --- STREAM GET (direct URL from stream API) ---
async function handleStreamGet(chatId, data) {
  await showTyping(chatId);
  const anim = await loadingAnim(chatId, `⏳ ${data.title} এর direct link লোড হচ্ছে...`);

  console.log(`[STREAM-GET] url: ${data.url}`);
  const streams = await streamFromUrl(data.url);
  console.log(`[STREAM-GET] got ${streams.length} streams`);
  anim.stop();

  if (!streams.length) {
    try { await bot.deleteMessage(chatId, anim.msg.message_id); } catch {}
    return bot.sendMessage(chatId, "😔 এই লিংক দিয়ে stream পাওয়া যায়নি। অন্য লিংক try করুন।");
  }

  try { await bot.deleteMessage(chatId, anim.msg.message_id); } catch {}

  let text = `✅ *${esc(data.title)}*\n\n📥 *${streams.length}টি Direct Link:*\n\n`;
  const buttons = streams.map((s, i) => {
    const url = s.link || s.url || "";
    const server = s.server || `Link ${i + 1}`;
    const type = s.type ? ` (${s.type})` : "";
    return [{ text: `${server}${type}`, url }];
  });

  bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  });
}

console.log("🤖 Bot running...");
