// --- FRONTIER INTERFACE ---
// This defines the "contract" for the URL queue.
// Both MemoryFrontier and RedisFrontier must follow this contract.
// In Java terms: this is like an interface that multiple classes implement.
// The difference from Java: TypeScript interfaces are STRUCTURAL (duck typing).
// If an object has these methods with these signatures, it "implements" this interface
// automatically — no "implements Frontier" keyword needed (though we use it anyway for clarity).

// FrontierItem: represents one URL waiting to be crawled, along with its depth level.
// depth 0 = the seed URL, depth 1 = links found on seed, depth 2 = links found on depth-1 pages, etc.
// In Java this would be: public record FrontierItem(String url, int depth) {}
// Note: TypeScript has no "int" — everything is "number" (like double in Java).
export interface FrontierItem {
  url: string;    // The URL to crawl, e.g. "https://ipfabric.io/about"
  depth: number;  // How many hops from the seed URL (0 = seed itself)
}

// Frontier: the queue interface. This is what the crawler uses to get URLs to process.
// Every method returns Promise<...> because some implementations (Redis) need network I/O.
// Even MemoryFrontier returns Promises (even though it doesn't need to) — this way
// the crawler code doesn't care which implementation it's talking to. Polymorphism!
// In Java this would be: public interface Frontier { CompletableFuture<Void> enqueue(...); }
export interface Frontier {
  // Add a URL to the queue. Like queue.add() in Java.
  enqueue(item: FrontierItem): Promise<void>;

  // Remove and return the next URL from the queue. Like queue.poll() in Java.
  // Returns null if the queue is empty.
  // The "FrontierItem | null" is a UNION TYPE — the return value is either a FrontierItem OR null.
  // In Java you'd return Optional<FrontierItem> or just null.
  dequeue(): Promise<FrontierItem | null>;

  // How many items are in the queue right now.
  size(): Promise<number>;

  // Optional cleanup method — the "?" means this method might not exist.
  // RedisFrontier implements this (to close the Redis connection).
  // MemoryFrontier does NOT implement this (nothing to clean up).
  // In Java you'd use a separate Closeable interface. Here we just mark it optional.
  // When calling: frontier.close?.()  — the ?. means "call only if it exists".
  close?(): Promise<void>;
}
