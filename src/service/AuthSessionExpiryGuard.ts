// src/service/AuthSessionExpiryGuard.ts
//
// Main-process only. Must NOT be imported from renderer/Vue code — it pulls
// `User` (Electron BrowserWindow) via dynamic import.
//
// Policy (session-expiry re-login requirement): when a first-party API call
// (e.g. POST /api/ai/v1/chat/completions, GET /api/ai/v1/models) receives a
// 401/403, HttpClient already attempts a token refresh. When that refresh
// fails in a DEFINITIVE auth-shaped way — the refresh token is rejected or
// expired, the refreshed request is still rejected, or no refresh token is
// stored — the session cannot recover and the user must be signed out so
// they can log in again. Transient failures (network down, HTTP 5xx) do NOT
// sign out: backend/proxy instability can look like auth failure and the
// user should keep local app functionality.

import { log } from "@/modules/Logger";
import { isRefreshTokenInvalidError } from "@/modules/lib/httpclient";

/**
 * True when the error represents a definitive, auth-shaped session failure
 * that cannot recover without a fresh login:
 *  - typed `RefreshTokenInvalidError` (refresh token missing/expired/rejected)
 *  - HttpClient messages "Authentication failed …" (refresh retry still
 *    401/403, refresh token unavailable, signout-endpoint token expiry)
 *
 * Transient failures (network down, HTTP 5xx) never match.
 */
export function isAuthShapedSessionFailure(err: unknown): boolean {
  if (isRefreshTokenInvalidError(err)) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /authentication failed/i.test(msg);
}

/** Guards against duplicate/concurrent sign-out flights. */
let signoutInFlight = false;

/**
 * Fire-and-forget: when the failure is auth-shaped, sign the user out
 * (clears local tokens, stops auto-refresh, navigates the renderer to the
 * login page) so they can re-login. Never throws; never blocks the caller.
 *
 * Uses a dynamic import for `User` because `user.ts` → `RemoteSource` →
 * `HttpClient` would create a circular static import from `httpclient.ts`.
 */
export function triggerSignoutOnAuthShapedFailure(err: unknown): void {
  if (!isAuthShapedSessionFailure(err)) {
    return;
  }
  // Worker processes have no Electron APIs — they cannot sign out.
  if (process.env.WORKER_TYPE) {
    return;
  }
  if (signoutInFlight) {
    log.warn(
      "[AuthSessionExpiry] Sign-out already in flight; skipping duplicate trigger"
    );
    return;
  }
  signoutInFlight = true;
  void (async (): Promise<void> => {
    try {
      const { User } = await import("@/modules/user");
      await new User().Signout();
      log.info(
        "[AuthSessionExpiry] Signed out after auth-shaped refresh failure"
      );
    } catch (signoutError) {
      // Allow a later trigger to retry if this attempt failed before
      // clearing local state (e.g. DB teardown error).
      signoutInFlight = false;
      log.error(
        "[AuthSessionExpiry] Failed to sign out after auth expiry:",
        signoutError
      );
    }
  })();
}

/** Test-only: reset the in-flight guard between tests. */
export function resetAuthSessionExpiryGuardForTests(): void {
  signoutInFlight = false;
}
