# Study Q&A — Everything You Need to Know

All questions from our crash course sessions, plus additional ones.
Answers are written as if YOU are answering in the interview.
Practice saying these out loud in English.

---

## Module 1: TypeScript Type System

### Q1.1: Why do your interfaces use `Promise` in every method?
**A:** Because some implementations (Redis) need network I/O to complete the operation. Network calls are asynchronous — they take time and we don't want to block the single Node.js thread while waiting. By making the interface return Promises, both the Memory implementation (which is instant) and the Redis implementation (which needs network) can satisfy the same contract. The Memory version wraps its synchronous result in a Promise automatically via `async`.

### Q1.2: What does the `?` mean in `close?(): Promise<void>`?
**A:** It marks the method as optional. A class implementing this interface is not required to provide a `close()` method. In our case, `MemoryFrontier` has nothing to clean up (it's just a JS array), so it doesn't implement `close()`. `RedisFrontier` needs to close the Redis connection, so it does implement it. When calling, we use optional chaining: `frontier.close?.()` — this calls `close()` only if it exists, and does nothing otherwise.

### Q1.3: Can an object `{ url: "http://test.com", depth: 2 }` be used as a `FrontierItem` without `implements`?
**A:** Yes. TypeScript uses structural typing (also called "duck typing"). If an object has all the required properties with the correct types, it satisfies the interface — no explicit `implements` declaration is needed. This is different from Java's nominal typing where you must write `class MyClass implements MyInterface`. In TypeScript, the shape matters, not the name.

### Q1.4: What is a union type? Give an example from your code.
**A:** A union type means "this value can be one of several types." In my `Config` interface, `mode: "memory" | "redis"` means the mode property can only be the string literal `"memory"` or the string literal `"redis"` — nothing else. It's like a Java enum but more flexible because you can combine any types: `string | number | null`, `FrontierItem | null`, etc. The TypeScript compiler checks exhaustiveness — if I wrote a switch on `mode` and forgot to handle `"redis"`, it would warn me.

### Q1.5: What does `as` do in `config.mode = next as Config["mode"]`?
**A:** It's a type assertion — it tells the TypeScript compiler "I know this string is actually `"memory" | "redis"`, trust me." It does NOT perform any runtime validation — if someone passes `--mode banana`, it would happily assign `"banana"` to `mode` and TypeScript wouldn't catch it. It's similar to casting in Java: `(Mode) next`. For production code, I'd add a runtime check like `if (next !== "memory" && next !== "redis") throw new Error(...)`.

### Q1.6: What's the difference between `interface` and `type` in TypeScript?
**A:** They're very similar. Both can define the shape of objects. Key differences:
- `interface` can be extended with `extends` and merged (declaration merging)
- `type` can represent unions (`string | number`), intersections, and primitives
- Convention: use `interface` for object shapes that might be implemented by classes, `type` for unions and utility types
- In my project, I use `interface` for `Frontier`, `VisitedStore`, `Config` because they define contracts that classes implement.

### Q1.7: What does `export` do?
**A:** It makes the symbol available to other files via `import`. Without `export`, the interface/class/function is private to the file. It's similar to `public` vs package-private in Java. In my code, `Frontier` is exported because `worker.ts`, `index.ts`, and the backend implementations all need to reference it.

### Q1.8: What is the spread operator `{ ...defaults }`?
**A:** It creates a shallow copy of an object by "spreading" all its properties into a new object. In `config.ts` line 22, `const config = { ...defaults }` copies all default values into a new object. This way, when I modify `config.seed`, I'm not mutating the original `defaults` object. In Java, you'd use a copy constructor or `clone()`.

---

## Module 2: Async/Await & Promises

### Q2.1: Why `Promise.allSettled()` instead of `Promise.all()` at line 200?
**A:** `Promise.all()` rejects as soon as ANY promise rejects — it short-circuits on the first error. But the other promises keep running in the background, we just can't await them anymore. This means we'd exit the function while tasks are still in flight — data corruption risk. `Promise.allSettled()` waits for ALL promises to finish, whether they succeed or fail. This is critical for graceful shutdown: we need every in-flight HTTP request to complete before we close Redis connections and return results.

### Q2.2: What does `pLimit` do when concurrency=5 and 5 tasks are already active?
**A:** The new task goes into pLimit's internal queue. It stays there until one of the 5 active tasks finishes. When a task completes, its `.finally()` callback decrements `active` and calls `next()`, which pulls the next task from the queue and starts it. The caller still gets a Promise back immediately — it just won't resolve until the task actually runs and finishes. This is the token bucket pattern: 5 tokens available, each active task holds one, queued tasks wait for a token.

### Q2.3: Why do you need back-pressure at line 195?
**A:** Without back-pressure, the main loop would dequeue URLs from Redis as fast as possible, creating a Promise object for each one in the `inFlight` Set. If Redis has 1 million URLs, we'd create 1 million Promises in memory — out of memory crash. The back-pressure check `if (inFlight.size >= concurrency * 2)` limits the number of Promises in memory. Extra URLs stay safely in Redis until we have capacity. The `* 2` allows some buffering (e.g., with concurrency=5, we allow 10: 5 actively fetching + 5 waiting in pLimit's queue).

### Q2.4: Explain the Node.js event loop in simple terms.
**A:** Node.js has ONE thread (unlike Java which has many). When you do an I/O operation (HTTP request, file read, Redis command), Node doesn't wait — it registers a callback and moves on to the next task. When the I/O completes, the callback is placed in a queue. The event loop continuously checks this queue and executes callbacks one at a time. This is why Node can handle thousands of concurrent connections with a single thread — it's never "waiting" for I/O, it's always doing something. `async/await` is syntactic sugar over this callback mechanism — `await` tells the runtime "pause this function, resume it when the I/O is done, and run other tasks in the meantime."

### Q2.5: What's the difference between `Promise.race()`, `Promise.all()`, and `Promise.allSettled()`?
**A:**
- `Promise.race([A, B, C])` — resolves/rejects as soon as ANY ONE finishes. I use it for: "wait until one in-flight task completes, then check if new URLs appeared in the queue."
- `Promise.all([A, B, C])` — resolves when ALL succeed. Rejects immediately if ANY ONE fails. I don't use this because I don't want one failed page to abort the entire crawl.
- `Promise.allSettled([A, B, C])` — resolves when ALL finish, regardless of success or failure. I use this for the drain at the end: wait for every in-flight task to complete before shutting down.

### Q2.6: What does `.finally()` do and where do you use it?
**A:** `.finally()` runs a callback when a Promise settles, regardless of whether it resolved or rejected. It's like Java's `try { } finally { }`. I use it in two places:
1. In `pLimit` (limiter.ts): after a task finishes, `active--` and `next()` to free the slot and start the next queued task.
2. In the crawl loop (worker.ts line 191): `task.finally(() => inFlight.delete(tracked))` removes the completed task from the tracking Set. This ensures `inFlight.size` stays accurate.

### Q2.7: How does `await new Promise((r) => setTimeout(r, 500))` work?
**A:** This is an async sleep — it pauses the current function for 500ms without blocking the thread. `setTimeout(r, 500)` calls the resolve function `r` after 500ms. `await` pauses the function until the Promise resolves. During those 500ms, the event loop is free to run other tasks (other HTTP requests, Redis calls, etc.). In Java, `Thread.sleep(500)` blocks the thread — nothing else can run on it. In Node.js, the thread stays productive.

### Q2.8: What is a closure? Where do you use one?
**A:** A closure is when an inner function "remembers" variables from its outer function's scope, even after the outer function returns. In my `pLimit` function, the returned wrapper function remembers `active` and `queue` — they live in the closure. Every call to `limit()` accesses and modifies the same `active` and `queue` variables. In Java, you'd need a class with private fields. In JavaScript, closures give you encapsulation without classes. I also use closures in `crawl()`: the `processItem()` function accesses `stopping`, `crawled`, `errors`, `pages` from the outer scope.

---

## Module 3: Node.js APIs

### Q3.1: What is `AbortSignal.timeout()` and why do you use it?
**A:** It creates a signal that automatically aborts an operation after a timeout period. I pass it to `fetch()` to cancel HTTP requests that take too long — without this, a slow or unresponsive server could hang the crawler forever. When the timeout fires, `fetch()` throws an `AbortError`, which my retry logic catches and retries. In Java, you'd set `HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))`.

### Q3.2: What are `process.on("SIGINT")` and `process.on("SIGTERM")`?
**A:** They register handlers for OS signals. SIGINT is sent when the user presses Ctrl+C. SIGTERM is sent by `kill` command or Docker stop. I use them for graceful shutdown: instead of killing the process immediately, I set `stopping = true` and let in-flight tasks finish. This is the equivalent of Java's `Runtime.getRuntime().addShutdownHook()`. I also remove them with `process.off()` after the crawl finishes to prevent memory leaks.

### Q3.3: Why use dynamic `import()` instead of static `import` for Redis modules?
**A:** Three reasons:
1. **Lazy loading**: if the user runs in memory mode, we never load the `ioredis` package — faster startup.
2. **Optional dependency**: if `ioredis` isn't installed at all, memory mode still works without crashing at startup.
3. **Code splitting**: the Redis code is only loaded into memory when needed.
Static imports at the top of the file are evaluated when the module loads, regardless of whether you need them. Dynamic `await import()` loads on demand.

### Q3.4: What is `??` (nullish coalescing) and how is it different from `||`?
**A:** Both provide a default value, but they differ in what they consider "empty":
- `??` only triggers on `null` or `undefined` (nullish values)
- `||` triggers on ANY falsy value: `null`, `undefined`, `""`, `0`, `false`, `NaN`
Example: `response.headers.get("content-type") ?? ""` — if `get()` returns `null`, use `""`. But if it returned the empty string `""`, `??` would keep it (it's not null). With `||`, the empty string would also be replaced. I use `??` because it's more precise — I only want to replace actual null/undefined, not legitimate empty strings or zeros.

### Q3.5: What does `?.` (optional chaining) do?
**A:** It short-circuits to `undefined` if the left side is null or undefined, instead of throwing an error. `frontier.close?.()` means: if `frontier.close` exists, call it. If not, evaluate to `undefined` (do nothing). Without it, calling `frontier.close()` on a `MemoryFrontier` (which has no `close` method) would throw `TypeError: frontier.close is not a function`. In Java, there's no equivalent — you'd write `if (frontier instanceof Closeable) ((Closeable) frontier).close()`.

---

## Module 4: Error Handling

### Q4.1: Why is the catch variable typed as `unknown` instead of `Error`?
**A:** In JavaScript, you can throw ANYTHING: `throw "oops"`, `throw 42`, `throw { code: 500 }`, `throw new Error("real error")`. Unlike Java where `catch(Exception e)` guarantees `e` is an `Exception`, JavaScript makes no guarantees about the thrown value. TypeScript's strict mode types catch variables as `unknown` to force you to check the type before using it. I use `err instanceof Error ? err.message : String(err)` — this is a type guard that safely narrows the type.

### Q4.2: Why don't you retry 4xx errors?
**A:** 4xx errors are client errors — they indicate a problem with the request, not the server. A 404 means the page doesn't exist. A 403 means we're not authorized. A 410 means the resource is permanently gone. Retrying won't change the server's response — the page still won't exist, and we still won't be authorized. Retrying would just waste time and bandwidth. On the other hand, 5xx errors (500 Internal Server Error, 502 Bad Gateway, 503 Service Unavailable) are server-side problems that are often transient — the server might recover if we wait a bit.

### Q4.3: What is exponential backoff and why do you use it?
**A:** Exponential backoff means waiting progressively longer between retries: my delays are 500ms, then 1500ms. The idea is: if the server is overloaded, hammering it with immediate retries makes things worse. By waiting longer each time, we give the server time to recover. In production systems, you'd often add jitter (random variation) to prevent multiple clients from retrying at exactly the same time (thundering herd problem). My implementation is "exponential-ish" — not strictly exponential (which would be 500, 1000, 2000...) but follows the same spirit.

### Q4.4: What happens at line 82: `return { html: "", status: 0, skipped: true }`?
**A:** This is dead code — it should never be reached. The for loop always either returns a result or throws an error. But TypeScript's control flow analysis doesn't know that the loop will always execute at least once (because `MAX_RETRIES >= 0`), so it thinks the function might reach the end without returning. This line satisfies the compiler. It's a common TypeScript pattern for exhaustive loops.

---

## Module 5: Architecture & Design Patterns

### Q5.1: If you wanted to add a `PostgresFrontier`, what files would you change?
**A:** I would:
1. Create `src/backends/postgres/postgresFrontier.ts` — implements `Frontier` interface using PostgreSQL queries
2. Create `src/backends/postgres/postgresVisited.ts` — implements `VisitedStore` interface using PostgreSQL
3. Modify `src/config.ts` — add `"postgres"` to the mode union type and add a `postgresUrl` property
4. Modify `src/index.ts` — add an `else if (config.mode === "postgres")` branch with dynamic imports
5. **Zero changes to `worker.ts`** — the crawler doesn't know or care about the storage backend. This is the power of coding to interfaces.

### Q5.2: Why does `MemoryFrontier` use `async` when it doesn't do I/O?
**A:** Because the `Frontier` interface requires methods to return `Promise<...>`. If `MemoryFrontier` had synchronous methods, it couldn't satisfy the interface and couldn't be used interchangeably with `RedisFrontier`. The `async` keyword automatically wraps the return value in a Promise, so `async enqueue() { this.queue.push(item) }` returns `Promise<void>` even though the operation is instant. We sacrifice a tiny bit of performance (negligible Promise overhead) for polymorphism — the crawler code works with any implementation without conditional logic.

### Q5.3: Which SOLID principle is applied when `crawl()` accepts interfaces instead of concrete classes?
**A:** The **Dependency Inversion Principle** (the "D" in SOLID): "Depend on abstractions, not concretions." The `crawl()` function depends on `Frontier` and `VisitedStore` (abstractions), not on `RedisFrontier` or `MemoryVisited` (concretions). This means:
- `crawl()` is testable — pass in `MemoryFrontier` for unit tests, no Redis needed
- `crawl()` is extensible — add PostgreSQL backend without changing crawler code
- `crawl()` is decoupled — it doesn't know about Redis, ioredis, or any implementation details

Note: Don't confuse with **Interface Segregation Principle** (the "I"), which is about keeping interfaces small and focused — also applied here (Frontier has 3 methods, not 30).

### Q5.4: What is the Strategy Pattern and where do you use it?
**A:** The Strategy Pattern lets you swap algorithms/implementations at runtime without changing the code that uses them. In my project:
- The "strategy" is the storage backend: Memory vs Redis
- The "context" is the `crawl()` function — it uses whichever strategy is injected
- The "selection" happens in `index.ts` based on `config.mode`
- Both strategies implement the same interfaces (`Frontier`, `VisitedStore`)
This is identical to how Spring Boot uses `@Profile` or `@ConditionalOnProperty` to swap bean implementations.

### Q5.5: Why is the DI manual instead of using a framework?
**A:** For a project this size, a DI framework (like InversifyJS or tsyringe) would be overkill. We have exactly 2 injection points (`frontier` and `visited`) with 2 implementations each. The manual approach in `index.ts` is 10 lines of code, easy to read, and has zero dependencies. In a larger project with dozens of services, a DI framework would make sense. This is a pragmatic choice — use the simplest tool that solves the problem.

---

## Module 6: Redis as Distributed State

### Q6.1: What would happen if you replaced `BRPOP` with `RPOP`?
**A:** `RPOP` returns immediately — if the queue is empty, it returns `null` right away. This means the main loop would spin at full CPU speed: dequeue → null → dequeue → null → dequeue → null, thousands of times per second. This is called "busy-waiting" or "busy-polling" — it wastes CPU and puts unnecessary load on Redis. `BRPOP` solves this by blocking on the Redis server side: the connection stays open but both the client and server use zero CPU. When an item appears (via LPUSH from another worker), Redis immediately returns it. The `2` parameter is a timeout: after 2 seconds of nothing, it returns null so we can check the `stopping` flag and `emptyPolls` counter.

### Q6.2: Two workers discover the same URL simultaneously. What happens with SADD?
**A:** SADD is an atomic Redis command. Even if both workers send SADD at the "same time," Redis processes commands sequentially (single-threaded):
1. Worker A: `SADD "crawler:visited" "https://ipfabric.io/about"` → Redis returns `1` (new, added)
2. Worker B: `SADD "crawler:visited" "https://ipfabric.io/about"` → Redis returns `0` (already exists)
Worker A sees `true` → enqueues and crawls the URL. Worker B sees `false` → skips it. No race condition, no duplicate crawling. This is fundamentally different from a non-atomic check-then-add: `if (!visited.has(url)) { visited.add(url) }` — between the check and the add, another worker could sneak in.

### Q6.3: If a worker crashes mid-crawl, are URLs lost?
**A:** It depends on what exactly is lost:
- **URLs in the Redis queue**: Safe. They're in Redis, not in the worker's memory.
- **URLs in the `visited` set**: Safe. They persist in Redis.
- **The URL being processed when the crash happened**: LOST. It was BRPOP'd (removed from the queue) and SADD'd (marked as visited), but never actually crawled. No other worker will pick it up because it's already in the visited set.
- **URLs that the crashed page would have discovered**: LOST. Those links were never extracted because the page was never parsed.

To fix this, I would implement a "processing queue" pattern:
1. When a worker BRPOP's a URL, also add it to a `crawler:processing` sorted set with the current timestamp as score
2. When processing completes, remove it from `crawler:processing`
3. A background monitor periodically checks `crawler:processing` — any URL older than 60 seconds is assumed to belong to a crashed worker and gets moved back to `crawler:frontier`
This is exactly how Sidekiq (Ruby) and Bull (Node.js) handle reliable job processing.

### Q6.4: Why is Redis single-threaded, and why does that help us?
**A:** Redis processes all commands on a single thread, one at a time. This means every command is automatically atomic — no locks needed, no race conditions between commands. When I call `SADD`, nothing else can run between the "check if exists" and "add" steps — it's one indivisible operation. This is the same reason why our `MemoryVisited` is thread-safe in Node.js — single thread means no concurrent access. Redis extends this guarantee across the network to multiple clients/processes.

### Q6.5: How does LPUSH + BRPOP give FIFO ordering?
**A:** LPUSH adds to the LEFT (head) of the list. BRPOP removes from the RIGHT (tail). So the first item pushed ends up at the rightmost position and is the first to be popped. This is FIFO — First In, First Out. It's like a real queue where people join at the back (LPUSH = left) and are served from the front (BRPOP = right). This FIFO order is what gives us BFS (Breadth-First Search) — we process all URLs at depth N before depth N+1.

### Q6.6: What Redis data structures do you use and why?
**A:** Two:
1. **List** (`crawler:frontier`) for the URL queue — because lists support LPUSH/BRPOP which gives us a blocking FIFO queue. Redis Lists are implemented as linked lists, so push/pop are O(1).
2. **Set** (`crawler:visited`) for deduplication — because sets guarantee uniqueness and SADD is atomic. Looking up a member (SISMEMBER) is O(1). We don't need ordering, just "have we seen this URL before?"
I didn't use a Hash or Sorted Set because I don't need key-value pairs or scoring/ranking.

### Q6.7: How would you scale this to billions of URLs?
**A:** Several challenges and solutions:
1. **Redis memory**: A Redis Set with 1 billion URLs would need ~100GB+ RAM. Solution: use Redis Cluster (sharding across multiple machines) or switch to a probabilistic data structure like a Bloom filter for the visited set (trades perfect accuracy for massive memory savings).
2. **Queue throughput**: Single Redis might become a bottleneck. Solution: partition the queue by domain (each domain gets its own Redis list) or use Redis Cluster.
3. **Workers**: Scale horizontally — add more workers pointing at the same Redis. The architecture already supports this.
4. **Politeness**: Add per-domain rate limiting to avoid overwhelming target servers. Currently we limit total concurrency but not per-domain.
5. **Storage**: The `pages` array in memory would be too large. Solution: stream results to disk or a database instead of accumulating in memory.

---

## Module 7: Concurrency Control & Crawl Loop

### Q7.1: Why is `maxEmptyPolls` 3 in Redis mode but 1 in memory mode?
**A:** In memory mode, if the queue is empty and no tasks are in flight, nothing can add new URLs — we're the only process. So 1 empty poll is enough to determine we're done. In Redis mode, another worker might be processing a page RIGHT NOW and about to enqueue new URLs. If we give up after 1 empty poll, we might miss those URLs. So we wait 3 polls × 2 seconds = 6 seconds, giving other workers time to finish their current work and enqueue new discoveries.

### Q7.2: What would happen if you removed lines 178-181 (Promise.race when queue is empty)?
**A:** The crawler would terminate prematurely. Imagine: 3 tasks are in flight, each processing a page and discovering new URLs. The queue is temporarily empty. Without the `Promise.race(inFlight)` check, we'd go straight to `emptyPolls++` and potentially break out of the loop. But those 3 in-flight tasks are about to call `enqueueNewLinks()` which would put new URLs in the queue! By waiting for one task to finish first, we give it a chance to enqueue new work before we decide to exit.

### Q7.3: Walk through the full lifecycle of a URL from discovery to crawl.
**A:**
1. A page is being crawled → `extractLinks()` finds a link `/about` in the HTML
2. `normalizeUrl("/about", "https://ipfabric.io")` → `"https://ipfabric.io/about"` (resolves relative URL, removes fragments/tracking params)
3. `isSameDomain("ipfabric.io", "ipfabric.io")` → `true` (same domain, keep it)
4. `visited.add("https://ipfabric.io/about")` → Redis `SADD` returns `1` (new URL!)
5. `frontier.enqueue({url: "https://ipfabric.io/about", depth: 1})` → Redis `LPUSH`
6. Some worker (maybe this one, maybe another) → `frontier.dequeue()` → Redis `BRPOP` returns this URL
7. Back-pressure check: `inFlight.size < concurrency * 2` → proceed
8. `limit(() => processItem(item))` → pLimit either runs immediately or queues
9. `fetchPage(url, 10000)` → HTTP GET with timeout and retry logic
10. Response 200 + text/html → `cheerio.load(html)` → extract title and links
11. `pages.push({...})` → save result
12. `enqueueNewLinks(links, depth+1, ...)` → back to step 1 for each new link
13. `task.finally(() => inFlight.delete(tracked))` → remove from tracking set

### Q7.4: Explain the two levels of concurrency control in your crawler.
**A:** There are two separate mechanisms:
1. **pLimit** (limiter.ts): controls how many HTTP requests are actively running at the same time. With `concurrency=5`, at most 5 `fetch()` calls are in progress. Extra tasks wait in pLimit's internal queue.
2. **Back-pressure** (worker.ts line 195): controls how many tasks are in the `inFlight` set (both active in pLimit + queued in pLimit). With `concurrency=5`, max 10 tasks in `inFlight`. When reached, we stop dequeuing from Redis.

Together they form a pipeline:
```
Redis Queue → [back-pressure ≤10] → inFlight Set → [pLimit ≤5] → HTTP fetch
```
This prevents both CPU overload (too many HTTP requests) and memory overload (too many queued Promises).

### Q7.5: What does line 191 do and why is it tricky?
**A:** `const tracked = task.finally(() => inFlight.delete(tracked));`
This creates a self-referencing Promise. The `.finally()` callback references `tracked`, but `tracked` is being declared on this same line! This works because of closures: the callback function doesn't execute immediately — it only runs when the task finishes. By that time, `tracked` has already been assigned. The callback captures the variable REFERENCE, not the value at declaration time. In Java, this would be impossible — you can't reference a variable before it's declared.

### Q7.6: Why do you track tasks in a Set instead of an Array?
**A:** Because we need fast `delete()`. When a task completes, we remove it from `inFlight`. With an Array, `delete` is O(n) — you'd need to find the element first. With a Set, `delete` is O(1). We also need `size` (for back-pressure check) and `add` — both are O(1) on a Set. We never need index-based access, so Set is the perfect data structure.

---

## Parser Module

### Q8.1: What does IP Fabric actually do, and how does your parser relate?
**A:** IP Fabric is a network assurance platform. It connects to network devices (routers, switches, firewalls) via SSH, runs CLI commands like `show interfaces`, `show routes`, `show arp table`, and gets back unstructured text output — plain text designed for humans to read. IP Fabric then PARSES this text into structured JSON data, stores it in a database, and builds a model of the entire network for analysis, troubleshooting, and compliance.

My parser does the "text → structured JSON" step for Juniper's `show interfaces` command. In production, IP Fabric supports hundreds of vendors (Cisco, Juniper, Arista, Huawei, Palo Alto, etc.), each with different output formats. Each vendor — and sometimes each firmware version — needs its own parser.

### Q8.2: Why do you use regex instead of a proper parsing library?
**A:** Router CLI output is not a standard format — it's not XML, JSON, YAML, or CSV. It's plain text designed for human readability, with vendor-specific formatting. There's no formal grammar or schema. Regex is the most practical tool because:
1. The patterns are relatively consistent within each vendor's output format
2. Each field can be extracted independently (speed, MAC, description, etc.)
3. It's easy to update when a firmware version changes the format slightly
4. It's lightweight — no external parsing library needed

For more complex formats (e.g., Cisco IOS with deeply nested sections), a state machine approach might be better. But for Juniper's relatively flat structure, regex works well.

### Q8.3: What does `colonToDotNotation` do and why?
**A:** It converts MAC addresses from Juniper's colon notation (`50:00:00:26:00:00`) to Cisco's dot notation (`5000.0026.0000`). Different vendors display MAC addresses differently. IP Fabric needs a single standard format for comparison and searching across a multi-vendor network. If one router reports a MAC as `50:00:00:26:00:00` and another reports the same MAC as `5000.0026.0000`, they need to match when you search for a device. The conversion strips colons, then groups the hex digits into three groups of four separated by dots.

### Q8.4: Why is the speed stored in bits per second instead of Mbps or Gbps?
**A:** Storing in bps (the smallest unit) avoids floating-point issues and makes comparison trivial. If I stored "1 Gbps" as `1` and "100 Mbps" as `100`, comparing them would be meaningless without knowing the unit. By normalizing everything to bps: 1 Gbps = `1_000_000_000`, 100 Mbps = `100_000_000`. Now `1_000_000_000 > 100_000_000` is a simple integer comparison. This is the same principle as storing timestamps in milliseconds or money in cents.

### Q8.5: What does the `/m` flag do in regex?
**A:** The `m` (multiline) flag changes the behavior of `^` and `$`:
- Without `/m`: `^` matches start of the ENTIRE string, `$` matches end of the ENTIRE string
- With `/m`: `^` matches start of EACH LINE, `$` matches end of EACH LINE
I need this because my input text has many lines, and I'm looking for patterns at the start of specific lines, like `^ {2}Description:` (a line starting with 2 spaces followed by "Description:").

### Q8.6: How do you distinguish between physical and logical interface descriptions?
**A:** By indentation level. Juniper uses consistent indentation:
- Physical interface data: 2 spaces → `^ {2}Description: (.+)$`
- Logical interface data: 4 spaces → `^ {4}Description: (.+)$`
This is fragile (depends on exact spacing) but it's how the vendor formats the output. If Juniper changed their indentation in a firmware update, the parser would need updating. This is a real challenge at IP Fabric — firmware updates sometimes change output formats.

### Q8.7: What edge cases could break your parser?
**A:** Several:
1. **Missing fields**: No speed, no MAC, no description → I handle this by returning 0, "", or undefined
2. **Different firmware versions**: Juniper might change field names or indentation → parser needs updating
3. **Non-standard interfaces**: Loopback, management, or virtual interfaces might have different formatting
4. **Multi-line descriptions**: If a description spans multiple lines, my regex only captures the first line
5. **Unicode characters**: Interface descriptions might contain non-ASCII characters
6. **Very long output**: Thousands of interfaces might need streaming instead of splitting the whole string at once

### Q8.8: What does `.filter((b) => b.trim())` do after `.split()`?
**A:** When you split `"Physical interface: X...Physical interface: Y..."` by `"Physical interface: "`, the first element is always an empty string (the part before the first occurrence). `.filter((b) => b.trim())` removes empty or whitespace-only strings. `.trim()` removes leading/trailing whitespace, and an empty string after trimming is falsy, so `.filter()` removes it. Java equivalent: `Arrays.stream(parts).filter(s -> !s.trim().isEmpty()).collect(Collectors.toList())`.

---

## Cross-Cutting Concerns

### Q9.1: How do you test your crawler without hitting real websites?
**A:** In my integration tests, I create a local HTTP server using Node's built-in `http.createServer()`. It runs on `127.0.0.1` with a random port (port 0 = OS assigns an available port). I define test pages as a dictionary: `{ "/": "<a href='/about'>", "/about": "<p>about page</p>" }`. The server responds with these pages. This way I test the full pipeline (fetch → parse → extract → enqueue → dequeue) without any network dependency, rate limiting, or flakiness. Tests are fast, deterministic, and repeatable.

### Q9.2: What's the difference between unit tests and integration tests in your project?
**A:** 
- **Unit tests** (`normalizer.test.ts`, `extractor.test.ts`, `parseInterfaces.test.ts`): test ONE function in isolation. `normalizeUrl("/about?utm_source=x", "https://ipfabric.io")` → verify output. No HTTP, no server, no Redis.
- **Integration tests** (`crawler.integration.test.ts`): test the FULL crawl pipeline end-to-end. Start a real HTTP server, run `crawl()` with `MemoryFrontier`/`MemoryVisited`, verify that the right pages were crawled in the right order with the right depth values. This catches issues that unit tests miss — like the interaction between the concurrency limiter, the queue, and the link extractor.

### Q9.3: Why is Node.js single-threaded but can still handle concurrent HTTP requests?
**A:** Node.js delegates I/O operations to the operating system (via libuv). When you call `fetch()`, Node tells the OS "make this HTTP request and notify me when it's done," then immediately moves on to the next task. The OS handles the actual networking using its own mechanisms (epoll on Linux, kqueue on macOS, IOCP on Windows). When the response arrives, the OS notifies Node, which adds a callback to the event loop queue. Node processes these callbacks one at a time on its single thread. So Node is single-threaded for JavaScript execution, but the I/O is handled by the OS in parallel. This is why Node is great for I/O-heavy workloads (web servers, crawlers, API gateways) but not for CPU-heavy work (video encoding, machine learning).

### Q9.4: If you were joining IP Fabric, what would you bring from this project?
**A:** This project demonstrates skills directly relevant to IP Fabric's work:
1. **Parser development**: Writing regex-based parsers for unstructured CLI output — exactly what IP Fabric does for hundreds of vendor formats
2. **Distributed systems thinking**: Understanding of queues, deduplication, atomic operations, crash recovery — relevant for IP Fabric's large-scale network discovery
3. **Node.js/TypeScript proficiency**: async/await, Promises, event loop — IP Fabric's stack
4. **Clean architecture**: Interface-based design, dependency injection, strategy pattern — maintainable code for a growing codebase
5. **Testing methodology**: Both unit and integration testing with mock servers — essential for parser development where edge cases are endless
