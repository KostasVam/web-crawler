import { Config } from "../config";
import { Frontier, FrontierItem } from "./frontier";
import { VisitedStore } from "./visited";
import { extractLinks } from "./extractor";
import * as cheerio from "cheerio";

// Inline concurrency limiter (avoids p-limit ESM/CJS issue)
function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
}

export interface PageRecord {
  url: string;
  depth: number;
  status: number;
  title: string;
  links: string[];
}

export interface CrawlResult {
  crawled: number;
  errors: number;
  seedDomain: string;
  pages: PageRecord[];
  durationMs: number;
}

interface FetchResult {
  html: string;
  status: number;
  skipped: boolean;
}

const MAX_RETRIES = 2;
const RETRY_DELAYS = [500, 1500]; // ms — exponential-ish backoff

/** Fetch a single URL with retry on transient errors. */
async function fetchPage(
  url: string,
  timeoutMs: number,
): Promise<FetchResult> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
        headers: { "User-Agent": "IPFabric-Crawler/1.0" },
      });

      // Don't retry client errors (4xx) — they won't change
      if (response.status >= 400 && response.status < 500) {
        console.warn(`  HTTP ${response.status} — skipped`);
        return { html: "", status: response.status, skipped: true };
      }

      // Retry server errors (5xx)
      if (!response.ok) {
        if (attempt < MAX_RETRIES) {
          console.warn(`  HTTP ${response.status} — retry ${attempt + 1}/${MAX_RETRIES}`);
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
        console.warn(`  HTTP ${response.status} — skipped after ${MAX_RETRIES} retries`);
        return { html: "", status: response.status, skipped: true };
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return { html: "", status: response.status, skipped: true };
      }

      const html = await response.text();
      return { html, status: response.status, skipped: false };
    } catch (err) {
      // Retry on network/timeout errors
      if (attempt < MAX_RETRIES) {
        console.warn(`  ${err instanceof Error ? err.message : err} — retry ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw err;
    }
  }

  // Unreachable, but TypeScript needs it
  return { html: "", status: 0, skipped: true };
}

/** Enqueue newly discovered links that haven't been visited yet. */
async function enqueueNewLinks(
  links: string[],
  depth: number,
  frontier: Frontier,
  visited: VisitedStore,
  isStopping: () => boolean,
): Promise<void> {
  for (const link of links) {
    if (isStopping()) break;
    const added = await visited.add(link);
    if (added) {
      await frontier.enqueue({ url: link, depth });
    }
  }
}

export async function crawl(
  config: Config,
  frontier: Frontier,
  visited: VisitedStore,
): Promise<CrawlResult> {
  const startTime = Date.now();
  const limit = pLimit(config.concurrency);
  let crawled = 0;
  let errors = 0;
  let stopping = false;
  const pages: PageRecord[] = [];

  const seedDomain = new URL(config.seed).hostname.replace(/^www\./, "");

  // Enqueue seed
  const isNew = await visited.add(config.seed);
  if (isNew) {
    await frontier.enqueue({ url: config.seed, depth: 0 });
  }

  // Graceful shutdown
  const onSignal = () => {
    console.log("\nGraceful shutdown requested...");
    stopping = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  async function processItem(item: FrontierItem): Promise<void> {
    if (stopping) return;

    console.log(`[depth=${item.depth}] ${item.url}`);

    try {
      const result = await fetchPage(item.url, config.requestTimeout);

      if (result.skipped) return;

      crawled++;

      const $ = cheerio.load(result.html);
      const title = $("title").first().text().trim();

      const links = item.depth < config.maxDepth
        ? extractLinks(result.html, item.url, seedDomain)
        : [];

      pages.push({
        url: item.url,
        depth: item.depth,
        status: result.status,
        title,
        links,
      });

      if (links.length > 0) {
        await enqueueNewLinks(links, item.depth + 1, frontier, visited, () => stopping);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Error: ${msg}`);
      errors++;
    }
  }

  // Main crawl loop
  const inFlight: Set<Promise<void>> = new Set();
  let emptyPolls = 0;
  const maxEmptyPolls = config.mode === "redis" ? 3 : 1;

  while (!stopping) {
    const item = await frontier.dequeue();

    if (!item) {
      // Queue is empty, but tasks in flight may enqueue new URLs.
      // Wait for them to finish before deciding we're done.
      if (inFlight.size > 0) {
        await Promise.race(inFlight);
        continue;
      }

      emptyPolls++;
      if (emptyPolls >= maxEmptyPolls) break;
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    emptyPolls = 0;
    const task = limit(() => processItem(item));
    const tracked = task.finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);

    // Back-pressure: if too many in flight, wait for one to finish
    if (inFlight.size >= config.concurrency * 2) {
      await Promise.race(inFlight);
    }
  }

  await Promise.allSettled(inFlight);

  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  const durationMs = Date.now() - startTime;
  return { crawled, errors, seedDomain, pages, durationMs };
}
