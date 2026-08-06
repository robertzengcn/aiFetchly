import { z } from "zod";

/**
 * Zod schemas for secure social-account cookie storage.
 *
 * Trust model: raw cookies arrive from four sources (Netscape file upload,
 * Electron session capture, Chromium extension, worker refresh). Each source
 * is normalized (see `src/modules/accountSession/cookieNormalize.ts`) to the
 * `NormalizedCookie` shape below BEFORE it ever reaches encryption. Only this
 * normalized array is encrypted and persisted.
 *
 * Note on zod version: the codebase and `registerValidatedHandler` are typed
 * against zod v3 (`from "zod"`). v3 has every capability this feature needs
 * (strictObject, enum, nullable, finite). Mixing v3/v4 ZodType across the
 * validated-handler boundary causes TS friction, so v3 is used consistently.
 * See docs/prd/secure-browser-profile-import-IMPLEMENTATION-PLAN.md §2.
 */

/** Shared size limits for cookie name/value (referenced by the normalizer too). */
export const COOKIE_NAME_MAX = 4096;
export const COOKIE_VALUE_MAX = 16384;

/** SameSite as Electron / chrome.cookies represents it. */
export const cookieSameSiteSchema = z.enum([
  "unspecified",
  "no_restriction",
  "lax",
  "strict",
]);
export type CookieSameSite = z.infer<typeof cookieSameSiteSchema>;

/**
 * The normalized in-memory cookie representation. This is the ONLY cookie
 * shape that gets encrypted. It deliberately omits browser-specific fields
 * (storeId, session flag, Netscape subdomain flag) so the persisted snapshot
 * is source-agnostic.
 *
 * Rules enforced here are STRUCTURAL only (sizes, types, enum). Temporal and
 * semantic rules (expiry, SameSite+Secure combination, domain allowlist) are
 * enforced by the normalizer/service which have runtime context (now, manifest).
 */
export const normalizedCookieSchema = z.strictObject({
  domain: z.string().min(1).max(253),
  path: z.string().min(1).max(1024).default("/"),
  name: z.string().min(1).max(COOKIE_NAME_MAX),
  value: z.string().max(COOKIE_VALUE_MAX),
  secure: z.boolean(),
  httpOnly: z.boolean().default(false),
  /** Seconds since epoch. Omitted for session cookies. */
  expirationDate: z.number().finite().positive().optional(),
  sameSite: cookieSameSiteSchema.optional(),
  hostOnly: z.boolean().optional(),
});
export type NormalizedCookie = z.infer<typeof normalizedCookieSchema>;

/** Array form used for the encrypted snapshot. */
export const normalizedCookieArraySchema = z.array(normalizedCookieSchema);

/**
 * Source recorded in the non-secret `source` metadata column.
 * `worker_refresh` is internal-only; it is not exposed to the renderer.
 */
export const storedCookieSourceSchema = z.enum([
  "manual_login",
  "netscape_file",
  "browser_profile",
  "worker_refresh",
]);
export type StoredCookieSource = z.infer<typeof storedCookieSourceSchema>;

/**
 * Renderer-facing import-source values (PRD §8.4). `worker_refresh` is
 * intentionally excluded — it is an automation-internal write, not a
 * user-meaningful import source.
 */
export const rendererImportSourceSchema = z.enum([
  "manual_login",
  "netscape_file",
  "browser_profile",
]);

/** Session availability state shown to the user. */
export const sessionStatusSchema = z.enum([
  "available",
  "missing",
  "invalid",
  "migration_pending",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/** Bounded error codes (never contain raw errors / cookie values / paths). */
export const cookieErrorCodeSchema = z.enum([
  "KEY_UNAVAILABLE",
  "CIPHER_INVALID",
  "LEGACY_INVALID",
  "NO_ALLOWED_COOKIES",
  "REQUEST_EXPIRED",
  "EXTENSION_MISSING",
  "PERMISSION_DENIED",
  "SESSION_CAPTURE_FAILED",
  "PARTITION_CLEAR_FAILED",
  "STORAGE_FAILED",
]);
export type CookieErrorCode = z.infer<typeof cookieErrorCodeSchema>;

/**
 * Safe reject reasons surfaced to the UI. These describe WHY a cookie was
 * dropped without revealing its name or value.
 */
export const safeCookieRejectReasonSchema = z.enum([
  "outside_allowed_domains",
  "expired",
  "malformed",
  "duplicate",
  "oversize",
  "invalid_samesite",
]);
export type SafeCookieRejectReason = z.infer<
  typeof safeCookieRejectReasonSchema
>;

/** Empty-count map helper type for reject tallies. */
export type RejectCounts = Record<SafeCookieRejectReason, number>;

/**
 * Renderer-safe session metadata. Contains NO cookie values, names, domains,
 * or raw entities. This is the only cookie-related payload that may cross
 * main→renderer.
 */
export const accountSessionMetadataSchema = z.strictObject({
  hasCookies: z.boolean(),
  cookieCount: z.number().int().nonnegative(),
  lastUpdatedAt: z.string().nullable(),
  importSource: rendererImportSourceSchema.nullable(),
  sessionStatus: sessionStatusSchema,
});
export type AccountSessionMetadata = z.infer<
  typeof accountSessionMetadataSchema
>;

/**
 * Result of a cookie import / capture operation. Success variants carry a
 * count + safe reject breakdown + a verification URL. Failure variants carry
 * only a state code and counts. No cookie values, names, or paths anywhere.
 */
export const safeCookieRejectCountsSchema = z.record(
  safeCookieRejectReasonSchema,
  z.number().int().nonnegative()
);

export const cookieImportResultSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.enum(["success", "partial_success"]),
    importedCookieCount: z.number().int().nonnegative(),
    rejectedCookieCounts: safeCookieRejectCountsSchema,
    verificationUrl: z.string().url(),
  }),
  z.strictObject({
    state: z.enum([
      "cancelled",
      "extension_missing",
      "permission_denied",
      "no_eligible_cookies",
      "request_expired",
      "key_unavailable",
      "storage_failed",
    ]),
    importedCookieCount: z.literal(0),
    rejectedCookieCounts: safeCookieRejectCountsSchema,
  }),
]);
export type CookieImportResult = z.infer<typeof cookieImportResultSchema>;

/** Input to `AccountSessionService.persistSnapshot`. */
export const persistSnapshotInputSchema = z.strictObject({
  accountId: z.number().int().positive(),
  cookies: z.array(z.unknown()),
  source: storedCookieSourceSchema,
  partitionPath: z.string().min(1),
});
export type PersistSnapshotInput = z.infer<typeof persistSnapshotInputSchema>;

/** Aggregate migration summary (safe counts only). */
export const cookieMigrationSummarySchema = z.strictObject({
  scanned: z.number().int().nonnegative(),
  migrated: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  deferredKeyUnavailable: z.number().int().nonnegative(),
  persistenceFailed: z.number().int().nonnegative(),
  alreadyEncrypted: z.number().int().nonnegative(),
});
export type CookieMigrationSummary = z.infer<
  typeof cookieMigrationSummarySchema
>;
