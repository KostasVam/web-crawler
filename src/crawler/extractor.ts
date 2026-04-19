// --- LINK EXTRACTOR ---
// Parses an HTML page and extracts all <a href="..."> links that belong
// to the same domain as the seed URL.
//
// This is how the crawler discovers new URLs to visit:
//   1. Fetch a page (worker.ts)
//   2. Extract all links from it (THIS FILE)
//   3. Normalize them (normalizer.ts)
//   4. Check if they've been visited (visited.add())
//   5. Add new ones to the queue (frontier.enqueue())
//
// Java equivalent: Jsoup.parse(html).select("a[href]")

// cheerio: jQuery-like HTML parser for Node.js.
// Lets us use CSS selectors to find elements in HTML.
// Java equivalent: Jsoup
import * as cheerio from "cheerio";

import { normalizeUrl } from "./normalizer";

// isSameDomain: checks if a hostname belongs to our seed domain.
// We only crawl links on the SAME domain — we don't want to crawl the entire internet!
//
// Handles the www prefix:
//   seedDomain = "ipfabric.io"
//   hostname "ipfabric.io" → true (exact match)
//   hostname "www.ipfabric.io" → true (www prefix)
//   hostname "google.com" → false (different domain)
//
// Java: this would be a simple string comparison method.
/** Check if hostname belongs to the seed domain (with or without www). */
function isSameDomain(hostname: string, seedDomain: string): boolean {
  return (
    hostname === seedDomain ||               // Exact match: ipfabric.io === ipfabric.io
    hostname === `www.${seedDomain}` ||      // Link has www: www.ipfabric.io matches ipfabric.io
    seedDomain === `www.${hostname}`         // Seed has www: www.ipfabric.io matches ipfabric.io
  );
}

// extractLinks: the main function. Takes raw HTML and returns an array of normalized URLs.
//
// Parameters:
//   html: the raw HTML string of the page
//   pageUrl: the URL of the page (used to resolve relative links like "/about")
//   seedDomain: the domain we're allowed to crawl (e.g., "ipfabric.io")
//
// Returns: array of normalized URLs on the same domain.
// Example: ["/about", "https://ipfabric.io/products", "https://google.com"]
//   → ["https://ipfabric.io/about", "https://ipfabric.io/products"]
//   (google.com is filtered out — different domain)
export function extractLinks(html: string, pageUrl: string, seedDomain: string): string[] {
  // cheerio.load(html) parses the HTML and returns a jQuery-like function "$".
  // We can use $ to query the HTML like we're in a browser.
  // Java: Document doc = Jsoup.parse(html);
  const $ = cheerio.load(html);
  const links: string[] = [];

  // $("a[href]") finds ALL <a> tags that have an href attribute.
  // "a" = anchor tag, "[href]" = must have href attribute (filters out <a name="...">).
  // .each() iterates over all matches — like Java's forEach().
  //
  // The callback receives:
  //   _ : the index (0, 1, 2...) — we don't use it, so we name it "_" (convention for "unused")
  //   el: the HTML element
  //
  // Java: doc.select("a[href]").forEach(el -> { ... })
  $("a[href]").each((_, el) => {
    // $(el).attr("href") gets the value of the href attribute.
    // Could be: "/about", "https://ipfabric.io/products", "mailto:info@...", "#section", etc.
    // Java: el.attr("href")
    const href = $(el).attr("href");
    if (!href) return;  // Skip if href is empty. "return" in .each() = "continue" in a for loop.

    // Normalize the URL: resolve relative links, remove tracking params, etc.
    // Returns null if the URL is invalid or not HTTP/HTTPS.
    const normalized = normalizeUrl(href, pageUrl);
    if (!normalized) return;  // Skip invalid URLs

    // Check if the link is on the same domain as our seed.
    // We use try/catch because new URL() might throw for weird URLs.
    try {
      // DESTRUCTURING: "const { hostname } = new URL(normalized)"
      // This creates a URL object and extracts ONLY the hostname property.
      // Same as:
      //   const urlObj = new URL(normalized);
      //   const hostname = urlObj.hostname;
      // Java: new URI(normalized).getHost()
      const { hostname } = new URL(normalized);

      if (isSameDomain(hostname, seedDomain)) {
        links.push(normalized);  // Same domain → keep this link!
      }
      // Different domain → silently skip (don't push to links array)
    } catch {
      // skip malformed URLs — the URL constructor threw an error.
      // This shouldn't happen often since normalizeUrl already validates,
      // but it's a safety net.
    }
  });

  return links;
}
