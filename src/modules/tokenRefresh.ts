"use strict";
// NOTE: This service intentionally does NOT import HttpClient to avoid circular dependency.
// HttpClient uses TokenRefreshService for token refresh, so TokenRefreshService uses raw fetch() instead.
import { Token } from "@/modules/token";
import {
  TOKENNAME,
  REFRESHTOKEN,
  TOKENEXPIRY,
  REFRESHTOKENEXPIRY,
} from "@/config/usersetting";
import { User } from "@/modules/user";
import { CommonApiresp } from "@/entityTypes/commonType";
import { log } from "@/modules/Logger";
import { resolveViteLoginBase } from "@/config/viteLoginUrl";

/**
 * Token refresh response data interface
 */
export interface TokenRefreshData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn?: number;
}

/**
 * Thrown by {@link TokenRefreshService._performRefreshNetwork} when the refresh
 * token is genuinely missing, rejected (HTTP 401/403), or expired.
 *
 * Network errors and HTTP 5xx (backend unreachable / erroring) are thrown as
 * plain `Error` instead. Callers must not clear local auth state for refresh
 * failures, because backend/proxy/network instability can look like auth
 * failure and the user can still use local app functionality.
 */
export class RefreshTokenInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshTokenInvalidError";
  }
}

/**
 * Returns `true` when a refresh failure is caused by the backend being
 * unreachable or misbehaving — a transient condition that must NOT log the
 * user out.
 *
 * Covers:
 *  - Node `fetch` network failures (`TypeError: fetch failed`, optionally with
 *    a system-error `cause` such as ECONNREFUSED / ETIMEDOUT / EAI_AGAIN).
 *  - HTTP 5xx server errors (thrown by `_performRefreshNetwork` as
 *    `HTTP error: <status> ...`).
 */
export function isTransientBackendError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);

  // Node's undici fetch throws `TypeError: fetch failed` for any network issue.
  if (msg.includes("fetch failed")) {
    return true;
  }

  // HTTP 5xx surfaced as "HTTP error: 5xx ...".
  if (/HTTP error:\s*5\d\d/.test(msg)) {
    return true;
  }

  // Belt-and-suspenders: inspect the undici `cause` for system-level errors.
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeMsg = cause instanceof Error ? cause.message : "";
  if (
    /ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|socket hang up|UND_ERR|network/i.test(
      causeMsg
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Service for refreshing access tokens using refresh tokens.
 *
 * Supports both on-demand refresh (called by HttpClient on 401) and
 * automatic background refresh that proactively refreshes tokens before
 * they expire.
 *
 * Uses a singleton pattern for the background scheduler so only one
 * timer is ever running across the application.
 *
 * NOTE: This service uses raw fetch() instead of HttpClient to avoid circular dependency.
 * HttpClient depends on TokenRefreshService for automatic token refresh.
 *
 * @example
 * ```typescript
 * // On-demand usage
 * const service = new TokenRefreshService();
 * const result = await service.refreshAccessToken();
 *
 * // Background auto-refresh (call once after login)
 * TokenRefreshService.startAutoRefresh();
 *
 * // Stop on signout
 * TokenRefreshService.stopAutoRefresh();
 * ```
 */
export class TokenRefreshService {
  private _baseUrl: string;
  private _tokenService: Token;

  // --- Process-wide refresh serialization ---
  /**
   * A single in-flight refresh promise shared across ALL callers in the process.
   *
   * Why: refresh-token rotation makes concurrent refresh requests unsafe —
   * the backend revokes the old refresh token on the winner, and the loser's
   * request (still carrying the now-revoked token) fails with "invalid refresh
   * token", which historically forced a sign-out. Serializing at the process
   * level guarantees only one network refresh is ever in flight.
   */
  private static _inFlight: Promise<CommonApiresp<TokenRefreshData>> | null =
    null;

  // --- Singleton background auto-refresh state ---
  private static _autoRefreshTimer: ReturnType<typeof setInterval> | null =
    null;
  private static _isAutoRefreshRunning = false;
  /** How often (ms) the background check runs. Default: 60 seconds */
  private static readonly CHECK_INTERVAL_MS = 60 * 1000;
  /** Refresh the access token when it expires within this window. Default: 5 minutes */
  private static readonly REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
  /** Maximum consecutive failures before stopping auto-refresh */
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;
  private static _consecutiveFailures = 0;

  constructor() {
    const resolved = resolveViteLoginBase();
    let loginUrl: string | undefined = resolved?.value;

    // Validate and ensure we have a valid URL
    if (!loginUrl || loginUrl.trim() === "") {
      loginUrl = "http://localhost:3000";
    }

    // Validate URL format
    try {
      new URL(loginUrl);
    } catch (error) {
      log.warn(
        `Invalid VITE_LOGIN_URL: ${loginUrl}, falling back to default`
      );
      loginUrl = "http://localhost:3000";
    }

    this._baseUrl = loginUrl + "/apis";
    this._tokenService = new Token();
  }

  // =========================================================================
  // Background Auto-Refresh (static / singleton)
  // =========================================================================

  /**
   * Start the background auto-refresh timer.
   *
   * Periodically checks if the access token is about to expire and
   * refreshes it proactively. If the refresh endpoint rejects the token, the
   * timer is stopped but local auth state is kept so local app functions remain
   * available.
   *
   * Safe to call multiple times – subsequent calls are no-ops if the
   * timer is already running.
   */
  static startAutoRefresh(): void {
    if (TokenRefreshService._isAutoRefreshRunning) {
      log.info(
        "[TokenRefresh] Auto-refresh is already running, skipping start"
      );
      return;
    }

    log.info("[TokenRefresh] Starting background auto-refresh");
    TokenRefreshService._consecutiveFailures = 0;
    TokenRefreshService._isAutoRefreshRunning = true;

    // Run the first check immediately (non-blocking)
    TokenRefreshService.performAutoRefreshCheck().catch((err) => {
      log.error("[TokenRefresh] Initial auto-refresh check failed:", err);
    });

    // Schedule periodic checks
    TokenRefreshService._autoRefreshTimer = setInterval(() => {
      TokenRefreshService.performAutoRefreshCheck().catch((err) => {
        log.error("[TokenRefresh] Periodic auto-refresh check failed:", err);
      });
    }, TokenRefreshService.CHECK_INTERVAL_MS);
  }

  /**
   * Stop the background auto-refresh timer.
   *
   * Should be called on user sign-out or when the app is shutting down.
   */
  static stopAutoRefresh(): void {
    if (TokenRefreshService._autoRefreshTimer) {
      clearInterval(TokenRefreshService._autoRefreshTimer);
      TokenRefreshService._autoRefreshTimer = null;
    }
    TokenRefreshService._isAutoRefreshRunning = false;
    TokenRefreshService._consecutiveFailures = 0;
    log.info("[TokenRefresh] Background auto-refresh stopped");
  }

  /**
   * Check whether the background auto-refresh timer is running.
   */
  static isAutoRefreshRunning(): boolean {
    return TokenRefreshService._isAutoRefreshRunning;
  }

  /**
   * Core logic for one auto-refresh cycle.
   *
   * 1. Check if the refresh token is still valid (not expired).
   *    If expired → stop auto-refresh and sign out.
   * 2. Check if the access token is about to expire.
   *    If yes → call refreshOnce().
   * 3. Handle the refresh result:
   *    - Success → reset the failure counter.
   *    - Refresh endpoint rejects the token ({@link RefreshTokenInvalidError})
   *      → stop auto-refresh, but keep local auth state.
   *    - Backend unreachable / HTTP 5xx (transient, {@link isTransientBackendError})
   *      → KEEP the user logged in and keep the timer running so it retries on
   *      the next cycle. A temporary backend outage must NOT force a re-login.
   *    - Any other unexpected error → count toward MAX_CONSECUTIVE_FAILURES;
   *      after the threshold the timer is stopped (but the user is NOT signed
   *      out, since persistent failures are most likely backend issues).
   *
   * Exposed as public (rather than private) so it can be invoked directly in
   * tests without relying on the 60s background timer.
   */
  static async performAutoRefreshCheck(): Promise<void> {
    const tokenService = new Token();
    const now = Date.now();

    // --- 1. Check refresh token validity ---
    const refreshToken = tokenService.getValue(REFRESHTOKEN);
    if (!refreshToken || refreshToken.trim().length === 0) {
      log.warn("[TokenRefresh] No refresh token found, stopping auto-refresh");
      TokenRefreshService.stopAutoRefresh();
      return;
    }

    const refreshExpiryStr = tokenService.getValue(REFRESHTOKENEXPIRY);
    if (refreshExpiryStr) {
      const refreshExpiry = parseInt(refreshExpiryStr, 10);
      if (!isNaN(refreshExpiry) && now >= refreshExpiry) {
        log.warn(
          "[TokenRefresh] Refresh token has expired, stopping auto-refresh and signing out"
        );
        TokenRefreshService.stopAutoRefresh();

        // Sign out user because the refresh token is no longer valid
        try {
          const userService = new User();
          await userService.Signout();
        } catch (signoutError) {
          log.error(
            "[TokenRefresh] Error during signout after refresh token expiry:",
            signoutError
          );
        }
        return;
      }
    }

    // --- 2. Check if access token needs refreshing ---
    const accessToken = tokenService.getValue(TOKENNAME);
    if (!accessToken || accessToken.trim().length === 0) {
      // No access token at all – try to get one
      log.info("[TokenRefresh] No access token found, attempting refresh");
    } else {
      const tokenExpiryStr = tokenService.getValue(TOKENEXPIRY);
      if (tokenExpiryStr) {
        const tokenExpiry = parseInt(tokenExpiryStr, 10);
        if (!isNaN(tokenExpiry)) {
          const timeUntilExpiry = tokenExpiry - now;
          if (timeUntilExpiry > TokenRefreshService.REFRESH_BEFORE_EXPIRY_MS) {
            // Token is still valid with enough margin – nothing to do
            return;
          }
          log.info(
            `[TokenRefresh] Access token expires in ${Math.round(
              timeUntilExpiry / 1000
            )}s, refreshing now`
          );
        }
      }
      // If no expiry stored, refresh proactively to be safe
    }

    // --- 3. Perform the refresh (process-wide serialized) ---
    try {
      const result = await TokenRefreshService.refreshOnce();

      if (result.status && result.data) {
        // Update the stored expiry time based on the new expiresIn value
        if (result.data.expiresIn) {
          const newExpiry = Date.now() + result.data.expiresIn * 1000;
          tokenService.setValue(TOKENEXPIRY, newExpiry.toString());
        }
        log.info("[TokenRefresh] Background token refresh successful");
        TokenRefreshService._consecutiveFailures = 0;
      } else {
        throw new Error(result.msg || "Refresh returned unsuccessful status");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Case A: the refresh endpoint rejected the token. Do NOT sign out here:
      // staging/proxy/backend issues can return auth-shaped failures, and the
      // user can still use local app functionality while remote calls retry later.
      if (error instanceof RefreshTokenInvalidError) {
        log.warn(
          `[TokenRefresh] Refresh token refresh failed (${errorMsg}); stopping auto-refresh and keeping local session`
        );
        TokenRefreshService.stopAutoRefresh();
        return;
      }

      // Case B: the backend is unreachable or erroring (network down, DNS,
      // timeout, HTTP 5xx). Keep the user logged in and keep the timer running
      // so the next cycle retries automatically once the backend is reachable.
      // Do NOT increment the failure counter and do NOT sign out.
      if (isTransientBackendError(error)) {
        log.warn(
          `[TokenRefresh] Backend unreachable (${errorMsg}). User remains logged in; will retry next cycle.`
        );
        return;
      }

      // Case C: any other unexpected failure. Count toward the threshold; once
      // it is reached, stop the timer to avoid hammering the server. The user
      // is intentionally NOT signed out — persistent failures are far more
      // likely to be backend issues than invalid credentials, and only an
      // explicit auth error (Case A) should end the session.
      TokenRefreshService._consecutiveFailures++;
      log.error(
        `[TokenRefresh] Background refresh failed (${TokenRefreshService._consecutiveFailures}/${TokenRefreshService.MAX_CONSECUTIVE_FAILURES}):`,
        errorMsg
      );

      if (
        TokenRefreshService._consecutiveFailures >=
        TokenRefreshService.MAX_CONSECUTIVE_FAILURES
      ) {
        log.error(
          "[TokenRefresh] Max consecutive failures reached, stopping auto-refresh. User remains logged in."
        );
        TokenRefreshService.stopAutoRefresh();
      }
    }
  }

  // =========================================================================
  // On-demand Refresh (instance methods, used by HttpClient)
  // =========================================================================

  /**
   * Process-wide entrypoint for refreshing the access token.
   *
   * All callers (background timer, every HttpClient instance) MUST go through
   * this method so that only one refresh network request is ever in flight at
   * a time. This is critical because the backend rotates the refresh token and
   * revokes the old one — concurrent refreshes race the rotation and one of
   * them will see its (now-revoked) token rejected, which historically caused
   * spurious forced sign-outs.
   *
   * If a refresh is already in flight, returns the same promise (callers wait
   * for it to settle and then retry their original request).
   *
   * @returns Promise resolving to token refresh response with new tokens
   * @throws {RefreshTokenInvalidError} When the refresh token is missing,
   *   rejected (HTTP 401/403), or expired. Callers should keep local auth state
   *   and fail only the current remote request.
   * @throws {Error} For transient failures (network unreachable, HTTP 5xx) —
   *   callers should keep the user logged in and retry.
   */
  static refreshOnce(): Promise<CommonApiresp<TokenRefreshData>> {
    if (TokenRefreshService._inFlight) {
      return TokenRefreshService._inFlight;
    }
    const instance = new TokenRefreshService();
    const p = instance._performRefreshNetwork();
    TokenRefreshService._inFlight = p;
    // Clear the slot once the refresh settles so the next refresh can run.
    // Only clear when this promise is still the active slot — otherwise a
    // stale settlement (e.g. after tests reset _inFlight, or a superseded
    // caller) would wipe a newer in-flight refresh.
    p.then(
      () => {
        if (TokenRefreshService._inFlight === p) {
          TokenRefreshService._inFlight = null;
        }
      },
      () => {
        if (TokenRefreshService._inFlight === p) {
          TokenRefreshService._inFlight = null;
        }
      }
    );
    return p;
  }

  /**
   * Check whether a refresh is currently in flight process-wide.
   */
  static isRefreshInFlight(): boolean {
    return TokenRefreshService._inFlight !== null;
  }

  /**
   * Refreshes the access token using the stored refresh token.
   *
   * Delegates to the process-wide {@link TokenRefreshService.refreshOnce} so
   * concurrent callers are serialized. Kept for backward compatibility.
   *
   * @returns Promise resolving to token refresh response with new tokens
   * @throws {RefreshTokenInvalidError} When the refresh token is missing,
   *   rejected (HTTP 401/403), or expired. Callers should keep local auth state
   *   and fail only the current remote request.
   * @throws {Error} For transient failures (network unreachable, HTTP 5xx) —
   *   callers should keep the user logged in and retry.
   *
   * @example
   * ```typescript
   * const result = await service.refreshAccessToken();
   * ```
   */
  async refreshAccessToken(): Promise<CommonApiresp<TokenRefreshData>> {
    return TokenRefreshService.refreshOnce();
  }

  /**
   * Internal network refresh. Only invoked via {@link TokenRefreshService.refreshOnce}
   * so exactly one of these runs at a time per process.
   *
   * Uses raw fetch() to avoid circular dependency with HttpClient.
   *
   * Throws {@link RefreshTokenInvalidError} for auth-shaped refresh failures
   * (missing / expired / rejected refresh token). Network and HTTP 5xx failures
   * throw a plain `Error`. Both paths preserve local auth state; callers only
   * fail the current remote request.
   */
  private async _performRefreshNetwork(): Promise<
    CommonApiresp<TokenRefreshData>
  > {
    const tokenService = this._tokenService;
    // Get refresh token from storage
    const refreshToken = tokenService.getValue(REFRESHTOKEN);

    if (!refreshToken || refreshToken.trim().length === 0) {
      throw new RefreshTokenInvalidError("Refresh token not found");
    }

    // Check if refresh token has expired before making the request
    const refreshExpiryStr = tokenService.getValue(REFRESHTOKENEXPIRY);
    if (refreshExpiryStr) {
      const refreshExpiry = parseInt(refreshExpiryStr, 10);
      if (!isNaN(refreshExpiry) && Date.now() >= refreshExpiry) {
        // Local expiry is definitive; callers decide the user-facing behavior.
        throw new RefreshTokenInvalidError("Refresh token has expired");
      }
    }

    // Call refresh API endpoint using raw fetch (to avoid circular dependency with HttpClient)
    const requestBody = {
      refreshToken: refreshToken.trim(),
    };

    const res = await fetch(this._baseUrl + "/api/auth/refresh", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      // 401/403 means the refresh token was rejected — a genuine auth
      // failure. Everything else (5xx, etc.) stays a plain Error so callers
      // can treat it as a transient/backend issue.
      if (res.status === 401 || res.status === 403) {
        throw new RefreshTokenInvalidError(
          `Refresh token rejected (HTTP ${res.status})`
        );
      }
      throw new Error(`HTTP error: ${res.status} ${res.statusText}`);
    }

    const response: CommonApiresp<TokenRefreshData> = await res.json();

    // Handle API response errors
    if (!response.status) {
      // Check for specific error codes
      if (response.code === 401) {
        // Auth-shaped refresh failure. Callers keep local auth state and fail
        // only the current remote request.
        throw new RefreshTokenInvalidError(
          response.msg || "Invalid or expired refresh token"
        );
      } else {
        throw new Error(response.msg || "Token refresh failed");
      }
    }

    // Update stored tokens if refresh was successful
    if (response.data) {
      tokenService.setValue(TOKENNAME, response.data.accessToken);

      // Update access token expiry
      if (response.data.expiresIn) {
        const newExpiry = Date.now() + response.data.expiresIn * 1000;
        tokenService.setValue(TOKENEXPIRY, newExpiry.toString());
      }

      // Handle refresh token rotation (backend may return new refresh token)
      if (
        response.data.refreshToken &&
        response.data.refreshToken.trim().length > 0
      ) {
        tokenService.setValue(REFRESHTOKEN, response.data.refreshToken);
      }

      if (
        typeof response.data.refreshExpiresIn === "number" &&
        !Number.isNaN(response.data.refreshExpiresIn) &&
        response.data.refreshExpiresIn > 0
      ) {
        const newRefreshExpiry =
          Date.now() + response.data.refreshExpiresIn * 1000;
        tokenService.setValue(REFRESHTOKENEXPIRY, newRefreshExpiry.toString());
      }
    }

    return response;
  }
}
