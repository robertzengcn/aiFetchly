/**
 * DnsMailRouteResolver — resolves a domain's mail-routing status (design §9.6,
 * §9.7, §9.8).
 *
 * Wraps an injectable `DnsMailRouteAdapter` (production: node:dns.promises;
 * tests: fake). Centralizes the DNS error → MailRoutingStatus mapping table
 * so platform-specific codes never leak into the verifier.
 *
 * Per-operation timeout (3s) + one retry for temporary failures only. No
 * retry for NXDOMAIN / null MX / no-data answers. Caught errors are never
 * cast to `any` — the mapper inspects an object with a string `code`.
 */
import { promises as dns } from "node:dns";
import type { DnsMailRouteResult } from "@/entityTypes/contactVerificationTypes";
import { CONTACT_VERIFICATION_LIMITS } from "@/config/contactVerification";

/** Minimal MX record shape consumed by the resolver (node:dns MxRecord). */
export interface MxRecord {
  readonly priority: number;
  readonly exchange: string;
}

/**
 * Injectable DNS adapter. The production adapter wraps `dns.promises`; tests
 * inject a fake. Methods reject on error/timeout so the resolver can map.
 */
export interface DnsMailRouteAdapter {
  resolveMx(domain: string): Promise<readonly MxRecord[]>;
  resolve4(domain: string): Promise<readonly string[]>;
  resolve6(domain: string): Promise<readonly string[]>;
}

/** Production adapter wrapping node:dns.promises. */
export class NodeDnsMailRouteAdapter implements DnsMailRouteAdapter {
  async resolveMx(domain: string): Promise<readonly MxRecord[]> {
    return dns.resolveMx(domain);
  }
  async resolve4(domain: string): Promise<readonly string[]> {
    return dns.resolve4(domain);
  }
  async resolve6(domain: string): Promise<readonly string[]> {
    return dns.resolve6(domain);
  }
}

/** DNS error codes that mean "domain does not exist". */
const NXDOMAIN_CODES: ReadonlySet<string> = new Set(["ENOTFOUND", "NXDOMAIN"]);

/** DNS error codes that mean "no such records of this type". */
const NODATA_CODES: ReadonlySet<string> = new Set(["ENODATA"]);

/** DNS error codes meaning a temporary/retryable failure. */
const TEMPORARY_CODES: ReadonlySet<string> = new Set([
  "ETIMEOUT",
  "ESERVFAIL",
  "SERVFAIL",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAISTR",
]);

export interface DnsMailRouteResolverDeps {
  readonly adapter: DnsMailRouteAdapter;
}

export class DnsMailRouteResolver {
  constructor(private readonly deps: DnsMailRouteResolverDeps) {}

  /**
   * Resolve the mail-routing status for a lowercased ASCII domain. Returns
   * a stable {@link DnsMailRouteResult} with `domainResolves` possibly null
   * (meaning the DNS check did not produce a stable answer).
   */
  async resolve(domain: string): Promise<DnsMailRouteResult> {
    return this.resolveWithRetry(domain, false);
  }

  private async resolveWithRetry(
    domain: string,
    isRetry: boolean
  ): Promise<DnsMailRouteResult> {
    // MX lookup with a timeout race.
    const mxResult = await this.withTimeout(
      this.deps.adapter.resolveMx(domain),
      domain
    );

    if (mxResult.kind === "ok") {
      const records = mxResult.value;
      // Explicit null MX: exchange === "."
      if (records.length === 1 && records[0].exchange === ".") {
        return {
          status: "null_mx",
          domainResolves: true,
          retryable: false,
        };
      }
      if (records.length > 0) {
        return {
          status: "mx",
          domainResolves: true,
          retryable: false,
        };
      }
      // Empty MX array: treat as no-data and fall through to A/AAAA.
      return this.fallbackToAddressRecords(domain);
    }

    // MX errored. ENODATA means "no MX records of this type" -> try A/AAAA.
    const code = mxResult.code;
    if (code && NODATA_CODES.has(code)) {
      return this.fallbackToAddressRecords(domain);
    }
    if (code && NXDOMAIN_CODES.has(code)) {
      return {
        status: "nxdomain",
        domainResolves: false,
        retryable: false,
      };
    }
    if (code && TEMPORARY_CODES.has(code)) {
      // One retry for temporary failures.
      if (!isRetry) {
        return this.resolveWithRetry(domain, true);
      }
      return {
        status: "temporary_failure",
        domainResolves: null,
        retryable: true,
      };
    }
    // Unclassified resolver error.
    return {
      status: "resolver_failure",
      domainResolves: null,
      retryable: false,
    };
  }

  /**
   * When MX returned no records (ENODATA or empty), check A/AAAA to decide
   * implicit_address vs no_route (design §9.7).
   */
  private async fallbackToAddressRecords(
    domain: string
  ): Promise<DnsMailRouteResult> {
    // withTimeout never rejects (it catches internally and returns an
    // {ok|error} union), so Promise.allSettled always yields "fulfilled"
    // with that union. Unwrap it here.
    const aWrapped = await this.withTimeout(
      this.deps.adapter.resolve4(domain),
      domain
    );
    const aaaaWrapped = await this.withTimeout(
      this.deps.adapter.resolve6(domain),
      domain
    );
    const hasIpv4 = aWrapped.kind === "ok" && aWrapped.value.length > 0;
    const hasIpv6 = aaaaWrapped.kind === "ok" && aaaaWrapped.value.length > 0;
    if (hasIpv4 || hasIpv6) {
      return {
        status: "implicit_address",
        domainResolves: true,
        retryable: false,
      };
    }
    // Both failed or empty. If either NXDOMAIN, the domain doesn't exist;
    // otherwise the domain resolves to nothing -> no_route.
    const aErr = aWrapped.kind === "error" ? aWrapped.code : undefined;
    const aaaaErr = aaaaWrapped.kind === "error" ? aaaaWrapped.code : undefined;
    if (
      (aErr && NXDOMAIN_CODES.has(aErr)) ||
      (aaaaErr && NXDOMAIN_CODES.has(aaaaErr))
    ) {
      return {
        status: "nxdomain",
        domainResolves: false,
        retryable: false,
      };
    }
    if (
      (aErr && TEMPORARY_CODES.has(aErr)) ||
      (aaaaErr && TEMPORARY_CODES.has(aaaaErr))
    ) {
      return {
        status: "temporary_failure",
        domainResolves: null,
        retryable: true,
      };
    }
    return {
      status: "no_route",
      domainResolves: true,
      retryable: false,
    };
  }

  /**
   * Race a DNS promise against a timeout. Node's dns.promises does not
   * consistently support cancellation, so we race and attach a late-rejection
   * handler so a slow native call cannot become an unhandled rejection.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    domain: string
  ): Promise<
    { kind: "ok"; value: T } | { kind: "error"; error: unknown; code?: string }
  > {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            Object.assign(new Error(`DNS timeout for ${domain}`), {
              code: "ETIMEOUT",
            })
          ),
        CONTACT_VERIFICATION_LIMITS.dnsOperationTimeoutMs
      );
    });
    try {
      const value = await Promise.race([promise, timeout]);
      return { kind: "ok", value };
    } catch (error) {
      return { kind: "error", error, code: extractCode(error) };
    } finally {
      if (timer) clearTimeout(timer);
      // Attach a no-op rejection handler to the losing native DNS promise so
      // a late rejection (after the timeout won the race) cannot become an
      // unhandled rejection (design §9.8). Node's dns.promises does not
      // consistently support cancellation; this swallows the late error.
      promise.catch(() => {});
    }
  }
}

/**
 * Extract a DNS error `code` from a thrown value WITHOUT casting to `any`.
 * Inspects an object with a string `code` property; returns undefined for
 * non-objects or objects without a code.
 */
function extractCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const maybe = error as { code?: unknown };
  if (typeof maybe.code === "string") return maybe.code;
  return undefined;
}
