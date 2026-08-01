import axios from "axios";
import * as cheerio from "cheerio";

export async function getEpisodes({ url, providerContext }) {
  const { axios: ax, cheerio: ch } = providerContext;
  const fullUrl = url.startsWith("http") ? url : `https://your-site.com${url}`;

  const res = await ax.get(fullUrl);
  const $ = ch.load(res.data);
  const episodes = [];

  $(".episode-item").each((i, el) => {
    const title = $(el).find(".ep-title").text().trim();
    const link = $(el).find("a").attr("href");
    const description = $(el).find(".ep-desc").text().trim();
    const image = $(el).find("img").attr("src");

    if (title && link) {
      episodes.push({ title, link, description, image });
    }
  });

  return episodes;
}
