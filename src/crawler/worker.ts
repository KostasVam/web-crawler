// --- CRAWLER WORKER ---
// This is the HEART of the application — the main crawl loop.
// It orchestrates: fetching pages, extracting links, managing concurrency,
// and handling graceful shutdown.
//
// The crawl() function is STATELESS in terms of data storage:
//   - All URL queue state → in Frontier (Memory or Redis)
//   - All visited URL state → in VisitedStore (Memory or Redis)
//   - The worker only holds temporary, in-flight processing state
//
// This means you can run MULTIPLE workers pointing at the same Redis
// and they automatically share the work. No coordination code needed.

// cheerio: a library for parsing HTML, similar to jQuery.
// We use it to extract <a href="..."> links and page titles.
// Java equivalent: Jsoup
import * as cheerio from "cheerio";

// Importing types and dependencies
import { Config } from "../config";
import { Frontier, FrontierItem } from "./frontier";
import { VisitedStore } from "./visited";
import { extractLinks } from "./extractor";
import { pLimit } from "./limiter";

// --- OUTPUT TYPES ---

// PageRecord: information about one crawled page.
// This is what gets saved to the JSON output file.
// In Java: public record PageRecord(String url, int depth, int status, String title, List<String> links) {}
export interface PageRecord {
  url: string;       // The URL that was crawled
  depth: number;     // How many hops from the seed URL
  status: number;    // HTTP status code (200, 404, etc.)
  title: string;     // The <title> tag content
  links: string[];   // All links found on this page (that match our domain)
}

// CrawlResult: summary of the entire crawl operation.
// Returned by crawl() when everything is done.
export interface CrawlResult {
  crawled: number;      // How many pages were successfully fetched
  errors: number;       // How many pages failed (after retries)
  seedDomain: string;   // The domain we're crawling (e.g., "ipfabric.io")
  pages: PageRecord[];  // All crawled pages
  durationMs: number;   // Total time in milliseconds
}

// FetchResult: internal type for what fetchPage() returns.
// Not exported — only used within this file.
// "skipped" means: we got a response but decided not to process it
// (e.g., 404 error, or content-type is not HTML).
interface FetchResult {
  html: string;      // The HTML content (empty string if skipped)
  status: number;    // HTTP status code
  skipped: boolean;  // true = don't process this page (wrong type or error)
}

// --- RETRY CONFIGURATION ---
// When HTTP requests fail, we retry up to MAX_RETRIES times.
// But NOT for all failures — only for TRANSIENT ones (server errors, timeouts).
// Client errors (404, 403) are permanent — retrying won't help.
const MAX_RETRIES = 2;

// Delays between retries in milliseconds.
// This is "exponential-ish backoff": first retry waits 500ms, second waits 1500ms.
// The idea: give the server time to recover. If it's overloaded, hammering it
// immediately won't help.
// Array has MAX_RETRIES elements — one delay per retry attempt.
const RETRY_DELAYS = [500, 1500]; // ms — exponential-ish backoff

// --- fetchPage() ---
// Fetches a single URL with retry logic.
// "async function" means this function can use "await" and returns a Promise.
// Java equivalent: public CompletableFuture<FetchResult> fetchPage(String url, int timeoutMs)
/** Fetch a single URL with retry on transient errors. */
async function fetchPage(
  url: string,
  timeoutMs: number,
): Promise<FetchResult> {
  // Try up to MAX_RETRIES + 1 times (attempt 0, 1, 2 = original + 2 retries)
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // fetch(): the built-in Node.js HTTP client (since Node 18+).
      // Java equivalent: HttpClient.newHttpClient().send(request, ...)
      //
      // "await" means: pause this function, let other tasks run, resume when
      // the HTTP response arrives. This is how Node.js handles I/O without threads.
      //
      // AbortSignal.timeout(timeoutMs): automatically cancel the request after N ms.
      // Without this, a slow server could hang forever.
      // Java equivalent: .timeout(Duration.ofMillis(timeoutMs))
      //
      // redirect: "follow" means: if the server says "301 Moved to X", automatically go to X.
      // Java: HttpClient.followRedirects(HttpClient.Redirect.ALWAYS)
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
        headers: { "User-Agent": "IPFabric-Crawler/1.0" },
      });

      // --- Handle HTTP status codes ---

      // 4xx (Client Error): 400 Bad Request, 403 Forbidden, 404 Not Found, etc.
      // These are PERMANENT errors — the page doesn't exist or we're not allowed.
      // Retrying won't change the outcome, so we skip immediately.
      if (response.status >= 400 && response.status < 500) {
        console.warn(`  HTTP ${response.status} — skipped`);
        return { html: "", status: response.status, skipped: true };
      }

      // 5xx (Server Error): 500 Internal Server Error, 502 Bad Gateway, 503 Service Unavailable
      // These are TRANSIENT errors — the server might recover.
      // So we RETRY (unless we've run out of attempts).
      // "!response.ok" means status is not in the 200-299 range.
      if (!response.ok) {
        if (attempt < MAX_RETRIES) {
          console.warn(`  HTTP ${response.status} — retry ${attempt + 1}/${MAX_RETRIES}`);
          // Sleep before retrying. This is an ASYNC sleep — it doesn't block the thread!
          // "new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]))" creates a Promise
          // that resolves after N milliseconds. "await" pauses this function until then.
          // During the pause, other tasks can run (event loop continues).
          // Java equivalent: Thread.sleep(500) — but that BLOCKS the thread!
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          continue; // Go back to the top of the for loop and try again
        }
        // Out of retries — give up on this URL.
        console.warn(`  HTTP ${response.status} — skipped after ${MAX_RETRIES} retries`);
        return { html: "", status: response.status, skipped: true };
      }

      // --- Check content type ---
      // We only want HTML pages. PDFs, images, JSON APIs, etc. should be skipped.
      // "??" is the NULLISH COALESCING operator: if left side is null/undefined, use right side.
      // Different from "||": the "||" operator would also replace "" and 0, while "??" only replaces null/undefined.
      // Java equivalent: Optional.ofNullable(headers.get("content-type")).orElse("")
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return { html: "", status: response.status, skipped: true };
      }

      // --- Read the response body ---
      // response.text() reads the entire response body as a string.
      // This is also async because the body might still be streaming from the server.
      // Java equivalent: response.body() if using HttpClient
      const html = await response.text();
      return { html, status: response.status, skipped: false };
      // NOTE: "{ html, status: response.status, skipped: false }" uses SHORTHAND notation.
      // "html" is the same as "html: html" — if the variable name matches the property name,
      // you can write it once. Java doesn't have this.

    } catch (err) {
      // --- Network errors, timeout errors, DNS failures, etc. ---
      // These are also transient — the network might recover.
      // So we retry, just like 5xx errors.
      if (attempt < MAX_RETRIES) {
        // "err instanceof Error ? err.message : err"
        // This is a TERNARY expression with TYPE NARROWING.
        // In JavaScript, you can throw ANYTHING (string, number, object, Error).
        // "err" has type "unknown" (we don't know what was thrown).
        // "instanceof Error" checks: is this an Error object?
        //   If YES → we can safely access .message
        //   If NO  → convert it to string with String(err)
        // Java: catch blocks always give you a typed exception. JS doesn't guarantee this.
        console.warn(`  ${err instanceof Error ? err.message : err} — retry ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      // Out of retries AND it's an error (not just a bad status) — re-throw it.
      // This will be caught by processItem()'s try/catch.
      throw err;
    }
  }

  // This line should NEVER be reached (the loop always returns or throws).
  // But TypeScript's compiler doesn't know that — it sees a function that
  // might reach the end without returning. So we add this to make it happy.
  // It's a "dead code" safety net.
  // Unreachable, but TypeScript needs it
  return { html: "", status: 0, skipped: true };
}

// --- enqueueNewLinks() ---
// Takes the links found on a page and adds NEW ones to the queue.
// "New" = not yet visited (checked via visited.add()).
//
// isStopping: a callback function that returns true if the crawler is shutting down.
// We check it on each link because enqueuing hundreds of links while shutting down
// would be wasteful. This is an example of a CALLBACK pattern.
// Java equivalent: Supplier<Boolean> isStopping
/** Enqueue newly discovered links that haven't been visited yet. */
async function enqueueNewLinks(
  links: string[],
  depth: number,
  frontier: Frontier,
  visited: VisitedStore,
  isStopping: () => boolean,   // "() => boolean" = a function that returns boolean. Java: Supplier<Boolean>
): Promise<void> {
  for (const link of links) {
    // "for...of" iterates over values. Java equivalent: for (String link : links)
    // (Don't confuse with "for...in" which iterates over keys/indices — rarely used)
    if (isStopping()) break;   // Stop enqueuing if we're shutting down

    // visited.add(link):
    // - Returns true if the URL was NEWLY added (never seen before) → enqueue it
    // - Returns false if the URL was ALREADY seen → skip it
    // This is the ATOMIC deduplication check. In Redis, this is a single SADD command.
    // No race condition possible because SADD is atomic.
    const added = await visited.add(link);
    if (added) {
      // URL is new → put it in the queue for crawling.
      // "depth" here is the depth of the CHILD page (parent depth + 1).
      await frontier.enqueue({ url: link, depth });
      // NOTE: "{ url: link, depth }" is shorthand for "{ url: link, depth: depth }"
    }
  }
}

// --- crawl() ---
// THE MAIN FUNCTION. This is what index.ts calls.
// It receives its dependencies via parameters (DEPENDENCY INJECTION).
// In Spring Boot, you'd use @Autowired. Here, we pass them manually.
//
// This function is STATELESS regarding persistent data:
//   - frontier holds the queue (in-memory or Redis)
//   - visited holds the seen URLs (in-memory or Redis)
//   - This function only holds temporary processing state (in-flight tasks, counters)
//
// Because of this, you can run MULTIPLE instances of this function
// (in different processes) pointing at the same Redis, and they'll
// automatically share the work without any coordination code.
export async function crawl(
  config: Config,        // All settings (seed URL, depth, concurrency, etc.)
  frontier: Frontier,    // The URL queue (Memory or Redis implementation)
  visited: VisitedStore, // The visited URL tracker (Memory or Redis implementation)
): Promise<CrawlResult> {
  // --- Initialize state ---
  const startTime = Date.now();     // Record start time for duration calculation. Java: System.currentTimeMillis()
  const limit = pLimit(config.concurrency);  // Create a concurrency limiter. See limiter.ts for details.
  let crawled = 0;     // Counter: pages successfully crawled
  let errors = 0;      // Counter: pages that failed (after retries)
  let stopping = false; // Flag: set to true when Ctrl+C or SIGTERM is received
  const pages: PageRecord[] = [];  // Accumulates results for JSON output

  // Extract the domain from the seed URL.
  // new URL("https://www.ipfabric.io/about") → hostname = "www.ipfabric.io"
  // .replace(/^www\./, "") removes "www." prefix → "ipfabric.io"
  // We use this to filter links: only follow links on the same domain.
  // In Java: new URI(seed).getHost().replaceFirst("^www\\.", "")
  const seedDomain = new URL(config.seed).hostname.replace(/^www\./, "");

  // --- Enqueue the seed URL ---
  // First, mark it as visited (so no one else enqueues it again).
  // Then, add it to the queue to start crawling.
  const isNew = await visited.add(config.seed);
  if (isNew) {
    await frontier.enqueue({ url: config.seed, depth: 0 });
  }
  // Why "if (isNew)"? In Redis mode, another worker might have already
  // enqueued the seed. We don't want duplicates in the queue.

  // --- Graceful shutdown ---
  // When the user presses Ctrl+C (SIGINT) or the process receives SIGTERM
  // (e.g., from Docker stop), we don't kill immediately.
  // Instead, we set stopping=true and let in-flight tasks finish.
  // Java equivalent: Runtime.getRuntime().addShutdownHook(new Thread(() -> stopping = true));
  const onSignal = () => {
    console.log("\nGraceful shutdown requested...");
    stopping = true;
    // NOTE: We don't call process.exit()! We just set the flag.
    // The main loop checks "stopping" and will exit cleanly.
  };
  // process.on("SIGINT", handler) registers a callback for the signal.
  // SIGINT = Ctrl+C, SIGTERM = kill command / Docker stop
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // --- processItem() ---
  // Processes a single URL: fetch it, extract links, enqueue new links.
  // This is defined as a NESTED FUNCTION (closure). It has access to all
  // variables in the outer scope: config, frontier, visited, stopping, crawled, etc.
  // In Java, you'd need a separate class with these as fields.
  async function processItem(item: FrontierItem): Promise<void> {
    // If we're shutting down, skip this item.
    if (stopping) return;

    console.log(`[depth=${item.depth}] ${item.url}`);

    try {
      // Fetch the page. This may retry internally on 5xx/network errors.
      const result = await fetchPage(item.url, config.requestTimeout);

      // If the page was skipped (wrong content type, 4xx error, etc.), bail out.
      if (result.skipped) return;

      crawled++;  // Count this as a successfully crawled page

      // Parse the HTML to extract the <title> tag.
      // cheerio.load(html) creates a jQuery-like interface for the HTML.
      // $("title") finds the <title> tag, .first() gets the first match,
      // .text() gets the text content, .trim() removes whitespace.
      // Java equivalent: Jsoup.parse(html).title()
      const $ = cheerio.load(result.html);
      const title = $("title").first().text().trim();

      // Extract links from the page, BUT ONLY if we haven't reached maxDepth.
      // If depth = maxDepth, we crawl the page (for data) but don't follow its links.
      // This prevents infinite crawling.
      // The "? ... : ..." is a TERNARY OPERATOR — same as Java.
      const links = item.depth < config.maxDepth
        ? extractLinks(result.html, item.url, seedDomain)  // Extract and normalize links
        : [];  // At max depth → empty array, don't follow any links

      // Save this page's data for the JSON output.
      // .push() adds to the end of the array. Java: list.add(...)
      pages.push({
        url: item.url,
        depth: item.depth,
        status: result.status,
        title,          // Shorthand for "title: title"
        links,          // Shorthand for "links: links"
      });

      // Enqueue newly discovered links (if any).
      // "links.length > 0" is just an optimization — skip the function call if there's nothing.
      // "() => stopping" is a CALLBACK (lambda in Java). It's called inside enqueueNewLinks
      // to check if we should stop. We pass a function (not the value) because the value
      // of "stopping" might change WHILE we're enqueuing links (if user presses Ctrl+C).
      if (links.length > 0) {
        await enqueueNewLinks(links, item.depth + 1, frontier, visited, () => stopping);
      }
    } catch (err: unknown) {
      // "err: unknown" — TypeScript strict mode requires this.
      // In Java, catch(Exception e) guarantees e is an Exception.
      // In JS/TS, you can throw ANYTHING. "unknown" forces you to check the type.
      const msg = err instanceof Error ? err.message : String(err);
      // "instanceof Error" is a TYPE GUARD. After this check, TypeScript knows
      // that inside the "?" branch, err is definitely an Error (with .message).
      // In Java: if (err instanceof Exception) { err.getMessage(); }
      console.warn(`  Error: ${msg}`);
      errors++;
    }
  }

  // ==============================================
  // === MAIN CRAWL LOOP — THE HEART OF IT ALL ===
  // ==============================================

  // inFlight: tracks all promises (tasks) that are currently running or queued in pLimit.
  // We need this to:
  //   1. Wait for tasks to finish when the queue is empty (they might enqueue new URLs)
  //   2. Implement back-pressure (don't dequeue too fast)
  //   3. Wait for all tasks at the end (graceful shutdown)
  // Using a Set because we need fast add/delete/size operations.
  // Java equivalent: Set<CompletableFuture<Void>>
  const inFlight: Set<Promise<void>> = new Set();

  // emptyPolls: counts consecutive times we found an empty queue.
  // Used for termination detection.
  let emptyPolls = 0;

  // maxEmptyPolls: how many empty polls before we decide "we're done".
  // Redis mode: 3 — because another worker might add URLs to the queue.
  //   We wait 3 * 2 seconds = 6 seconds before giving up.
  // Memory mode: 1 — if the queue is empty and nothing is in flight,
  //   no one else can add URLs (single process). We're definitely done.
  const maxEmptyPolls = config.mode === "redis" ? 3 : 1;

  // THE MAIN LOOP — runs until we decide to stop.
  // Stops when: stopping=true (Ctrl+C) OR no more work (emptyPolls >= maxEmptyPolls)
  while (!stopping) {
    // Dequeue the next URL from the queue.
    // In Redis mode: BRPOP with 2-second timeout (blocks if empty, returns after 2s with null)
    // In Memory mode: array.shift() (returns undefined/null immediately if empty)
    const item = await frontier.dequeue();

    // --- EMPTY QUEUE HANDLING ---
    if (!item) {
      // Queue is empty. But should we stop?

      // CASE 1: Tasks are still running (inFlight is not empty).
      // These tasks might discover new URLs and enqueue them!
      // Example: Worker is fetching /about → finds links to /about/team, /about/careers
      //          → enqueueNewLinks adds them to the queue
      // So we WAIT for one task to finish, then check the queue again.
      if (inFlight.size > 0) {
        // Promise.race(inFlight): wait for ANY ONE of the in-flight tasks to finish.
        // Java: CompletableFuture.anyOf(futures).join()
        // Once one finishes, we loop back to dequeue() — maybe new URLs appeared!
        await Promise.race(inFlight);
        continue;  // Go back to top of while loop
      }

      // CASE 2: No tasks running and queue is empty.
      // In memory mode: we're done. In Redis mode: maybe another worker will add URLs.
      emptyPolls++;
      if (emptyPolls >= maxEmptyPolls) break;  // We're truly done!

      // Wait 2 seconds before checking again (only for Redis mode, since maxEmptyPolls=1 for memory).
      // This gives other workers time to discover and enqueue new URLs.
      await new Promise((r) => setTimeout(r, 2000));
      continue;  // Go back to top of while loop
    }

    // --- WE GOT A URL! Process it. ---
    emptyPolls = 0;  // Reset the empty poll counter — queue is not empty anymore.

    // Wrap the task in the concurrency limiter.
    // limit() will either:
    //   - Run it immediately (if fewer than 'concurrency' tasks are active)
    //   - Queue it internally (if 'concurrency' tasks are already running)
    // Either way, it returns a Promise that resolves when processItem finishes.
    const task = limit(() => processItem(item));

    // SELF-REMOVING PROMISE TRACKING:
    // When the task finishes (success OR failure), remove it from the inFlight set.
    // .finally() runs no matter what — like Java's try { } finally { }.
    //
    // TRICKY PART: "tracked" references itself in the .finally() callback!
    // This works because the callback doesn't run until the task finishes,
    // and by then "tracked" has already been assigned. This is CLOSURE behavior.
    // In Java, you can't reference a variable before it's declared. In JS, closures
    // capture the variable's REFERENCE, not its VALUE at declaration time.
    const tracked = task.finally(() => inFlight.delete(tracked));

    // Add to the tracking set.
    inFlight.add(tracked);

    // --- BACK-PRESSURE ---
    // If too many tasks are in the inFlight set, STOP dequeuing and wait.
    // Why "concurrency * 2"?
    //   - pLimit already limits to 'concurrency' ACTIVE tasks
    //   - But pLimit also has an internal queue of WAITING tasks
    //   - We allow up to concurrency * 2 total (active + waiting in pLimit)
    //   - This prevents memory explosion if Redis has millions of URLs:
    //     without this, we'd dequeue ALL of them into memory as Promise objects
    //
    // Example with concurrency=5:
    //   - inFlight has 10 tasks (5 active HTTP requests + 5 waiting in pLimit queue)
    //   - We STOP dequeuing from Redis until one finishes
    //   - This keeps memory usage bounded and predictable
    //
    // Java equivalent: BlockingQueue with bounded capacity, or a Semaphore
    if (inFlight.size >= config.concurrency * 2) {
      // Wait for ANY one task to finish before dequeuing more.
      await Promise.race(inFlight);
    }
  }

  // --- DRAIN: Wait for all remaining tasks to finish ---
  // Promise.allSettled() waits for ALL promises, whether they succeed or fail.
  // Promise.all() would REJECT on the first failure — we don't want that.
  // We want ALL tasks to finish cleanly before we exit.
  // Java: CompletableFuture.allOf(futures).join() — but that also rejects on first failure.
  // Java equivalent: manually catching each future and joining all.
  await Promise.allSettled(inFlight);

  // --- CLEANUP: Remove signal handlers ---
  // process.off() unregisters the signal handler.
  // Without this, the handler stays registered and could cause memory leaks
  // in long-running processes or if crawl() is called multiple times.
  // Java: There's no easy equivalent — shutdown hooks can't be easily removed.
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  // --- Return results ---
  const durationMs = Date.now() - startTime;
  return { crawled, errors, seedDomain, pages, durationMs };
  // Shorthand for { crawled: crawled, errors: errors, seedDomain: seedDomain, ... }
}
