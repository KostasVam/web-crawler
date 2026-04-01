# Web Crawler

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Distributed web crawler in TypeScript — Redis-backed URL frontier, horizontal scalability, BFS traversal.

## Overview

A TypeScript web crawler that performs BFS traversal starting from a seed URL. It extracts links from HTML content and schedules them for crawling, while avoiding duplicate visits. Designed for horizontal scalability using Redis as a shared coordination layer between worker nodes.

## Tech Stack

| Component | Choice |
|---|---|
| Language | TypeScript 5.5 |
| Runtime | Node.js 24 |
| HTML Parsing | cheerio |
| Shared State | Redis (Lists + Sets) |
| Build | tsc |
| Containerization | Docker Compose (Redis) |

## Architecture

```
                    ┌─────────────┐
                    │    Redis    │
                    │  ┌────────┐ │
                    │  │ Queue  │ │  ← URLs to visit (LPUSH/BRPOP)
                    │  │Visited │ │  ← URLs already seen (SADD/SISMEMBER)
                    │  └────────┘ │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼────┐ ┌────▼─────┐ ┌────▼─────┐
        │ Worker 1 │ │ Worker 2 │ │ Worker 3 │
        │          │ │          │ │          │
        │ fetch()  │ │ fetch()  │ │ fetch()  │
        │ parse()  │ │ parse()  │ │ parse()  │
        │ extract()│ │ extract()│ │ extract()│
        └──────────┘ └──────────┘ └──────────┘
```

### Worker Loop

```
1. BRPOP url from Redis queue         ← blocking pop, waits if empty
2. Check: url in visited set?          ← SADD (returns 0 if exists)
   - Already visited → skip
   - New → continue
3. Fetch HTML content                  ← HTTP GET
4. Parse HTML, extract <a href> links  ← cheerio
5. Normalize discovered URLs           ← resolve relative, remove fragments
6. Filter by domain scope              ← only seed domain
7. Push new URLs to queue              ← LPUSH
8. Repeat
```

### Why This Scales Horizontally

- **Workers are stateless** — all state lives in Redis
- **Add workers without code changes** — they just connect to the same Redis
- **No duplicate work** — `SADD` is atomic; if two workers discover the same URL, only one enqueues it
- **Automatic load balancing** — `BRPOP` distributes URLs to whichever worker is free

### Completeness Guarantee

The distributed crawler produces the **same result** as a single-node crawler. Here's why:

1. **Every discovered URL enters the queue exactly once** — before enqueuing, we do `SADD visited <url>`. Redis returns `1` (new) or `0` (duplicate). Only new URLs are enqueued. This is atomic — even if 10 workers discover the same URL simultaneously, exactly one `SADD` returns `1`.

2. **Every queued URL is processed exactly once** — `BRPOP` removes the URL from the queue and delivers it to exactly one worker. No two workers receive the same URL.

3. **No URLs are lost** — the queue is persistent in Redis. If a URL is enqueued, it stays until a worker picks it up.

The combination guarantees: every reachable URL from the seed is visited exactly once, regardless of how many workers are running.

### Scaling to a Large Grid of Machines

```
Small scale (1-10 nodes):
  All workers → single Redis instance
  Redis handles ~100K ops/sec — sufficient for thousands of pages/sec

Medium scale (10-100 nodes):
  All workers → Redis Sentinel (high availability)
  Add read replicas for SISMEMBER checks
  Workers grouped by region to reduce latency

Large scale (100+ nodes):
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ Redis    │  │ Redis    │  │ Redis    │
  │ Shard A  │  │ Shard B  │  │ Shard C  │
  │ *.a-m.com│  │ *.n-s.com│  │ *.t-z.com│
  └────┬─────┘  └────┬─────┘  └────┬─────┘
       │             │             │
   Workers A     Workers B     Workers C
```

At large scale, a single Redis becomes the bottleneck. Solutions:

| Challenge | Solution |
|---|---|
| Redis memory limit | **Bloom filter** — visited set uses constant memory (~1GB for 1 billion URLs) instead of growing linearly |
| Redis throughput limit | **Consistent hashing** — partition URLs by domain across Redis shards. Same domain always maps to same shard |
| DNS resolution overhead | **Local DNS cache** per worker — avoids repeated lookups for same domain |
| Network bandwidth per node | **Domain-aware partitioning** — workers specialize in domain subsets, improving TCP connection reuse |
| Worker crash recovery | **Reliable queue** (BRPOPLPUSH) — URLs being processed are tracked; if worker dies, URLs return to queue |
| Duplicate content at different URLs | **Content fingerprinting** — SHA-256 hash of page body, skip if already seen |

## Assumptions & Limitations

| Assumption / Limitation | Impact |
|---|---|
| Static HTML only — no JavaScript rendering | SPAs (React, Angular) won't have their dynamic content crawled |
| No `robots.txt` support | May crawl pages the site owner prefers bots to skip |
| No politeness delay | Could overwhelm the target server under high concurrency |
| Redis is single point of failure | If Redis goes down, all workers stop |
| Visited set grows unboundedly in memory | For very large sites, Redis memory could be exhausted |
| Retry is limited (2 attempts) | Persistent failures are skipped after 2 retries with backoff |
| Domain-scoped only | External links are discovered but not followed |

## Future Improvements

See [docs/roadmap.md](docs/roadmap.md) for the full phased plan. Key improvements:

- **Reliability**: Reliable queue pattern (BRPOPLPUSH) for crash recovery
- **Politeness**: `robots.txt` parsing, per-domain rate limiting, crawl delay
- **Memory**: Bloom filter for visited set (constant memory vs linear growth)
- **Scale**: Consistent hashing for URL partitioning across Redis shards
- **Rendering**: Headless browser (Puppeteer) for JavaScript-heavy pages
- **Observability**: Prometheus metrics, structured JSON logging

## Project Structure

```
web-crawler/
├── src/
│   ├── index.ts                  ← crawler entry point
│   ├── parse.ts                  ← parser entry point (Juniper CLI output)
│   ├── config.ts                 ← CLI argument parsing
│   ├── crawler/
│   │   ├── worker.ts             ← main crawl loop + retry logic
│   │   ├── extractor.ts          ← HTML → URLs (cheerio)
│   │   ├── normalizer.ts         ← URL normalization
│   │   ├── limiter.ts            ← concurrency limiter (inline p-limit)
│   │   ├── frontier.ts           ← queue interface
│   │   ├── visited.ts            ← visited set interface
│   │   ├── normalizer.test.ts    ← URL normalization tests
│   │   ├── extractor.test.ts     ← link extraction tests
│   │   └── crawler.integration.test.ts ← end-to-end crawl tests
│   ├── backends/
│   │   ├── memory/               ← in-memory (single node)
│   │   └── redis/                ← Redis (distributed)
│   └── parser/
│       ├── interfaces.ts         ← PhysicalInterface, LogicalInterface types
│       ├── parseInterfaces.ts    ← Juniper "show interfaces" parser
│       └── parseInterfaces.test.ts ← parser tests against sample data
├── fixtures/
│   └── juniper-show-interfaces.txt ← sample device output for parser
├── docs/
│   ├── adr/                      ← Architecture Decision Records
│   ├── execution-examples.md     ← Real crawl outputs and benchmarks
│   └── roadmap.md                ← Phased implementation plan
├── docker-compose.yml
├── jest.config.ts
├── package.json
└── tsconfig.json
```

## Documentation

### Architecture Decision Records

| ADR | Decision |
|---|---|
| [ADR-001](docs/adr/ADR-001-typescript-and-nodejs.md) | Use TypeScript on Node.js (async I/O, non-blocking) |
| [ADR-002](docs/adr/ADR-002-redis-as-shared-state.md) | Use Redis as shared state store (atomic ops, blocking queue) |
| [ADR-003](docs/adr/ADR-003-bfs-crawl-strategy.md) | BFS crawl strategy (important pages first, parallelizable) |
| [ADR-004](docs/adr/ADR-004-url-normalization.md) | URL normalization before deduplication |
| [ADR-005](docs/adr/ADR-005-concurrency-model.md) | Async concurrency within each worker (p-limit) |
| [ADR-006](docs/adr/ADR-006-domain-scoping.md) | Restrict crawling to seed domain |

## Getting Started

### Prerequisites
- Node.js 18+
- Docker (for Redis mode)

### Install & Build
```bash
npm install
npm run build
```

### Run the Crawler

```bash
# Single-node mode (no Redis needed)
node dist/index.js --max-depth 2

# With JSON output
node dist/index.js --max-depth 1 --output results.json

# Distributed mode with Redis
docker compose up -d
node dist/index.js --mode redis --max-depth 2

# Multiple workers (run in separate terminals)
node dist/index.js --mode redis --max-depth 2 --output worker1.json
node dist/index.js --mode redis --max-depth 2 --output worker2.json
```

### CLI Options

| Option | Default | Description |
|---|---|---|
| `--seed <url>` | `https://ipfabric.io` | Starting URL |
| `--max-depth <n>` | `2` | Maximum link-following depth |
| `--concurrency <n>` | `5` | Parallel HTTP requests per worker |
| `--mode <memory\|redis>` | `memory` | Backend for queue and visited set |
| `--redis-url <url>` | `redis://localhost:6379` | Redis connection string |
| `--output <file>` | _(none)_ | Write results as JSON |
| `--timeout <ms>` | `10000` | HTTP request timeout |

### Run the Parser

Parses Juniper `show interfaces` CLI output into structured JSON:

```bash
node dist/parse.js device-output.txt
```

### Run Tests

```bash
npm test     # 39 tests: unit + integration
```

## Design Principles

| Principle | How It's Applied |
|---|---|
| **Horizontal scalability** | Stateless workers + shared Redis state = add nodes freely |
| **No duplicate work** | Atomic `SADD` guarantees each URL is processed exactly once |
| **Pluggable backends** | Interface-based design — swap Redis for in-memory without changing crawler logic |
| **Breadth-first discovery** | FIFO queue ensures important (shallow) pages are found first |
| **Graceful degradation** | In-memory fallback when Redis is unavailable |
