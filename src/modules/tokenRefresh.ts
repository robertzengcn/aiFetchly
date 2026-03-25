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

/**
 * Token refresh response data interface
 */
export interface TokenRefreshData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
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
  private _userService: User;
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
    // Use process.env for environment variables in Electron main process
    // NOTE: Removed import.meta.env check - Vite statically replaces import.meta.env.VITE_*
    // at build time which causes Invalid URL errors in Electron main process.
    // process.env is loaded correctly via Vite's loadEnv() in vite.main.config.mjs
    let loginUrl: string | undefined = process.env.VITE_LOGIN_URL;

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
    this._userService = new User();
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
   * 3. Track consecutive failures. After MAX_CONSECUTIVE_FAILURES
   *    the timer is stopped to avoid hammering the server.
   */
  private static async performAutoRefreshCheck(): Promise<void> {
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
      TokenRefreshService._consecutiveFailures++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(
        `[TokenRefresh] Background refresh failed (${TokenRefreshService._consecutiveFailures}/${TokenRefreshService.MAX_CONSECUTIVE_FAILURES}):`,
        errorMsg
      );

      // If the error indicates an invalid/expired refresh token, stop immediately
      if (
        errorMsg.includes("Invalid or expired refresh token") ||
        errorMsg.includes("Refresh token not found")
      ) {
        log.warn(
          "[TokenRefresh] Refresh token is invalid, stopping auto-refresh"
        );
        TokenRefreshService.stopAutoRefresh();
        return;
      }

      // Stop after too many consecutive failures
      if (
        TokenRefreshService._consecutiveFailures >=
        TokenRefreshService.MAX_CONSECUTIVE_FAILURES
      ) {
        log.error(
          "[TokenRefresh] Max consecutive failures reached, stopping auto-refresh"
        );
        TokenRefreshService.stopAutoRefresh();

        // Sign out user as the session is likely invalid
        try {
          const userService = new User();
          await userService.Signout();
        } catch (signoutError) {
          log.error(
            "[TokenRefresh] Error during signout after max failures:",
            signoutError
          );
        }
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
   * @throws {Error} When refresh token is missing, invalid, or expired
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
        throw new Error("Refresh token not found");
      }

      // Check if refresh token has expired before making the request
      const refreshExpiryStr = this._tokenService.getValue(REFRESHTOKENEXPIRY);
      if (refreshExpiryStr) {
        const refreshExpiry = parseInt(refreshExpiryStr, 10);
        if (!isNaN(refreshExpiry) && Date.now() >= refreshExpiry) {
          // Stop auto-refresh if running
          TokenRefreshService.stopAutoRefresh();

          // Sign out user
          try {
            await this._userService.Signout();
          } catch (signoutError) {
            console.error("Error during signout:", signoutError);
          }

          throw new Error("Refresh token has expired");
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
        throw new Error(`HTTP error: ${res.status} ${res.statusText}`);
      }

      const response: CommonApiresp<TokenRefreshData> = await res.json();

      // Handle API response errors
      if (!response.status) {
        // Check for specific error codes
        if (response.code === 401) {
          const errorMsg = response.msg || "Invalid or expired refresh token";

          // Stop auto-refresh if running
          TokenRefreshService.stopAutoRefresh();

          // Sign out user on authentication failure
          try {
            await this._userService.Signout();
          } catch (signoutError) {
            console.error("Error during signout:", signoutError);
          }

          throw new Error(errorMsg);
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
