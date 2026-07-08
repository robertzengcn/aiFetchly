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
}

/**
 * Thrown by {@link TokenRefreshService.refreshAccessToken} when the refresh
 * token is genuinely missing, rejected (HTTP 401/403), or expired — the ONLY
 * situation in which signing the user out is the correct response.
 *
 * Network errors and HTTP 5xx (backend unreachable / erroring) are thrown as
 * plain `Error` instead, because the user must STAY logged in and retry. This
 * distinction is what prevents a temporary backend outage from forcing a
 * re-login.
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
 *  - HTTP 5xx server errors (thrown by `refreshAccessToken` as
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
  private _isRefreshing = false;

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
      console.warn(
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
   * refreshes it proactively. If the refresh token itself is invalid
   * or expired the timer is stopped and the user is signed out.
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
   *    If yes → call refreshAccessToken().
   * 3. Handle the refresh result:
   *    - Success → reset the failure counter.
   *    - Refresh token genuinely invalid/expired ({@link RefreshTokenInvalidError})
   *      → stop auto-refresh and sign out.
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

    // --- 3. Perform the refresh ---
    try {
      const service = new TokenRefreshService();
      const result = await service.refreshAccessToken();

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

      // Case A: the refresh token is genuinely invalid/expired/missing. This is
      // the ONLY situation where signing the user out is correct.
      if (error instanceof RefreshTokenInvalidError) {
        log.warn(
          `[TokenRefresh] Refresh token is invalid/expired (${errorMsg}), stopping auto-refresh and signing out`
        );
        TokenRefreshService.stopAutoRefresh();
        try {
          const userService = new User();
          await userService.Signout();
        } catch (signoutError) {
          log.error(
            "[TokenRefresh] Error during signout after invalid refresh token:",
            signoutError
          );
        }
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
   * Refreshes the access token using the stored refresh token
   *
   * Uses raw fetch() to avoid circular dependency with HttpClient.
   *
   * @returns Promise resolving to token refresh response with new tokens
   * @throws {RefreshTokenInvalidError} When the refresh token is missing,
   *   rejected (HTTP 401/403), or expired — callers should sign the user out.
   * @throws {Error} For transient failures (network unreachable, HTTP 5xx) —
   *   callers should keep the user logged in and retry.
   *
   * @example
   * ```typescript
   * const result = await service.refreshAccessToken();
   * ```
   */
  async refreshAccessToken(): Promise<CommonApiresp<TokenRefreshData>> {
    // Prevent concurrent refresh requests
    if (this._isRefreshing) {
      throw new Error("Token refresh already in progress");
    }

    this._isRefreshing = true;

    try {
      // Get refresh token from storage
      const refreshToken = this._tokenService.getValue(REFRESHTOKEN);

      if (!refreshToken || refreshToken.trim().length === 0) {
        throw new RefreshTokenInvalidError("Refresh token not found");
      }

      // Check if refresh token has expired before making the request
      const refreshExpiryStr = this._tokenService.getValue(REFRESHTOKENEXPIRY);
      if (refreshExpiryStr) {
        const refreshExpiry = parseInt(refreshExpiryStr, 10);
        if (!isNaN(refreshExpiry) && Date.now() >= refreshExpiry) {
          // Genuine auth failure — the caller decides whether to sign out.
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
          // Genuine auth failure — the caller decides whether to sign out.
          throw new RefreshTokenInvalidError(
            response.msg || "Invalid or expired refresh token"
          );
        } else {
          throw new Error(response.msg || "Token refresh failed");
        }
      }

      // Update stored tokens if refresh was successful
      if (response.data) {
        this._tokenService.setValue(TOKENNAME, response.data.accessToken);

        // Update access token expiry
        if (response.data.expiresIn) {
          const newExpiry = Date.now() + response.data.expiresIn * 1000;
          this._tokenService.setValue(TOKENEXPIRY, newExpiry.toString());
        }

        // Handle refresh token rotation (backend may return new refresh token)
        if (
          response.data.refreshToken &&
          response.data.refreshToken.trim().length > 0
        ) {
          this._tokenService.setValue(REFRESHTOKEN, response.data.refreshToken);
        }
      }

      return response;
    } catch (error) {
      // Re-throw with more context
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Token refresh failed: ${String(error)}`);
    } finally {
      this._isRefreshing = false;
    }
  }

  /**
   * Check if a token refresh is currently in progress
   *
   * @returns boolean indicating if refresh is in progress
   */
  isRefreshing(): boolean {
    return this._isRefreshing;
  }
}
