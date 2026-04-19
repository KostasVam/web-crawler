// --- CONFIGURATION ---
// This file handles all settings for the crawler.
// Settings can come from CLI arguments (like --seed https://example.com)
// or fall back to sensible defaults.

// Config interface: defines ALL settings the crawler needs.
// In Java this would be a class with fields, or a record.
// In Spring Boot, this would be @ConfigurationProperties with application.yml.
export interface Config {
  seed: string;          // The starting URL to crawl (e.g., "https://ipfabric.io")
  maxDepth: number;      // How deep to follow links (0 = only seed, 2 = seed + 2 levels)
  concurrency: number;   // Max simultaneous HTTP requests (passed to pLimit)

  // UNION TYPE: mode can ONLY be "memory" or "redis" — nothing else.
  // In Java you'd use an enum: enum Mode { MEMORY, REDIS }
  // This determines which backend implementations to use:
  //   "memory" → MemoryFrontier + MemoryVisited (single process, no Redis needed)
  //   "redis"  → RedisFrontier + RedisVisited (multi-process, needs Redis server)
  mode: "memory" | "redis";

  redisUrl: string;      // Redis connection string (only used in "redis" mode)
  requestTimeout: number; // HTTP request timeout in milliseconds
  output: string;        // File path to write JSON output (empty = don't write)
}

// Default values — used when the user doesn't specify a setting.
// The "const" keyword + explicit type means TypeScript checks all fields are present.
// "10_000" is just "10000" — underscores are visual separators (like 10,000 in English).
// This works in both TypeScript and modern Java (since Java 7: 10_000).
const defaults: Config = {
  seed: "https://ipfabric.io",
  maxDepth: 2,
  concurrency: 5,
  mode: "memory",
  redisUrl: "redis://localhost:6379",
  requestTimeout: 10_000,   // 10 seconds
  output: "",
};

// parseArgs: reads command-line arguments and merges them with defaults.
// In Java: public static Config parseArgs(String[] args)
// In Spring Boot: you wouldn't need this — Spring handles it automatically.
//
// "argv: string[] = process.argv.slice(2)" means:
//   - argv is an array of strings
//   - default value is process.argv.slice(2)
//   - process.argv = ["/path/to/node", "/path/to/script.js", "--seed", "https://..."]
//   - .slice(2) skips the first two → ["--seed", "https://..."]
//   - In Java: args in main(String[] args) already has only the user's arguments.
export function parseArgs(argv: string[] = process.argv.slice(2)): Config {
  // SPREAD OPERATOR: { ...defaults } creates a COPY of defaults.
  // Without this, we'd be modifying the original defaults object.
  // Java equivalent: new Config(defaults) — copy constructor.
  const config = { ...defaults };

  // Loop through arguments in pairs: --flag value --flag value
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];     // Current argument (e.g., "--seed")
    const next = argv[i + 1]; // Next argument (e.g., "https://example.com")

    switch (arg) {
      case "--seed":
        config.seed = next;
        i++;  // Skip next because we consumed it as the value
        break;
      case "--max-depth":
        // parseInt(next, 10) — parse string to integer, base 10.
        // In Java: Integer.parseInt(next)
        config.maxDepth = parseInt(next, 10);
        i++;
        break;
      case "--concurrency":
        config.concurrency = parseInt(next, 10);
        i++;
        break;
      case "--mode":
        // TYPE ASSERTION: "next as Config['mode']"
        // This tells TypeScript: "trust me, this string is 'memory' or 'redis'".
        // It does NOT check at runtime! If someone passes --mode banana, it will be "banana".
        // Java equivalent: (Mode) next — a cast that might fail.
        // A safer approach would be: if (next !== "memory" && next !== "redis") throw ...
        // But for this project, we trust the user input.
        config.mode = next as Config["mode"];
        i++;
        break;
      case "--redis-url":
        config.redisUrl = next;
        i++;
        break;
      case "--timeout":
        config.requestTimeout = parseInt(next, 10);
        i++;
        break;
      case "--output":
        config.output = next;
        i++;
        break;
      default:
        // TEMPLATE LITERAL: `Unknown argument: ${arg}`
        // Same as String.format("Unknown argument: %s", arg) in Java.
        // Uses backticks (`) instead of quotes, and ${...} for interpolation.
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
