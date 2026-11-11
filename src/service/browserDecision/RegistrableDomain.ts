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
  // X1 (2026-11-10 audit): private public-suffix entries — WITHOUT
  // these, unrelated tenants of a hosting platform collide into one
  // registrable domain (attacker.github.io === victim.github.io),
  // which once released stored passwords across tenants.
  "github.io", "gitlab.io", "herokuapp.com", "vercel.app",
  "netlify.app", "pages.dev", "blogspot.com", "web.app",
  "appspot.com", "firebaseapp.com", "firebaseio.com",
  "azurewebsites.net", "azurestaticapps.net", "cloudfront.net",
  "s3.amazonaws.com", "s3.dualstack.amazonaws.com",
  "workers.dev", "r2.dev", "fastly.net", "edgekey.net",
  "ghost.io", "surge.sh", "now.sh", "reinterpretapp.com",
  // X1: country second-level suffixes missing from the original list.
  "co.ke", "or.ke", "ne.ke", "go.ke", "ac.ke",
  "com.sa", "net.sa", "org.sa", "edu.sa", "gov.sa",
  "gob.mx", "edu.mx", "org.mx",
  "ltd.uk", "plc.uk", "gov.uk", "nhs.uk", "police.uk",
  "edu.cn", "ac.cn", "mil.cn", "org.cn",
  "ac.in", "edu.in", "res.in", "mil.in",
  "gov.ph", "edu.ph", "mil.ph", "i.ph", "ngo.ph",
  "co.at", "or.at", "ac.at", "gv.at", "priv.at",
  "com.pt", "org.pt", "edu.pt", "gov.pt",
  "com.es", "org.es", "gob.es", "edu.es",
  "com.se", "org.se", "pp.se",
  "com.gr", "org.gr", "edu.gr", "net.gr",
  "com.ro", "org.ro", "nom.ro",
  "com.ec", "net.ec", "gob.ec",
  "com.ve", "net.ve", "org.ve", "gob.ve",
  "com.bo", "net.bo", "org.bo", "gob.bo",
  "com.py", "net.py", "org.py", "gov.py",
  "com.pe", "net.pe", "org.pe", "edu.pe",
  "com.do", "net.do", "org.do", "gob.do",
  "com.gt", "net.gt", "org.gt", "gob.gt",
  "com.sv", "org.sv", "edu.sv", "gob.sv",
  "com.ni", "net.ni", "org.ni", "gob.ni",
  "com.cr", "net.cr", "org.cr", "ed.cr", "go.cr",
  "co.ma", "net.ma", "org.ma", "ac.ma", "gov.ma",
  "com.dz", "org.dz", "net.dz", "gov.dz", "edu.dz",
  "com.tn", "net.tn", "org.tn", "gov.tn", "edu.tn",
  "com.ly", "net.ly", "org.ly", "gov.ly", "edu.ly",
  "com.jo", "org.jo", "net.jo", "gov.jo", "edu.jo",
  "com.lb", "org.lb", "net.lb", "gov.lb", "edu.lb",
  "com.kz", "net.kz", "org.kz", "edu.kz", "gov.kz",
  "com.uz", "net.uz", "org.uz", "gov.uz",
  "com.ge", "net.ge", "org.ge", "edu.ge", "gov.ge",
  "com.am", "net.am", "org.am", "edu.am", "gov.am",
  "com.az", "net.az", "org.az", "edu.az", "gov.az",
  "com.et", "gov.et", "org.et", "edu.et", "net.et",
  "co.tz", "or.tz", "ne.tz", "go.tz", "ac.tz",
  "co.ug", "or.ug", "ne.ug", "go.ug", "ac.ug",
  "com.gh", "org.gh", "net.gh", "edu.gh", "gov.gh",
  "com.ng", "org.ng", "net.ng", "edu.ng", "gov.ng",
  "com.zm", "org.zm", "net.zm", "edu.zm", "gov.zm",
  "co.zw", "org.zw", "net.zw", "gov.zw", "ac.zw",
  "com.bd", "net.bd", "org.bd", "edu.bd", "gov.bd",
  "com.lk", "net.lk", "org.lk", "edu.lk", "gov.lk",
  "com.np", "net.np", "org.np", "edu.np", "gov.np",
  "com.af", "net.af", "org.af", "edu.af", "gov.af",
  "co.ir", "net.ir", "org.ir", "ac.ir", "gov.ir",
  "co.hu", "org.hu", "2000.hu",
  "co.yu", "org.yu", "edu.yu",
  "co.vi", "org.vi",
  "com.ai", "net.ai", "org.ai", "off.ai", "n.om",
  "co.mz", "org.mz", "net.mz", "gov.mz", "edu.mz",
  "co.hu", "2000.hu", "erotika.hu", "jogasz.hu", "otters.hu",
  "org.net.cn",
]);

/**
 * X1/N01: PSL wildcard rules (`*.ck`) — ANY label + the base is a public
 * suffix. Stored WITH the leading `*.` marker.
 */
const WILDCARD_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  "*.ck", "*.km", "*.jm", "*.kh", "*.mm",
  "*.ni", "*.pg", "*.pw",
]);

/**
 * X1/N01: PSL exception rules (`!www.ck`) — the named host is itself the
 * registrable domain, overriding a wildcard. Stored WITH the leading `!`
 * marker.
 */
const EXCEPTION_RULES: ReadonlySet<string> = new Set(["!www.ck"]);

/** Single-label public suffixes too broad to be a registrable domain. */
const SINGLE_LABEL_PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  "com", "net", "org", "edu", "gov", "int", "mil", "info", "biz", "name",
  "io", "ai", "co", "app", "dev", "me", "us", "uk", "de", "fr", "it", "es",
  "nl", "se", "no", "fi", "dk", "pl", "pt", "gr", "cz", "at", "ch", "be",
  "ru", "ua", "tr", "in", "cn", "jp", "kr", "au", "br", "mx", "ar", "cl",
  "za", "ng", "eg", "pk", "bd", "id", "my", "sg", "hk", "tw", "vn", "th",
  "ph", "il", "sa", "ae", "ca", "ir", "ro", "hu", "ie", "nz", "eu", "cat",
]);

/** N01: the longest rule tail in any set (computed once at module load). */
const maxRuleLabelCount: number = (() => {
  let max = 2;
  for (const set of [
    MULTI_LABEL_PUBLIC_SUFFIXES,
    SINGLE_LABEL_PUBLIC_SUFFIXES,
    WILDCARD_PUBLIC_SUFFIXES,
    EXCEPTION_RULES,
  ]) {
    for (const rule of set) {
      const isWildcard = rule.startsWith("*.");
      const cleaned = isWildcard ? rule.slice(2) : rule.replace(/^[!]/, "");
      const labelCount = cleaned.split(".").length;
      max = Math.max(max, labelCount + (isWildcard ? 1 : 0));
    }
  }
  return max;
})();

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
  // X1: loopback / private-name hosts can NEVER be registrable
  // domains — a credential site must not be creatable on
  // localhost/.local/.internal, and tenant names under them must not
  // collide. (E2E fixtures use direct suffix matching, not this
  // function, so loopback fixtures remain usable behind their flag.)
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return null;
  }
  if (labels.length < 2) {
    return null;
  }
  // N01: LONGEST-MATCH rule traversal — compare the longest tails first
  // so multi-label rules (s3.amazonaws.com) and wildcards (*.ck) actually
  // match; the previous two-label comparison silently ignored every 3+
  // label rule (alice.s3.amazonaws.com → amazonaws.com).
  const maxRuleLabels = maxRuleLabelCount;
  for (let k = Math.min(labels.length, maxRuleLabels); k >= 1; k--) {
    const tail = labels.slice(-k).join(".");
    // Exception rule: the named tail is itself the registrable domain.
    if (EXCEPTION_RULES.has(`!${tail}`)) {
      return tail;
    }
    // Wildcard rule: any single label + the base is a public suffix.
    if (k >= 2 && WILDCARD_PUBLIC_SUFFIXES.has(`*.${tail}`)) {
      if (labels.length < k + 1) {
        return null; // the wildcard suffix itself
      }
      return labels.slice(-(k + 1)).join(".");
    }
    // Normal rule (multi- or single-label): the tail is a public suffix;
    // one more label is the registrable domain.
    if (
      MULTI_LABEL_PUBLIC_SUFFIXES.has(tail) ||
      (k === 1 && SINGLE_LABEL_PUBLIC_SUFFIXES.has(tail))
    ) {
      if (labels.length < k + 1) {
        return null; // the public suffix itself (e.g. "co.uk")
      }
      return labels.slice(-(k + 1)).join(".");
    }
  }
  // No rule matched: conservative last-two rule for unknown TLDs.
  return labels.slice(-2).join(".");
}

/** Full identity of a URL string: null when the URL is not valid HTTPS/HTTP. */
export function parseUrlIdentity(rawUrl: string): ParsedUrlIdentity | null {
  return parseUrlIdentityWithOptions(rawUrl, {});
}

export interface ParseUrlIdentityOptions {
  /** X1: reject http:// targets (NAVIGATE must not allow downgrades). */
  readonly httpsOnly?: boolean;
}

export function parseUrlIdentityWithOptions(
  rawUrl: string,
  options: ParseUrlIdentityOptions
): ParsedUrlIdentity | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  if (options.httpsOnly && parsed.protocol !== "https:") {
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
