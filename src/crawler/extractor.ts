import * as cheerio from "cheerio";
import { normalizeUrl } from "./normalizer";

/** Check if hostname belongs to the seed domain (with or without www). */
function isSameDomain(hostname: string, seedDomain: string): boolean {
  return (
    hostname === seedDomain ||
    hostname === `www.${seedDomain}` ||
    seedDomain === `www.${hostname}`
  );
}

export function extractLinks(html: string, pageUrl: string, seedDomain: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const normalized = normalizeUrl(href, pageUrl);
    if (!normalized) return;

    try {
      const { hostname } = new URL(normalized);
      if (isSameDomain(hostname, seedDomain)) {
        links.push(normalized);
      }
    } catch {
      // skip malformed URLs
    }
  });

  return links;
}
