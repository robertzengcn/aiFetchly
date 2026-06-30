/**
 * In-memory singleton tracking an in-flight desktop auth handoff.
 *
 * When the user clicks "Login" we generate (verifier, state), start a
 * loopback callback server, and store everything here. When the browser
 * redirects back with ?code=...&state=... we consult this singleton to:
 *
 *   1. Validate that the returned `state` matches the one we issued
 *      (CSRF defense).
 *   2. Retrieve the verifier to send to the exchange endpoint.
 *   3. Retrieve the redirectUri to confirm the callback came from the
 *      expected origin.
 *
 * The state MUST be cleared on success, failure, user cancel, or app quit.
 * There is at most one in-flight handoff at a time — a new login attempt
 * overwrites any previous pending state.
 *
 * TTL: 5 minutes from `set`. Expired state is treated as missing (so a
 * late callback from a long-abandoned login attempt is rejected).
 *
 * Lives in main process memory only; never persisted, never logged in
 * plaintext (the verifier is a secret-equivalent until the code is
 * redeemed).
 */

/** Shape of a pending desktop auth handoff. */
export type PendingDesktopAuth = {
  /** PKCE verifier the desktop generated. Secret until exchange. */
  readonly codeVerifier: string;
  /** PKCE challenge sent to the web app. */
  readonly codeChallenge: string;
  /** Opaque CSRF token we issued. */
  readonly state: string;
  /** The loopback/custom-scheme redirectUri the desktop registered. */
  readonly redirectUri: string;
  /** Epoch ms when this pending handoff expires. */
  readonly expiresAt: number;
};

/** Maximum time a handoff may stay pending before it is considered stale. */
export const PENDING_DESKTOP_AUTH_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Internal storage. Single mutable slot — module-level state mirrors a
 * singleton without the ceremony of a class. Access goes through the
 * exported helpers so invariants (e.g. expiry check) are enforced.
 */
let pending: PendingDesktopAuth | null = null;

/**
 * Stores a new pending handoff, overwriting any previous one.
 * Call this immediately after starting the loopback server and BEFORE
 * opening the browser so the state is ready when the callback arrives.
 */
export function setPendingDesktopAuth(
  fields: Omit<PendingDesktopAuth, "expiresAt">
): void {
  pending = {
    ...fields,
    expiresAt: Date.now() + PENDING_DESKTOP_AUTH_TTL_MS,
  };
}

/**
 * Returns the current pending handoff, or null if there isn't one or it
 * has expired. Does NOT clear the slot — callers that consume the handoff
 * (success/failure paths) should call clearPendingDesktopAuth().
 */
export function getPendingDesktopAuth(): PendingDesktopAuth | null {
  if (!pending) return null;
  if (Date.now() >= pending.expiresAt) {
    // Expired — treat as absent. Don't log the verifier.
    return null;
  }
  return pending;
}

/**
 * True iff `state` matches the currently-pending handoff's state. A
 * missing or expired handoff never matches.
 */
export function isMatchingState(state: string): boolean {
  const current = getPendingDesktopAuth();
  if (!current) return false;
  // Constant-time-ish compare. State is not a long-lived secret, but
  // avoid trivial timing leaks anyway.
  if (state.length !== current.state.length) return false;
  let diff = 0;
  for (let i = 0; i < state.length; i++) {
    diff |= state.charCodeAt(i) ^ current.state.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Clears any pending handoff. Idempotent. Safe to call from success,
 * failure, cancel, or app-quit paths.
 */
export function clearPendingDesktopAuth(): void {
  pending = null;
}
