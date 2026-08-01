const BASE_URL = "https://cinefreak.net";

export async function getPosts({ filter, page, signal, providerContext }) {
  const { axios, cheerio } = providerContext;
  const url = filter === "/" 
    ? `${BASE_URL}/page/${page}/`
    : `${BASE_URL}${filter}page/${page}/`;

  const res = await axios.get(url, { signal });
  const $ = cheerio.load(res.data);
  const posts = [];

  $("a.movie-card").each((i, el) => {
    const title = $(el).find(".movie-card-title").text().trim();
    const link = $(el).attr("href");
    const image = $(el).find("img.wp-post-image").attr("src");

    if (title && link) {
      const postUrl = link.startsWith("http") ? link : `${BASE_URL}${link}`;
      posts.push({
        title,
        link: postUrl.replace(BASE_URL, ""),
        image: image || "",
      });
    }
  });

  return posts;
}

export async function getSearchPosts({ searchQuery, page, signal, providerContext }) {
  const { axios, cheerio } = providerContext;
  const url = `${BASE_URL}/page/${page}/?s=${encodeURIComponent(searchQuery)}`;

  const res = await axios.get(url, { signal });
  const $ = cheerio.load(res.data);
  const posts = [];

  $("a.movie-card").each((i, el) => {
    const title = $(el).find(".movie-card-title").text().trim();
    const link = $(el).attr("href");
    const image = $(el).find("img.wp-post-image").attr("src");

    if (title && link) {
      const postUrl = link.startsWith("http") ? link : `${BASE_URL}${link}`;
      posts.push({
        title,
        link: postUrl.replace(BASE_URL, ""),
        image: image || "",
      });
    }
  });

  return posts;
}
