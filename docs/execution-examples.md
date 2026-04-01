# Execution Examples

Real crawl runs against `ipfabric.io` demonstrating different configurations.

---

## Example 1: Depth 0 — Seed Only

Fetches only the seed URL without following any links. Useful for verifying connectivity and basic HTML parsing.

```bash
$ node dist/index.js --max-depth 0
```

```
=== Web Crawler ===
Seed:        https://ipfabric.io
Max depth:   0
Concurrency: 5
Mode:        memory

[depth=0] https://ipfabric.io

=== Summary ===
Domain:       ipfabric.io
Pages crawled: 1
Errors:        0
URLs visited:  1
```

**What happened:** The crawler fetched the seed page, parsed it successfully (HTTP 200, content-type `text/html`), but did not extract or follow any links because `depth 0 >= maxDepth 0`.

---

## Example 2: Depth 1 — Seed + Direct Links

Fetches the seed page, extracts all links, then visits each discovered URL one level deep. This is the most practical single-pass crawl.

```bash
$ node dist/index.js --max-depth 1 --concurrency 3
```

```
=== Web Crawler ===
Seed:        https://ipfabric.io
Max depth:   1
Concurrency: 3
Mode:        memory

[depth=0] https://ipfabric.io
[depth=1] https://ipfabric.io/how-does-it-work
[depth=1] https://ipfabric.io/what-is-network-assurance
[depth=1] https://ipfabric.io/network-assurance-security-compliance-controls
[depth=1] https://ipfabric.io/blog/10-critical-dora-requirements-satisfied-by-network-assurance-1-2
[depth=1] https://ipfabric.io/blog/can-you-handle-the-truth
[depth=1] https://ipfabric.io/integrations
[depth=1] https://ipfabric.io/ip-fabric-7-dot-2-security-automation-with-infrastructure-assurance
[depth=1] https://ipfabric.io/compliance-automation-with-infrastructure-assurance
[depth=1] https://ipfabric.io/de-risk-digital-transformation-with-reliable-automation
[depth=1] https://ipfabric.io/drive-operational-efficiency-with-end-to-end-insights
[depth=1] https://ipfabric.io/regain-trust-in-your-network-with-8-automation-dos-and-donts
[depth=1] https://ipfabric.io/company/contact
[depth=1] https://ipfabric.io/company/about-us
[depth=1] https://ipfabric.io/careers
[depth=1] https://ipfabric.io/events
[depth=1] https://ipfabric.io/our-partners
[depth=1] https://ipfabric.io/pricing
[depth=1] https://ipfabric.io/resource-center
[depth=1] https://ipfabric.io/blog
[depth=1] https://ipfabric.io/press-center
[depth=1] https://ipfabric.io/wp-content/uploads/2025/09/IP-Fabric-Case-Study-CHU-Toulouse.pdf
[depth=1] https://ipfabric.io/faq
[depth=1] https://ipfabric.io/privacy-policy
[depth=1] https://ipfabric.io/end-user-license-agreement
[depth=1] https://ipfabric.io/termsandconditions
[depth=1] https://ipfabric.io/freetrial
[depth=1] https://ipfabric.io/ip-fabric-guided-demo
[depth=1] https://ipfabric.io/blog/how-to-integrate-ip-fabric-with-splunk
[depth=1] https://ipfabric.io/blog/integrating-ip-fabric-with-grafana
[depth=1] https://ipfabric.io/blog/introducing-the-ip-fabric-netbox-plugin-a-game-changer-for-network-management
[depth=1] https://ipfabric.io/stable-operations
[depth=1] https://ipfabric.io/security-compliance
[depth=1] https://ipfabric.io/accelerate-transformation
[depth=1] https://ipfabric.io/blog/ip-fabric-7-0
[depth=1] https://ipfabric.io/blog/category/releases
[depth=1] https://ipfabric.io/blog/10-critical-dora-requirements-satisfied-by-network-assurance
[depth=1] https://ipfabric.io/blog/category/network-discovery
[depth=1] https://ipfabric.io/blog/category/network-monitoring
[depth=1] https://ipfabric.io/blog/category/network-security
[depth=1] https://ipfabric.io/blog/ip-fabrics-netbox-plugin-improves-automation
[depth=1] https://ipfabric.io/blog/category/network-automation
[depth=1] https://ipfabric.io/blog/category/netbox
[depth=1] https://ipfabric.io/blog/category/network-documentation
[depth=1] https://ipfabric.io/ipf-documentation
[depth=1] https://ipfabric.io/cut-costs
[depth=1] https://ipfabric.io/entreprise-network-automation
[depth=1] https://ipfabric.io/resources
[depth=1] https://ipfabric.io/wp-content/uploads/2025/02/IP_Fabric-Datasheet-7.x.pdf
[depth=1] https://ipfabric.io/proactively-reveal-eliminate-critical-infrastructure-vulnerabilities
[depth=1] https://ipfabric.io/webinars-with-ip-fabric
[depth=1] https://ipfabric.io/podcasts-with-ip-fabric
[depth=1] https://ipfabric.io/reports-white-papers-guides/?_sft_ipfc_report_type=case-studies
[depth=1] https://ipfabric.io/reports-white-papers-guides/?_sft_ipfc_report_type=solutions-briefs
[depth=1] https://ipfabric.io/reports-white-papers-guides
  HTTP 403 — skipped
[depth=1] https://ipfabric.io/about-us
  HTTP 403 — skipped
[depth=1] https://ipfabric.io/retire-legacy-tech
  HTTP 403 — skipped
[depth=1] https://ipfabric.io/speed-root-cause-discovery-and-troubleshooting
  HTTP 403 — skipped
[depth=1] https://ipfabric.io/fill-crirtical-gaps-in-your-tool-ecocsystem
[depth=1] https://ipfabric.io/secure-a-growing-attack-surface
  HTTP 403 — skipped
[depth=1] https://ipfabric.io/regulatory-compliance-readiness
  HTTP 403 — skipped
[depth=1] https://ipfabric.io/safely-manage-configurations-and-changes
  HTTP 403 — skipped
[depth=1] https://ipfabric.io/centralize-network-visibility
  HTTP 403 — skipped
[depth=1] https://ipfabric.io/standardize-network-data-for-automation-initiatives
  HTTP 403 — skipped
[depth=1] https://ipfabric.io/reporting-unlawful-conduct
  HTTP 403 — skipped
  HTTP 403 — skipped

=== Summary ===
Domain:       ipfabric.io
Pages crawled: 52
Errors:        0
URLs visited:  65
```

**What happened:**

1. The crawler fetched the seed page (`depth=0`) and extracted 64 unique same-domain links.
2. All 64 links were added to the visited set and enqueued at `depth=1`.
3. With `concurrency=3`, up to 3 pages were fetched in parallel at any time.
4. 52 pages returned HTML successfully (HTTP 200 with `text/html` content type).
5. 11 pages were blocked by the site's WAF/CDN (HTTP 403) — this is normal for aggressive crawling without politeness delays.
6. 2 URLs pointed to PDFs — silently skipped because content type is not `text/html`.
7. At `depth=1 >= maxDepth=1`, links found inside these pages were **not** followed further.

### Observations

- **URL normalization working:** No duplicate URLs despite the site having links with and without trailing slashes, fragments, and tracking parameters.
- **Domain scoping working:** Only `ipfabric.io` URLs were followed. External links (LinkedIn, Twitter, YouTube) were filtered out.
- **Content-type filtering working:** PDF links were fetched but not parsed for links.
- **WAF rate limiting:** ~17% of requests received HTTP 403. A production crawler would add politeness delays (`robots.txt` crawl-delay) to avoid this.
