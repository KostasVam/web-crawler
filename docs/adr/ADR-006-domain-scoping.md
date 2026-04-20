# ADR-006: Restrict Crawling to Seed Domain

## Status
Accepted

## Context
Starting from `https://example.com/`, the crawler will discover links to external sites (Google, LinkedIn, Twitter, YouTube, etc.). Without restriction, the crawler would try to crawl the entire internet.

## Decision
By default, only crawl URLs that belong to the **same domain** as the seed URL (including subdomains).

- Seed: `https://example.com/` → allowed domain: `example.com`
- `https://example.com/about` → YES (same domain)
- `https://blog.example.com/post` → YES (subdomain)
- `https://google.com` → NO (different domain)
- `https://linkedin.com/company/example` → NO

## Why
- **Completeness**: The task says "ensures a complete scan" — scoping to one domain makes "complete" achievable
- **Politeness**: We don't accidentally hammer third-party servers
- **Relevance**: We're crawling example.com, not the whole web
- **Termination**: The crawl will eventually finish (finite pages on one domain)

## Implementation
```typescript
function isAllowedDomain(url: string, seedDomain: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === seedDomain || hostname.endsWith('.' + seedDomain);
}
```

## Consequences

### Positive
- Crawl is bounded and will terminate
- No accidental abuse of external servers

### Negative
- Misses content on external domains that might be relevant
- Configurable: could be extended to allow a list of domains
