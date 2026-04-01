import * as http from "http";
import { crawl } from "./worker";
import { MemoryFrontier } from "../backends/memory/memoryFrontier";
import { MemoryVisited } from "../backends/memory/memoryVisited";
import { Config } from "../config";

// Simple HTML pages for a 3-page site
const pages: Record<string, string> = {
  "/": `<html>
    <head><title>Home</title></head>
    <body>
      <a href="/about">About</a>
      <a href="/blog">Blog</a>
      <a href="https://external.com">External</a>
      <a href="mailto:test@test.com">Email</a>
    </body>
  </html>`,

  "/about": `<html>
    <head><title>About Us</title></head>
    <body>
      <a href="/">Home</a>
      <a href="/blog">Blog</a>
    </body>
  </html>`,

  "/blog": `<html>
    <head><title>Blog</title></head>
    <body>
      <a href="/">Home</a>
      <a href="/post/1">Post 1</a>
    </body>
  </html>`,

  "/post/1": `<html>
    <head><title>Post 1</title></head>
    <body>
      <a href="/blog">Back to blog</a>
    </body>
  </html>`,
};

let server: http.Server;
let baseUrl: string;

beforeAll((done) => {
  server = http.createServer((req, res) => {
    const html = pages[req.url ?? ""];
    if (html) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    seed: baseUrl,
    maxDepth: 10,
    concurrency: 2,
    mode: "memory",
    redisUrl: "",
    requestTimeout: 5000,
    output: "",
    ...overrides,
  };
}

describe("crawler integration", () => {
  it("crawls all reachable pages", async () => {
    const frontier = new MemoryFrontier();
    const visited = new MemoryVisited();
    const result = await crawl(makeConfig(), frontier, visited);

    expect(result.crawled).toBe(4);
    expect(result.errors).toBe(0);

    const urls = result.pages.map((p) => new URL(p.url).pathname).sort();
    expect(urls).toEqual(["/", "/about", "/blog", "/post/1"]);
  });

  it("respects max depth", async () => {
    const frontier = new MemoryFrontier();
    const visited = new MemoryVisited();
    const result = await crawl(makeConfig({ maxDepth: 1 }), frontier, visited);

    // depth 0 = /, depth 1 = /about + /blog
    expect(result.crawled).toBe(3);

    const urls = result.pages.map((p) => new URL(p.url).pathname).sort();
    expect(urls).toEqual(["/", "/about", "/blog"]);
  });

  it("does not crawl external domains", async () => {
    const frontier = new MemoryFrontier();
    const visited = new MemoryVisited();
    const result = await crawl(makeConfig(), frontier, visited);

    const hosts = result.pages.map((p) => new URL(p.url).hostname);
    expect(hosts.every((h) => h === "127.0.0.1")).toBe(true);
  });

  it("never visits the same URL twice", async () => {
    const frontier = new MemoryFrontier();
    const visited = new MemoryVisited();
    const result = await crawl(makeConfig(), frontier, visited);

    const urls = result.pages.map((p) => p.url);
    const unique = new Set(urls);
    expect(urls.length).toBe(unique.size);
  });

  it("extracts page titles", async () => {
    const frontier = new MemoryFrontier();
    const visited = new MemoryVisited();
    const result = await crawl(makeConfig(), frontier, visited);

    const titles = result.pages.map((p) => p.title).sort();
    expect(titles).toEqual(["About Us", "Blog", "Home", "Post 1"]);
  });

  it("records outgoing links per page", async () => {
    const frontier = new MemoryFrontier();
    const visited = new MemoryVisited();
    const result = await crawl(makeConfig(), frontier, visited);

    const homePage = result.pages.find((p) => new URL(p.url).pathname === "/");
    expect(homePage).toBeDefined();
    // Home links to /about and /blog (external and mailto filtered out)
    expect(homePage!.links.length).toBe(2);
  });

  it("handles depth 0 (seed only)", async () => {
    const frontier = new MemoryFrontier();
    const visited = new MemoryVisited();
    const result = await crawl(makeConfig({ maxDepth: 0 }), frontier, visited);

    expect(result.crawled).toBe(1);
    expect(result.pages[0].title).toBe("Home");
    expect(result.pages[0].links).toEqual([]);
  });
});
