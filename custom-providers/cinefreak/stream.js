const BASE_URL = "https://cinefreak.net";

export async function getStream({ link, type, signal, providerContext }) {
  const { axios, cheerio } = providerContext;
  const streams = [];

  // If link is a generate.php link, decode the base64 ID to get actual URL
  if (link.includes("generate.php")) {
    const url = link.startsWith("http") ? link : `${BASE_URL}${link}`;
    
    try {
      const res = await axios.get(url, { 
        signal,
        maxRedirects: 5,
        timeout: 15000,
      });
      
      // The generate.php redirects to the actual file URL
      const finalUrl = res.request?.res?.responseUrl || res.headers?.location || url;
      
      // If we got HTML, try to extract the actual link
      if (typeof res.data === 'string' && res.data.includes('href')) {
        const $ = cheerio.load(res.data);
        const redirectLink = $('a').first().attr('href') || $('meta[http-equiv="refresh"]').attr('content')?.split('url=')[1];
        if (redirectLink) {
          streams.push({
            server: "CineFreak GDrive",
            link: redirectLink,
            type: "mp4",
            quality: "1080",
          });
          return streams;
        }
      }
      
      // If it's a direct URL response
      streams.push({
        server: "CineFreak GDrive",
        link: finalUrl,
        type: "mp4",
        quality: "1080",
      });
    } catch (err) {
      // If redirect fails, try to decode the base64 directly
      try {
        const urlObj = new URL(link.startsWith("http") ? link : `${BASE_URL}${link}`);
        const id = urlObj.searchParams.get("id");
        if (id) {
          const decoded = Buffer.from(id, 'base64').toString('utf-8');
          streams.push({
            server: "CineFreak Direct",
            link: decoded,
            type: "mp4",
            quality: "1080",
          });
        }
      } catch (e) {
        streams.push({
          server: "CineFreak",
          link: link,
          type: "mp4",
          quality: "1080",
        });
      }
    }
  } else {
    // Direct link
    streams.push({
      server: "CineFreak",
      link: link.startsWith("http") ? link : `${BASE_URL}${link}`,
      type: "mp4",
      quality: "1080",
    });
  }

  return streams;
}
