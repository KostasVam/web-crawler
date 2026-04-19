// --- CONCURRENCY LIMITER (pLimit) ---
// This is a CUSTOM implementation of the popular "p-limit" npm package.
// We wrote our own because p-limit v4+ switched to ESM modules, which
// cause compatibility issues with our CommonJS (CJS) TypeScript setup.
//
// WHAT IT DOES:
// Limits how many async tasks can run at the same time.
// Example: if concurrency = 5, at most 5 HTTP requests happen simultaneously.
// Extra tasks wait in a queue until a slot opens up.
//
// JAVA EQUIVALENT:
// This is like a Semaphore + ExecutorService with a bounded thread pool:
//   ExecutorService pool = Executors.newFixedThreadPool(5);
// But remember: Node.js has NO threads. Everything runs on ONE thread.
// The "concurrency" here isn't about threads — it's about how many HTTP
// requests are "in flight" (waiting for response) at the same time.
//
// HOW IT WORKS (Token Bucket Pattern):
// - There are N "tokens" (where N = concurrency)
// - Each task needs a token to run
// - If no tokens available, task waits in queue
// - When a task finishes, it returns its token and the next queued task gets it

/**
 * Inline concurrency limiter — equivalent to p-limit but avoids
 * the ESM/CJS compatibility issue with p-limit v4+.
 *
 * Returns a function that wraps async tasks, ensuring at most
 * `concurrency` run simultaneously. Excess tasks are queued.
 */
export function pLimit(concurrency: number) {
  // CLOSURE VARIABLES — these live in the scope of pLimit() and are
  // "remembered" by the returned function. This is a CLOSURE.
  // In Java, you'd put these as private fields in a class.
  // Here, they're just variables — the inner function captures them.

  let active = 0;                      // How many tasks are currently running (0 to concurrency)
  const queue: (() => void)[] = [];    // Tasks waiting for a free slot.
                                       // Each element is a zero-argument function that starts a task.
                                       // "() => void" means "a function that takes nothing and returns nothing".
                                       // Java equivalent: Queue<Runnable>

  // next(): Check if we can start the next queued task.
  // Called in two places:
  //   1. When a new task is submitted (maybe there's a free slot right now)
  //   2. When a running task finishes (frees up a slot for the next one)
  function next() {
    // Only run if: there ARE tasks waiting AND there's a free slot
    if (queue.length > 0 && active < concurrency) {
      active++;              // Reserve a slot (take a token)
      queue.shift()!();      // Remove first task from queue and EXECUTE it.
                             // .shift() is like queue.poll() in Java — removes first element.
                             // The ! is a NON-NULL ASSERTION — we already checked queue.length > 0,
                             // so shift() won't return undefined. TypeScript doesn't know that,
                             // so we tell it "trust me, this isn't null" with the !.
                             // The () at the end CALLS the function we just removed from the queue.
    }
  }

  // RETURN A WRAPPER FUNCTION — this is what the caller uses.
  // Usage: const limit = pLimit(5);
  //        const result = await limit(() => fetchPage(url));
  //
  // <T> is a GENERIC TYPE PARAMETER — same as <T> in Java.
  // It means: "whatever type fn() returns (inside the Promise), I return the same type."
  // So if fn returns Promise<FetchResult>, the wrapper also returns Promise<FetchResult>.
  //
  // "fn: () => Promise<T>" means: fn is a function that takes no arguments and returns a Promise.
  // The wrapper returns "Promise<T>" — same type, so the caller doesn't know about the limit.
  return <T>(fn: () => Promise<T>): Promise<T> =>

    // Create a new Promise that the CALLER will await.
    // This Promise resolves when the task actually finishes (not when it's queued).
    new Promise<T>((resolve, reject) => {

      // Don't run the task immediately — put it in the queue.
      // The task is wrapped in a function that, when called:
      //   1. Runs fn() (the actual work)
      //   2. Forwards the result to resolve/reject (so the caller gets it)
      //   3. On completion (success OR failure), frees the slot and tries the next task
      queue.push(() => {
        fn()                          // Execute the actual task (e.g., HTTP request)
          .then(resolve, reject)      // Forward result to the caller's Promise
                                      // .then(onSuccess, onError) — two arguments:
                                      //   - if fn() succeeds: call resolve(result)
                                      //   - if fn() fails: call reject(error)
          .finally(() => {            // .finally() runs ALWAYS (success or failure)
                                      // Same as try { } finally { } in Java
            active--;                 // Release the slot (return the token)
            next();                   // Try to start the next queued task
          });
      });

      // Try to run immediately — if active < concurrency, it will start right away.
      // If not, it stays in the queue until next() is called by a finishing task.
      next();
    });
}
