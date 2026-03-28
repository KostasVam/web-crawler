import { normalizeUrl } from "./normalizer";

describe("normalizeUrl", () => {
  it("resolves relative URLs against a base", () => {
    expect(normalizeUrl("/about", "https://example.com/page")).toBe(
      "https://example.com/about",
    );
  });

  it("removes fragment", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe(
      "https://example.com/page",
    );
  });

  it("removes trailing slash", () => {
    expect(normalizeUrl("https://example.com/page/")).toBe(
      "https://example.com/page",
    );
  });

  it("lowercases hostname", () => {
    expect(normalizeUrl("https://EXAMPLE.COM/Page")).toBe(
      "https://example.com/Page",
    );
  });

  it("strips tracking params", () => {
    const url = "https://example.com/page?utm_source=google&utm_medium=cpc&id=5";
    expect(normalizeUrl(url)).toBe("https://example.com/page?id=5");
  });

  it("sorts query params", () => {
    const url = "https://example.com/page?z=1&a=2";
    expect(normalizeUrl(url)).toBe("https://example.com/page?a=2&z=1");
  });

  it("returns null for non-http protocols", () => {
    expect(normalizeUrl("mailto:test@example.com")).toBeNull();
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
    expect(normalizeUrl("ftp://example.com")).toBeNull();
  });

  it("returns null for invalid URLs without a base", () => {
    expect(normalizeUrl("not-a-url")).toBeNull();
  });

  it("handles URLs with no path", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });
});
