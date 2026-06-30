"use strict";
import { HttpClient } from "@/modules/lib/httpclient";

/**
 * Request body for POST /api/desktop-auth/exchange.
 *
 * Mirrors the backend DesktopAuthController.Exchange input shape:
 *   - clientId:       registered desktop client identifier
 *   - code:           one-time authorization code from the browser redirect
 *   - codeVerifier:   PKCE verifier; backend hashes and compares against
 *                     the stored codeChallenge (S256)
 *   - redirectUri:    the loopback/custom-scheme URI the code was issued to;
 *                     backend re-checks it against the stored value
 *   - deviceName:     human-readable device name for audit logging
 *   - deviceIdHash:   stable device fingerprint hash
 */
export interface ExchangeRequest {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  deviceName: string;
  deviceIdHash: string;
}

/**
 * User object returned by the exchange endpoint. Mirrors the backend's
 * GraphQL User type subset that the controller emits.
 */
export interface ExchangeUser {
  id: string | number;
  firstName?: string;
  lastName?: string;
  email: string;
  emailVerified?: boolean;
  languagePreference?: string;
  created?: string;
  updated?: string;
}

/**
 * Success response from POST /api/desktop-auth/exchange.
 *
 * Tokens travel ONLY in this HTTPS response body — never in a URL.
 */
export interface ExchangeSuccessResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn?: number;
  user: ExchangeUser;
}

/**
 * Error response shape from the exchange endpoint. The backend returns a
 * generic `{ "error": "invalid_grant" }` for ALL failure paths (unknown
 * code, already-used code, wrong verifier, wrong redirect, wrong client,
 * expired) so attackers cannot probe which check failed.
 */
export interface ExchangeErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Typed outcome of exchangeDesktopAuthorizationCode.
 *
 * `ok: true` carries the tokens. `ok: false` carries a categorized reason
 * the caller can map to user-facing messaging. Token values never appear
 * in the error branch.
 */
export type ExchangeResult =
  | { ok: true; data: ExchangeSuccessResponse }
  | {
      ok: false;
      reason:
        | "invalid_grant"
        | "network"
        | "server"
        | "bad_response";
      message?: string;
    };

/**
 * API client for redeeming a desktop authorization code for tokens.
 *
 * This is the desktop-side counterpart to the web's
 * createDesktopAuthorizationCode mutation. The web mints the code; the
 * desktop redeems it here.
 *
 * Never logs tokens. Never constructs URLs containing tokens.
 */
export class DesktopAuthApi {
  private _httpClient: HttpClient;

  constructor() {
    this._httpClient = new HttpClient();
  }

  /**
   * POST /api/desktop-auth/exchange
   *
   * Sends {clientId, code, codeVerifier, redirectUri, deviceName,
   * deviceIdHash} and receives {accessToken, refreshToken, expiresIn,
   * refreshExpiresIn, user} on success.
   *
   * All failure modes (bad code, replay, wrong verifier, wrong redirect,
   * wrong client, expired) collapse to `reason: "invalid_grant"` so
   * callers can't distinguish them either.
   *
   * @returns ExchangeResult — always check `.ok` before reading `.data`.
   */
  async exchangeDesktopAuthorizationCode(
    request: ExchangeRequest
  ): Promise<ExchangeResult> {
    if (!request.clientId) {
      return { ok: false, reason: "invalid_grant", message: "missing clientId" };
    }
    if (!request.code) {
      return { ok: false, reason: "invalid_grant", message: "missing code" };
    }
    if (!request.codeVerifier) {
      return {
        ok: false,
        reason: "invalid_grant",
        message: "missing codeVerifier",
      };
    }
    if (!request.redirectUri) {
      return {
        ok: false,
        reason: "invalid_grant",
        message: "missing redirectUri",
      };
    }

    let response: unknown;
    try {
      response = await this._httpClient.postJson<
        ExchangeSuccessResponse | ExchangeErrorResponse
      >("/api/desktop-auth/exchange", request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // fetch network failure / DNS / CORS / offline
      return { ok: false, reason: "network", message };
    }

    // The exchange endpoint is public (no Bearer token), so HttpClient's
    // 403-refresh path does not trigger. Any non-success is a server error
    // or an `invalid_grant`. We treat both as failure but categorize.
    const shape = response as Partial<ExchangeSuccessResponse> &
      Partial<ExchangeErrorResponse> & { status?: boolean; msg?: string };

    // HttpClient wraps most responses; tolerate both wrapped and unwrapped.
    // The controller writes JSON directly, so we expect unwrapped fields.
    if (
      shape &&
      typeof shape.accessToken === "string" &&
      typeof shape.refreshToken === "string" &&
      typeof shape.expiresIn === "number"
    ) {
      return { ok: true, data: shape as ExchangeSuccessResponse };
    }

    if (shape && typeof shape.error === "string") {
      return {
        ok: false,
        reason: "invalid_grant",
        message: shape.error_description || shape.error,
      };
    }

    // Wrapped CommonApiresp-style {status, msg, data}
    if (shape && typeof shape.status === "boolean" && !shape.status) {
      return {
        ok: false,
        reason: "server",
        message: shape.msg || "exchange rejected",
      };
    }

    return {
      ok: false,
      reason: "bad_response",
      message: "unexpected response shape from exchange endpoint",
    };
  }
}
