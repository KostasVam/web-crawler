# Roadmap

## Assignment Requirements Coverage

| Requirement | Phase | How |
|---|---|---|
| Fetch content of URLs | Phase 1 | Worker loop: HTTP GET → HTML |
| Discover new URLs from content | Phase 1 | cheerio extracts `<a href>` links |
| Crawl discovered URLs | Phase 1 | BFS queue loop |
| Seed with `ipfabric.io` | Phase 1 | Configurable seed URL |
| State assumptions & limitations | README | Assumptions & Limitations table |
| Evaluate weaknesses | README + ADRs | Each ADR has "Consequences → Negative" |
| Future improvements | Phase 3-5 | Robustness, observability, advanced scaling |
| Scale on large grid of machines | Phase 2 + 5 | Redis coordination + sharding + Bloom filters |
| Run on multiple nodes | Phase 2 | Redis-backed queue + visited set |
| Complete scan guarantee | Phase 2 | Atomic SADD = each URL visited exactly once |
| Horizontal scalability focus | Phase 2 + 5 | Stateless workers, consistent hashing |

---

## Phase 1: Single-Node Crawler (MVP)
Get a working crawler that runs on one machine with in-memory state.

- [x] Project setup (TypeScript, Node.js)
- [ ] URL extractor — parse HTML with cheerio, extract `<a href>` links
- [ ] URL normalizer — resolve relative URLs, remove fragments/tracking params
- [ ] In-memory frontier (queue) and visited set
- [ ] Single worker loop: dequeue → fetch → extract → enqueue
- [ ] Domain scoping — only crawl seed domain
- [ ] Max depth limiting
- [ ] Concurrency control with p-limit (multiple fetches per worker)
- [ ] Basic console output (URLs crawled, queue size, errors)
- [ ] Graceful shutdown (finish current fetches on SIGINT)

**After Phase 1 you can say**: "I built a working crawler that does BFS traversal with configurable concurrency and depth limiting."

---

## Phase 2: Distributed (Redis-backed)
Replace in-memory state with Redis so multiple workers can cooperate.

- [ ] Redis frontier implementation (LPUSH/BRPOP)
- [ ] Redis visited set implementation (SADD/SISMEMBER)
- [ ] Docker Compose with Redis
- [ ] Configuration to switch between in-memory and Redis backends
- [ ] Run multiple worker instances against same Redis
- [ ] Verify no duplicate crawling across workers
- [ ] Stats endpoint or periodic logging (URLs/sec, queue depth, visited count)

**After Phase 2 you can say**: "I made it distributed — multiple workers coordinate through Redis with no duplicate work. I can scale horizontally by adding workers."

---

## Phase 3: Robustness
Handle real-world edge cases.

- [ ] Retry failed fetches (with exponential backoff)
- [ ] Timeout on HTTP requests (don't hang forever)
- [ ] Handle non-HTML content types (skip images, PDFs, etc.)
- [ ] Respect `robots.txt` (fetch and parse, honor Disallow rules)
- [ ] Politeness delay per domain (don't hammer the server)
- [ ] Error tracking and reporting
- [ ] Reliable queue pattern (BRPOPLPUSH — recover from worker crashes)
- [ ] Redis connection retry / reconnect logic

**After Phase 3 you can say**: "The crawler is production-grade — it handles failures gracefully, respects server policies, and recovers from crashes."

---

## Phase 4: Observability & Output
Make the results useful and the system observable.

- [ ] Store crawled page data (URL, title, status code, outgoing links)
- [ ] Export results as JSON
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
