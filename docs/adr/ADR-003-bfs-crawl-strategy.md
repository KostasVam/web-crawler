# ADR-003: Breadth-First Search Crawl Strategy

## Status
Accepted

## Context
When crawling, we need to decide the **order** in which we visit URLs. The two main strategies are:

- **BFS (Breadth-First Search)**: Visit all links on the current page before going deeper. Uses a **FIFO queue**.
- **DFS (Depth-First Search)**: Follow one link chain as deep as possible before backtracking. Uses a **stack (LIFO)**.

## Decision
Use **BFS** traversal via a FIFO queue.

## Why BFS over DFS

```
        ipfabric.io          ← depth 0
       /     |      \
    /about  /blog  /products  ← depth 1
    |        |
 /about/team /blog/post-1     ← depth 2
              |
           /blog/post-1/comments  ← depth 3
```

**BFS visits**: ipfabric.io → /about → /blog → /products → /about/team → /blog/post-1 → ...
**DFS visits**: ipfabric.io → /about → /about/team → (back) → /blog → /blog/post-1 → /blog/post-1/comments → ...

| Criteria | BFS | DFS |
|---|---|---|
| Finds important pages first | Yes — top-level pages are usually most important | No — can get lost in deep chains |
| Gets stuck in deep traps | No — breadth limits depth naturally | Yes — infinite pagination, calendar links, etc. |
| Memory usage | Higher (wide frontier) | Lower (narrow stack) |
| Max depth control | Natural — just stop at depth N | Needs explicit tracking |
| Parallelization | Easy — workers grab from same queue | Harder — stack doesn't parallelize well |

## Implementation
- FIFO queue in Redis: `LPUSH` (add to left) + `BRPOP` (take from right)
- This naturally gives BFS order
- We also track `depth` per URL to allow max depth limiting

## Consequences

### Positive
- Important pages discovered first
- Natural depth limiting
- Parallelizes trivially across workers

### Negative
- Frontier (queue) can grow large for wide sites — managed by max depth and domain filtering
