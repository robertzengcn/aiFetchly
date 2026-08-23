/**
 * ContactVerificationCache — process-local bounded DNS cache (design §13).
 *
 * In-memory only. The main process and worker maintain SEPARATE caches; no
 * cache data is persisted or crosses user boundaries. Phone parsing is
 * inexpensive so we cache only within a single call (via the dedup index),
 * not here.
 *
 * Domain cache: cap 1000 entries. On overflow, evict expired entries first,
 * then the oldest inserted. A simple bounded Map is sufficient — no LRU pkg.
 */
import type { DnsMailRouteResult } from "@/entityTypes/contactVerificationTypes";
import { CONTACT_VERIFICATION_CACHE } from "@/config/contactVerification";

interface CachedEntry {
  readonly result: DnsMailRouteResult;
  readonly expiresAt: number;
}

/**
 * Pick the cache TTL (ms) for a routing result. Positive results live longer
 * than negatives; temporary failures live briefly (design §13.2).
 */
export function ttlForResult(result: DnsMailRouteResult): number {
  switch (result.status) {
    case "mx":
    case "implicit_address":
      return CONTACT_VERIFICATION_CACHE.positiveTtlMs;
    case "null_mx":
    case "no_route":
    case "nxdomain":
      return CONTACT_VERIFICATION_CACHE.negativeTtlMs;
    case "temporary_failure":
    case "resolver_failure":
      return CONTACT_VERIFICATION_CACHE.temporaryTtlMs;
    case "not_checked":
      return CONTACT_VERIFICATION_CACHE.temporaryTtlMs;
    default:
      return CONTACT_VERIFICATION_CACHE.temporaryTtlMs;
  }
}

export class ContactVerificationCache {
  private readonly entries = new Map<string, CachedEntry>();
  /** Insertion order tracker for oldest-first eviction. */
  private readonly order: string[] = [];

  constructor(private readonly now: () => Date) {}

  /** Look up a cached result. Returns undefined on miss / expiry. */
  get(domain: string): DnsMailRouteResult | undefined {
    const entry = this.entries.get(domain);
    if (!entry) return undefined;
    if (this.now().getTime() >= entry.expiresAt) {
      // Expired: lazy eviction.
      this.entries.delete(domain);
      const idx = this.order.indexOf(domain);
      if (idx >= 0) this.order.splice(idx, 1);
      return undefined;
    }
    return entry.result;
  }

  /** Store a result with the TTL derived from its status. */
  set(domain: string, result: DnsMailRouteResult): void {
    const ttl = ttlForResult(result);
    const expiresAt = this.now().getTime() + ttl;
    // If already present, refresh (Map preserves insertion order, so no order change).
    if (!this.entries.has(domain)) {
      this.order.push(domain);
    }
    this.entries.set(domain, { result, expiresAt });

    // Enforce capacity.
    if (this.entries.size > CONTACT_VERIFICATION_CACHE.maxDomains) {
      this.evictUntilUnderCap();
    }
  }

  /** Clear all cached entries (test/teardown helper). */
  clear(): void {
    this.entries.clear();
    this.order.length = 0;
  }

  /** Current size (test helper). */
  get size(): number {
    return this.entries.size;
  }

  private evictUntilUnderCap(): void {
    // First pass: drop all expired entries.
    const nowMs = this.now().getTime();
    for (const domain of [...this.order]) {
      const entry = this.entries.get(domain);
      if (entry && nowMs >= entry.expiresAt) {
        this.entries.delete(domain);
        const idx = this.order.indexOf(domain);
        if (idx >= 0) this.order.splice(idx, 1);
      }
    }
    // Second pass: drop oldest until under cap.
    while (this.entries.size > CONTACT_VERIFICATION_CACHE.maxDomains) {
      const oldest = this.order.shift();
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
