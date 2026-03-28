import { extractLinks } from "./extractor";

describe("extractLinks", () => {
  const seedDomain = "example.com";
  const pageUrl = "https://example.com/page";

  it("extracts same-domain links", () => {
    const html = `<html><body>
      <a href="https://example.com/about">About</a>
      <a href="https://example.com/contact">Contact</a>
    </body></html>`;

    const links = extractLinks(html, pageUrl, seedDomain);
    expect(links).toContain("https://example.com/about");
    expect(links).toContain("https://example.com/contact");
  });

  it("resolves relative links", () => {
    const html = `<a href="/relative">Link</a>`;
    const links = extractLinks(html, pageUrl, seedDomain);
    expect(links).toContain("https://example.com/relative");
  });

  it("filters out external domain links", () => {
    const html = `
      <a href="https://example.com/ok">OK</a>
      <a href="https://other.com/nope">Nope</a>
    `;
    const links = extractLinks(html, pageUrl, seedDomain);
    expect(links).toContain("https://example.com/ok");
    expect(links).not.toContain("https://other.com/nope");
  });

  it("includes www subdomain of seed", () => {
    const html = `<a href="https://www.example.com/page">Link</a>`;
    const links = extractLinks(html, pageUrl, seedDomain);
    expect(links).toHaveLength(1);
  });

  it("skips anchors with no href", () => {
    const html = `<a>No href</a><a href="">Empty</a>`;
    const links = extractLinks(html, pageUrl, seedDomain);
    // Empty href resolves to current page
    expect(links.length).toBeLessThanOrEqual(1);
  });

  it("skips mailto and javascript links", () => {
    const html = `
      <a href="mailto:a@b.com">Mail</a>
      <a href="javascript:void(0)">JS</a>
    `;
    const links = extractLinks(html, pageUrl, seedDomain);
    expect(links).toHaveLength(0);
  });
});
