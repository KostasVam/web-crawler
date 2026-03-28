export interface Config {
  seed: string;
  maxDepth: number;
  concurrency: number;
  mode: "memory" | "redis";
  redisUrl: string;
  requestTimeout: number;
}

const defaults: Config = {
  seed: "https://ipfabric.io",
  maxDepth: 2,
  concurrency: 5,
  mode: "memory",
  redisUrl: "redis://localhost:6379",
  requestTimeout: 10_000,
};

export function parseArgs(argv: string[] = process.argv.slice(2)): Config {
  const config = { ...defaults };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--seed":
        config.seed = next;
        i++;
        break;
      case "--max-depth":
        config.maxDepth = parseInt(next, 10);
        i++;
        break;
      case "--concurrency":
        config.concurrency = parseInt(next, 10);
        i++;
        break;
      case "--mode":
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
      default:
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  return config;
}
