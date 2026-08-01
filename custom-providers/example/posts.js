import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://your-site.com";

export async function getPosts({ filter, page, signal, providerContext }) {
  const { axios: ax, cheerio: ch } = providerContext;
  const url = `${BASE_URL}${filter}?page=${page}`;

  const res = await ax.get(url, { signal });
  const $ = ch.load(res.data);
  const posts = [];

  // Example: parse movie cards
  $(".movie-card").each((i, el) => {
    const title = $(el).find(".title").text().trim();
    const link = $(el).find("a").attr("href");
    const image = $(el).find("img").attr("src");

    if (title && link && image) {
      posts.push({ title, link, image });
    }
  });

  return posts;
}

export async function getSearchPosts({ searchQuery, page, signal, providerContext }) {
  const { axios: ax, cheerio: ch } = providerContext;
  const url = `${BASE_URL}/search?q=${encodeURIComponent(searchQuery)}&page=${page}`;

  const res = await ax.get(url, { signal });
  const $ = ch.load(res.data);
  const posts = [];

  $(".movie-card").each((i, el) => {
    const title = $(el).find(".title").text().trim();
    const link = $(el).find("a").attr("href");
    const image = $(el).find("img").attr("src");

    if (title && link && image) {
      posts.push({ title, link, image });
    }
  });

  return posts;
}
