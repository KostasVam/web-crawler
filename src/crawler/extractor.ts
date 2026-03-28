import * as cheerio from "cheerio";
import { normalizeUrl } from "./normalizer";

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
      if (hostname === seedDomain || hostname === `www.${seedDomain}` || seedDomain === `www.${hostname}`) {
        links.push(normalized);
      }
    } catch {
      // skip invalid URLs
    }
  });

  return links;
}
