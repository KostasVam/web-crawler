import { Config } from "../config";
import { Frontier, FrontierItem } from "./frontier";
import { VisitedStore } from "./visited";
import { extractLinks } from "./extractor";

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

export interface CrawlResult {
  crawled: number;
  errors: number;
  seedDomain: string;
}

export async function crawl(
  config: Config,
  frontier: Frontier,
  visited: VisitedStore,
): Promise<CrawlResult> {
  const limit = pLimit(config.concurrency);
  let crawled = 0;
  let errors = 0;
  let stopping = false;

  // Determine seed domain from the final URL after redirects
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
      const response = await fetch(item.url, {
        signal: AbortSignal.timeout(config.requestTimeout),
        redirect: "follow",
        headers: { "User-Agent": "IPFabric-Crawler/1.0" },
      });

      if (!response.ok) {
        console.warn(`  HTTP ${response.status} — skipped`);
        errors++;
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return;
      }

      crawled++;
      const html = await response.text();

      if (item.depth >= config.maxDepth) return;

      const links = extractLinks(html, item.url, seedDomain);

      for (const link of links) {
        if (stopping) break;
        const added = await visited.add(link);
        if (added) {
          await frontier.enqueue({ url: link, depth: item.depth + 1 });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Error: ${msg}`);
      errors++;
    }
  }

  // Main crawl loop
  const inFlight: Promise<void>[] = [];
  let emptyPolls = 0;
  const maxEmptyPolls = config.mode === "redis" ? 3 : 1;

  while (!stopping) {
    const item = await frontier.dequeue();

    if (!item) {
      emptyPolls++;
      if (emptyPolls >= maxEmptyPolls) break;
      // Wait a bit for distributed workers to enqueue more items
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    emptyPolls = 0;
    const task = limit(() => processItem(item));
    inFlight.push(task);

    // Prevent unbounded memory growth
    if (inFlight.length >= config.concurrency * 2) {
      await Promise.race(inFlight);
      // Remove settled promises
      for (let i = inFlight.length - 1; i >= 0; i--) {
        const settled = await Promise.race([
          inFlight[i].then(() => true),
          Promise.resolve(false),
        ]);
        if (settled) inFlight.splice(i, 1);
      }
    }
  }

  // Wait for remaining in-flight tasks
  await Promise.allSettled(inFlight);

  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  return { crawled, errors, seedDomain };
}
