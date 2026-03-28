const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
]);

export function normalizeUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  for (const param of TRACKING_PARAMS) {
    url.searchParams.delete(param);
  }
  url.searchParams.sort();

  let normalized = url.toString();
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}
