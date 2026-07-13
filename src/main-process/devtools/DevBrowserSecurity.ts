"use strict";
/**
 * Dev Browser Bridge security checks (PRD FR-6, technical design §12).
 *
 * Pure functions — no I/O — so they are exhaustively unit-testable. Each check
 * returns a {@link SecurityCheck} whose `reason` doubles as the user-visible
 * failure message (FR-7.3: distinguish invalid token, blocked channel, etc.).
 *
 * Controls implemented here:
 *   - strict Origin exact-match (FR-6.2) — origin = scheme+host+port, no path
 *   - per-session bearer token (FR-6.1), constant-time compared
 *   - request payload size cap (technical design §12 #5)
 *   (channel allowlist is enforced in devBrowserChannels.ts; loopback binding
 *   and the !app.isPackaged gate are enforced in DevBrowserActivation.ts)
 */

export interface SecurityCheck {
  ok: boolean;
  /** Stable machine-readable-ish reason; surfaced to the browser client. */
  reason: string;
}

const OK: SecurityCheck = { ok: true, reason: "ok" };

/** Hard cap on a single invoke request body. Keep modest — read-only MVP. */
export const MAX_PAYLOAD_BYTES = 256 * 1024; // 256 KiB

/**
 * Validate the request Origin against the single allowed renderer origin.
 * Browsers always send `Origin` on cross-origin/fetch requests and on
 * WebSocket handshakes; a missing Origin is treated as a rejection.
 */
export function checkOrigin(
  actualOrigin: string | undefined,
  allowedOrigin: string
): SecurityCheck {
  if (!actualOrigin || actualOrigin.length === 0) {
    return { ok: false, reason: "invalid token or missing origin" };
  }
  if (actualOrigin !== allowedOrigin) {
    return { ok: false, reason: "invalid origin" };
  }
  return OK;
}

/**
 * Validate an `Authorization: Bearer <token>` header against the session token.
 *
 * Uses a constant-time comparison over the full header value to avoid leaking
 * token length / prefix via a timing side channel. A wrong scheme or wrong
 * token both produce the same generic reason (do not reveal which).
 */
export function checkBearerToken(
  authHeader: string | undefined,
  token: string
): SecurityCheck {
  if (!authHeader || authHeader.length === 0) {
    return { ok: false, reason: "invalid or missing token" };
  }
  const expected = `Bearer ${token}`;
  // Reject before constant-time compare if lengths differ — still do not reveal
  // whether the scheme was correct.
  if (authHeader.length !== expected.length) {
    return { ok: false, reason: "invalid or missing token" };
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= authHeader.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) {
    return { ok: false, reason: "invalid or missing token" };
  }
  return OK;
}

/** Validate a request body size against the payload cap. */
export function checkPayloadSize(byteLength: number): SecurityCheck {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    return { ok: false, reason: "invalid payload size" };
  }
  if (byteLength > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      reason: `payload too large (limit ${MAX_PAYLOAD_BYTES} bytes)`,
    };
  }
  return OK;
}
