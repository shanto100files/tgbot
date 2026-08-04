import axios from "axios";

// Domain mapping - known cloud provider patterns
const DOMAIN_MAP = {
  hubcloud: ["hubcloud.cx", "hubcloud.cc", "hubcloud.to", "hubcloud.vip", "hubcloud.lol"],
  hubdrive: ["hubdrive.tips", "hubdrive.cc", "hubdrive.me", "hubdrive.click"],
  hubcdn: ["hubcdn.sbs", "hubcdn.cc", "hubcdn.me"],
  cinecloud: ["cinecloud.site", "new5.cinecloud.site", "gadgetsweb.xyz", "yagaverse.net"],
  nexdrive: ["nexdrive.fit", "nexdrive.cc", "nexdrive.me"],
};

// Cache for working domains
let domainCache = {};

// Detect working domain for a cloud type
export async function detectWorkingDomain(cloudType, sampleLink) {
  // Check cache first
  if (domainCache[cloudType]) {
    return domainCache[cloudType];
  }

  const domains = DOMAIN_MAP[cloudType] || [];
  if (!domains.length) return null;

  for (const domain of domains) {
    try {
      const testUrl = sampleLink.replace(/https?:\/\/[^/]+/, `https://${domain}`);
      const res = await axios.head(testUrl, { timeout: 8000, maxRedirects: 3 });
      if (res.status < 400) {
        domainCache[cloudType] = domain;
        console.log(`[DOMAIN] Working domain for ${cloudType}: ${domain}`);
        return domain;
      }
    } catch {}
  }

  return null;
}

// Auto-detect new domain from redirect
export async function detectNewDomainFromRedirect(cloudType, link) {
  try {
    const res = await axios.get(link, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
    });

    // Check if redirected to a new domain
    const finalUrl = res.request?.res?.responseUrl || res.request?.responseURL || "";
    if (finalUrl && finalUrl !== link) {
      const newHost = new URL(finalUrl).hostname;
      const oldHost = new URL(link).hostname;
      if (newHost !== oldHost) {
        console.log(`[DOMAIN] ${cloudType}: ${oldHost} -> ${newHost}`);
        domainCache[cloudType] = newHost;
        return { newDomain: newHost, newUrl: finalUrl };
      }
    }

    // Check response for new domain hints
    if (typeof res.data === "string") {
      // Look for meta refresh or JS redirect
      const metaRefresh = res.data.match(/url\s*=\s*["']?([^"'\s>]+)/i);
      if (metaRefresh) {
        const newUrl = metaRefresh[1];
        if (newUrl.startsWith("http")) {
          const newHost = new URL(newUrl).hostname;
          domainCache[cloudType] = newHost;
          return { newDomain: newHost, newUrl };
        }
      }

      // Look for domain in response
      for (const domain of DOMAIN_MAP[cloudType] || []) {
        if (res.data.includes(domain)) {
          domainCache[cloudType] = domain;
          return { newDomain: domain, newUrl: link };
        }
      }
    }
  } catch {}

  return null;
}

// Fix link with working domain
export async function fixLinkDomain(cloudType, link) {
  if (!link || !link.startsWith("http")) return link;

  try {
    const url = new URL(link);
    const workingDomain = domainCache[cloudType];
    if (workingDomain && url.hostname !== workingDomain) {
      url.hostname = workingDomain;
      return url.toString();
    }
  } catch {}

  return link;
}

// Get or detect working domain
export async function ensureWorkingDomain(cloudType, sampleLink) {
  if (domainCache[cloudType]) {
    return domainCache[cloudType];
  }
  return await detectWorkingDomain(cloudType, sampleLink);
}

export function getDomainCache() {
  return { ...domainCache };
}

export function setDomainCache(cache) {
  domainCache = { ...domainCache, ...cache };
}
