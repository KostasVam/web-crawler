# Learning Resources

Curated list of resources to understand the concepts behind this crawler.
Ordered by priority — start from the top.

---

## 1. Node.js Event Loop & Async (MUST READ)

The foundation of why our crawler works. Node.js uses a single thread but handles thousands of concurrent connections through async I/O.

- **[Node.js Event Loop Explained (visual)](https://www.builder.io/blog/visual-guide-to-nodejs-event-loop)** — Best visual explanation. Shows how `async/await` and Promises work under the hood.
- **[MDN: Asynchronous JavaScript](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous)** — Callbacks → Promises → async/await progression. Read the Promises and async/await sections.

**Key takeaway**: When our crawler does `await fetch(url)`, Node.js doesn't wait idle — it handles other fetches. That's why one worker can fetch 10 URLs "at the same time" with one thread.

---

## 2. TypeScript Basics (MUST READ)

You'll write in TypeScript, so you need the basics.

- **[TypeScript in 5 Minutes](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html)** — The absolute minimum.
- **[TypeScript Handbook: Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)** — The types you'll actually use: `string`, `number`, `boolean`, interfaces, type aliases.
- **[TypeScript Handbook: Interfaces](https://www.typescriptlang.org/docs/handbook/2/objects.html)** — We use interfaces for `Frontier` and `VisitedStore` to swap Redis/in-memory implementations.

**Key takeaway**: TypeScript = JavaScript + type annotations. `function fetch(url: string): Promise<string>` means "takes a string, returns a Promise that resolves to a string".

---

## 3. Redis Fundamentals (MUST READ)

Redis is our coordination backbone. You need to understand 5 commands.

- **[Try Redis (interactive tutorial)](https://try.redis.io/)** — Hands-on in the browser. Do the first 10 minutes.
- **[Redis Data Types (official)](https://redis.io/docs/latest/develop/data-types/)** — Focus on **Strings**, **Lists**, and **Sets**. That's all we use.

**The 5 commands you need**:
| Command | What it does | We use it for |
|---|---|---|
| `LPUSH key value` | Add to left of list | Enqueue URL |
| `BRPOP key timeout` | Remove from right of list, block if empty | Dequeue URL (workers wait here) |
| `SADD key value` | Add to set, returns 1 if new, 0 if exists | Mark URL as visited (atomically!) |
| `SISMEMBER key value` | Check if value in set | Pre-filter before enqueue |
| `SCARD key` | Count items in set | Stats: how many URLs visited |

---

## 4. Web Crawling Concepts (SHOULD READ)

- **[Web Crawler Wikipedia](https://en.wikipedia.org/wiki/Web_crawler)** — Surprisingly good overview. Read "Crawl frontier", "Politeness policy", and "Parallelization" sections.
- **[Crawling the Web (Stanford)](https://nlp.stanford.edu/IR-book/html/htmledition/crawling-1.html)** — Academic but clear. Chapter 20.1-20.2 from Introduction to Information Retrieval. Covers URL frontier, duplicate detection, and distributed crawling.

**Key concepts**:
- **URL Frontier**: Fancy name for the queue of URLs to visit
- **Politeness**: Don't hammer a server — add delays between requests to same host
- **robots.txt**: File on every website that says what crawlers are/aren't allowed to crawl
- **URL canonicalization**: Same as our normalization (ADR-004)

---

## 5. Distributed Systems Patterns (SHOULD READ)

These are the patterns that make the crawler horizontally scalable.

- **[BRPOP — Redis Blocking Queue Pattern](https://redis.io/docs/latest/commands/brpop/)** — Official docs. This is how workers coordinate: they block-wait on a shared queue. When a URL appears, exactly one worker gets it.
- **[Reliable Queue Pattern (BRPOPLPUSH)](https://redis.io/docs/latest/commands/brpoplpush/)** — Extension: when a worker pops a URL, it simultaneously copies it to a "processing" list. If the worker dies, the URL isn't lost. We list this as a future improvement.

**Key insight**: The "magic" of our distributed system is simple — Redis commands are atomic. `SADD` and `BRPOP` can't be interrupted. No locks needed.

---

## 6. Bloom Filters (NICE TO KNOW)

When the visited set has billions of URLs, even Redis runs out of memory. A Bloom filter is a space-efficient probabilistic data structure.

- **[Bloom Filters by Example (interactive)](https://llimllib.github.io/bloomfilter-tutorial/)** — Best visual explanation.
- **[Redis Bloom Filter Module](https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter/)** — Redis has a built-in Bloom filter. `BF.ADD` / `BF.EXISTS` replace `SADD` / `SISMEMBER`.

**Key takeaway**: A Bloom filter can say "definitely not seen" or "probably seen" — never gives false negatives. Uses 10x less memory than a Set. Trade-off: might skip ~1% of URLs it thinks it saw (acceptable for crawling).

---

## 7. Consistent Hashing (NICE TO KNOW)

For extreme scale, instead of one Redis, you partition URLs across multiple Redis instances.

- **[Consistent Hashing Explained (visual)](https://www.toptal.com/big-data/consistent-hashing)** — The best visual guide to understanding the concept.

**Key takeaway**: Hash the URL's domain → maps to a specific Redis node. Same domain always goes to the same node. Add/remove nodes without reshuffling everything.

---

## Reading Order Suggestion

| Day | Topic | Time |
|---|---|---|
| Day 1 | TypeScript basics (#2), Node.js async (#1) | 2-3 hours |
| Day 2 | Redis fundamentals (#3), Try Redis interactive | 1-2 hours |
| Day 3 | Web crawling concepts (#4), read our ADRs | 1-2 hours |
| Day 4 | Distributed patterns (#5), review the code | 1-2 hours |
| Day 5 | Bloom filters & consistent hashing (#6, #7) — only if time | 1 hour |
