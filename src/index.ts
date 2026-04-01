import * as fs from "fs";
import { parseArgs } from "./config";
import { Frontier } from "./crawler/frontier";
import { VisitedStore } from "./crawler/visited";
import { crawl } from "./crawler/worker";
import { MemoryFrontier } from "./backends/memory/memoryFrontier";
import { MemoryVisited } from "./backends/memory/memoryVisited";

async function main() {
  const config = parseArgs();

  console.log("=== Web Crawler ===");
  console.log(`Seed:        ${config.seed}`);
  console.log(`Max depth:   ${config.maxDepth}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Mode:        ${config.mode}`);
  console.log();

  let frontier: Frontier;
  let visited: VisitedStore;

  if (config.mode === "redis") {
    const { RedisFrontier } = await import("./backends/redis/redisFrontier");
    const { RedisVisited } = await import("./backends/redis/redisVisited");
    frontier = new RedisFrontier(config.redisUrl);
    visited = new RedisVisited(config.redisUrl);
  } else {
    frontier = new MemoryFrontier();
    visited = new MemoryVisited();
  }

  const result = await crawl(config, frontier, visited);

  console.log();
  console.log("=== Summary ===");
  console.log(`Domain:       ${result.seedDomain}`);
  console.log(`Pages crawled: ${result.crawled}`);
  console.log(`Errors:        ${result.errors}`);
  console.log(`URLs visited:  ${await visited.size()}`);

  const secs = (result.durationMs / 1000).toFixed(1);
  const pagesPerSec = result.crawled > 0 ? (result.crawled / (result.durationMs / 1000)).toFixed(1) : "0";
  console.log(`Duration:      ${secs}s (${pagesPerSec} pages/sec)`);

  if (config.output) {
    fs.writeFileSync(config.output, JSON.stringify(result.pages, null, 2));
    console.log(`Output:        ${config.output} (${result.pages.length} records)`);
  }

  await frontier.close?.();
  await visited.close?.();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
