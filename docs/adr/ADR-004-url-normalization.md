# ADR-004: URL Normalization Before Deduplication

## Status
Accepted

## Context
The same page can be referenced by many different URL strings:

```
https://ipfabric.io/about
https://ipfabric.io/about/
https://ipfabric.io/about#team
https://ipfabric.io/about?utm_source=google
https://IPFABRIC.IO/about
```

If we don't normalize these, the visited set treats each as unique — we'd crawl the same page 5 times.

## Decision
Normalize all URLs before adding to the visited set or frontier:

1. **Parse** with `new URL()` (Node.js built-in)
2. **Lowercase** the hostname (`IPFABRIC.IO` → `ipfabric.io`)
3. **Remove fragment** (`#team` → removed, fragments are client-side only)
4. **Remove trailing slash** (`/about/` → `/about`, except for root `/`)
5. **Remove tracking params** (`utm_source`, `utm_medium`, etc.)
6. **Resolve relative URLs** (`/about` on `https://ipfabric.io/blog` → `https://ipfabric.io/about`)

## Consequences

### Positive
- Dramatically reduces duplicate crawling
- Visited set stays smaller
- Consistent key format for Redis

### Negative
- Some normalization is lossy — removing query params might merge genuinely different pages (rare)
- Adds processing overhead per URL (negligible)
