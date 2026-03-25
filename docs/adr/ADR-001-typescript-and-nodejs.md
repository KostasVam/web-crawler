# ADR-001: Use TypeScript on Node.js

## Status
Accepted

## Context
We need to choose a language/runtime for the crawler. The assignment prefers JavaScript/TypeScript/Node.js. Python is also acceptable but TypeScript offers better type safety and is closer to the team's stack at IP Fabric.

## Decision
Use **TypeScript** on **Node.js** runtime.

## Consequences

### Positive
- **Async I/O by default**: Node.js uses a non-blocking event loop — perfect for a crawler that spends most of its time waiting for HTTP responses. We can have many concurrent fetches without threads.
- **Type safety**: TypeScript catches errors at compile time (wrong URL types, missing fields) while still being JavaScript under the hood.
- **npm ecosystem**: Libraries like `cheerio` (HTML parsing) and `ioredis` (Redis client) are mature and well-maintained.

### Negative
- No true parallelism for CPU-bound work (single-threaded event loop). Not a problem here since crawling is I/O-bound.
- TypeScript adds a compilation step (`tsc`), slightly more complex than plain JS.

### Alternatives Considered
- **Python**: Popular in networking, has `asyncio` + `aiohttp`, but IP Fabric prefers JS/TS.
- **Go**: Excellent concurrency model with goroutines, but not in the preferred stack.
