# Debug Trace — 2 Workers + Redis (Hard Scenario)

A debugger-style walkthrough showing **every variable's state at every step**. Read it like stepping through a breakpoint.

---

## Setup

```
Workers:        W1, W2          (two separate processes, same machine or different)
Mode:           redis
Concurrency:    2 per worker
Seed:           https://ipfabric.io
Max depth:      2
```

**Pages we'll encounter:**

| URL                       | Behavior                                           |
| ------------------------- | -------------------------------------------------- |
| `/`                       | 200 OK, finds 2 links: `/a`, `/b`                  |
| `/a`                      | 200 OK, finds 1 link: `/shared`                    |
| `/b`                      | First call → **503**, retry → 200, finds `/shared` |
| `/shared`                 | 200 OK, no links (or beyond maxDepth)              |

**Why this scenario is hard:**
1. Both workers race to enqueue the seed.
2. `BRPOP` wakeup ordering between the two workers.
3. `/b` returns 503 → triggers retry with backoff → meanwhile `/a` finishes first.
4. **SADD race**: both `/a` and `/b` try to enqueue `/shared`. Only one wins.
5. `pLimit` internal queue fills up → back-pressure kicks in.
6. Termination via `emptyPolls` counter (not immediate — Redis mode).

---

## Notation

Each frame shows:

```
=== T+<ms> | <worker> | <file>:<line> ===
LOCAL:        worker.ts variables (inFlight, emptyPolls, etc.)
PLIMIT:       internal state (active, queue.length)
REDIS:        crawler:visited set, crawler:frontier list
EVENT:        what just happened
```

Variables that **changed since the previous frame** are marked with `← changed`.

---

## T+0ms | Both workers start

### W1 boots up

```
=== T+0 | W1 | crawl() entry, worker.ts:236 ===
LOCAL:
  config         = { mode:"redis", concurrency:2, seed:"https://ipfabric.io", maxDepth:2 }
  startTime      = 1700000000000
  limit          = pLimit(2)             ← created
  crawled        = 0
  errors         = 0
  stopping       = false
  pages          = []
  seedDomain     = "ipfabric.io"
  inFlight       = Set {}                 ← not created yet, will be at line 356
  emptyPolls     = 0                      ← not created yet, line 360
  maxEmptyPolls  = 3                      ← redis mode
PLIMIT:
  active         = 0
  queue          = []
REDIS:
  crawler:visited  = (key does not exist)
  crawler:frontier = (key does not exist)
EVENT: W1 process started, about to call visited.add(seed)
```

### W1 enqueues the seed

```
=== T+5 | W1 | worker.ts:255 (await visited.add(config.seed)) ===
EVENT: W1 sends SADD crawler:visited "https://ipfabric.io" → Redis returns 1
LOCAL:
  isNew          = true                   ← changed
REDIS:
  crawler:visited  = { "https://ipfabric.io" }    ← changed
```

```
=== T+6 | W1 | worker.ts:257 (frontier.enqueue(seed)) ===
EVENT: W1 sends LPUSH crawler:frontier '{"url":"https://ipfabric.io","depth":0}'
REDIS:
  crawler:frontier = [ {"url":".../",depth:0} ]   ← changed (right end = oldest)
```

### W2 boots up 50ms later (the race)

```
=== T+50 | W2 | crawl() entry + visited.add(seed) ===
EVENT: W2 sends SADD crawler:visited "https://ipfabric.io" → Redis returns 0
       (W1 already added it — atomic SADD prevents duplicate)
LOCAL (W2):
  isNew          = false                  ← W2 sees false → SKIPS the if-block
                                            (line 256: if(isNew) does not execute)
REDIS: unchanged
```

**Why this matters:** without atomic `SADD`, both workers would have enqueued the seed, and we'd crawl `/` twice. The `if (isNew)` guard at line 256 is what protects us.

---

## T+100ms | Main loop begins

### Both workers reach the `while(!stopping)` loop

```
=== T+100 | W1 | worker.ts:375 (await frontier.dequeue()) ===
EVENT: W1 sends BRPOP crawler:frontier 2 → Redis returns immediately
       (queue not empty, so no blocking)
LOCAL (W1):
  item           = { url:".../", depth:0 }   ← changed
REDIS:
  crawler:frontier = []                      ← changed (popped the seed)
```

```
=== T+101 | W2 | worker.ts:375 (await frontier.dequeue()) ===
EVENT: W2 sends BRPOP crawler:frontier 2 → queue is empty → W2 BLOCKS
       on the Redis side. The TCP connection stays open. W2 uses ZERO CPU.
LOCAL (W2):
  item           = (waiting for response)
```

### W1 wraps the seed in pLimit

```
=== T+102 | W1 | worker.ts:413 (limit(() => processItem(item))) ===
EVENT: pLimit's inner Promise constructor runs:
       - queue.push(taskFn)        → pLimit.queue = [ taskFn ]
       - next() runs immediately   → queue.length(1) > 0 && active(0) < 2 → TRUE
                                   → active++ (0→1), shifts taskFn out, calls it
                                   → taskFn invokes fn() = processItem(item)
LOCAL (W1):
  task           = Promise<pending>          ← changed
PLIMIT (W1):
  active         = 1                          ← changed
  queue          = []                         ← pushed then immediately shifted
```

```
=== T+103 | W1 | worker.ts:424 (.finally(() => inFlight.delete(tracked))) ===
LOCAL (W1):
  tracked        = Promise<pending>          ← wraps task with cleanup
  inFlight       = Set { tracked }           ← changed (line 427: inFlight.add)
  inFlight.size  = 1
EVENT: Back-pressure check at line 444:
       inFlight.size(1) >= concurrency*2(4) → FALSE → don't wait, loop again
```

### W1 loops back to dequeue

```
=== T+104 | W1 | worker.ts:375 (back to top of while loop) ===
EVENT: W1 sends BRPOP crawler:frontier 2 → queue is empty → W1 BLOCKS too
       Both W1 and W2 are now blocked on Redis BRPOP.
       Meanwhile, the seed-fetch task is running INSIDE pLimit (different code path).
LOCAL (W1):
  inFlight       = Set { tracked }           ← seed task still running in background
PLIMIT (W1):
  active         = 1                          ← seed task is in the active slot
```

**Important:** the `dequeue()` and the `processItem()` both run on W1, but they're **interleaved**. While W1 awaits BRPOP, the seed's `processItem` (an HTTP request) is also awaiting. The Node.js event loop juggles both.

---

## T+800ms | Seed fetch completes on W1

```
=== T+800 | W1 | worker.ts:291 (inside processItem, await fetchPage returns) ===
EVENT: GET https://ipfabric.io → 200 OK, 12KB HTML
LOCAL (W1, inside processItem):
  item           = { url:".../", depth:0 }
  result         = { html:"<html>...", status:200, skipped:false }   ← changed
```

```
=== T+810 | W1 | worker.ts:296-310 (extract title + links) ===
LOCAL (W1):
  crawled        = 1                         ← changed (line 296)
  $              = cheerio CheerioAPI
  title          = "IP Fabric"
  links          = [".../a", ".../b"]        ← changed (extractor found 2)
                                              (item.depth(0) < maxDepth(2) → TRUE)
  pages          = [ { url:".../", depth:0, status:200, title, links } ]   ← changed
```

### enqueueNewLinks runs on W1

```
=== T+811 | W1 | worker.ts:330 (await enqueueNewLinks) ===
EVENT (loop iter 1): visited.add(".../a")
       SADD crawler:visited ".../a" → returns 1
LOCAL:
  added          = true
REDIS:
  crawler:visited  = { ".../", ".../a" }     ← changed
EVENT: frontier.enqueue({ url:".../a", depth:1 })
       LPUSH crawler:frontier '{"url":".../a","depth":1}'
REDIS:
  crawler:frontier = [ {.../a,1} ]           ← changed
```

**KEY MOMENT — Redis wakes up a blocked BRPOP:**

```
=== T+812 | W2 | redis BRPOP unblocks ===
EVENT: Redis sees the LPUSH, immediately wakes up the LONGEST-WAITING
       blocked client. W2 was waiting since T+101 (W1 since T+104).
       → W2 wins. Redis returns the item to W2.
LOCAL (W2):
  item           = { url:".../a", depth:1 }   ← changed
REDIS:
  crawler:frontier = []                       ← changed (W2 just popped it)
```

W1 continues enqueuing inside its current processItem:

```
=== T+813 | W1 | worker.ts:209 (loop iter 2: visited.add(".../b")) ===
EVENT: SADD crawler:visited ".../b" → 1
       LPUSH crawler:frontier '{".../b",1}'
REDIS:
  crawler:visited  = { ".../", ".../a", ".../b" }   ← changed
  crawler:frontier = [ {.../b,1} ]                  ← changed
```

```
=== T+814 | W1 | redis BRPOP unblocks (W1's own dequeue from T+104) ===
EVENT: W1 was blocked on its own BRPOP since T+104. The LPUSH wakes it up.
LOCAL (W1, the OUTER dequeue, not processItem):
  item           = { url:".../b", depth:1 }   ← changed
REDIS:
  crawler:frontier = []                       ← changed (W1 popped its own push)
```

---

## T+820ms | Both workers now have work

State snapshot:

```
W1:
  Currently in processItem(seed)         → finishing up (line 343, function returns)
  Just dequeued in main loop             → item = {.../b, 1}
  inFlight                               = Set { trackedSeed }    (about to add trackedB)
  pLimit.active                          = 1 (seed still wrapping up)

W2:
  In main loop, just dequeued            → item = {.../a, 1}
  About to wrap in pLimit
  inFlight                               = Set {}
  pLimit.active                          = 0
```

### W1 wraps `/b` in pLimit

```
=== T+821 | W1 | worker.ts:413 (second time through limit()) ===
EVENT: pLimit.next() runs:
       queue.length(0) > 0 → FALSE before push
       Actually the push happens first → queue = [taskFnB]
       Then next() inside Promise constructor:
         queue.length(1) > 0 && active(1) < 2 → TRUE
         → active++ (1→2), shifts taskFnB, calls it
PLIMIT (W1):
  active         = 2                          ← changed
  queue          = []
LOCAL (W1):
  inFlight       = Set { trackedSeed, trackedB }   ← changed
  inFlight.size  = 2
EVENT: Back-pressure check: 2 >= 4 → FALSE → loop again
```

### W2 wraps `/a` in pLimit (same logic)

```
=== T+823 | W2 | worker.ts:413 ===
PLIMIT (W2):
  active         = 1                          ← changed
LOCAL (W2):
  inFlight       = Set { trackedA }           ← changed
```

Both workers loop back to BRPOP. Queue is empty. Both block again.

---

## T+1500ms | `/b` returns 503 — retry kicks in

```
=== T+1500 | W1 | worker.ts:116 (inside fetchPage for /b, attempt=0) ===
EVENT: fetch(.../b) → response.status = 503 → !response.ok → TRUE
       attempt(0) < MAX_RETRIES(2) → TRUE → retry path
LOCAL (W1, inside fetchPage):
  attempt        = 0
  response       = { status:503, ... }
  RETRY_DELAYS[0] = 500
EVENT: console.warn("HTTP 503 — retry 1/2")
       await new Promise((r) => setTimeout(r, 500))
       → W1's processItem-for-/b is now SLEEPING for 500ms
       → pLimit.active stays at 2 (slot still reserved)
       → Event loop is free to process other tasks meanwhile
```

While W1's `/b` task sleeps, W1 is **simultaneously** still blocked on its outer BRPOP. Single-threaded multiplexing in action.

---

## T+1600ms | W2 finishes `/a`, finds `/shared`

```
=== T+1600 | W2 | worker.ts:296 (processItem /a, after fetch) ===
LOCAL (W2):
  result         = { html:"<a href='/shared'>", status:200, skipped:false }
  crawled        = 1                          ← changed (W2's local counter)
  links          = [".../shared"]             ← extracted
  pages          = [ { url:".../a", ... } ]   ← changed
```

```
=== T+1610 | W2 | worker.ts:209 (enqueueNewLinks) ===
EVENT: W2 sends SADD crawler:visited ".../shared" → returns 1 (W2 wins!)
LOCAL (W2):
  added          = true
REDIS:
  crawler:visited  = { ".../", ".../a", ".../b", ".../shared" }   ← changed
EVENT: LPUSH crawler:frontier '{".../shared",2}'
REDIS:
  crawler:frontier = [ {.../shared,2} ]       ← changed
```

```
=== T+1611 | W1 | redis BRPOP unblocks ===
EVENT: W1 was blocked since T+822. Wakes up first (longest-waiting).
LOCAL (W1):
  item           = { url:".../shared", depth:2 }   ← changed
REDIS:
  crawler:frontier = []                       ← changed
```

```
=== T+1612 | W1 | worker.ts:413 (wrap /shared) ===
EVENT: pLimit.next():
       queue.push(taskFnShared) → pLimit.queue = [taskFnShared]
       next(): active(2) < 2 → FALSE → DOES NOT START IT
       → /shared task waits in pLimit's internal queue!
PLIMIT (W1):
  active         = 2                          ← unchanged (still seed + /b)
  queue          = [ taskFnShared ]           ← changed (size 1)
LOCAL (W1):
  tracked        = Promise<pending>           (the outer Promise, awaiting pLimit)
  inFlight       = Set { trackedSeed, trackedB, trackedShared }   ← changed
  inFlight.size  = 3
EVENT: Back-pressure: 3 >= 4 → FALSE → loop again
```

**Notice:** `inFlight.size = 3` but `pLimit.active = 2`. The third Promise is **inside pLimit's queue**, not actually running. This is the difference between "tracked" and "running."

---

## T+1650ms | Seed task on W1 finally finishes

The seed `processItem` returns (line 343). The `.finally()` from line 424 runs:

```
=== T+1650 | W1 | pLimit's .finally() in limiter.ts:87 ===
EVENT: active-- (2→1), then next():
       queue.length(1) > 0 && active(1) < 2 → TRUE
       → active++ (1→2), shifts taskFnShared, calls it
       → /shared task starts running NOW
PLIMIT (W1):
  active         = 2                          ← released seed slot, took /shared slot
  queue          = []                         ← changed
EVENT: Then worker.ts:424 .finally() runs:
       inFlight.delete(trackedSeed)
LOCAL (W1):
  inFlight       = Set { trackedB, trackedShared }   ← changed
  inFlight.size  = 2
```

---

## T+2000ms | `/b` retry succeeds

```
=== T+2000 | W1 | worker.ts:96 (fetchPage for /b, attempt=1) ===
EVENT: fetch(.../b) → 200 OK this time
LOCAL (inside fetchPage):
  attempt        = 1
  response       = { status:200, ... }
  html           = "<a href='/shared'>..."
EVENT: returns { html, status:200, skipped:false }
```

```
=== T+2010 | W1 | worker.ts:303-310 (extract from /b) ===
LOCAL (W1, inside processItem for /b):
  links          = [".../shared"]            ← /b ALSO links to /shared!
  pages          = [ {.../}, {.../b} ]       ← W1's local list (2 items)
  crawled        = 2                         ← changed
```

```
=== T+2011 | W1 | worker.ts:209 (enqueueNewLinks for /b) ===
EVENT: SADD crawler:visited ".../shared" → returns 0 (already there!)
LOCAL:
  added          = false                     ← /shared was claimed by W2 at T+1610
EVENT: if(added) is FALSE → DO NOT ENQUEUE
       → No duplicate work. SADD atomicity wins again.
REDIS: unchanged
```

**This is the SADD race resolved.** Without it, W1 would have re-enqueued `/shared` and W1 (or another worker) would have crawled the same page twice.

---

## T+2050ms | `/b` task finishes on W1

```
=== T+2050 | W1 | pLimit's .finally() ===
PLIMIT (W1):
  active         = 1                          ← changed (released /b's slot)
  queue          = []
LOCAL (W1):
  inFlight       = Set { trackedShared }      ← changed
  inFlight.size  = 1
```

Then W1's outer BRPOP eventually times out (2s) since the queue is empty:

```
=== T+3611 | W1 | worker.ts:375 (BRPOP returned null after 2s) ===
LOCAL (W1):
  item           = null                       ← BRPOP timeout
EVENT: Enter the "if (!item)" block at line 378
       inFlight.size(1) > 0 → TRUE
       → await Promise.race(inFlight)
       → Wait for /shared to finish (or W2's /a finished already).
```

---

## T+3700ms | `/shared` finishes on W1, queue truly empty

```
=== T+3700 | W1 | inside processItem for /shared, returns ===
EVENT: /shared had no links (or depth=2 = maxDepth, so links not extracted)
LOCAL (W1, inside processItem):
  links          = []                         (line 312 ternary returns [])
  crawled        = 3                          ← changed
  pages.length   = 3
```

```
=== T+3701 | W1 | pLimit + outer .finally() ===
PLIMIT (W1):
  active         = 0                          ← changed
LOCAL (W1):
  inFlight       = Set {}                     ← changed
  inFlight.size  = 0
EVENT: Promise.race resolves → continue → back to top of while loop
```

```
=== T+3702 | W1 | worker.ts:375 (dequeue, queue empty, blocks on BRPOP for 2s) ===
... 2 seconds of blocking ...
=== T+5702 | W1 | BRPOP returns null ===
LOCAL (W1):
  item           = null
  inFlight.size  = 0   → "if (inFlight.size > 0)" → FALSE
  emptyPolls     = 1                          ← changed (line 396)
  emptyPolls(1) >= maxEmptyPolls(3) → FALSE → don't break yet
EVENT: await new Promise((r) => setTimeout(r, 2000))
       (2-second sleep before checking again)
```

---

## T+9700ms | Termination

After 3 consecutive empty polls (each ~2s of BRPOP timeout + 2s sleep), W1 decides it's done:

```
=== T+9700 | W1 | worker.ts:397 ===
LOCAL (W1):
  emptyPolls     = 3                          ← changed
  emptyPolls(3) >= maxEmptyPolls(3) → TRUE
EVENT: break out of while loop
```

```
=== T+9701 | W1 | worker.ts:456 (await Promise.allSettled(inFlight)) ===
LOCAL:
  inFlight       = Set {}                     ← already empty
EVENT: Promise.allSettled([]) resolves immediately with []
```

```
=== T+9702 | W1 | worker.ts:463-464 (cleanup signal handlers) ===
EVENT: process.off("SIGINT", onSignal)
       process.off("SIGTERM", onSignal)
```

```
=== T+9703 | W1 | worker.ts:467-468 (return result) ===
LOCAL:
  durationMs     = 9703
  return value   = { crawled: 3, errors: 0, seedDomain: "ipfabric.io",
                     pages: [ /, /b, /shared ], durationMs: 9703 }
```

W2 reaches the same termination independently around the same time, returning `{ crawled: 1, pages: [/a], ... }`.

**Combined across workers:** seed `/`, `/a`, `/b`, `/shared` = 4 unique pages crawled exactly once.

---

## Final Redis state

```
crawler:visited  = { ".../", ".../a", ".../b", ".../shared" }   (4 entries)
crawler:frontier = []                                            (drained)
```

---

## What this trace highlights (interview talking points)

1. **`SADD` is the linchpin.** Two atomic moments saved us:
   - T+50: W2's SADD on seed returned 0 → no duplicate seed enqueue.
   - T+2011: W1's SADD on `/shared` returned 0 → no duplicate `/shared` crawl.

2. **`BRPOP` wakeup ordering is FIFO.** The longest-blocked client wakes first. This naturally load-balances work without any coordinator.

3. **`pLimit.active` vs `inFlight.size` are different.** A Promise can be in `inFlight` but waiting in pLimit's internal queue (not actually running). The back-pressure check at line 444 uses `inFlight.size` so it caps total tracked work, not just active work.

4. **Retries don't release the pLimit slot.** When `/b` got 503 and slept 500ms, `pLimit.active` stayed at 2. The slot was held during the backoff. This is intentional — otherwise a flood of failing URLs could starve the working ones.

5. **`emptyPolls` is the only way out in Redis mode.** Unlike memory mode (where one empty check is enough), Redis mode waits 3 cycles (~6 seconds) because another worker might still produce URLs. This is the trade-off for distributed safety.

6. **The `if (isNew)` guard at line 256** prevents the seed from being enqueued twice when multiple workers start simultaneously. Without it, work would still complete correctly (because of dedup), but the queue would briefly contain duplicates.
