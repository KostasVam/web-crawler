// --- VISITED STORE INTERFACE ---
// This defines the "contract" for tracking which URLs have already been seen.
// Purpose: DEDUPLICATION — ensure each URL is crawled at most once.
// Without this, the crawler would visit the same page over and over in cycles.
//
// Two implementations exist:
//   MemoryVisited — uses a JavaScript Set (for single worker, testing)
//   RedisVisited  — uses a Redis Set  (for multiple workers, production)

export interface VisitedStore {
  // The MOST IMPORTANT method: add a URL and return whether it was NEW.
  // Returns true  → "This URL was never seen before. I added it. Go crawl it."
  // Returns false → "This URL was already seen. Someone else handles it. Skip."
  //
  // WHY it returns boolean instead of void:
  // This combines "check if exists" + "add" into ONE atomic operation.
  // In the Redis implementation, this maps to the SADD command which is atomic.
  // If we had separate has() + add(), two workers could BOTH see has()=false
  // and BOTH crawl the same URL (race condition). The boolean return prevents this.
  //
  // Java equivalent: ConcurrentHashMap.putIfAbsent(url, true) == null
  /** Returns true if the URL was newly added (not seen before). */
  add(url: string): Promise<boolean>;

  // How many URLs have been visited so far. Used for the summary at the end.
  size(): Promise<number>;

  // Optional cleanup — same pattern as Frontier.close?()
  // Redis version closes the connection; Memory version doesn't need this.
  close?(): Promise<void>;
}
