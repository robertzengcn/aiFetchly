/**
 * Registrable-domain (eTLD+1) derivation for browser site identity.
 *
 * The PRD names the `tldts` public-suffix library; that dependency cannot be
 * installed in this environment, so this module implements the same
 * conservative semantics with a curated multi-label public-suffix list:
 *
 * - returns eTLD+1, lowercased, without a trailing dot;
 * - public suffixes themselves (e.g. `com`, `co.uk`) return null;
 * - IP literals and single-label hosts return null;
 * - unknown multi-label suffixes conservatively use the last label as the
 *   TLD (an over- rather than under-broad rule never widens a site's
 *   allowed-domain set beyond what the user confirms).
 */
import { isIP } from "net";

/** Common multi-label public suffixes (a pragmatic subset of the PSL). */
const MULTI_LABEL_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
  "com.br", "net.br", "org.br", "gov.br",
  "co.nz", "net.nz", "org.nz", "govt.nz",
  "co.in", "net.in", "org.in", "gov.in",
  "com.cn", "net.cn", "org.cn", "gov.cn",
  "com.hk", "org.hk", "net.hk", "gov.hk",
  "com.tw", "org.tw", "net.tw", "gov.tw",
  "co.kr", "ne.kr", "or.kr", "gov.kr",
  "com.sg", "net.sg", "org.sg", "gov.sg",
  "co.za", "net.za", "org.za", "gov.za",
  "com.mx", "net.mx", "org.mx",
  "com.ar", "net.ar", "org.ar",
  "com.tr", "net.tr", "org.tr",
  "com.ru", "net.ru", "org.ru",
  "co.il", "net.il", "org.il", "gov.il",
  "co.th", "net.th", "or.th",
  "com.vn", "net.vn", "org.vn",
  "com.my", "net.my", "org.my", "gov.my",
  "com.ph", "net.ph", "org.ph",
  "com.co", "net.co", "org.co",
  "com.ng", "net.ng", "org.ng", "gov.ng",
  "com.pk", "net.pk", "org.pk",
  "com.eg", "net.eg", "org.eg",
  "com.ua", "net.ua", "org.ua",
  "com.pl", "net.pl", "org.pl",
  "co.id", "net.id", "or.id", "web.id",
]);

/** Single-label public suffixes too broad to be a registrable domain. */
const SINGLE_LABEL_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  "com", "net", "org", "edu", "gov", "int", "mil", "info", "biz", "name",
  "io", "ai", "co", "app", "dev", "me", "us", "uk", "de", "fr", "it", "es",
  "nl", "se", "no", "fi", "dk", "pl", "pt", "gr", "cz", "at", "ch", "be",
  "ru", "ua", "tr", "in", "cn", "jp", "kr", "au", "br", "mx", "ar", "cl",
  "za", "ng", "eg", "pk", "bd", "id", "my", "sg", "hk", "tw", "vn", "th",
  "ph", "il", "sa", "ae", "ca", "ir", "ro", "hu", "ie", "nz", "eu", "cat",
]);

export interface ParsedUrlIdentity {
  readonly registrableDomain: string;
  readonly hostname: string;
  readonly protocol: string;
}

/**
 * Normalize a hostname to its registrable domain (eTLD+1).
 * Returns null for IP literals, single-label hosts, and bare public suffixes.
 */
export function registrableDomainOf(hostname: string | null | undefined): string | null {
  if (!hostname) {
    return null;
  }
  let host = hostname.trim().toLowerCase().replace(/\.+$/, "");
  if (host.startsWith("[") && host.endsWith("]")) {
    return null; // IPv6 literal
  }
  host = host.split("@").pop() ?? host; // strip any accidental userinfo
  if (isIP(host)) {
    return null;
  }
  const labels = host.split(".").filter((label) => label.length > 0);
  if (labels.length < 2) {
    return null;
  }
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo)) {
    if (labels.length < 3) {
      return null; // e.g. "co.uk" itself
    }
    return labels.slice(-3).join(".");
  }
  const tld = labels[labels.length - 1];
  if (SINGLE_LABEL_PUBLIC_SUFFIXES.has(tld)) {
    return labels.slice(-2).join(".");
  }
  // Unknown TLD: require at least two labels, use last two conservatively.
  return lastTwo;
}

/** Full identity of a URL string: null when the URL is not valid HTTPS/HTTP. */
export function parseUrlIdentity(rawUrl: string): ParsedUrlIdentity | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  const registrableDomain = registrableDomainOf(parsed.hostname);
  if (!registrableDomain) {
    return null;
  }
  return {
    registrableDomain,
    hostname: parsed.hostname.toLowerCase(),
    protocol: parsed.protocol,
  };
}

/** True when `hostname` equals `suffix` or ends in `.<suffix>` (suffix-exact). */
export function hostnameMatchesSuffix(hostname: string, suffix: string): boolean {
  const host = hostname.trim().toLowerCase();
  const suffixNormalized = suffix.trim().toLowerCase().replace(/^\./, "");
  if (!host || !suffixNormalized) {
    return false;
  }
  return host === suffixNormalized || host.endsWith(`.${suffixNormalized}`);
}

/**
 * True when a hostname is allowed by a site's domain-suffix list. A site with
 * an empty allowlist matches nothing (fail-closed).
 */
export function hostnameAllowedBySuffixes(
  hostname: string,
  allowedSuffixes: readonly string[],
): boolean {
  return allowedSuffixes.some((suffix) => hostnameMatchesSuffix(hostname, suffix));
}
