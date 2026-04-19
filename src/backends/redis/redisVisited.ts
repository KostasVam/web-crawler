// --- REDIS VISITED STORE ---
// Distributed implementation of the VisitedStore interface using Redis.
// Uses a Redis Set for ATOMIC deduplication across multiple workers.
//
// THIS IS THE KEY TO PREVENTING DUPLICATE CRAWLING.
//
// THE PROBLEM WITHOUT ATOMICITY:
//   Worker A: "Is ipfabric.io/about visited?" → Redis: "No"
//   Worker B: "Is ipfabric.io/about visited?" → Redis: "No"  ← RACE CONDITION!
//   Worker A: "OK, mark it as visited" → Redis: done
//   Worker B: "OK, mark it as visited" → Redis: done
//   RESULT: BOTH workers crawl /about → DUPLICATE WORK!
//
// THE SOLUTION — SADD (Set Add):
//   SADD is an ATOMIC operation. It does check + add in ONE step.
//   Worker A: SADD "ipfabric.io/about" → Redis: 1 (new! you got it)
//   Worker B: SADD "ipfabric.io/about" → Redis: 0 (already exists! skip)
//   RESULT: Only Worker A crawls /about → NO DUPLICATE!
//
// WHY IS SADD ATOMIC?
// Redis is single-threaded (just like Node.js!). It processes commands one at a time.
// Between SADD receiving the command and returning the result, NO other command runs.
// This is a fundamental guarantee of Redis.
//
// JAVA EQUIVALENT:
// ConcurrentHashMap.putIfAbsent(url, true) — but only works within one JVM process.
// Redis works across processes AND across machines.

import Redis from "ioredis";
import { VisitedStore } from "../../crawler/visited";

// Redis key for the set of visited URLs. Same key across all workers → shared set.
const SET_KEY = "crawler:visited";

export class RedisVisited implements VisitedStore {
  private redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url);
  }

  // add(): THE MOST IMPORTANT METHOD IN THE ENTIRE PROJECT.
  // Uses SADD (Set Add) which is atomic:
  //   - If the URL is NOT in the set: adds it and returns 1
  //   - If the URL IS already in the set: does nothing and returns 0
  //
  // We convert 1 → true (new URL, go crawl it)
  //            0 → false (already visited, skip it)
  //
  // "added === 1" is a simple comparison. In JavaScript:
  //   === checks value AND type (strict equality)
  //   == checks value only (loose equality, with type coercion — AVOID)
  // Always use === in TypeScript. Java uses == for primitives and .equals() for objects.
  async add(url: string): Promise<boolean> {
    const added = await this.redis.sadd(SET_KEY, url);
    return added === 1;
  }

  // size(): how many URLs have been visited.
  // SCARD = Set Cardinality (fancy word for "count of elements").
  // Java: jedis.scard(SET_KEY)
  async size(): Promise<number> {
    return this.redis.scard(SET_KEY);
  }

  // close(): disconnect from Redis gracefully.
  async close(): Promise<void> {
    await this.redis.quit();
  }
}
