const BASE_URL = "https://cinefreak.net";

export async function getPosts({ filter, page, signal, providerContext }) {
  const { axios, cheerio } = providerContext;
  const url = filter === "/"
    ? `${BASE_URL}/page/${page}/`
    : `${BASE_URL}${filter}page/${page}/`;

  const res = await axios.get(url, {
    signal,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  const $ = cheerio.load(res.data);
  const posts = [];

  $("a.movie-card, .movie-card, article a, .post-item a, a[href]").each((i, el) => {
    const href = $(el).attr("href");
    if (!href || !href.includes("cinefreak.net/") || href.includes("/page/") || href === BASE_URL + "/") return;
    if (href.includes("wp-content") || href.includes("wp-admin") || href.includes("generate.php")) return;

    const title = $(el).find(".movie-card-title, h2, h3, .title").text().trim()
      || $(el).attr("title")
      || $(el).text().trim().substring(0, 80);
    const image = $(el).find("img").attr("src") || "";

    if (title && title.length > 3) {
      const postUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
      posts.push({
        title,
        link: postUrl.replace(BASE_URL, ""),
        image,
      });
    }
  });

  return posts;
}

export async function getSearchPosts({ searchQuery, page, signal, providerContext }) {
  const { axios } = providerContext;

  // Use WordPress REST API for search
  try {
    const res = await axios.get(`${BASE_URL}/wp-json/wp/v2/posts`, {
      params: { search: searchQuery, per_page: 20, page },
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });

    return (res.data || []).map(post => {
      // Decode HTML entities in title
      const title = (post.title?.rendered || "")
        .replace(/&#038;/g, "&")
        .replace(/&#8211;/g, "-")
        .replace(/&#8217;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/<[^>]+>/g, "");

      return {
        title,
        link: post.link?.replace(BASE_URL, "") || "",
        image: "",
      };
    }).filter(p => p.title && p.link);
  } catch {
    return [];
  }
}
