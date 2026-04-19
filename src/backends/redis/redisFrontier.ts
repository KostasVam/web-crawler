// --- REDIS FRONTIER ---
// Distributed implementation of the Frontier interface using Redis.
// Multiple workers (processes) can share the SAME queue via Redis.
//
// HOW IT WORKS:
// Uses a Redis List as a FIFO queue:
//   - LPUSH (Left Push): adds items to the LEFT (head) of the list
//   - BRPOP (Blocking Right Pop): removes items from the RIGHT (tail) of the list
//   - LPUSH left + BRPOP right = FIFO (First In, First Out)
//
// WHY REDIS LIST AND NOT A SIMPLE VARIABLE?
// Because Redis lives OUTSIDE the Node.js process. Multiple processes
// (even on different machines) can connect to the same Redis and share data.
// This is what makes the crawler distributed.
//
// JAVA EQUIVALENT:
// This is like a distributed BlockingQueue:
//   - RabbitMQ / Kafka for production message queues
//   - Redis is simpler for this use case (no broker setup needed)

import Redis from "ioredis";
// ioredis: popular Redis client for Node.js.
// Provides type-safe methods for all Redis commands.
// Java equivalent: Jedis or Lettuce

import { Frontier, FrontierItem } from "../../crawler/frontier";

// Redis key name for the queue. All workers use the same key → shared queue.
// Think of it as a "table name" — all data for the frontier lives under this key.
const QUEUE_KEY = "crawler:frontier";

export class RedisFrontier implements Frontier {
  // The Redis client connection.
  // "private" = only accessible within this class (same as Java).
  private redis: Redis;

  // Constructor: creates a new Redis connection.
  // "url" is the Redis connection string, e.g., "redis://localhost:6379"
  // Java: this.redis = new Jedis("localhost", 6379);
  constructor(url: string) {
    this.redis = new Redis(url);
  }

  // enqueue: add a URL to the queue.
  // LPUSH pushes to the LEFT (head) of the Redis list.
  // JSON.stringify converts the FrontierItem object to a JSON string:
  //   { url: "https://...", depth: 1 } → '{"url":"https://...","depth":1}'
  // Redis stores strings, not objects — we serialize to JSON.
  // Java: jedis.lpush(QUEUE_KEY, objectMapper.writeValueAsString(item));
  async enqueue(item: FrontierItem): Promise<void> {
    await this.redis.lpush(QUEUE_KEY, JSON.stringify(item));
  }

  // dequeue: remove and return the next URL from the queue.
  // BRPOP = Blocking Right Pop. Two important things:
  //
  //   1. RIGHT POP: removes from the RIGHT (tail) of the list.
  //      Combined with LPUSH (left push), this gives FIFO order:
  //      First item pushed → at the right end → first to be popped.
  //
  //   2. BLOCKING: the "B" in BRPOP. If the list is empty:
  //      - RPOP would return null immediately → worker would busy-loop
  //        (checking millions of times per second = wasting CPU)
  //      - BRPOP WAITS on the Redis server side. The connection stays open
  //        but the worker uses ZERO CPU. When an item appears (someone LPUSH's),
  //        Redis immediately returns it. Like a BlockingQueue.take() in Java.
  //
  //   The "2" parameter = timeout in seconds. After 2 seconds of waiting,
  //   BRPOP returns null. This prevents waiting forever.
  //   In our code: null return → check emptyPolls → maybe exit.
  //
  // Java equivalent: queue.poll(2, TimeUnit.SECONDS) on a BlockingQueue
  async dequeue(): Promise<FrontierItem | null> {
    const result = await this.redis.brpop(QUEUE_KEY, 2);
    // BRPOP returns [key, value] or null (if timeout).
    // result[0] = the key name (we don't need it, we know it's QUEUE_KEY)
    // result[1] = the JSON string we stored with LPUSH
    if (!result) return null;
    // JSON.parse converts the string back to an object.
    // "as FrontierItem" is a TYPE ASSERTION — tells TypeScript "this JSON is a FrontierItem".
    // It does NOT validate at runtime! If the JSON is wrong, we'd get weird errors.
    // Java: objectMapper.readValue(result, FrontierItem.class)
    return JSON.parse(result[1]) as FrontierItem;
  }

  // size: how many items are in the queue.
  // LLEN = List Length. Returns the number of elements in the Redis list.
  // Java: jedis.llen(QUEUE_KEY)
  async size(): Promise<number> {
    return this.redis.llen(QUEUE_KEY);
  }

  // close: disconnect from Redis.
  // .quit() sends the QUIT command and closes the connection gracefully.
  // Without this, the Node.js process would hang (open connection keeps it alive).
  // Java: jedis.close() — same concept.
  async close(): Promise<void> {
    await this.redis.quit();
  }
}
