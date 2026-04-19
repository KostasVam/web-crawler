// --- MEMORY FRONTIER ---
// In-memory implementation of the Frontier interface.
// Uses a simple JavaScript array as a FIFO queue.
//
// WHEN TO USE:
//   - Development and testing (no Redis needed)
//   - Single-worker mode
//
// LIMITATIONS:
//   - Only works within ONE process (not shared between workers)
//   - Data is lost if the process crashes (it's just RAM)
//   - Cannot scale to multiple workers
//
// For multi-worker production use, see RedisFrontier instead.

import { Frontier, FrontierItem } from "../../crawler/frontier";

// "implements Frontier" is optional in TypeScript (structural typing).
// We include it for CLARITY and to get compile-time errors if we
// forget to implement a required method.
// In Java, "implements" is mandatory.
export class MemoryFrontier implements Frontier {
  // Private array acting as a queue.
  // "private" works the same as Java: only accessible within this class.
  // "FrontierItem[]" = array of FrontierItem. Java: List<FrontierItem>
  private queue: FrontierItem[] = [];

  // WHY IS THIS ASYNC?
  // The Frontier interface requires Promise<void> return type.
  // MemoryFrontier doesn't need async (push is instant), but it must
  // match the interface so it can be swapped with RedisFrontier.
  // "async" automatically wraps the return in a Promise.
  // Java: returning CompletableFuture.completedFuture(null) for a sync operation.
  async enqueue(item: FrontierItem): Promise<void> {
    // .push() adds to the END of the array. Java: list.add(item)
    this.queue.push(item);
  }

  async dequeue(): Promise<FrontierItem | null> {
    // .shift() removes and returns the FIRST element. Java: queue.poll()
    // If empty, returns undefined. The "?? null" converts undefined to null.
    // "??" is NULLISH COALESCING: returns right side only if left is null/undefined.
    // LPUSH + BRPOP in Redis = push to left, pop from right = FIFO
    // .push() + .shift() in JS = push to right, remove from left = also FIFO
    // Both achieve the same FIFO (First In, First Out) order.
    return this.queue.shift() ?? null;
  }

  async size(): Promise<number> {
    // .length is a property, not a method (no parentheses). Java: list.size()
    return this.queue.length;
  }

  // NOTE: No close() method! It's optional in the interface (close?()),
  // and MemoryFrontier has nothing to clean up.
  // When index.ts calls "frontier.close?.()", the "?." checks if close exists.
  // For MemoryFrontier it doesn't → nothing happens.
}
