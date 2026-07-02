/**
 * UrlGuard — centralized SSRF protection for any code path that fetches
 * attacker-influenced URLs from a privileged context (Electron main process,
 * Puppeteer workers, AI tool calls).
 *
 * Enforces:
 *   1. Scheme allowlist (http/https only)
 *   2. Host syntax / IP literal classification
 *   3. Block loopback, link-local, RFC1918 private, and cloud-metadata IPs
 *   4. Block common internal hostnames (localhost, metadata.google.internal, ...)
 *   5. Optional DNS resolution check — rejects hosts whose A/AAAA records
 *      resolve exclusively to private ranges (DNS-rebinding defense).
 *
 * Usage:
 *   const result = UrlGuard.validate(url);
 *   if (!result.safe) throw new Error(result.error);
 *   // ... proceed with fetch / page.goto(result.normalizedUrl) ...
 *
 * For browser navigation that follows redirects, also call validate() on each
 * final URL via a request interceptor (see applySsrfNavigationGuard).
 */

import * as dns from "dns";
import * as net from "net";

export interface UrlValidationResult {
  readonly safe: boolean;
  readonly normalizedUrl?: string;
  readonly resolvedHost?: string;
  readonly error?: string;
  readonly code?:
    | "OK"
    | "BAD_SCHEME"
    | "BAD_HOST"
    | "BLOCKED_HOST"
    | "BLOCKED_IP"
    | "RESOLVE_FAILED"
    | "MALFORMED";
}

/** IPv4 ranges that must never be reachable from renderer/AI-controlled fetches. */
const BLOCKED_IPV4_PATTERNS: ReadonlyArray<{ name: string; test: (ip: string) => boolean }> = [
  // Loopback 127.0.0.0/8
  { name: "loopback", test: (ip) => ip.startsWith("127.") },
  // Link-local 169.254.0.0/16 — includes AWS/GCP/Azure metadata 169.254.169.254
  { name: "link-local-metadata", test: (ip) => ip.startsWith("169.254.") },
  // Private 10.0.0.0/8
  { name: "private-10", test: (ip) => ip.startsWith("10.") },
  // Private 172.16.0.0/12
  {
    name: "private-172",
    test: (ip) => {
      const parts = ip.split(".").map(Number);
      return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
    },
  },
  // Private 192.168.0.0/16
  { name: "private-192", test: (ip) => ip.startsWith("192.168.") },
  // Carrier-grade NAT 100.64.0.0/10
  {
    name: "carrier-nat",
    test: (ip) => {
      const parts = ip.split(".").map(Number);
      return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
    },
  },
  // Unspecified 0.0.0.0/8
  { name: "unspecified", test: (ip) => ip === "0.0.0.0" || ip.startsWith("0.") },
];

/** Blocked hostname literals (lowercase). */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal", // GCP metadata
  "metadata", // Azure metadata alias
  "fhmb6fmkmfnfjsfksf.ns.aliyuncs.com", // Aliyun metadata alias
]);

/** Blocked IPv6 literals (first hextet). */
const BLOCKED_IPV6_PREFIXES = [
  "::1", // loopback
  "fc",
  "fd", // unique local (fc00::/7)
  "fe80", // link-local
  "fec0", // site-local (deprecated)
];

function isBlockedIpv4(ip: string): string | null {
  for (const p of BLOCKED_IPV4_PATTERNS) {
    if (p.test(ip)) return p.name;
  }
  return null;
}

function isBlockedIpv6(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (lower === "::1") return "loopback";
  // Strip zone id
  const core = lower.split("%")[0];
  const firstHextet = core.split(":")[0] ?? "";
  if (BLOCKED_IPV6_PREFIXES.includes(firstHextet)) return "private/link-local";
  // ::ffff:127.0.0.1 v4-mapped
  const v4MappedMatch = core.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedMatch) {
    const v4 = v4MappedMatch[1];
    const blocked = isBlockedIpv4(v4);
    if (blocked) return `v4-mapped-${blocked}`;
  }
  return null;
}

/** Returns the blocked-range name if the IP literal is unsafe, else null. */
function classifyIpLiteral(ip: string): string | null {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return null;
}

/**
 * Validate a URL for privileged fetch/navigation. Optionally performs async
 * DNS resolution to defend against DNS rebinding to private ranges.
 *
 * `resolve` defaults to false so callers in hot paths can opt-in. Callers that
 * navigate a headless browser MUST set `resolve: true` or apply a navigation
 * interceptor (see applySsrfNavigationGuard).
 */
export const UrlGuard = {
  /**
   * Synchronous structural validation. Blocks bad schemes and known-bad
   * host literals/IPs. Does NOT defend against DNS rebinding.
   */
  validate(inputUrl: string): UrlValidationResult {
    if (typeof inputUrl !== "string" || inputUrl.length === 0) {
      return { safe: false, code: "MALFORMED", error: "Empty URL" };
    }

    let parsed: URL;
    try {
      parsed = new URL(inputUrl);
    } catch {
      return {
        safe: false,
        code: "MALFORMED",
        error: `Malformed URL: ${inputUrl}`,
      };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        safe: false,
        code: "BAD_SCHEME",
        error: `Disallowed URL scheme: ${parsed.protocol}`,
      };
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host) {
      return { safe: false, code: "BAD_HOST", error: "Missing host" };
    }

    // Blocked hostname literal
    if (BLOCKED_HOSTNAMES.has(host)) {
      return {
        safe: false,
        code: "BLOCKED_HOST",
        error: `Blocked host: ${host}`,
      };
    }

    // IP literal checks
    if (net.isIP(host) > 0) {
      const blocked = classifyIpLiteral(host);
      if (blocked) {
        return {
          safe: false,
          code: "BLOCKED_IP",
          error: `Blocked IP (${blocked}): ${host}`,
        };
      }
    }

    // userinfo / credentials in URL — reject to prevent credential smuggling
    if (parsed.username || parsed.password) {
      return {
        safe: false,
        code: "MALFORMED",
        error: "URL must not contain credentials",
      };
    }

    return {
      safe: true,
      code: "OK",
      normalizedUrl: parsed.toString(),
      resolvedHost: host,
    };
  },

  /**
   * Async validation that additionally resolves the host and rejects if every
   * resolved address lands in a blocked range. Use this for any code path
   * that performs a server-side fetch without a redirect-aware interceptor.
   */
  async validateWithDns(inputUrl: string): Promise<UrlValidationResult> {
    const base = UrlGuard.validate(inputUrl);
    if (!base.safe) return base;
    const host = base.resolvedHost!;

    // Already an IP literal — covered by validate()
    if (net.isIP(host) > 0) return base;

    let addrs: string[];
    try {
      const records = await dns.promises.lookup(host, {
        all: true,
        verbatim: true,
      });
      addrs = records.map((r) => r.address);
    } catch {
      return {
        safe: false,
        code: "RESOLVE_FAILED",
        error: `DNS resolution failed for ${host}`,
      };
    }

    if (addrs.length === 0) {
      return {
        safe: false,
        code: "RESOLVE_FAILED",
        error: `No DNS records for ${host}`,
      };
    }

    // Fail-closed: if ANY resolved address is private, reject. This defends
    // against DNS-rebinding where a single A record flips to internal.
    for (const addr of addrs) {
      const blocked = classifyIpLiteral(addr);
      if (blocked) {
        return {
          safe: false,
          code: "BLOCKED_IP",
          error: `Host ${host} resolves to blocked IP (${blocked}): ${addr}`,
        };
      }
    }

    return base;
  },
};
