# Mock Interview — 43 Questions + Model Answers

Read these first. Practice saying the answers **out loud in English**. Then we run the 1-1 mock where I ask, you answer, I push back.

**Format:**
- **Q** — how the interviewer might phrase it
- **A** — a first-person answer in the voice you should use
- **⚠ Watch out** — traps to avoid (only on the hard ones)

---

## Warm-up (1–4)

### Q1. Walk me through the project in 2 minutes.
**A:** I built a distributed web crawler in TypeScript for the IP Fabric interview. It starts from a seed URL and crawls all same-domain links up to a configurable depth, using BFS. The architecture has two swappable backends: a memory mode for single-process use and a Redis mode that lets multiple workers share work across machines. Coordination across workers is built on two Redis primitives: `SADD` for atomic deduplication of visited URLs, and `BRPOP`/`LPUSH` for a blocking FIFO queue. There's also a small Juniper `show interfaces` parser that turns CLI output into structured JSON — that's the part closest to what IP Fabric actually does.

⚠ Watch out: don't go into implementation details here. The interviewer wants shape, not code. End in under 2 minutes.

### Q2. Why BFS and not DFS?
**A:** Two reasons. First, fairness across depth — BFS explores shallow pages first, which is what users typically want from a crawler: "give me everything within N hops." DFS could disappear down a single branch and miss important top-level pages. Second, BFS maps naturally to a FIFO queue, which in Redis is just `LPUSH` + `BRPOP`. DFS would need a stack, and a distributed stack is awkward — workers would fight over the top element. A queue is the natural data structure for work distribution.

### Q3. How do you prevent crawling the same URL twice?
**A:** A single atomic operation: `SADD` on a Redis Set. When a worker discovers a link, it calls `visited.add(url)`. In Redis this maps to `SADD crawler:visited <url>`, which returns 1 if the URL was new and 0 if it was already there. I only enqueue when the return value is 1. Because `SADD` is atomic and Redis is single-threaded, two workers racing on the same URL will always see exactly one "1" and one "0" — no duplicates possible. Without this, I'd need a distributed lock, which is complex and slow.

### Q4. How do multiple workers coordinate without stepping on each other?
**A:** There's no explicit coordinator — they coordinate **through Redis**. All workers share the same queue (`crawler:frontier`) and the same visited set (`crawler:visited`). `BRPOP` guarantees a URL is handed to exactly one worker, and it wakes up the longest-waiting worker first, which gives natural load balancing. `SADD` guarantees dedup. That's all the coordination needed. No leader election, no heartbeats, no config sync. Workers are stateless and interchangeable — you can add or remove them at runtime.

---

## Architecture (5–8)

### Q5. Why did you separate the interfaces from the backend implementations?
**A:** So `crawl()` depends on abstractions, not concrete classes — that's the Dependency Inversion Principle. The crawler code in `worker.ts` doesn't import `RedisFrontier` or `MemoryFrontier`; it only knows the `Frontier` interface. This gives me three wins: testability (I can inject a `MemoryFrontier` in tests without running Redis), extensibility (adding a Postgres backend doesn't require touching the crawler), and clean separation of concerns (storage logic stays out of business logic). If I wanted to, I could write a `MockFrontier` that always returns the same URL, and the crawler wouldn't know the difference.

### Q6. Why does `visited.add()` return a boolean instead of `void`?
**A:** To make the "check and add" a single atomic operation. The interface also exposes a `has()` method, but that's only for debugging and inspection — the production crawl path never calls it. The reason is exactly the race condition: if the crawler used `has()` then `add()`, two workers could both call `has()`, both see `false`, and both call `add()` — both end up crawling the same URL. By returning whether the URL was newly added, `add()` gives the caller both pieces of information from one atomic call. In Redis this maps directly to `SADD`, which returns 1 if it was new and 0 if it already existed. In Java, `ConcurrentHashMap.putIfAbsent()` follows the same pattern — returns `null` if inserted, or the existing value if not.

⚠ Watch out: if the interviewer notices that `has()` exists and pushes on it, don't walk back the answer. Say: "Yes, `has()` is there for inspection — the convention in the codebase is that the crawl loop only uses `add()` for atomicity. I'd remove `has()` entirely in a stricter version of the interface, since keeping it invites misuse."

### Q7. Why did you inline pLimit instead of using the npm package?
**A:** Compatibility. The `p-limit` package at version 4+ switched to ESM-only modules, which don't play nicely with my CommonJS TypeScript setup without extra build configuration. The logic is ~30 lines — an `active` counter, a queue of pending tasks, and a `next()` function that releases slots. Writing it inline gave me full control, zero dependencies for this feature, and a chance to document exactly what it does. If the logic were 300 lines, I'd use the package. For 30 lines, the dependency isn't worth it.

### Q8. How does the crawler know when to stop?
**A:** Two conditions, combined. First, a `stopping` flag set by SIGINT/SIGTERM — immediate exit path for graceful shutdown. Second, an `emptyPolls` counter: each time the queue is empty AND nothing is in-flight, the counter increments. In memory mode we stop after 1 empty poll (nobody else can add URLs). In Redis mode we wait for 3 empty polls (~6 seconds), because another worker might be mid-fetch and about to enqueue new links. Before giving up, we also call `Promise.race(inFlight)` — wait for at least one running task to finish, because it might discover new URLs.

⚠ Watch out: "why not just check `queue.size() == 0`?" Because between the check and the decision, a running task could enqueue. You need to account for in-flight work.

---

## Distributed Systems (9–13)

### Q9. What happens if a worker crashes mid-crawl?
**A:** Different things survive differently. URLs still in the Redis queue are safe — they're in Redis, not the worker's memory. Visited URLs are safe — they persist in Redis. But the URL being processed at crash time is **lost**: it was popped from the queue (gone) and added to visited (so no other worker will claim it), but never actually crawled. Same for any links that page would have discovered. To fix this, I'd add a "processing" sorted set: when a worker pops a URL, it also adds it to `crawler:processing` with a timestamp. On completion, remove it. A background monitor reclaims anything older than, say, 60 seconds — that URL's worker is probably dead. This is the same pattern Sidekiq and Bull use for reliable job processing.

⚠ Watch out: don't claim "nothing is lost" — that's wrong and the interviewer will catch it.

### Q10. Prove to me that no URL is crawled twice.
**A:** It comes down to one invariant: a URL is only enqueued when `visited.add(url)` returns `true`, and `visited.add()` maps to Redis `SADD`, which returns 1 for the first caller and 0 for everyone else. Since Redis is single-threaded, `SADD` is atomic — there's no interleaving. So for any given URL, exactly one worker ever gets `true` from `visited.add()`, meaning exactly one worker ever enqueues it, meaning exactly one worker ever pops and crawls it. The proof rests on Redis's atomicity guarantee.

### Q11. What's the single point of failure in your system?
**A:** Redis. If the Redis instance dies, all workers lose access to the queue and the visited set simultaneously. Every in-flight operation fails, and the crawler halts. Mitigations: run Redis with replication (primary + replica, failover via Redis Sentinel), use Redis Cluster for sharding, or accept the tradeoff and run in memory mode for single-worker scenarios. For this project I didn't implement HA Redis because the scope is a programming test, but I'd call it out in an architecture review as the thing to fix first before running in production.

### Q12. With 1 billion URLs to crawl, where do you run out of memory first?
**A:** The Redis visited set. Each URL averages ~100 bytes, so 1 billion URLs is ~100 GB — won't fit in a single Redis instance. Three options, in order of increasing complexity. One: Redis Cluster with sharding by URL hash — linear scaling but operational cost. Two: replace the set with a Bloom filter — trades perfect accuracy (tiny false-positive rate) for ~100x memory savings, maybe 1 GB for 1 billion URLs. Three: two-tier — Bloom filter as fast first-pass check, then a persistent set in a database like Cassandra for the full truth. Bloom filter is usually the right call for crawlers because false positives just mean we skip a page, which is recoverable.

### Q13. How would you scale to 100 machines?
**A:** The architecture already supports this — just start 100 workers pointing at the same Redis. But at that scale you hit two real problems. One: Redis becomes the bottleneck, both throughput-wise and as a single point of failure. Mitigation: shard by domain (one Redis partition per domain hash bucket), or move to a proper broker like Kafka. Two: politeness. At 100 workers hitting one target domain, you'll get rate-limited or banned. You need per-domain throttling — a token bucket per domain stored in Redis that every worker checks before fetching. I'd probably build that as a separate service that the crawler asks "am I allowed to hit domain X right now?" before each request.

---

## Node.js / TypeScript (14–16)

### Q14. How does `async/await` actually work under the hood?
**A:** `async/await` is syntactic sugar over Promises and the event loop. When you write `const x = await fetch(url)`, the runtime registers a continuation (what to do when the Promise resolves), pauses the function, and returns control to the event loop. The event loop then runs other pending work. When the `fetch`'s I/O completes (via libuv notifying Node), the Promise resolves, the continuation is scheduled on the microtask queue, and eventually the function resumes with `x` set. From your code's perspective it looks synchronous, but the thread is never blocked. This is fundamentally different from Java, where `Thread.sleep()` or a blocking I/O call actually parks a thread.

### Q15. What are the different Promise combinators and when do you use each?
**A:** Four that matter. `Promise.all([...])` — resolves when all succeed, rejects on first failure. Use it for "everything must succeed" fan-out. `Promise.allSettled([...])` — resolves when all finish, never rejects; you inspect each result. I use this for the final drain in the crawler because I don't want one failed page to abort shutdown. `Promise.race([...])` — resolves as soon as the fastest one finishes. I use it in the empty-queue path: "wait for any in-flight task to complete, then re-check the queue." `Promise.any([...])` — resolves on the first success, ignores failures. Rarely useful here.

### Q16. Why does `MemoryFrontier` return Promises if it's synchronous?
**A:** To satisfy the `Frontier` interface. `async` methods automatically wrap the return value in a resolved Promise, so `async enqueue()` returns `Promise<void>` even if the body is a single `array.push()`. This lets the crawler code call `await frontier.enqueue()` the same way regardless of backend. The cost is negligible — a resolved Promise is a cheap object. The benefit is that `crawl()` has one code path, not two.

---

## Parser (17–19)

### Q17. Why do you split the text on `"Physical interface: "` specifically?
**A:** Because that's Juniper's natural record separator in `show interfaces` output. Each physical interface's block starts with that line, so splitting on it gives me an array where each element is one interface's full data. After splitting, I filter out the empty first element (text before the first `"Physical interface: "` line) and any whitespace-only chunks. It's a simple form of tokenization — the vendor format isn't structured, but it's consistent enough for a record-oriented split to work.

### Q18. Regex or a state machine? Why not a proper parser?
**A:** For this format, regex. Juniper's CLI output isn't a formal grammar — there's no BNF, no schema. It's text designed for humans, with relatively flat structure: key-value pairs, one per line, some indented. Regex works because each field can be extracted independently, and the patterns are vendor-specific but stable within a firmware version. A state machine would be better for deeply nested or context-sensitive formats — Cisco IOS with nested sections is closer to that. A full parser generator (ANTLR, PEG) would be overkill for text this flat, and would be harder to update when firmware changes. Regex gives us the 80% solution at 20% effort.

### Q19. Why convert MAC `50:00:00:26:00:00` to `5000.0026.0000`?
**A:** Normalization. Different vendors display MAC addresses in different formats — Juniper uses colons, Cisco uses dots, some use hyphens. IP Fabric needs one canonical format for the whole multi-vendor dataset so that searches and joins work. If a switch reports a MAC in Juniper format and a router reports the same MAC in Cisco format, they need to compare equal. I chose dot notation (`XXXX.XXXX.XXXX`) because Cisco's format is the most common in enterprise networks and IP Fabric's docs use it. The conversion is lossless — same bytes, different presentation.

---

## Edge Cases (20–23)

### Q20. A site returns HTTP 403 for half your requests. What's going on and what do you do?
**A:** Most likely a WAF or CDN (Cloudflare, Akamai) blocking my crawler. They fingerprint clients by User-Agent, request rate, TLS fingerprint, and absence of browser headers like `Accept-Language`. Some 403s are legitimate — protected pages — but a consistent pattern is anti-bot. Options: set a realistic User-Agent, add normal browser headers, slow down (politeness delay between requests), respect `robots.txt`, or for JS-heavy sites use a headless browser like Playwright. You can also detect the pattern in logs — if a specific host returns >50% 403s, surface it as a metric rather than silently skipping. In production I'd want that visibility.

### Q21. A page uses React and the links only appear after JavaScript runs. How does your crawler handle it?
**A:** It doesn't. My crawler fetches the raw HTML response and parses it with Cheerio — no JavaScript execution. For server-rendered pages that's fine. For SPAs, the initial HTML is basically empty (`<div id="root"></div>`) and the real content is rendered in the browser. To crawl those, you need a headless browser — Puppeteer or Playwright — which runs Chromium and waits for the DOM to settle before extracting links. The tradeoff is huge: headless browsers are 10-100x slower and use much more memory. Usually the right approach is hybrid: try the cheap HTML fetch first, fall back to headless only when the response looks like a SPA shell.

### Q22. Do you respect `robots.txt`?
**A:** Currently, no — and I'd call that out as a gap in a real production crawler. Respecting `robots.txt` means: before crawling a domain, fetch `/robots.txt`, parse the `User-agent` and `Disallow` directives, and filter out disallowed paths before enqueuing. It's a polite convention, not a legal requirement, but ignoring it is the fastest way to get IP-banned. For this project I left it out for scope, but the architecture supports it — I'd add a `robotsChecker` that the crawler consults before `frontier.enqueue()`, and cache per-domain rules so we only fetch `/robots.txt` once per domain per run.

### Q23. Ctrl+C is pressed while 5 tasks are mid-flight. Walk me through what happens.
**A:** I register SIGINT and SIGTERM handlers in `crawl()`. When Ctrl+C fires: the handler sets `stopping = true` but **does not** call `process.exit()`. The main `while (!stopping)` loop exits on the next iteration, stops dequeuing. Then `await Promise.allSettled(inFlight)` waits for all 5 in-flight tasks to finish — whether they succeed, fail, or hit their request timeout. This bounds the shutdown time to roughly `config.requestTimeout` in the worst case. After drain, signal handlers are unregistered with `process.off()` to avoid leaks, Redis connections close, and the function returns the results for pages that did complete. So you get partial results, not a crash, and no half-written state.

⚠ Watch out: the interviewer might ask "what if a user hits Ctrl+C twice impatiently?" Answer: with my current code, the second one is a no-op (same handler). In production I'd make the second Ctrl+C bypass the graceful path and exit immediately — common pattern.

---

## Curveballs (24–26)

### Q24. If you had to run this on 100 machines tomorrow, what's the first thing that breaks?
**A:** Redis. Specifically, the `crawler:visited` set. At 100 workers hitting it with `SADD` thousands of times per second, you'll saturate Redis CPU — it's single-threaded. The fix is sharding: either Redis Cluster, or a client-side shard-by-URL-hash across multiple Redis instances. The second thing to break is target-site politeness — 100 workers × concurrency 5 = 500 parallel requests to a single domain will get you instantly banned. So per-domain rate limiting becomes mandatory, not optional.

### Q25. How would you test the distributed behavior?
**A:** Three layers. Unit: mock `Frontier` and `VisitedStore` and test `crawl()` logic in isolation — no Redis. Integration: run an in-memory crawl against a local HTTP server, verify page count, order, and depth assignment. Distributed: spin up Redis in Docker via `docker-compose`, run 2 or 3 workers as separate Node processes against the same Redis, assert (a) total unique pages equals what a single worker would have crawled, (b) no page appears in more than one worker's output, (c) queue drains to zero. For a CI pipeline, this is what the `docker-compose.yml` in the repo is for — reproducible distributed tests.

### Q26. What's the weakest part of this project?
**A:** Crash recovery. If a worker crashes holding a URL — popped from the queue, added to visited, but not yet processed — that URL is silently dropped. No other worker picks it up because it's already in the visited set. The fix is a processing sorted set with timestamps and a background reclaimer, as I described earlier. I know the gap exists, I chose not to implement it because the scope was a programming test rather than a production system, but it's the first thing I'd add before running this for real.

⚠ Watch out: don't say "nothing" or "I don't know." Interviewers test self-awareness here. Naming a real weakness with a concrete fix is the senior-level answer.

---

## Senior System Design (27–32)

### Q27. How would you add per-domain politeness / rate limiting?
**A:** A Redis-backed token bucket per domain. Each domain gets a key like `ratelimit:<domain>` with two fields: `tokens` (current count) and `lastRefill` (timestamp). Before fetching, the worker calls a Lua script atomically: refill tokens based on elapsed time, check if tokens > 0, if yes decrement and return OK, else return the wait time. Lua because the refill-check-decrement needs to be atomic — otherwise two workers could both see "1 token left" and both take it. If denied, the worker either waits or re-enqueues the URL for later. The rate (e.g., 1 request per 2 seconds per domain) can be configured per-domain. This is what real polite crawlers do.

### Q28. Why `BRPOP` instead of `RPOP` in a loop?
**A:** Busy-polling. `RPOP` returns immediately — empty queue means a `null` response. A loop with `RPOP` would hit Redis thousands of times per second doing nothing, wasting CPU on both the worker and Redis. `BRPOP` blocks on the Redis side: the connection stays open but neither side uses CPU while waiting. When something is pushed, Redis immediately wakes the longest-waiting client. The `2`-second timeout is a safety net so the worker can periodically re-check the `stopping` flag and the `emptyPolls` counter. It's the difference between an event-driven system and a polling system.

### Q29. Can a URL end up in the queue twice?
**A:** Technically yes, in one narrow case. The seed URL: when two workers start simultaneously, one's `visited.add(seed)` wins and enqueues; the other's returns `false` and skips. That's the design path. But if a worker crashes right between `visited.add()` returning `true` and `frontier.enqueue()` succeeding — with my current code — the URL is marked visited but never queued. So actually the failure mode is the opposite: zero, not two. For two copies to land in the queue, I'd have to bypass the `SADD` check. My code doesn't do that. So: in practice, a URL never ends up twice.

### Q30. Where does memory grow unboundedly, and how do you bound it?
**A:** Two places. One: the `pages` array in `crawl()` — it accumulates every crawled page in memory until the function returns. Fine for thousands of pages, dangerous for millions. Fix: stream results to disk (NDJSON) as they complete, don't accumulate. Two: the `inFlight` Set grows if you dequeue faster than you process. That's what the back-pressure check (`inFlight.size >= concurrency * 2`) prevents — it stops dequeuing when we're saturated, leaving URLs safely in Redis. Without that check, a Redis queue with millions of URLs would get pulled into process memory as Promise objects. The back-pressure keeps memory O(concurrency), not O(queue-size).

### Q31. Tell me about consistent hashing and where you'd use it here.
**A:** Consistent hashing maps keys to nodes such that adding or removing a node only reshuffles a small fraction of keys, not all of them. In a sharded Redis setup, I'd use it to route URLs to Redis instances: `hash(url) → node`. When you add a Redis node, only ~1/N of keys need to move. A plain modulo shard (`hash % N`) would remap almost every key when N changes. Consistent hashing is the foundation of how memcached, Cassandra, DynamoDB, and Redis Cluster handle scale-out. For this project it's overkill — one Redis is fine. At 100 workers and multiple Redis nodes, it becomes essential.

### Q32. Horizontal or vertical scaling — which first?
**A:** For a crawler, horizontal — almost always. Vertical scaling (bigger machine) hits diminishing returns fast because a crawler is I/O-bound: more CPU doesn't help when you're waiting on network. Horizontal scaling is natural here because the architecture is already stateless at the worker level — state lives in Redis, and workers are interchangeable. You add capacity by adding processes, not by buying a bigger server. The moment you'd consider vertical is for Redis itself: a bigger Redis with more RAM is often simpler than sharding until you genuinely can't fit.

---

## Code Quality (33–36)

### Q33. What's the difference between unit and integration tests in your project?
**A:** Unit tests target one function in isolation — `normalizeUrl`, `extractLinks`, `parseInterfaces`. No HTTP, no Redis, just input → output verification. Fast, deterministic, run on every save. Integration tests spin up a real local HTTP server on a random port, serve fixture HTML pages, and run the full `crawl()` pipeline against it with memory backends. They catch things unit tests miss: does the queue actually drain, do links get extracted in the right order, does depth tracking work end-to-end. Different bugs, different tools. I keep the ratio skewed toward unit tests for speed, with integration tests covering the critical paths.

### Q34. Why test against a real HTTP server instead of mocking `fetch`?
**A:** Because mocks lie about the things that matter. Real HTTP behavior — connection handling, streaming response bodies, `content-type` header parsing, redirects, timeouts — is where bugs actually live. A mocked `fetch` returns whatever I tell it to, which means my tests pass but only verify the happy path I imagined. A real local server forces the code to go through the actual Node.js HTTP stack. For extra confidence I can simulate failures: return 503 from `/flaky`, delay responses on `/slow`, set weird content types. This catches integration bugs that pure mocks never will. The tradeoff is a bit more setup and slightly slower tests — worth it.

### Q35. If you were adding structured logging to this project, what would you do?
**A:** Replace `console.log` with Pino. Every log line becomes JSON with a consistent schema: `{ timestamp, level, event, url, depth, workerId, durationMs, ... }`. Pino is the fastest logger in Node — ~5x faster than Winston — and produces JSON natively for easy shipping to ELK, Loki, or Datadog. Key events to log: page fetched (with status, duration), page skipped (with reason: 4xx/5xx/content-type), queue empty poll, retry attempt, shutdown triggered. One log line per event, one event per URL. Then the logs become queryable: "show me all 5xx errors for domain X in the last hour." You can't do that with free-text logs.

### Q36. Say you need to add a Postgres backend. What changes?
**A:** Four files. Create `src/backends/postgres/postgresFrontier.ts` — implements `Frontier` with a table like `frontier(id SERIAL, url TEXT, depth INT, claimed_at TIMESTAMP)` and uses `SELECT ... FOR UPDATE SKIP LOCKED` for the dequeue. Create `src/backends/postgres/postgresVisited.ts` — implements `VisitedStore` with a unique constraint on URL, using `INSERT ... ON CONFLICT DO NOTHING RETURNING 1` for the atomic add. Add `"postgres"` to the mode union in `config.ts` and a `postgresUrl` option. Add one `else if` branch in `index.ts` with a dynamic import. Zero changes to `worker.ts` — that's the payoff of coding to interfaces.

---

## Deep Node.js (37–40)

### Q37. Explain the event loop — phases, microtasks, macrotasks.
**A:** The event loop has phases: timers (`setTimeout` callbacks), pending callbacks, poll (I/O), check (`setImmediate`), close callbacks. It cycles through these phases forever. Between every phase and after every task, the runtime drains the microtask queue — Promise `.then()`, `.catch()`, `.finally()` callbacks, `queueMicrotask`. Microtasks always run before the next macrotask. Practical implication: `await` callbacks are microtasks and run before the next `setTimeout` tick, so they're "higher priority." This is why an infinite Promise chain can starve the event loop while an infinite `setTimeout(..., 0)` loop wouldn't — microtasks jump the queue.

### Q38. What is `AbortSignal` and why do you pass it to `fetch`?
**A:** `AbortSignal` is a standard cancellation token. You create one, pass it to an async operation, and later call `signal.abort()` to cancel — or in my case, use `AbortSignal.timeout(ms)` which auto-aborts after a timeout. Without it, a slow or unresponsive server could hang `fetch` forever. With it, `fetch` throws an `AbortError` after the timeout, which my retry logic catches and retries. It's the JavaScript equivalent of Java's `HttpClient.Builder.connectTimeout()`, but composable — the same signal can be passed to multiple operations to cancel them all at once.

### Q39. Does `.finally()` always run?
**A:** Yes — in almost every case, including thrown errors and rejected Promises. The one exception is if the process is killed mid-execution (SIGKILL, `process.exit()`, hard crash) — no JavaScript runs after that, including `.finally()`. The guarantee is "the Promise settles and `.finally()` runs in response." If the Promise never settles (you drop the reference and it's GC'd), `.finally()` never runs either. In my code, I rely on `.finally()` in two places: pLimit's slot release (to avoid leaking active counts on errors) and `inFlight` cleanup in the crawl loop. Both must run on success and failure.

### Q40. `interface` vs `type` — when do you pick which?
**A:** Both can describe object shapes. I use `interface` for things that represent a contract a class will implement — `Frontier`, `VisitedStore`, `Config`. Three reasons: `interface` supports `extends` for hierarchy, supports declaration merging (useful when augmenting third-party types), and the error messages are usually clearer. I use `type` for unions, intersections, and utility types — `type Mode = "memory" | "redis"`, `type Nullable<T> = T | null`. If I'm defining a shape that might be implemented or extended, interface. If I'm combining or transforming types, type. In practice the choice is mostly stylistic.

---

## Business / Domain (41–43)

### Q41. How does this project relate to what IP Fabric actually does?
**A:** Two ways, corresponding to the two halves of the project. The parser half is directly relevant: IP Fabric's core job is connecting to network devices over SSH, running CLI commands, and parsing the unstructured text output into a structured model of the network. My Juniper `show interfaces` parser is a miniature version of exactly that — it takes Juniper's text output and produces typed JSON with speed, MAC, description, admin state, operational state. The crawler half is less directly related but demonstrates the systems thinking needed for IP Fabric's discovery backend: coordinating work across many processes, atomic operations for deduplication, crash tolerance, horizontal scaling — the same concerns as collecting data from thousands of network devices in parallel.

### Q42. IP Fabric supports hundreds of vendors. What's the challenge there?
**A:** Combinatorial explosion of formats. Cisco IOS, Cisco NX-OS, Juniper JunOS, Arista EOS, Huawei VRP, Palo Alto PAN-OS — each has its own CLI output for equivalent data. And within each vendor, different commands (`show interfaces` vs `show ip interface brief`), different firmware versions, different platforms. Writing a parser per vendor per command per version doesn't scale linearly — you need a framework: shared utilities for common primitives (MAC normalization, speed conversion, IP parsing), a clear parser interface, heavy testing with fixture files from real devices, and a CI pipeline that flags when a new firmware version breaks an existing parser. The interesting engineering is in the framework, not in any individual parser.

### Q43. What happens when a firmware update changes the output format?
**A:** Parsers break silently. That's the scary part — you don't get a compile error, you get subtly wrong data. The operational answer is: fixture-based testing with real device outputs from each supported firmware version, a CI run that re-parses every fixture on every change, and monitoring in production — if parser output for a device suddenly changes shape (fewer fields, missing data), alert. The design answer is: parsers should be version-aware where possible, either detecting version from headers or being explicit in config. And you need a fast path to ship a parser fix — hours, not weeks — because customers depend on current data.

---

## How to use this document

1. **Read it through once** to see the full scope.
2. **Say the answers out loud** — the physical act of speaking in English is what the interview actually tests.
3. **Find the 5 questions you're weakest on** and practice those 3x.
4. Then ping me and we do the 1-1 mock: I ask, you answer, I push back, we iterate.
