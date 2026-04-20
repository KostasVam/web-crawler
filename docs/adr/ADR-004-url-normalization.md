# ADR-004: URL Normalization Before Deduplication

## Status
Accepted

## Context
The same page can be referenced by many different URL strings:

```
https://example.com/about
https://example.com/about/
https://example.com/about#team
https://example.com/about?utm_source=google
https://EXAMPLE.COM/about
```

If we don't normalize these, the visited set treats each as unique — we'd crawl the same page 5 times.

## Decision
Normalize all URLs before adding to the visited set or frontier:

1. **Parse** with `new URL()` (Node.js built-in)
2. **Lowercase** the hostname (`EXAMPLE.COM` → `example.com`)
3. **Remove fragment** (`#team` → removed, fragments are client-side only)
4. **Remove trailing slash** (`/about/` → `/about`, except for root `/`)
5. **Remove tracking params** (`utm_source`, `utm_medium`, etc.)
6. **Resolve relative URLs** (`/about` on `https://example.com/blog` → `https://example.com/about`)

## Consequences

### Positive
- Dramatically reduces duplicate crawling
- Visited set stays smaller
- Consistent key format for Redis

### Negative
- Some normalization is lossy — removing query params might merge genuinely different pages (rare)
- Adds processing overhead per URL (negligible)
