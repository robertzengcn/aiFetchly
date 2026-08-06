import { z } from "zod";

/**
 * Native-messaging protocol schemas (technical design §9.5).
 *
 * Framing: Chromium native messaging = 32-bit little-endian length prefix +
 * UTF-8 JSON payload, with a strict payload cap (1 MiB) enforced before parse.
 *
 * Trust model: the native host is a TRANSPORT boundary, not a trust boundary.
 * The desktop main process re-validates everything (token, account, platform,
 * expiry, domain set) before accepting cookie data.
 *
 * `requestSecret` is an opaque base64url string on the wire; it is never logged
 * and never persisted. It authenticates a single one-time import response.
 */

export const NATIVE_MESSAGE_MAX_BYTES = 1 * 1024 * 1024; // 1 MiB

/** Desktop -> native host: announce a one-time import request. */
export const nativeImportRequestSchema = z.strictObject({
  version: z.literal(1),
  type: z.literal("import_request"),
  requestId: z.string().min(1),
  requestSecret: z.string().min(16),
  platformId: z.number().int().positive(),
  allowedDomains: z.array(z.string().min(1)).min(1),
  expiresAt: z.string().min(1),
});
export type NativeImportRequest = z.infer<typeof nativeImportRequestSchema>;

/**
 * Extension -> native host -> main: the cookie payload. Cookies use the
 * chrome.cookies shape (domain/path/name/value/secure/httpOnly/sameSite/
 * expirationDate/hostOnly). They are re-validated and allowlist-filtered by
 * AccountSessionService before persistence.
 */
export const nativeImportResultSchema = z.strictObject({
  version: z.literal(1),
  type: z.literal("import_result"),
  requestId: z.string().min(1),
  requestSecret: z.string().min(16),
  cookies: z.array(z.record(z.string(), z.unknown())),
  extensionVersion: z.string().min(1),
});
export type NativeImportResult = z.infer<typeof nativeImportResultSchema>;

/** Discriminated union for any native-host message we accept. */
export const nativeMessageSchema = z.discriminatedUnion("type", [
  nativeImportRequestSchema,
  nativeImportResultSchema,
]);
export type NativeMessage = z.infer<typeof nativeMessageSchema>;
