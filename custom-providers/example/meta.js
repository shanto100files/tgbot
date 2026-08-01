import axios from "axios";
import * as cheerio from "cheerio";

export async function getMeta({ link, provider, providerContext }) {
  const { axios: ax, cheerio: ch } = providerContext;
  const url = link.startsWith("http") ? link : `https://your-site.com${link}`;

  const res = await ax.get(url);
  const $ = ch.load(res.data);

  const title = $("h1.title").text().trim();
  const image = $("img.poster").attr("src") || "";
  const synopsis = $(".description").text().trim();
  const imdbId = $(".imdb-link").attr("data-id") || "";
  const type = $(".type-badge").text().trim().toLowerCase() || "movie";

  // Example: return linkList for seasons/episodes
  const linkList = [];
  $(".season-item").each((i, el) => {
    const seasonTitle = $(el).find(".season-title").text().trim();
    const episodesLink = $(el).find("a").attr("href");
    linkList.push({ title: seasonTitle, episodesLink });
  });

  return { title, image, synopsis, imdbId, type, linkList };
}
