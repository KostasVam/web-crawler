// --- URL NORMALIZER ---
// Ensures that the same web page always has the SAME URL string.
// Without this, the crawler would visit the same page multiple times
// because the same page can be reached via different URL forms.
//
// Example — all of these point to the SAME page:
//   https://ipfabric.io/about#team             (has fragment #team)
//   https://ipfabric.io/about?utm_source=google (has tracking param)
//   https://ipfabric.io/about/                  (has trailing slash)
//   https://IPFabric.IO/about                   (uppercase hostname)
//   https://ipfabric.io/about?b=2&a=1           (params in different order)
//
// After normalization, ALL become: "https://ipfabric.io/about"
// The visited Set then correctly identifies them as the same URL.

// TRACKING PARAMS: parameters added by analytics tools to track where users come from.
// They don't change the page content, so we strip them out.
// "new Set([...])" creates a Set for O(1) lookup. Java: Set.of(...)
const TRACKING_PARAMS = new Set([
  "utm_source",     // Google Analytics: where the traffic came from (google, twitter, etc.)
  "utm_medium",     // Google Analytics: what type (email, social, cpc)
  "utm_campaign",   // Google Analytics: which campaign
  "utm_term",       // Google Analytics: search keyword
  "utm_content",    // Google Analytics: which ad variant
  "fbclid",         // Facebook: click tracking ID
  "gclid",          // Google Ads: click tracking ID
  "ref",            // Generic referrer parameter
]);

// normalizeUrl: takes a raw URL (possibly relative) and returns a clean, canonical form.
// Returns null if the URL is invalid or not HTTP/HTTPS.
//
// "base" parameter: used to resolve relative URLs.
// Example: raw = "/about", base = "https://ipfabric.io/products"
//   → resolved to "https://ipfabric.io/about"
// In Java: new URI(base).resolve(raw)
//
// Return type "string | null" means: either a string OR null (union type).
// In Java: @Nullable String or Optional<String>
export function normalizeUrl(raw: string, base?: string): string | null {
  // "base?: string" — the "?" makes it an OPTIONAL PARAMETER.
  // If not provided, it's undefined. Java: @Nullable String base

  // Try to parse the URL. If it's malformed, URL constructor throws → catch → return null.
  let url: URL;
  try {
    // "new URL(raw, base)":
    //   - If raw is absolute ("https://..."): base is ignored
    //   - If raw is relative ("/about"): resolved against base
    //   - If raw is garbage: throws TypeError
    // Java: new URI(raw) or new URI(base).resolve(raw)
    url = new URL(raw, base);
  } catch {
    // "catch" without a variable — we don't care about the error details.
    // The URL was malformed, so we skip it. Java: catch (URISyntaxException ignored) {}
    return null;
  }

  // Only process HTTP and HTTPS URLs.
  // Skip: mailto:, tel:, ftp:, javascript:, data:, etc.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  // STEP 1: Remove the fragment (the #... part).
  // Fragments are client-side only — the server sends the same page.
  // "https://ipfabric.io/about#team" and "https://ipfabric.io/about" = same server response.
  url.hash = "";

  // STEP 2: Lowercase the hostname.
  // DNS is case-insensitive: IPFabric.IO = ipfabric.io
  // But URL strings are case-sensitive, so we normalize to lowercase.
  url.hostname = url.hostname.toLowerCase();

  // STEP 3: Remove tracking parameters.
  // These are added by marketing tools and don't change the page content.
  // "for...of" iterates over each value in the Set.
  for (const param of TRACKING_PARAMS) {
    url.searchParams.delete(param);
  }

  // STEP 4: Sort remaining query parameters alphabetically.
  // "?b=2&a=1" and "?a=1&b=2" are the same query, just in different order.
  // Sorting ensures they produce the same string.
  url.searchParams.sort();

  // STEP 5: Remove trailing slash.
  // "https://ipfabric.io/about/" and "https://ipfabric.io/about" = same page.
  // .toString() converts the URL object back to a string.
  // .endsWith("/") checks if it ends with a slash.
  // .slice(0, -1) removes the last character. Java: str.substring(0, str.length() - 1)
  let normalized = url.toString();
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}
