// --- MEMORY VISITED STORE ---
// In-memory implementation of the VisitedStore interface.
// Uses a JavaScript Set for O(1) lookups.
//
// WHY IS THIS SAFE WITHOUT LOCKS?
// Node.js is SINGLE-THREADED. Only one piece of code runs at a time.
// Even with async/await, code runs in turns (event loop), never truly in parallel.
// So there's no race condition possible with in-memory data structures.
//
// In Java, you'd need ConcurrentHashSet or synchronized blocks.
// In Node.js, you get thread safety for FREE (because there's only one thread).
//
// BUT: this safety only applies within ONE process.
// If you run multiple Node.js processes, they each have their own Set.
// For cross-process deduplication, use RedisVisited.

import { VisitedStore } from "../../crawler/visited";

export class MemoryVisited implements VisitedStore {
  // Set<string>: a collection of unique strings. No duplicates allowed.
  // Java equivalent: HashSet<String>
  // .has() = O(1), .add() = O(1), .size = O(1)
  private set = new Set<string>();

  // Returns true if the URL is NEW (not in the set before).
  // Returns false if the URL was already in the set.
  // This mimics Redis SADD behavior: check + add in one operation.
  async add(url: string): Promise<boolean> {
    // Check first, then add. This is safe because Node.js is single-threaded.
    // No other code can run between has() and add() — there's no preemption.
    // In Java with multiple threads, this would be a race condition!
    // You'd need: return set.add(url); (which atomically adds and returns boolean)
    if (this.set.has(url)) return false;  // Already seen
    this.set.add(url);                    // Mark as seen
    return true;                          // Was newly added
  }

  async has(url: string): Promise<boolean> {
    return this.set.has(url);
  }

  async size(): Promise<number> {
    // Set.size is a PROPERTY (not a method) — no parentheses.
    // Java: set.size() — is a method, needs parentheses.
    return this.set.size;
  }

  // No close() needed — nothing to clean up (just RAM, garbage collected).
}
