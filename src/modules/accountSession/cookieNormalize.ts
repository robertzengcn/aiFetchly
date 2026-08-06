import {
  normalizedCookieSchema,
  COOKIE_NAME_MAX,
  COOKIE_VALUE_MAX,
  type NormalizedCookie,
  type CookieSameSite,
  type SafeCookieRejectReason,
  type RejectCounts,
} from "@/schemas/accountCookies";
import type { CookiesType } from "@/entityTypes/cookiesType";

/**
 * Cookie normalization pipeline (technical design §10.2).
 *
 * Sources (design §10.1):
 *   - netscape:  Netscape .txt upload  + Puppeteer worker refresh (both emit CookiesType[])
 *   - chromium:  Electron session.cookies.get({}) + chrome.cookies extension API
 *
 * Each raw cookie is adapted to a candidate, structurally validated, then the
 * batch is domain-filtered, expiry-filtered, and deduplicated. Only the
 * accepted `NormalizedCookie[]` is ever encrypted.
 *
 * This module is pure (no Electron / DB / key imports) so it is unit-testable
 * in the utilitycode vitest config. Domain allowlisting is supplied by the
 * caller via `matchesDomain` (wired to the platform manifest by the service).
 */

export type CookieAdapterSource = "netscape" | "chromium" | "legacy";

export interface NormalizeBatchOptions {
  /** Epoch seconds. Defaults to now; injected for deterministic tests. */
  now?: number;
  /**
   * Optional domain allowlist predicate. When provided, cookies whose
   * normalized domain is NOT allowed are rejected with `outside_allowed_domains`.
   * When omitted, no domain filtering is applied (caller filters separately).
   */
  matchesDomain?: (normalizedDomain: string) => boolean;
}

export interface NormalizeBatchResult {
  accepted: NormalizedCookie[];
  rejected: RejectCounts;
}

class CookieRejectError extends Error {
  constructor(
    public readonly reason: SafeCookieRejectReason,
    message?: string
  ) {
    super(message ?? reason);
    this.name = "CookieRejectError";
  }
}

export function emptyRejectCounts(): RejectCounts {
  return {
    outside_allowed_domains: 0,
    expired: 0,
    malformed: 0,
    duplicate: 0,
    oversize: 0,
    invalid_samesite: 0,
  };
}

const MAX_VALUE_LENGTH = COOKIE_VALUE_MAX;
const MAX_NAME_LENGTH = COOKIE_NAME_MAX;

/** Map any raw sameSite spelling to the canonical enum, defaulting to lax. */
function coerceSameSite(raw: unknown): CookieSameSite {
  if (typeof raw === "string") {
    const lower = raw.toLowerCase();
    if (lower === "none" || lower === "no_restriction") return "no_restriction";
    if (lower === "lax") return "lax";
    if (lower === "strict") return "strict";
    if (lower === "unspecified") return "unspecified";
  }
  // Default matches the existing, production-proven controller behavior:
  // Netscape exports omit sameSite; treating omitted as lax avoids the
  // SameSite=None+Secure requirement that would otherwise reject them.
  return "lax";
}

/** Lowercase + strip exactly one leading dot. */
function normalizeDomain(raw: string): string {
  let domain = raw.trim().toLowerCase();
  if (domain.startsWith(".")) {
    domain = domain.slice(1);
  }
  return domain;
}

/**
 * Adapt a Netscape/Puppeteer `CookiesType` raw cookie to a candidate.
 * Netscape column 1 (`flag`) is the include-subdomains flag: TRUE => domain
 * cookie (hostOnly=false), FALSE => host-only.
 */
export function normalizeNetscapeCookie(raw: CookiesType): NormalizedCookie {
  if (!raw || typeof raw !== "object") {
    throw new CookieRejectError("malformed", "netscape cookie not an object");
  }
  const name = raw.name;
  const value = raw.value ?? "";
  if (typeof name !== "string" || name.length === 0) {
    throw new CookieRejectError("malformed", "cookie name empty");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new CookieRejectError("oversize", "cookie name too long");
  }
  if (typeof value === "string" && value.length > MAX_VALUE_LENGTH) {
    throw new CookieRejectError("oversize", "cookie value too long");
  }
  const domain = normalizeDomain(String(raw.domain ?? ""));
  if (domain.length === 0) {
    throw new CookieRejectError("malformed", "cookie domain empty");
  }

  const secure = raw.secure === true;
  const sameSite = coerceSameSite(raw.sameSite);
  if (sameSite === "no_restriction" && !secure) {
    // Design §10.2: reject SameSite=None when !secure (browsers reject it too).
    throw new CookieRejectError("invalid_samesite");
  }

  const rawExpiry = raw.expirationDate;
  const expirationDate =
    typeof rawExpiry === "number" && rawExpiry > 0 ? rawExpiry : undefined;

  const candidate = {
    domain,
    path: typeof raw.path === "string" && raw.path.length > 0 ? raw.path : "/",
    name,
    value,
    secure,
    httpOnly: raw.httpOnly === true,
    ...(expirationDate !== undefined ? { expirationDate } : {}),
    sameSite,
    hostOnly: raw.flag === false, // flag FALSE => host-only
  };

  return normalizedCookieSchema.parse(candidate);
}

/**
 * Adapt a legacy plaintext cookie of unknown shape (migration only). Legacy
 * rows may be either Netscape `CookiesType[]` (from file upload / worker
 * refresh) or Electron cookie objects (from old session capture). Try the
 * chromium adapter first, then fall back to netscape.
 */
export function normalizeLegacyCookie(raw: unknown): NormalizedCookie {
  try {
    return normalizeChromiumCookie(raw);
  } catch {
    // fall through to netscape
  }
  return normalizeNetscapeCookie(raw as CookiesType);
}

/**
 * Input is intentionally loose (passthrough) since Electron and chrome.cookies
 * shapes are nearly identical and both browser-version-dependent.
 */
export function normalizeChromiumCookie(raw: unknown): NormalizedCookie {
  if (!raw || typeof raw !== "object") {
    throw new CookieRejectError("malformed", "chromium cookie not an object");
  }
  const r = raw as Record<string, unknown>;
  const name = r.name;
  const value = r.value ?? "";
  if (typeof name !== "string" || name.length === 0) {
    throw new CookieRejectError("malformed", "cookie name empty");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new CookieRejectError("oversize", "cookie name too long");
  }
  if (typeof value === "string" && value.length > MAX_VALUE_LENGTH) {
    throw new CookieRejectError("oversize", "cookie value too long");
  }
  const domain = normalizeDomain(String(r.domain ?? ""));
  if (domain.length === 0) {
    throw new CookieRejectError("malformed", "cookie domain empty");
  }

  const secure = r.secure === true;
  const sameSite = coerceSameSite(r.sameSite);
  if (sameSite === "no_restriction" && !secure) {
    throw new CookieRejectError("invalid_samesite");
  }

  // Electron/Chromium: expirationDate in seconds since epoch; session cookies
  // have expirationDate undefined or <= 0.
  const rawExpiry = r.expirationDate;
  const expirationDate =
    typeof rawExpiry === "number" && rawExpiry > 0 ? rawExpiry : undefined;

  const candidate = {
    domain,
    path: typeof r.path === "string" && r.path.length > 0 ? r.path : "/",
    name,
    value,
    secure,
    httpOnly: r.httpOnly === true,
    ...(expirationDate !== undefined ? { expirationDate } : {}),
    sameSite,
    hostOnly: r.hostOnly === true,
  };

  return normalizedCookieSchema.parse(candidate);
}

function dedupeKey(c: NormalizedCookie): string {
  return `${c.domain}|${c.path}|${c.name}`;
}

/** Newest valid cookie wins: session (no expiry) beats finite; later expiry beats earlier. */
function expiryRank(c: NormalizedCookie): number {
  return c.expirationDate ?? Number.POSITIVE_INFINITY;
}

/**
 * Normalize a batch of raw cookies from a single source.
 * Applies: adapter → validate → domain filter → expiry filter → dedupe.
 */
export function normalizeCookieBatch(
  raws: ReadonlyArray<unknown>,
  source: CookieAdapterSource,
  options: NormalizeBatchOptions = {}
): NormalizeBatchResult {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const rejected = emptyRejectCounts();

  // Use a Map so the dedupe "newest wins" rule is deterministic regardless of
  // input order: we always replace when the incoming cookie's expiry rank is
  // >= the kept one (ties go to the later-seen cookie).
  const kept = new Map<string, NormalizedCookie>();

  for (const raw of raws) {
    let cookie: NormalizedCookie;
    try {
      // The Netscape adapter is typed for CookiesType; cast is safe because the
      // adapter re-validates every field defensively. `legacy` tries chromium
      // first, then netscape (used by the plaintext migration only).
      if (source === "netscape") {
        cookie = normalizeNetscapeCookie(raw as CookiesType);
      } else if (source === "chromium") {
        cookie = normalizeChromiumCookie(raw);
      } else {
        cookie = normalizeLegacyCookie(raw);
      }
    } catch (err) {
      if (err instanceof CookieRejectError) {
        rejected[err.reason]++;
      } else {
        rejected.malformed++;
      }
      continue;
    }

    if (options.matchesDomain && !options.matchesDomain(cookie.domain)) {
      rejected.outside_allowed_domains++;
      continue;
    }

    if (cookie.expirationDate !== undefined && cookie.expirationDate < now) {
      rejected.expired++;
      continue;
    }

    const key = dedupeKey(cookie);
    const existing = kept.get(key);
    if (existing && expiryRank(existing) > expiryRank(cookie)) {
      // Existing is newer — keep it; count the duplicate.
      rejected.duplicate++;
      continue;
    }
    if (existing) {
      // Incoming is newer (or tie) — replace; count the displaced duplicate.
      rejected.duplicate++;
    }
    kept.set(key, cookie);
  }

  return { accepted: Array.from(kept.values()), rejected };
}

/**
 * Convert a normalized snapshot back to the legacy `CookiesType[]` shape that
 * the search/maps/yellowpages worker feeds still consume. This is a pure shape
 * adapter — values pass through unchanged. Used by AccountSessionService read
 * paths so downstream workers see the same structure they always did, while the
 * persisted (encrypted) representation stays normalized.
 *
 * `flag` is the Netscape include-subdomains flag (TRUE => domain cookie),
 * i.e. the inverse of hostOnly. Session cookies (no expirationDate) map to 0.
 */
export function normalizedToCookiesType(
  cookies: NormalizedCookie[]
): CookiesType[] {
  return cookies.map((c) => ({
    domain: c.domain,
    flag: !(c.hostOnly ?? false),
    path: c.path,
    secure: c.secure,
    expirationDate: c.expirationDate ?? 0,
    hostOnly: c.hostOnly ?? false,
    httpOnly: c.httpOnly,
    name: c.name,
    value: c.value,
    sameSite: c.sameSite,
  }));
}
