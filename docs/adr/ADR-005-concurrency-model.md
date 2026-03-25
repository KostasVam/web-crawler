# ADR-005: Async Concurrency Within Each Worker

## Status
Accepted

## Context
We have horizontal scaling (multiple workers/machines), but each individual worker also needs to be efficient. A worker that fetches one page at a time wastes most of its time waiting for HTTP responses.

## Decision
Each worker runs **multiple concurrent fetches** using Node.js `async/await` and a concurrency limiter (p-limit).

```
Worker Process
├── Fetch slot 1: downloading ipfabric.io/about     (waiting for response...)
├── Fetch slot 2: downloading ipfabric.io/blog      (waiting for response...)
├── Fetch slot 3: downloading ipfabric.io/products   (parsing HTML...)
├── Fetch slot 4: idle (queue empty, waiting on BRPOP...)
└── Fetch slot 5: downloading ipfabric.io/careers    (waiting for response...)
```

### How this works in Node.js
Node.js has a **single thread** but an **event loop** that handles I/O asynchronously:

1. Worker starts 5 fetch operations concurrently (not in parallel — concurrently)
2. While waiting for HTTP response #1, the event loop processes HTTP response #2 that just arrived
3. No threads needed — the OS handles the network waiting

This is like a restaurant waiter: one waiter (thread) serves multiple tables (requests) by not standing idle while the kitchen prepares food.

### `p-limit` library
Controls how many concurrent operations run at once:

```typescript
import pLimit from 'p-limit';
const limit = pLimit(5);  // max 5 concurrent fetches

// These all start, but only 5 run at a time
const tasks = urls.map(url => limit(() => fetchAndProcess(url)));
await Promise.all(tasks);
```

## Consequences

### Positive
- Single worker can saturate its network connection
- Configurable concurrency (5, 10, 20 — tune per machine)
- No thread management complexity

### Negative
- Need to be careful with memory — 20 concurrent large HTML pages in memory
- Must handle backpressure (don't pull URLs faster than we can process them)

## Two levels of scaling

```
Level 1: Multiple workers (horizontal, via Redis)
  Worker A ──┐
  Worker B ──┼── Redis Queue
  Worker C ──┘

Level 2: Concurrent fetches within each worker (vertical, via async)
  Worker A
  ├── fetch 1
  ├── fetch 2
  └── fetch 3
```
