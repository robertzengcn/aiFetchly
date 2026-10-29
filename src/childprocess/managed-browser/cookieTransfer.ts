import type { CookieSameSite, NormalizedCookie } from "@/schemas/accountCookies";

/**
 * Storage-to-Puppeteer cookie conversion (technical design §13.1).
 *
 * The worker receives an already-allowlisted, domain-filtered
 * `NormalizedCookie[]` from the main process and maps it onto Puppeteer's
 * cookie shape. Each cookie is converted INDEPENDENTLY so one malformed or
 * browser-rejected cookie never blocks the others (FR-COOKIE-014).
 *
 * This module is pure: no Puppeteer import, unit-testable.
 */

/** Puppeteer's `Protocol.Network.CookieParam` subset we produce. */
export interface PuppeteerCookieSet {
  readonly name: string;
  readonly value: string;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly?: boolean;
  readonly expires?: number;
  readonly sameSite?: "Strict" | "Lax" | "None";
  /** Set for host-only cookies instead of `domain`. */
  readonly url?: string;
  readonly domain?: string;
}

export type CookieConversionOutcome =
  | { readonly ok: true; readonly cookie: PuppeteerCookieSet }
  | { readonly ok: false; readonly rejectReason: string };

const SAME_SITE_MAP: Readonly<Record<CookieSameSite, "Strict" | "Lax" | "None" | undefined>> =
  {
    no_restriction: "None",
    lax: "Lax",
    strict: "Strict",
    // Unspecified: omit and let Chrome use native behavior.
    unspecified: undefined,
  };

function hostOnlyUrl(domain: string, path: string, secure: boolean): string {
  const scheme = secure ? "https" : "http";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${scheme}://${domain}${normalizedPath}`;
}

/** Convert ONE normalized cookie (independent success/failure). */
export function convertCookie(cookie: NormalizedCookie): CookieConversionOutcome {
  if (!cookie.name || !cookie.domain) {
    return { ok: false, rejectReason: "missing_name_or_domain" };
  }
  const sameSite = cookie.sameSite ? SAME_SITE_MAP[cookie.sameSite] : undefined;
  const base = {
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(sameSite ? { sameSite } : {}),
    ...(cookie.expirationDate != null ? { expires: cookie.expirationDate } : {}),
  };
  if (cookie.hostOnly) {
    // Host-only: construct an origin URL so the cookie is NOT converted into
    // a domain cookie (design §13.1 hostOnly row).
    return {
      ok: true,
      cookie: {
        ...base,
        url: hostOnlyUrl(cookie.domain, base.path, cookie.secure),
      },
    };
  }
  return { ok: true, cookie: { ...base, domain: cookie.domain } };
}

/** Convert a batch, returning accepted sets + count-only reject tallies. */
export function convertCookieBatch(
  cookies: readonly NormalizedCookie[]
): {
  readonly accepted: readonly PuppeteerCookieSet[];
  readonly rejectedCount: number;
  readonly rejectReasonTallies: Readonly<Record<string, number>>;
} {
  const accepted: PuppeteerCookieSet[] = [];
  const tallies: Record<string, number> = {};
  let rejected = 0;
  for (const cookie of cookies) {
    const outcome = convertCookie(cookie);
    if (outcome.ok) {
      accepted.push(outcome.cookie);
    } else {
      rejected++;
      tallies[outcome.rejectReason] = (tallies[outcome.rejectReason] ?? 0) + 1;
    }
  }
  return { accepted, rejectedCount: rejected, rejectReasonTallies: tallies };
}

/**
 * Convert worker-captured Puppeteer cookies BACK to NormalizedCookie[] for
 * the private REFRESHED_COOKIES message. Domain filtering against the
 * immutable platform definition happens separately (worker + main both
 * re-filter; design §13.3).
 */
export interface CapturedBrowserCookie {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
  readonly secure?: boolean;
  readonly httpOnly?: boolean;
  readonly expires?: number;
  readonly sameSite?: "Strict" | "Lax" | "None";
  readonly session?: boolean;
}

const REVERSE_SAME_SITE: Readonly<
  Record<"Strict" | "Lax" | "None", CookieSameSite>
> = { Strict: "strict", Lax: "lax", None: "no_restriction" };

export function fromCapturedCookie(
  cookie: CapturedBrowserCookie
): NormalizedCookie | null {
  if (!cookie.name || !cookie.domain) {
    return null;
  }
  const domain = cookie.domain.replace(/^\./, "").toLowerCase();
  return {
    domain,
    path: cookie.path || "/",
    name: cookie.name,
    value: cookie.value,
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    ...(cookie.session || cookie.expires == null
      ? {}
      : { expirationDate: cookie.expires }),
    ...(cookie.sameSite ? { sameSite: REVERSE_SAME_SITE[cookie.sameSite] } : {}),
  };
}

export function fromCapturedCookies(
  cookies: readonly CapturedBrowserCookie[]
): NormalizedCookie[] {
  const out: NormalizedCookie[] = [];
  for (const cookie of cookies) {
    const normalized = fromCapturedCookie(cookie);
    if (normalized) {
      out.push(normalized);
    }
  }
  return out;
}

/** Suffix-exact domain matcher (mirrors PlatformSessionManifest semantics). */
export function matchesDomainSuffix(
  domain: string,
  allowedSuffixes: readonly string[]
): boolean {
  const d = domain.toLowerCase();
  return allowedSuffixes.some(
    (suffix) => d === suffix || d.endsWith(`.${suffix}`)
  );
}
