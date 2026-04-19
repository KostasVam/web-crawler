# Scenarios — What Actually Happens (Step by Step)

These are "stories" that explain how the crawler works in real situations.
Read them like a comic book — each step happens in order.

---

## Scenario 1: Single Worker, Happy Path

**Setup:** 1 worker, memory mode, seed = `https://ipfabric.io`, maxDepth = 2

```
STEP 1: Worker starts
  - parseArgs() reads CLI arguments
  - mode = "memory" → creates MemoryFrontier (JS array) + MemoryVisited (JS Set)
  - Calls crawl(config, frontier, visited)

STEP 2: Seed URL enters the system
  - visited.add("https://ipfabric.io") → returns TRUE (never seen before)
  - frontier.enqueue({ url: "https://ipfabric.io", depth: 0 })
  - Queue is now: [ {url: "https://ipfabric.io", depth: 0} ]

STEP 3: Main loop starts (while !stopping)
  - frontier.dequeue() → gets {url: "https://ipfabric.io", depth: 0}
  - Queue is now: [] (empty)
  - limit(() => processItem(item)) → pLimit has 0 active, limit is 5, so it runs immediately

STEP 4: processItem runs
  - fetchPage("https://ipfabric.io", 10000)
    - fetch() sends HTTP GET request
    - Server responds 200 OK, content-type: text/html
    - Returns { html: "<html>...", status: 200, skipped: false }

STEP 5: Extract links
  - cheerio.load(html) → parses the HTML
  - Finds 3 links: /about, /products, /blog
  - extractLinks normalizes them:
    - "/about" → "https://ipfabric.io/about"
    - "/products" → "https://ipfabric.io/products"  
    - "/blog" → "https://ipfabric.io/blog"
  - depth (0) < maxDepth (2) → YES, we process the links

STEP 6: enqueueNewLinks
  - visited.add("https://ipfabric.io/about") → TRUE (new!) → enqueue at depth 1
  - visited.add("https://ipfabric.io/products") → TRUE (new!) → enqueue at depth 1
  - visited.add("https://ipfabric.io/blog") → TRUE (new!) → enqueue at depth 1
  - Queue is now: [ {about, depth:1}, {products, depth:1}, {blog, depth:1} ]

STEP 7: Back to main loop
  - frontier.dequeue() → gets {url: ".../about", depth: 1}
  - processItem runs → finds 2 new links at depth 2
  - frontier.dequeue() → gets {url: ".../products", depth: 1}
  - processItem runs → finds 1 new link at depth 2
  - ... continues ...

STEP 8: Depth limit reached
  - A page at depth 2 is crawled
  - depth (2) < maxDepth (2) → FALSE → links are NOT extracted
  - No new URLs enter the queue

STEP 9: Termination
  - frontier.dequeue() → null (empty queue)
  - inFlight.size === 0 (no tasks running)
  - emptyPolls becomes 1 >= maxEmptyPolls (1 in memory mode)
  - Loop breaks → Promise.allSettled(inFlight) → returns results
```

---

## Scenario 2: Three Workers with Redis (The Distributed Story)

**Setup:** 3 workers in 3 terminals, Redis mode, same seed URL

```
TIME 0: Worker A starts first
  - Connects to Redis
  - visited.add("https://ipfabric.io") → SADD returns 1 (new!)
  - frontier.enqueue({url: seed, depth: 0}) → LPUSH to Redis list

TIME 1: Workers B and C start
  - They also call visited.add("https://ipfabric.io") → SADD returns 0 (already exists!)
  - They DON'T enqueue the seed again
  - They go straight to the main loop → BRPOP → queue is empty → they WAIT (blocking)

TIME 2: Worker A processes the seed
  - BRPOP → gets the seed URL
  - Fetches https://ipfabric.io → finds 3 links: /about, /products, /blog
  - SADD "about" → 1 (new) → LPUSH
  - SADD "products" → 1 (new) → LPUSH  
  - SADD "blog" → 1 (new) → LPUSH
  - Redis queue now has 3 items

TIME 3: All 3 workers grab URLs (THIS IS THE MAGIC)
  - Workers B and C were BLOCKED on BRPOP (waiting for items to appear)
  - Worker A finishes processing the seed and loops back to BRPOP
  - As Worker A did LPUSH 3 times, Redis wakes up blocked consumers:
    - Worker B: BRPOP unblocks → gets "/about"
    - Worker C: BRPOP unblocks → gets "/products"
    - Worker A: BRPOP → gets "/blog" (not blocked — items already in queue)
  - ALL THREE are now working in PARALLEL on different URLs!
  - NOTE: BRPOP is FAIR — it wakes up the worker that's been waiting the LONGEST first

TIME 4: Each worker finds more links
  - Worker A on /about: finds /about/team, /about/careers
    - SADD "about/team" → 1 → LPUSH
    - SADD "about/careers" → 1 → LPUSH
  - Worker B on /products: finds /products/demo, /about (already visited!)
    - SADD "products/demo" → 1 → LPUSH  
    - SADD "about" → 0 (ALREADY VISITED! Skip!)
  - Worker C on /blog: finds /blog/post-1, /about (already visited!)
    - SADD "blog/post-1" → 1 → LPUSH
    - SADD "about" → 0 (Skip! Worker A already claimed it)

TIME 5: Workers continue grabbing from queue
  - The queue keeps filling and draining
  - No URL is ever crawled twice (SADD guarantees this)
  - No URL is ever lost (Redis stores everything)
  - Workers automatically load-balance (whoever is free grabs next URL)

TIME 6: Queue runs dry
  - All URLs at maxDepth have been crawled (no new links extracted)
  - Redis queue is empty
  - Workers BRPOP → timeout after 2 seconds → returns null
  - emptyPolls starts incrementing: 1... 2... 3
  - After 3 empty polls → worker exits gracefully
```

---

## Scenario 3: Worker Crash Mid-Crawl

**Setup:** 2 workers, Redis mode, Worker A crashes while processing a URL

```
TIME 0: Both workers running
  - Queue has: [url-1, url-2, url-3, url-4, url-5]
  - visited has: {seed, url-1, url-2, url-3, url-4, url-5}

TIME 1: Workers grab URLs
  - Worker A: BRPOP → gets url-1 (REMOVED from queue)
  - Worker B: BRPOP → gets url-2 (REMOVED from queue)
  - Queue now: [url-3, url-4, url-5]

TIME 2: Worker A CRASHES (kill -9, out of memory, etc.)
  - url-1 was BRPOP'd (removed from queue)
  - url-1 is in visited set (SADD was done when it was discovered)
  - url-1 will NEVER be crawled — it's gone!
  - This is a KNOWN LIMITATION of this design

TIME 3: Worker B is fine, continues working
  - Worker B processes url-2 successfully
  - Worker B grabs url-3, url-4, url-5 from queue
  - Worker B handles ALL remaining work alone

TIME 4: What we LOST vs what we KEPT
  - LOST: url-1 (was in-flight when Worker A crashed)
  - LOST: any links that url-1 would have discovered
  - KEPT: url-3, url-4, url-5 (still in Redis queue)
  - KEPT: all visited URLs (still in Redis set)

HOW TO FIX THIS (interview answer):
  "I would use a processing queue pattern:
   1. When a worker BRPOP's a URL, also add it to a 'processing' set with a timestamp
   2. When the worker finishes, remove it from 'processing'
   3. A background monitor checks 'processing' — if a URL has been there > 60 seconds,
      it assumes the worker crashed and moves it back to the main queue
   This is how tools like Sidekiq and Bull handle this."
```

---

## Scenario 4: Back-Pressure in Action

**Setup:** 1 worker, concurrency = 2, a site with many links

```
STATE: concurrency = 2, so max inFlight = 4 (concurrency * 2)

STEP 1: dequeue URL-A → limit() → pLimit runs it immediately (active: 1)
  inFlight: {A}  |  pLimit active: 1

STEP 2: dequeue URL-B → limit() → pLimit runs it (active: 2)
  inFlight: {A, B}  |  pLimit active: 2 (= concurrency, FULL)

STEP 3: dequeue URL-C → limit() → pLimit QUEUES it (active already 2)
  inFlight: {A, B, C}  |  pLimit active: 2, queued: [C]

STEP 4: dequeue URL-D → limit() → pLimit QUEUES it
  inFlight: {A, B, C, D}  |  pLimit active: 2, queued: [C, D]
  inFlight.size (4) >= concurrency*2 (4) → BACK-PRESSURE KICKS IN!
  → await Promise.race(inFlight) → STOP dequeuing, wait for one to finish

STEP 5: URL-A finishes!
  - pLimit: active-- (now 1), next() → starts C (active: 2 again)
  - inFlight.delete(A) → inFlight: {B, C, D}
  - Promise.race resolves → main loop continues

STEP 6: dequeue URL-E → limit() → pLimit QUEUES it
  inFlight: {B, C, D, E}  → back-pressure again, wait...

WHY THIS MATTERS:
  Without back-pressure, if Redis has 1,000,000 URLs:
  - Main loop dequeues ALL of them into memory
  - Each creates a Promise object sitting in inFlight
  - Memory usage: BOOM! Out of memory crash
  
  With back-pressure:
  - Max 4 Promises in memory at any time
  - URLs stay safely in Redis until needed
  - Memory usage: constant, predictable
```

---

## Scenario 5: The Parser — What IP Fabric Actually Does

**Setup:** You have the raw text output from a Juniper router's "show interfaces" command.
IP Fabric connects to network devices, runs commands like this, and PARSES the output
into structured data that can be stored in a database and queried.

```
INPUT (raw text from router):
┌──────────────────────────────────────────────────────────────────┐
│ Physical interface: ge-0/0/0, Enabled, Physical link is Up      │
│   Description: UPLINK TO CORE                                   │
│   Speed: 1000mbps                                               │
│   Link-mode: Full-duplex                                        │
│   Current address: 50:00:00:26:00:00                            │
│                                                                  │
│   Logical interface ge-0/0/0.0                                  │
│     Description: VLAN 100 - Management                          │
│     Protocol inet, MTU: 1500                                    │
│     Protocol inet6, MTU: 1500                                   │
│                                                                  │
│ Physical interface: ge-0/0/1, Disabled, Physical link is Down   │
│   Speed: 100mbps                                                │
│   Current address: 50:00:00:26:00:01                            │
└──────────────────────────────────────────────────────────────────┘

STEP 1: parseInterfaces(text) is called
  - Split text by "Physical interface: " → gets 2 blocks

STEP 2: parsePhysicalBlock(block1) — first block is "ge-0/0/0, Enabled..."
  - Regex matches: name = "ge-0/0/0", admin = "enabled", link = "up"
  - parseSpeed("1000mbps") → 1000 * 1_000_000 = 1_000_000_000 (bits/sec)
  - parseDuplex("Full-duplex") → "full"
  - parseMac("50:00:00:26:00:00") → colonToDotNotation → "5000.0026.0000"
    (Juniper uses colon notation, IP Fabric converts to Cisco dot notation)
  - parseDescription → "UPLINK TO CORE"

STEP 3: parseLogicalInterfaces(block1)
  - Split by "  Logical interface " → 1 logical interface
  - name = "ge-0/0/0.0"
  - description = "VLAN 100 - Management"
  - Protocol matches: "inet" (IPv4), "inet6" (IPv6)

STEP 4: parsePhysicalBlock(block2) — second block is "ge-0/0/1, Disabled..."
  - Regex matches: name = "ge-0/0/1", admin = "disabled", link = "down"
  - parseSpeed("100mbps") → 100 * 1_000_000 = 100_000_000 (bits/sec)
  - parseDuplex → no match → undefined (not included in output)
  - parseMac("50:00:00:26:00:01") → "5000.0026.0001"
  - parseDescription → no match → undefined (this interface has no description)
  - parseLogicalInterfaces → no logical interfaces found → empty array
  - NOTE: optional fields (dscr, duplex) are simply OMITTED from the object.
    The output stays clean — no "dscr: null" or "duplex: undefined".

STEP 5: Build the result — an array with BOTH interfaces
  [
    {
      name: "ge-0/0/0",
      state: { admin: "enabled", link: "up" },
      speed: 1000000000,
      duplex: "full",
      mac: "5000.0026.0000",
      dscr: "UPLINK TO CORE",
      logicalInterfaceList: [
        {
          name: "ge-0/0/0.0",
          dscr: "VLAN 100 - Management",
          protocolList: [
            { type: "inet" },
            { type: "inet6" }
          ]
        }
      ]
    },
    {
      name: "ge-0/0/1",
      state: { admin: "disabled", link: "down" },
      speed: 100000000,
      mac: "5000.0026.0001",
      logicalInterfaceList: []
      ← NO dscr (no description configured)
      ← NO duplex (not reported when link is down)
      ← EMPTY logicalInterfaceList (no VLANs configured on this port)
    }
  ]

WHY THIS MATTERS FOR IP FABRIC:
  IP Fabric is a network assurance platform. It:
  1. Connects to routers/switches via SSH
  2. Runs commands like "show interfaces", "show routes", etc.
  3. PARSES the unstructured text output into structured JSON
  4. Stores it in a database for analysis

  The parser you built does step 3. In production, IP Fabric supports
  hundreds of vendors (Cisco, Juniper, Arista, Huawei...) — each with
  different output formats. Your parser handles Juniper's format.

  This is EXACTLY what you'd be doing on the job:
  - Read vendor documentation
  - Write regexes to extract data from CLI output
  - Handle edge cases (missing fields, different firmware versions)
  - Convert between formats (colon MAC → dot MAC)
```

---

## Scenario 6: URL Normalization — Why the Same Page Has 10 Different URLs

```
A user shares a link on social media. By the time it reaches different people,
tracking parameters have been added:

THESE ARE ALL THE SAME PAGE:
  https://ipfabric.io/about#team
  https://ipfabric.io/about?utm_source=twitter&utm_medium=social
  https://ipfabric.io/about?fbclid=abc123
  https://ipfabric.io/about/
  https://IPFabric.io/about
  https://www.ipfabric.io/about?ref=homepage&utm_campaign=launch

Without normalization, the crawler would visit this page 6 TIMES!

normalizeUrl processes each one:
  1. Remove fragment (#team)          → ipfabric.io/about
  2. Remove tracking params (utm_*)   → ipfabric.io/about  
  3. Remove trailing slash (/)        → ipfabric.io/about
  4. Lowercase hostname               → ipfabric.io/about
  5. Sort remaining query params      → ipfabric.io/about

Result: ALL 6 URLs normalize to "https://ipfabric.io/about"
The visited Set (SADD) sees them as the same URL → crawled only ONCE.
```

---

## Scenario 7: Retry Behavior — Server Error Then Recovery

**Setup:** Worker fetches a URL, server returns 503 twice, then 200.
Shows exactly what fetchPage() does internally.

```
ATTEMPT 0 (first try):
  - fetch("https://ipfabric.io/api") → server responds HTTP 503 Service Unavailable
  - status 503 → 5xx → server error → TRANSIENT (might recover)
  - response.ok is false
  - attempt (0) < MAX_RETRIES (2) → YES, retry
  - Console: "HTTP 503 — retry 1/2"
  - Sleep 500ms (RETRY_DELAYS[0])
  - "continue" → go back to top of for loop

ATTEMPT 1 (second try):
  - fetch("https://ipfabric.io/api") → server responds HTTP 503 again
  - Same as above, but now attempt = 1
  - attempt (1) < MAX_RETRIES (2) → YES, retry again
  - Console: "HTTP 503 — retry 2/2"
  - Sleep 1500ms (RETRY_DELAYS[1]) ← longer wait this time (backoff)
  - "continue" → go back to top of for loop

ATTEMPT 2 (third and final try):
  - fetch("https://ipfabric.io/api") → server responds HTTP 200 OK!
  - response.ok is true → skip the 5xx check
  - Check content-type → "text/html" → good!
  - Read HTML body → return { html: "...", status: 200, skipped: false }
  - SUCCESS after 2 retries!

WHAT IF ATTEMPT 2 ALSO FAILED?
  - status 503, attempt (2) < MAX_RETRIES (2) → FALSE
  - Console: "HTTP 503 — skipped after 2 retries"
  - return { html: "", status: 503, skipped: true }
  - The URL is counted as an error, but the crawler continues with other URLs

WHAT ABOUT 404?
  - fetch("https://ipfabric.io/missing") → HTTP 404 Not Found
  - status 404 → 4xx → client error → PERMANENT (page doesn't exist)
  - NO RETRY — immediately return { html: "", status: 404, skipped: true }
  - Why? A 404 means the page doesn't exist. Asking again won't create it.
  - Same for 403 Forbidden, 401 Unauthorized, etc.

WHAT ABOUT NETWORK ERRORS?
  - fetch() throws: "ECONNREFUSED" or "AbortError" (timeout)
  - Enters the catch block, NOT the status code checks
  - Same retry logic: attempt < MAX_RETRIES → sleep → retry
  - After all retries: "throw err" → caught by processItem → errors++
```

---

## Scenario 8: Graceful Shutdown (Ctrl+C)

**Setup:** Worker is crawling with 3 tasks in-flight. User presses Ctrl+C.
Shows the entire shutdown chain, step by step.

```
STATE BEFORE Ctrl+C:
  - Main loop is running
  - inFlight has 3 tasks: {task-A (fetching /about), task-B (fetching /blog), task-C (in pLimit queue)}
  - Queue has 10 more URLs waiting
  - stopping = false

USER PRESSES Ctrl+C:
  - OS sends SIGINT signal to the Node.js process
  - process.on("SIGINT", onSignal) fires
  - onSignal() runs:
      console.log("Graceful shutdown requested...")
      stopping = true      ← THIS IS ALL IT DOES. No process.exit()!

WHAT HAPPENS NEXT — the main loop checks "stopping":

  1. Main loop: "while (!stopping)" → stopping is now TRUE → loop exits!
     But it does NOT kill in-flight tasks. They keep running.

  2. "await Promise.allSettled(inFlight)" — waits for ALL 3 tasks:
     - task-A: fetching /about → still waiting for HTTP response...
     - task-B: fetching /blog → still waiting...
     - task-C: in pLimit queue → pLimit runs it when a slot opens

  3. task-A finishes → fetchPage returns → processItem runs:
     - "if (stopping) return;" at the top of processItem → BUT task-A is ALREADY
       past this check (it's in the middle of processing)
     - extractLinks finds new URLs → enqueueNewLinks is called
     - Inside enqueueNewLinks: "if (isStopping()) break;" → isStopping() is TRUE!
     - We DON'T enqueue new links → prevents new work from piling up
     - task-A completes

  4. task-B finishes → same as task-A

  5. task-C starts (pLimit slot opened) → processItem runs:
     - "if (stopping) return;" → stopping is TRUE → returns IMMEDIATELY
     - task-C does NO work — skipped entirely

  6. All 3 tasks done → Promise.allSettled resolves

  7. Cleanup:
     - process.off("SIGINT", onSignal) — remove signal handler
     - process.off("SIGTERM", onSignal)
     - Calculate duration, return results

RESULT:
  - task-A and task-B: crawled their pages, but did NOT enqueue new links
  - task-C: skipped entirely
  - 10 URLs in queue: never processed (that's ok, we're shutting down)
  - No data corruption, no orphan connections
  - This is "GRACEFUL" because: we let in-flight work finish cleanly,
    we just stop accepting NEW work

COMPARE WITH UNGRACEFUL (kill -9):
  - Process killed immediately
  - In-flight HTTP requests: abandoned (server might still process them)
  - Open Redis connections: not closed properly
  - Output file: might not be written (if we were mid-write)
  - No cleanup code runs at all
```

---

## Scenario 9: BFS vs DFS — Why FIFO Queue Matters

**Setup:** Crawling a site with this link structure, maxDepth = 3:
```
                    seed (depth 0)
                   /      \
              /about     /blog     (depth 1)
              /    \        |
         /team  /careers  /post-1  (depth 2)
           |
        /team/alice                (depth 3)
```

### BFS — What our crawler does (FIFO queue: push right, pop left)

```
Queue operations (→ = enqueue right, ← = dequeue left):

START: Queue = [seed]

Round 1: ← dequeue seed (depth 0)
  Process seed → find /about, /blog → enqueue both
  Queue = [/about, /blog]

Round 2: ← dequeue /about (depth 1) ← TAKES THE OLDEST FIRST
  Process /about → find /team, /careers → enqueue both
  Queue = [/blog, /team, /careers]

Round 3: ← dequeue /blog (depth 1) ← STILL DOING DEPTH 1!
  Process /blog → find /post-1 → enqueue
  Queue = [/team, /careers, /post-1]

Round 4: ← dequeue /team (depth 2) ← NOW depth 2 starts
  Process /team → find /team/alice → enqueue
  Queue = [/careers, /post-1, /team/alice]

Round 5: ← dequeue /careers (depth 2)
Round 6: ← dequeue /post-1 (depth 2)
Round 7: ← dequeue /team/alice (depth 3) ← depth 3, last level

CRAWL ORDER: seed → /about → /blog → /team → /careers → /post-1 → /team/alice
PATTERN: all depth-0, then all depth-1, then all depth-2, then all depth-3
THIS IS BFS (Breadth-First Search)!
```

### DFS — What would happen with a LIFO stack (push right, pop right)

```
START: Stack = [seed]

Round 1: pop seed → find /about, /blog → push both
  Stack = [/about, /blog]

Round 2: pop /blog (depth 1) ← TAKES THE NEWEST FIRST
  Process /blog → find /post-1 → push
  Stack = [/about, /post-1]

Round 3: pop /post-1 (depth 2) ← JUMPS TO DEPTH 2 IMMEDIATELY!
  Process /post-1 → no new links
  Stack = [/about]

Round 4: pop /about (depth 1)
  Process /about → find /team, /careers → push
  Stack = [/team, /careers]

Round 5: pop /careers (depth 2) ← NEWEST FIRST AGAIN
  ... and so on

CRAWL ORDER: seed → /blog → /post-1 → /about → /careers → /team → /team/alice
PATTERN: dives DEEP before going WIDE
```

### Why BFS is better for a web crawler:

```
1. IMPORTANT PAGES FIRST
   - Pages closer to the homepage (depth 1) are usually more important
   - BFS finds them BEFORE going deep into obscure sub-pages
   - If you hit a time limit, you've already crawled the most valuable pages

2. PREDICTABLE DEPTH CONTROL
   - maxDepth = 2 means: ALL pages at depth 0, 1, and 2 are crawled
   - With DFS, you might crawl depth 0 → 1 → 2 → 3 on one branch
     while completely missing depth 1 pages on another branch

3. DISTRIBUTED FAIRNESS
   - With multiple workers, BFS ensures all workers process
     similarly-important pages (all at the same depth level)
   - DFS could send one worker deep into a dead-end branch

4. INTERVIEW ANSWER:
   "I chose BFS because it prioritizes breadth over depth. In a web crawler,
   pages closer to the homepage are typically more important. BFS ensures
   we crawl all pages at depth N before going to depth N+1. This is
   implemented via a FIFO queue — LPUSH/BRPOP in Redis, push/shift in memory."
```
