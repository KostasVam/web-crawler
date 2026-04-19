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
  - Worker A: BRPOP → gets "/about" (it was waiting for new items)
  - Worker B: BRPOP → gets "/products" (was blocked, now wakes up!)
  - Worker C: BRPOP → gets "/blog" (was blocked, now wakes up!)
  - ALL THREE are now working in PARALLEL on different URLs!

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

STEP 4: Build the result
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
  }

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
