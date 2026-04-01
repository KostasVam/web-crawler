# Roadmap

## Assignment Requirements Coverage

| Requirement | Phase | Status | How |
|---|---|---|---|
| Fetch content of URLs | Phase 1 | Done | Worker loop: HTTP GET → HTML |
| Discover new URLs from content | Phase 1 | Done | cheerio extracts `<a href>` links |
| Crawl discovered URLs | Phase 1 | Done | BFS queue loop |
| Seed with `ipfabric.io` | Phase 1 | Done | Configurable seed URL |
| State assumptions & limitations | README | Done | Assumptions & Limitations table |
| Evaluate weaknesses | README + ADRs | Done | Each ADR has "Consequences → Negative" |
| Future improvements | Phase 3-5 | Done | Robustness, observability, advanced scaling |
| Scale on large grid of machines | Phase 2 | Done | Redis coordination (verified with 2 workers) |
| Run on multiple nodes | Phase 2 | Done | Redis-backed queue + visited set |
| Complete scan guarantee | Phase 2 | Done | Atomic SADD = each URL visited exactly once |
| Horizontal scalability focus | Phase 2 | Done | Stateless workers, consistent hashing (documented) |
| Parse device CLI output | Parser | Done | Juniper "show interfaces" → structured JSON |

---

## Phase 1: Single-Node Crawler (MVP)
Get a working crawler that runs on one machine with in-memory state.

- [x] Project setup (TypeScript, Node.js)
- [x] URL extractor — parse HTML with cheerio, extract `<a href>` links
- [x] URL normalizer — resolve relative URLs, remove fragments/tracking params
- [x] In-memory frontier (queue) and visited set
- [x] Single worker loop: dequeue → fetch → extract → enqueue
- [x] Domain scoping — only crawl seed domain
- [x] Max depth limiting
- [x] Concurrency control (inline p-limit for parallel fetches)
- [x] Basic console output (URLs crawled, queue size, errors)
- [x] Graceful shutdown (finish current fetches on SIGINT)

---

## Phase 2: Distributed (Redis-backed)
Replace in-memory state with Redis so multiple workers can cooperate.

- [x] Redis frontier implementation (LPUSH/BRPOP)
- [x] Redis visited set implementation (SADD/SISMEMBER)
- [x] Docker Compose with Redis
- [x] Configuration to switch between in-memory and Redis backends
- [x] Run multiple worker instances against same Redis
- [x] Verify no duplicate crawling across workers (verified at depth 1 and 2)
- [x] Crawl duration and throughput metrics (pages/sec)

---

## Phase 3: Robustness (partially implemented)
Handle real-world edge cases.

- [x] Retry failed fetches (2 retries with exponential backoff)
- [x] Timeout on HTTP requests (configurable, default 10s)
- [x] Handle non-HTML content types (skip images, PDFs, etc.)
- [ ] Respect `robots.txt` (fetch and parse, honor Disallow rules)
- [ ] Politeness delay per domain (don't hammer the server)
- [ ] Reliable queue pattern (BRPOPLPUSH — recover from worker crashes)
- [ ] Redis connection retry / reconnect logic

---

## Phase 4: Observability & Output (partially implemented)
Make the results useful and the system observable.

- [x] Store crawled page data (URL, title, status code, outgoing links)
- [x] Export results as JSON (`--output` flag)
- [ ] Crawl statistics dashboard (terminal UI or simple web page)
- [ ] Structured logging (JSON format)
- [ ] Prometheus metrics (pages/sec, queue depth, error rate)

---

## Phase 5: Advanced Scaling (Future / Interview Discussion)
These are things to **talk about** in the interview, not necessarily implement.

### Bloom Filter for Visited Set
- Replace Redis SET with Redis Bloom Filter module
- Reduces memory from O(n) to O(1) (fixed size regardless of URL count)
- Trade-off: ~1% false positive rate (might skip some URLs)

### URL Partitioning (Consistent Hashing)
- Hash URL domain → assign to specific Redis shard
- Each shard handles a subset of domains
- Ensures same domain always goes to same shard (important for politeness)

### DNS Caching
- DNS resolution for every fetch is slow
- Local DNS cache per worker reduces latency

### Content Deduplication
- Different URLs can serve identical content (mirrors, redirects)
- Hash page content (SHA-256) → skip if already seen
- Saves storage and avoids duplicate processing

### Priority Queue
- Not all URLs are equally important
- Prioritize by: depth (shallower = higher), page rank estimate, content type
- Replace FIFO queue with sorted set (`ZADD`/`BZPOPMIN`)

### Rate Limiting Per Domain
- Currently we scope to one domain, but for multi-domain crawling
- Per-domain token bucket to avoid overwhelming any single server

### Headless Browser Rendering
- Current limitation: we only see static HTML
- SPAs (React, Angular) generate content via JavaScript
- Puppeteer/Playwright can render JS but 10-100x slower per page
