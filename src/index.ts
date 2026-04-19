// --- ENTRY POINT ---
// This is the main file that runs when you do: node dist/index.js
// It's the "glue" that connects everything together:
//   1. Parse CLI arguments → Config
//   2. Choose backend (Memory or Redis) → create Frontier + VisitedStore
//   3. Run the crawler → get results
//   4. Print summary + write JSON output
//
// This file implements DEPENDENCY INJECTION manually:
// It creates the concrete implementations (MemoryFrontier or RedisFrontier)
// and passes them to crawl(), which only knows about the INTERFACES.
// In Spring Boot, the DI container does this automatically with @Autowired.

// "import * as fs from 'fs'" imports the entire Node.js filesystem module.
// We only use fs.writeFileSync() to save the JSON output.
// Java equivalent: import java.io.File; (or import java.nio.file.Files;)
import * as fs from "fs";

// Import our modules. These are STATIC imports (loaded at startup).
import { parseArgs } from "./config";
import { Frontier } from "./crawler/frontier";
import { VisitedStore } from "./crawler/visited";
import { crawl } from "./crawler/worker";

// Memory backends are imported statically because they're lightweight (no dependencies).
import { MemoryFrontier } from "./backends/memory/memoryFrontier";
import { MemoryVisited } from "./backends/memory/memoryVisited";
// Note: Redis backends are NOT imported here! They're loaded dynamically below.
// This means if you run in memory mode, the "ioredis" package isn't even loaded.

// main() is async because crawl() is async (it does network I/O).
// "async function" means it returns Promise<void> and can use "await".
async function main() {
  // Parse command-line arguments. Returns a Config object with all settings.
  // Defaults are applied for any missing arguments.
  const config = parseArgs();

  // Print configuration so the user knows what settings are active.
  // Template literals (backticks) allow ${...} interpolation.
  // Java: System.out.println(String.format("Seed: %s", config.seed));
  console.log("=== Web Crawler ===");
  console.log(`Seed:        ${config.seed}`);
  console.log(`Max depth:   ${config.maxDepth}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Mode:        ${config.mode}`);
  console.log();

  // --- DEPENDENCY INJECTION (Manual) ---
  // Declare variables with the INTERFACE type, not the concrete type.
  // This is the Dependency Inversion Principle (SOLID "D"):
  // "Depend on abstractions, not concretions."
  // Java: Frontier frontier; // declared as interface type
  let frontier: Frontier;
  let visited: VisitedStore;

  // Choose implementation based on config.mode.
  // This is the STRATEGY PATTERN: same interface, different implementations,
  // chosen at runtime based on configuration.
  if (config.mode === "redis") {
    // --- DYNAMIC IMPORTS ---
    // "await import(...)" loads the module at runtime, only if we need it.
    // This is different from "import ... from ..." at the top (which loads at startup).
    //
    // WHY? Two reasons:
    //   1. If user runs in memory mode, we don't load ioredis → faster startup
    //   2. If ioredis isn't installed, memory mode still works (no crash)
    //
    // Java equivalent: Class.forName("com.redis.RedisFrontier") — reflection-based loading.
    // Or in modern Java: using ServiceLoader for lazy module loading.
    //
    // The "{ RedisFrontier }" is DESTRUCTURING — extracts just the RedisFrontier export
    // from the module. Same as:
    //   const module = await import("./backends/redis/redisFrontier");
    //   const RedisFrontier = module.RedisFrontier;
    const { RedisFrontier } = await import("./backends/redis/redisFrontier");
    const { RedisVisited } = await import("./backends/redis/redisVisited");

    // Create Redis implementations, connecting to the Redis server.
    // Both receive the same Redis URL so they connect to the same server.
    // Multiple workers can point to the same Redis → shared state!
    frontier = new RedisFrontier(config.redisUrl);
    visited = new RedisVisited(config.redisUrl);
  } else {
    // Memory mode: simple in-process data structures.
    // Fast, no external dependencies, but limited to single process.
    frontier = new MemoryFrontier();
    visited = new MemoryVisited();
  }

  // --- RUN THE CRAWLER ---
  // This is where the magic happens. crawl() receives:
  //   config: settings (depth, concurrency, etc.)
  //   frontier: the URL queue (Memory or Redis — crawl() doesn't know which!)
  //   visited: the visited URL set (Memory or Redis — crawl() doesn't care!)
  //
  // crawl() returns when all URLs are processed or the user presses Ctrl+C.
  const result = await crawl(config, frontier, visited);

  // --- PRINT SUMMARY ---
  console.log();
  console.log("=== Summary ===");
  console.log(`Domain:       ${result.seedDomain}`);
  console.log(`Pages crawled: ${result.crawled}`);
  console.log(`Errors:        ${result.errors}`);
  // "await visited.size()" — still async because it might be a Redis call.
  console.log(`URLs visited:  ${await visited.size()}`);

  // Calculate and display duration.
  // .toFixed(1) formats to 1 decimal place. Java: String.format("%.1f", value)
  const secs = (result.durationMs / 1000).toFixed(1);
  const pagesPerSec = result.crawled > 0 ? (result.crawled / (result.durationMs / 1000)).toFixed(1) : "0";
  console.log(`Duration:      ${secs}s (${pagesPerSec} pages/sec)`);

  // --- WRITE JSON OUTPUT (optional) ---
  // Only if the user specified --output <filename>
  if (config.output) {
    // fs.writeFileSync: write to file synchronously (blocking).
    // JSON.stringify(data, null, 2): convert to JSON with 2-space indentation.
    //   null = no custom replacer function
    //   2 = indent with 2 spaces (pretty-print)
    // Java: Files.writeString(Path.of(output), objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(pages));
    fs.writeFileSync(config.output, JSON.stringify(result.pages, null, 2));
    console.log(`Output:        ${config.output} (${result.pages.length} records)`);
  }

  // --- CLEANUP: Close backends ---
  // Optional chaining "?.": call close() ONLY IF the method exists.
  // MemoryFrontier doesn't have close() → this is a no-op (does nothing).
  // RedisFrontier has close() → this closes the Redis connection.
  //
  // Without "?." you'd need: if (frontier.close) await frontier.close();
  // Java: if (frontier instanceof Closeable) ((Closeable) frontier).close();
  await frontier.close?.();
  await visited.close?.();
}

// --- RUN MAIN ---
// main() is async, so it returns a Promise.
// .catch() handles any unhandled errors (like Redis connection failure).
// Without this, unhandled promise rejections would crash Node.js with a confusing error.
// process.exit(1) exits with error code 1 (convention: 0 = success, non-zero = error).
// Java: try { main() } catch (Exception e) { System.err.println("Fatal: " + e); System.exit(1); }
main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
