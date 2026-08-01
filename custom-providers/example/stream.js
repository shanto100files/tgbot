import axios from "axios";
import * as cheerio from "cheerio";

export async function getStream({ link, type, signal, providerContext }) {
  const { axios: ax, cheerio: ch } = providerContext;
  const url = link.startsWith("http") ? link : `https://your-site.com${link}`;

  const res = await ax.get(url, { signal });
  const $ = ch.load(res.data);
  const streams = [];

  // Example: extract video links
  $(".stream-link").each((i, el) => {
    const server = $(el).find(".server-name").text().trim();
    const videoUrl = $(el).attr("data-url");
    const quality = $(el).attr("data-quality") || "1080";

    if (videoUrl) {
      streams.push({
        server,
        link: videoUrl,
        type: "mp4",
        quality,
      });
    }
  });

  return streams;
}
