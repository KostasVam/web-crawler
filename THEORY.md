# Distributed Systems Theory — What You Need to Understand

This is not a list of answers to memorize. It's the reasoning behind every
design decision in your project. Read it like a textbook chapter.

---

## 1. Concurrency vs Parallelism

These are NOT the same thing. People confuse them constantly.

**Concurrency**: dealing with multiple things at once (structure).
**Parallelism**: doing multiple things at once (execution).

**Analogy — a restaurant:**
- **1 waiter, 10 tables** = CONCURRENCY. The waiter takes order from table 1,
  walks to table 2, takes their order, goes to the kitchen, comes back when
  food is ready. The waiter is never idle, but they're only doing ONE thing at
  any moment. They INTERLEAVE tasks.
- **5 waiters, 10 tables** = PARALLELISM. Multiple waiters are literally
  serving different tables at the same time.

**Node.js is concurrent but NOT parallel** (for JavaScript code).
One thread handles thousands of connections by interleaving: start HTTP request A,
while waiting for A's response, start HTTP request B, while waiting for B, handle
A's response that just arrived, etc.

**Java is both concurrent AND parallel.**
You can have 100 threads, each blocking on their own HTTP request, all truly
running at the same time on different CPU cores.

**Trade-off:**
| | Node.js (concurrent) | Java (parallel) |
|---|---|---|
| Memory per connection | ~1 KB (just a callback) | ~1 MB (thread stack) |
| 10,000 connections | ~10 MB | ~10 GB |
| CPU-intensive work | BAD (blocks the only thread) | GOOD (use multiple cores) |
| I/O-intensive work | EXCELLENT | Good, but wastes memory |
| Complexity | Simple (no locks, no deadlocks) | Complex (synchronization) |

**Your project is I/O-intensive** (HTTP requests, Redis calls). Node.js is
the right tool. If you were doing CPU-intensive work (image processing, ML),
Java or Go would be better.

**In your code:**
```
const response = await fetch(url);  // Node pauses HERE, serves other tasks
const html = await response.text(); // Node pauses HERE too
```
Each `await` is a point where Node says "I'm waiting for I/O, let me handle
something else." When the I/O completes, Node picks up where it left off.
This is why one Node.js process can crawl 5 websites "simultaneously" —
it's not parallel, it's interleaved.

---

## 2. The Event Loop — How Node.js Actually Works

```
   ┌───────────────────────────┐
┌─>│         timers             │  ← setTimeout, setInterval callbacks
│  └──────────┬────────────────┘
│  ┌──────────┴────────────────┐
│  │     pending callbacks      │  ← I/O callbacks deferred from previous cycle
│  └──────────┬────────────────┘
│  ┌──────────┴────────────────┐
│  │         poll               │  ← retrieve new I/O events; execute I/O callbacks
│  └──────────┬────────────────┘     (this is where most time is spent)
│  ┌──────────┴────────────────┐
│  │         check              │  ← setImmediate callbacks
│  └──────────┬────────────────┘
│  ┌──────────┴────────────────┐
│  │    close callbacks         │  ← socket.on('close', ...)
│  └──────────┬────────────────┘
│             │
└─────────────┘  ← loop repeats
```

You don't need to memorize these phases. What matters:

1. **There is ONE loop, running on ONE thread.**
2. Each iteration processes pending callbacks from I/O, timers, etc.
3. Between each iteration, Node checks for microtasks (Promise callbacks, `await` continuations).
4. If you block the loop (e.g., `while(true)` or heavy CPU computation), EVERYTHING stops — no HTTP requests are processed, no Redis responses are handled.

**Why this matters for your crawler:**
Your `pLimit` works because of the event loop. When you `await fetch()`, the
function pauses and the event loop picks up another task. When the fetch
completes, its callback is queued. The event loop processes it on its next
iteration. The `pLimit` queue is just a regular array — it works because
JavaScript code NEVER runs in parallel. There's no risk of two pieces of code
modifying `active` or `queue` at the same time.

---

## 3. Shared Nothing Architecture

**The problem with shared state:**
When multiple processes need to coordinate, they need shared state.
But shared state is the source of almost every bug in distributed systems:
race conditions, deadlocks, stale reads, lost updates.

**Your project has TWO approaches:**

### Memory mode: Shared Everything (within one process)
```
┌──────────────────────────────┐
│  Worker Process               │
│  ┌────────┐  ┌─────────────┐ │
│  │ Queue   │  │ Visited Set │ │  ← all in ONE process's memory
│  │ (Array) │  │ (JS Set)    │ │
│  └────────┘  └─────────────┘ │
│  ┌──────────────────────────┐ │
│  │ Crawl Loop + pLimit      │ │
│  └──────────────────────────┘ │
└──────────────────────────────┘
```
- Simple, fast, no network overhead
- Cannot scale beyond one process
- If the process dies, everything is lost

### Redis mode: Shared Nothing (between processes)
```
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Worker A │  │ Worker B │  │ Worker C │   ← each has NO local state
│ (no state│  │ (no state│  │ (no state│
│  at all) │  │  at all) │  │  at all) │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │              │              │
     └──────────────┼──────────────┘
                    │
            ┌───────┴────────┐
            │     Redis       │   ← ALL state lives here
            │ ┌─────────────┐ │
            │ │ Queue (List)│ │
            │ │ Visited(Set)│ │
            │ └─────────────┘ │
            └────────────────┘
```
- Workers are STATELESS — they can crash and restart without losing data
- Workers are INTERCHANGEABLE — any worker can process any URL
- Can scale by adding more workers (horizontal scaling)
- But: Redis is a SINGLE POINT OF FAILURE

**Trade-off:**
- Shared everything = fast, simple, doesn't scale
- Shared nothing = slower (network hops), complex, scales horizontally

**In your project**, the `crawl()` function doesn't know which mode it's in.
The same code runs with both architectures because of the interface abstraction.

---

## 4. Message Delivery Guarantees

When a system sends a message (in your case: a URL from the queue to a worker),
there are three possible guarantees:

### At-most-once delivery
"I'll try to deliver the message once. If it fails, oh well."
- No retries
- Messages can be LOST but never DUPLICATED
- Example: UDP, fire-and-forget

### At-least-once delivery
"I'll keep trying until I'm sure the message was processed."
- Retries on failure
- Messages are never LOST but can be DUPLICATED
- Example: most message queues with acknowledgment

### Exactly-once delivery
"Each message is processed exactly one time."
- The holy grail — extremely hard to achieve in distributed systems
- Usually approximated by: at-least-once delivery + idempotent processing
- Example: Kafka with transactions

### What does YOUR project use?
**At-most-once.** When a worker does BRPOP, the URL is removed from the queue
immediately. If the worker crashes before processing it, the URL is LOST.
No retry mechanism exists.

```
BRPOP removes URL from queue  →  Worker processes it  →  Done
         ↑                              ↑
    If crash here,                  If crash here,
    URL is lost                     URL is lost
```

**To upgrade to at-least-once**, you'd need:
1. BRPOP the URL
2. Add it to a "processing" set with a timestamp
3. Process the URL
4. Remove it from the "processing" set
5. A monitor checks the "processing" set — any URL older than 60s
   is assumed lost and moved back to the main queue

**Why not exactly-once?**
Because it requires the processing itself to be idempotent (processing the
same URL twice gives the same result) AND distributed transactions. For a
web crawler, at-least-once is good enough — crawling a page twice is wasteful
but not harmful.

---

## 5. The CAP Theorem

In a distributed system, you can only guarantee TWO of these three:

- **C**onsistency: every read returns the most recent write
- **A**vailability: every request gets a response
- **P**artition tolerance: the system works even when network links fail

**You MUST choose P** (network failures are a fact of life), so the real
choice is between C and A:

**CP systems** (consistent but might be unavailable):
- When in doubt, REFUSE to answer rather than give stale data
- Example: Redis in standalone mode, traditional databases
- Your project: Redis is CP — if Redis goes down, workers can't operate

**AP systems** (available but might be inconsistent):
- When in doubt, ANSWER with possibly stale data
- Example: DNS, Cassandra, DynamoDB (eventually consistent)

### How this relates to your project:

Your project chooses **consistency** (via Redis). The visited set MUST be
consistent — if two workers check the same URL, one MUST see the other's write.
If you chose eventual consistency, both workers might think the URL is new
and crawl it twice.

This is why Redis (single-threaded, consistent) is a better choice than
Cassandra (eventually consistent) for the visited set. The trade-off:
Redis is a single point of failure. If Redis goes down, everything stops.

**Interview answer if asked "how would you handle Redis going down?":**
"For high availability, I'd use Redis Sentinel or Redis Cluster.
Sentinel provides automatic failover — if the master goes down, a replica
is promoted. For the crawler, a brief period of unavailability during
failover is acceptable. The workers would reconnect automatically
(ioredis handles this). We'd lose any in-flight URLs during the failover,
but that's the at-most-once trade-off we've already accepted."

---

## 6. Stateless vs Stateful Services

**Stateful service**: stores data that must survive between requests.
If the process dies, data is lost. Hard to scale (need to route requests
to the right instance).

**Stateless service**: stores nothing between requests. All state is
externalized (database, Redis, shared filesystem). If the process dies,
just start a new one — no data lost. Easy to scale (any instance can
handle any request).

**Your workers are STATELESS.**
They hold temporary variables (crawled count, in-flight set), but these
are purely operational — losing them just means you lose progress counters,
not actual data. The real state (which URLs to visit, which are already
visited) lives in Redis.

This is why you can:
1. Start 10 workers without configuration changes
2. Kill any worker without data loss (except the in-flight URL)
3. Restart workers without "warming up" or "syncing"
4. Run workers on different machines

**The trade-off:**
Stateless = network roundtrip for every operation (slow per-operation,
but scales infinitely). Stateful = local access (fast per-operation,
but doesn't scale).

Your Memory mode is stateful (faster, single process).
Your Redis mode is stateless (slower per-op, multi-process).

---

## 7. Back-Pressure — Why You Can't Ignore Flow Control

**The producer-consumer problem:**
Your crawler has a pipeline:
```
Redis Queue  →  Main Loop (dequeue)  →  pLimit (concurrency)  →  HTTP fetch
 (producer)      (consumer/producer)      (consumer)             (consumer)
```

Each stage runs at a different speed:
- Redis dequeue: microseconds (very fast)
- HTTP fetch: 100ms - 10s (very slow)

If the main loop dequeues URLs at full speed, it creates millions of
Promise objects waiting for their turn in pLimit. Each Promise consumes
memory. Result: out of memory crash.

**Back-pressure means: the slow consumer tells the fast producer to slow down.**

In your code (worker.ts line 195):
```typescript
if (inFlight.size >= config.concurrency * 2) {
    await Promise.race(inFlight);
}
```

This is back-pressure: "I have enough buffered work. Stop giving me more
until I finish some." The `await` pauses the main loop — no more dequeuing
until a task completes.

**Real-world analogy:**
A factory assembly line. If the painting station is slow and the cutting
station is fast, parts pile up between them. Eventually the pile falls over
(out of memory). Back-pressure: the cutting station pauses when the pile
gets too big.

**Why `concurrency * 2` and not just `concurrency`?**
If we limited to exactly `concurrency` (say 5), then:
1. We dequeue 5 URLs, all start fetching
2. The main loop stops (inFlight = 5 = limit)
3. One finishes → inFlight drops to 4 → we dequeue 1 more
4. But there's a gap! Between "one finished" and "new one starts", we have idle capacity

With `* 2`, we keep a buffer: 5 active + 5 queued in pLimit. When one finishes,
the next one starts immediately from pLimit's queue. We only pause the main loop
when the BUFFER is full. This keeps the pipeline more saturated.

**Trade-off:**
- Higher multiplier = better throughput (less idle time), more memory usage
- Lower multiplier = less memory usage, more idle time between tasks
- `* 2` is a reasonable balance for this use case

---

## 8. BFS vs DFS for Web Crawling

This is not just an algorithm choice — it has real implications.

### BFS (Breadth-First Search) — what your crawler does
```
Visit order: depth 0 → all depth 1 → all depth 2 → all depth 3
Uses: FIFO queue (first in, first out)
```

### DFS (Depth-First Search) — the alternative
```
Visit order: depth 0 → first child depth 1 → first grandchild depth 2 → ...
Uses: LIFO stack (last in, first out)
```

### Trade-offs:

| | BFS | DFS |
|---|---|---|
| Important pages first? | YES (homepage, main sections) | NO (dives into obscure sub-pages) |
| Memory usage | High (stores entire frontier at current depth) | Low (stores only one path) |
| Time to first deep page | Slow (must finish all shallow pages first) | Fast (dives immediately) |
| Distributed fairness | Good (workers share similar-depth work) | Poor (workers might go deep into different branches) |
| maxDepth behavior | All pages at depth ≤ N are crawled | Some depth-1 pages might be missed if time runs out |

### Why BFS is better for web crawling:

1. **Page importance**: Pages linked from the homepage (depth 1) are
   usually the most important — About, Products, Blog, Contact.
   Pages at depth 5 might be obscure blog comments or legal footnotes.
   BFS ensures you get the important pages first.

2. **Predictable coverage**: With maxDepth=2, BFS guarantees ALL pages
   at depths 0, 1, and 2 are crawled. DFS might crawl depths 0→1→2→3→4
   on one branch while completely missing depth 1 pages on another branch.

3. **Time budget**: If you have 5 minutes to crawl a site, BFS gives you
   the best "snapshot" of the site. DFS gives you a very deep view of one
   corner and nothing else.

**Your implementation:**
- Memory: `push()` + `shift()` = FIFO = BFS
- Redis: `LPUSH` + `BRPOP` = FIFO = BFS
Both implementations maintain BFS order.

---

## 9. Idempotency

**An operation is idempotent if doing it once and doing it N times
has the same effect.**

Examples:
- `SET x = 5` — idempotent (setting it 10 times still gives 5)
- `x = x + 1` — NOT idempotent (each time increases the value)
- `SADD set "url"` — idempotent (adding same URL multiple times = same set)
- `LPUSH list "url"` — NOT idempotent (pushing same URL 10 times = 10 copies)

### Why this matters for your project:

**SADD (visited set)** is idempotent. If two workers both SADD the same URL,
the set still has it once. This is why deduplication works.

**LPUSH (queue)** is NOT idempotent. If you LPUSH the same URL twice,
the queue has two copies. That's why you ALWAYS check visited.add() BEFORE
frontier.enqueue() — if the URL is already visited, you never enqueue it.

```typescript
const added = await visited.add(link);  // SADD — idempotent, atomic
if (added) {
    await frontier.enqueue(link);       // LPUSH — NOT idempotent, but safe
}                                       // because we only reach here once per URL
```

This pattern — "check with an idempotent operation, then act" — is very
common in distributed systems.

### The TOCTOU problem (Time of Check to Time of Use):
If the check and the action are NOT atomic, there's a window where
another process can interfere:

```
NON-ATOMIC (dangerous):
  Worker A: has("url")? → false         ← check
  Worker B: has("url")? → false         ← check (same time!)
  Worker A: add("url")                  ← act
  Worker B: add("url")                  ← act (duplicate!)
  Worker A: enqueue("url")             ← URL in queue
  Worker B: enqueue("url")             ← DUPLICATE in queue!
```

```
ATOMIC (safe — what SADD does):
  Worker A: SADD("url") → 1 (new)      ← check AND act in one step
  Worker B: SADD("url") → 0 (exists)   ← check AND act in one step
  Worker A: enqueue("url")             ← only A enqueues
```

---

## 10. Horizontal vs Vertical Scaling

**Vertical scaling (scale UP):**
Get a bigger machine. More CPU, more RAM, faster disk.
- Simple: no code changes needed
- Limited: there's a maximum machine size
- Expensive: high-end servers cost disproportionately more
- Single point of failure: if the machine dies, everything dies

**Horizontal scaling (scale OUT):**
Add more machines running the same software.
- Complex: needs distributed coordination
- Unlimited: add as many machines as needed
- Cost-effective: use commodity hardware
- Resilient: if one dies, others continue

### Your project supports BOTH:

**Vertical**: increase `concurrency` (more HTTP requests from one process).
This is limited by CPU, memory, and the target server's tolerance.

**Horizontal**: start more worker processes pointing at the same Redis.
This is limited by Redis throughput and the target server's tolerance.

### Scaling bottlenecks in your design:

1. **Redis as single point of failure**: all workers depend on one Redis.
   Fix: Redis Cluster (sharding) or Redis Sentinel (failover).

2. **Redis memory**: all visited URLs in one Redis Set.
   At 100 bytes per URL × 1 billion URLs = ~100 GB.
   Fix: Bloom filter (probabilistic, uses ~1 GB for 1 billion URLs with 1% false positive rate),
   or partition the visited set across multiple Redis instances.

3. **Target server rate limiting**: adding workers doesn't help if the
   target server blocks you at 10 requests/second.
   Fix: per-domain rate limiting, polite crawling delays.

4. **Results in memory**: the `pages` array accumulates all results in RAM.
   Fix: stream to disk or database instead of buffering.

---

## 11. Single Point of Failure (SPOF)

A SPOF is any component whose failure takes down the entire system.

**SPOFs in your project:**

| Component | Is it a SPOF? | Impact of failure | How to fix |
|---|---|---|---|
| Redis | YES | All workers stop | Redis Sentinel / Cluster |
| Worker A | NO | Workers B, C continue | Already handled — stateless |
| Network | YES | Can't reach target site | Nothing to do (fundamental) |
| Target site | YES | Nothing to crawl | Nothing to do (fundamental) |

**Key insight:** making workers stateless eliminates them as SPOFs.
Any worker can die and be replaced. The work continues.

Redis remains a SPOF. For a production system, you'd want:
- **Redis Sentinel**: monitors master, auto-promotes replica on failure
- **Redis Cluster**: shards data across multiple masters

---

## 12. Consistency in Distributed Deduplication

Why is consistency critical for the visited set?

### Strong consistency (what Redis gives you):
Every read returns the most recent write. If Worker A adds "url-X" to
the visited set, Worker B immediately sees it.

### Eventual consistency (what Cassandra/DynamoDB give you):
After a write, there's a delay before all nodes see it. Worker A adds
"url-X", but Worker B might not see it for a few milliseconds.

**For a crawler's visited set, eventual consistency means DUPLICATES.**
Worker A: `add("url-X")` → success
Worker B: `has("url-X")` → "no" (replication delay!) → crawls url-X AGAIN

For a web crawler, duplicates are wasteful but not catastrophic.
For a financial system (deducting money), duplicates are catastrophic.
That's why the choice between consistency models depends on the consequences.

**Your project chooses strong consistency (Redis)** because:
1. Duplicates waste HTTP requests (slow, and might get us rate-limited)
2. Redis's strong consistency is simple to reason about
3. The project is small enough that a single Redis handles the load

---

## 13. Failure Modes — What Can Go Wrong

### Network failures:
- **Worker can't reach target site**: fetch() throws → retry → eventually error
- **Worker can't reach Redis**: ioredis throws → worker crashes → other workers continue
- **Redis can't reach workers**: doesn't apply (workers initiate connections)

### Process failures:
- **Worker crashes (OOM, segfault)**: in-flight URL lost, queue URLs safe
- **Redis crashes**: ALL workers stop. Data may be lost (depends on Redis persistence config)
- **Slow worker (not crashed, just slow)**: other workers compensate. No timeout on processing.

### Data failures:
- **Corrupt data in Redis**: `JSON.parse()` throws → processItem catches → error count++
- **Redis full (out of memory)**: LPUSH fails → worker crashes or loses URLs
- **Visited set wrong**: URL crawled twice (wasteful) or never (data loss)

### Your project handles:
- ✅ Target site down (retry with backoff)
- ✅ Target site slow (AbortSignal.timeout)
- ✅ Worker crash (other workers continue, stateless)
- ✅ Graceful shutdown (SIGINT/SIGTERM handling)
- ❌ Redis crash (workers crash too — would need retry/reconnect logic)
- ❌ In-flight URL loss (needs processing queue pattern)
- ❌ Redis memory limit (needs monitoring/alerting)

---

## 14. Atomicity — The Foundation of Distributed Correctness

An atomic operation either fully completes or doesn't happen at all.
There's no in-between state visible to other processes.

**Non-atomic** (TWO steps, observable gap between them):
```
Step 1: CHECK if URL exists in visited set     ← other process can act here!
Step 2: ADD URL to visited set                  ← too late, damage done
```

**Atomic** (ONE step, indivisible):
```
SADD: CHECK and ADD in one command              ← no gap, no interference
```

Redis commands are atomic because Redis is single-threaded. It processes
one command completely before starting the next. This is a fundamental
architectural decision by Redis's creator (Salvatore Sanfilippo) — trade
throughput for simplicity and correctness.

**When you need multiple atomic operations together:**
Single Redis commands are atomic, but what if you need TWO commands to be
atomic together? For example: "move URL from queue to processing set."
BRPOP + SADD are each atomic, but something can happen BETWEEN them.

Solutions:
- **Lua scripts**: Redis runs Lua scripts atomically (the entire script
  is one operation). This is how Sidekiq and Bull implement reliable queues.
- **MULTI/EXEC transactions**: batch multiple commands into one atomic block.

Your project doesn't need multi-command atomicity because SADD alone
handles the critical deduplication check.

---

## Summary: Every Trade-Off in Your Project

| Decision | What you chose | Alternative | Why you chose it |
|---|---|---|---|
| Language | Node.js/TypeScript | Java, Go, Python | I/O-intensive workload, single-thread simplicity |
| Concurrency model | async/await (event loop) | Threads (Java) | Simpler, no locks/deadlocks, good for I/O |
| Queue | Redis List (LPUSH/BRPOP) | RabbitMQ, Kafka, SQS | Simple, no broker setup, fast for this scale |
| Deduplication | Redis Set (SADD) | Bloom filter, database | Exact (no false positives), atomic, simple |
| Traversal | BFS (FIFO queue) | DFS (LIFO stack) | Important pages first, predictable depth coverage |
| Backends | Interface + Strategy pattern | Hard-coded Redis | Testability, extensibility, clean architecture |
| DI | Manual injection | DI framework (InversifyJS) | Project too small for a framework |
| Concurrency limit | Custom pLimit | npm p-limit package | ESM/CJS compatibility issue with p-limit v4+ |
| Delivery guarantee | At-most-once | At-least-once | Simpler, acceptable for web crawling |
| Consistency | Strong (Redis) | Eventual (Cassandra) | Deduplication requires consistent reads |
| Scaling | Horizontal (add workers) | Vertical (bigger machine) | Stateless workers make horizontal trivial |
| Retry strategy | Exponential-ish backoff | Fixed delay, no retry | Gives servers recovery time, industry standard |
| Shutdown | Graceful (drain tasks) | Immediate (process.exit) | No data corruption, clean resource cleanup |
