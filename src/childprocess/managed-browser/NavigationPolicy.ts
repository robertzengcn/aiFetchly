/**
 * Navigation policy (technical design §12.2; PRD §14.1).
 *
 * Every explicit navigation, popup target, and redirect chain is evaluated
 * here BEFORE the worker acts on it. Page content can never widen these
 * rules — the allowlist comes only from the platform definition the MAIN
 * process supplied.
 *
 * Pure module: hostname literals only (DNS resolution is not performed —
 * rebinding defense for P0 relies on literal checks; the strict interceptor
 * is a later design item).
 */

export interface NavigationPolicyOptions {
  /** Registrable origins the platform adapter allows (login/SSO included). */
  readonly allowedOrigins: readonly string[];
  /** Development/test mode: permit http: loopback fixture pages. */
  readonly allowLoopbackFixtures?: boolean;
}

export type NavigationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reasonCode: string };

const BLOCKED_SCHEMES = new Set([
  "file:",
  "data:",
  "javascript:",
  "blob:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "view-source:",
  "about:",
]);

/** Loopback literals (127.0.0.0/8, ::1, localhost, 0.0.0.0). */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "[::1]") {
    return true;
  }
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
    return true;
  }
  return false;
}

/** Private / link-local / cloud-metadata literals. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackHost(h)) {
    return true;
  }
  // 10.0.0.0/8
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // 172.16.0.0/12
  const match172 = /^172\.(\d{1,3})\./.exec(h);
  if (match172) {
    const second = Number.parseInt(match172[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // 192.168.0.0/16
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // 169.254.0.0/16 (link-local + cloud metadata 169.254.169.254)
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // IPv6 unique-local / link-local
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  return false;
}

function hostMatchesAllowed(hostname: string, allowed: readonly string[]): boolean {
  const h = hostname.toLowerCase();
  return allowed.some((raw) => {
    let originHost = raw;
    try {
      originHost = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
    } catch {
      originHost = raw;
    }
    const suffix = originHost.toLowerCase();
    return h === suffix || h.endsWith(`.${suffix}`);
  });
}

/**
 * Evaluate a navigation target. Rules (PRD §14.1):
 *  1. https: allowed only for platform/SSO origins (suffix-exact);
 *  2. http: allowed ONLY for loopback test fixtures in fixture mode;
 *  3. file:/data:/javascript:/blob:/browser-internal schemes blocked;
 *  4. loopback/private/link-local/metadata literals blocked outside fixtures.
 */
export function evaluateNavigationTarget(
  rawUrl: string,
  options: NavigationPolicyOptions
): NavigationDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reasonCode: "invalid_url" };
  }
  const scheme = url.protocol.toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) {
    return { allowed: false, reasonCode: "blocked_scheme" };
  }
  if (scheme !== "https:" && scheme !== "http:") {
    return { allowed: false, reasonCode: "unsupported_scheme" };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback = isLoopbackHost(hostname);
  if (scheme === "http:") {
    if (loopback && options.allowLoopbackFixtures) {
      return { allowed: true };
    }
    return { allowed: false, reasonCode: "insecure_scheme" };
  }
  // https:
  if (!options.allowLoopbackFixtures && isPrivateHost(hostname)) {
    return { allowed: false, reasonCode: "private_network_blocked" };
  }
  if (loopback && !options.allowLoopbackFixtures) {
    return { allowed: false, reasonCode: "private_network_blocked" };
  }
  if (hostMatchesAllowed(hostname, options.allowedOrigins)) {
    return { allowed: true };
  }
  return { allowed: false, reasonCode: "cross_origin_not_allowed" };
}

/**
 * URL sanitized for status/observation/reporting: strip credentials, query,
 * and fragment (queries can carry tokens and user data).
 */
export function sanitizeUrlForReport(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "";
  }
}

/** Origin only (used for chat notices and handoff status). */
export function extractOrigin(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}
