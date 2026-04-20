# ADR-002: Use Redis as Shared State Store

## Status
Accepted

## Context
A single-node crawler keeps its URL queue and visited set in memory. This works but cannot scale horizontally — if we add a second machine, it has no way to know what the first machine already visited.

We need a **shared store** that all crawler workers can read/write concurrently.

## Decision
Use **Redis** as the shared state store for:
1. **URL Frontier** (queue of URLs to crawl) — using Redis Lists (`LPUSH`/`BRPOP`)
2. **Visited Set** (URLs already seen) — using Redis Sets (`SADD`/`SISMEMBER`)

## Why Redis specifically

| Requirement | How Redis solves it |
|---|---|
| Shared access across machines | Redis is a network server — any worker connects via TCP |
| Atomic operations | `SADD` returns 1 if added, 0 if already exists — no race condition between workers |
| Blocking queue | `BRPOP` makes workers wait efficiently when queue is empty (no busy-polling) |
| Speed | In-memory store, sub-millisecond latency for simple operations |
| Simple to run | Single binary, or `docker run redis` |

## Key Redis commands we use

### For the queue (URL Frontier):
- `LPUSH frontier <url>` — add URL to left side of list (enqueue)
- `BRPOP frontier 5` — remove and return URL from right side, wait up to 5 seconds if empty (dequeue)
- This gives us **FIFO** order = **Breadth-First Search** traversal

### For the visited set:
- `SADD visited <url>` — add URL to set. Returns `1` if new, `0` if duplicate
- `SISMEMBER visited <url>` — check if URL was already visited (used for filtering before enqueue)

### Why these are race-condition safe:
Imagine Worker A and Worker B both discover `https://example.com/about` at the same time:
1. Worker A: `SADD visited https://example.com/about` → Redis returns `1` (new!)
2. Worker B: `SADD visited https://example.com/about` → Redis returns `0` (already there!)
3. Only Worker A enqueues it. No duplicate work.

This works because Redis processes commands **sequentially** (single-threaded command execution).

## Consequences

### Positive
- Workers are stateless — add/remove workers at will
- No duplicate crawling across workers
- Simple mental model: queue + set

### Negative
- Redis is a **single point of failure** — if Redis dies, all workers stop. Mitigation: Redis Sentinel/Cluster for HA.
- Redis stores everything in memory — visited set for billions of URLs would need too much RAM. Mitigation: use a Bloom filter for approximate membership testing at scale (future improvement).
- Network latency between workers and Redis (microseconds on same datacenter, but still more than local memory).

### Alternatives Considered
- **RabbitMQ/Kafka**: More complex, designed for message streaming rather than shared state. We'd still need a separate store for the visited set.
- **PostgreSQL**: ACID guarantees we don't need, much slower for this simple get/set pattern.
- **In-memory only**: Works for single node, but doesn't scale. We provide this as a fallback for local development.
