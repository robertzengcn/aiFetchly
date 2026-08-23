export type HttpClientOptions = {
  headers?: HeadersInit;
};
// export type FetchOptions = {
//     headers?: HeadersInit;
// }
//import { AuthInterceptor } from '@/modules/lib/authInterceptor';
import type FormDataLib from "form-data";
import { TOKENNAME, REFRESHTOKEN } from "@/config/usersetting";
import { RefreshTokenInvalidError } from "@/modules/tokenRefresh";
import { resolveViteLoginBase } from "@/config/viteLoginUrl";
import { assertFirstPartyHubUrl } from "@/config/pluginHubUrl";
import { userSecretKeyService } from "@/modules/fieldCipher";
import { log } from "@/modules/Logger";
import {
  HttpResponseError,
  MAX_RESPONSE_BODY_BYTES,
  MAX_RETRY_AFTER_MS,
} from "@/modules/lib/httpResponseError";

/**
 * Decide whether a refresh failure is auth-shaped versus a transient/network
 * failure. Both paths keep local auth state; auth-shaped failures only stop
 * the current remote request so local app features remain available.
 *
 * Matches case-insensitively because the backend returns lowercase messages
 * (e.g. "invalid or expired refresh token") and the prior capital-I match let
 * this branch silently never fire.
 */
export function isRefreshTokenInvalidError(error: unknown): boolean {
  if (error instanceof RefreshTokenInvalidError) {
    return true;
  }
  const msg = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    (error instanceof Error && error.name === "RefreshTokenInvalidError") ||
    msg.includes("invalid or expired refresh token") ||
    msg.includes("refresh token not found") ||
    msg.includes("refresh token has expired") ||
    msg.includes("refresh token is invalid") ||
    msg.includes("refresh token rejected") ||
    msg.includes("http error: 401")
  );
}

// export type RemoteResp = {
//   status: boolean,
//   msg: string,
//   data?: any,
// }
export class HttpClient {
  private _headers: Record<string, string> = {};
  private baseUrl: string;
  private _isWorker = false;
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
      log.warn(`Invalid VITE_LOGIN_URL: ${loginUrl}, falling back to default`);
      loginUrl = "http://localhost:3000";
    }

    this.baseUrl = loginUrl + "/apis";

    // Worker processes don't have access to Electron APIs (app, safeStorage, etc.)
    // so Token/ElectronStoreService cannot be instantiated. Instead, use the
    // auth token passed via WORKER_AUTH_TOKEN env var from the main process.
    this._isWorker = !!process.env.WORKER_TYPE;
    if (this._isWorker) {
      const workerToken = process.env.WORKER_AUTH_TOKEN;
      if (workerToken && workerToken.trim().length > 0) {
        this.setHeader("Authorization", "Bearer " + workerToken);
      }
    } else {
      void this.setheaderToken();
    }
    // const tokenModel=new Token()
    // const tokenval=tokenModel.getValue("social-market-token")
    // if (tokenval) {
    //   //config.headers.Authorization = 'Bearer ' + tokenval
    //   this.setHeader('Authorization', 'Bearer ' + tokenval)
    // }
  }

  public async setheaderToken(): Promise<void> {
    const { Token } = await import("@/modules/token");
    const tokenModel = new Token();
    const tokenval = tokenModel.getValue(TOKENNAME);
    //log.info("prepare to set token:"+tokenval)
    if (tokenval) {
      //config.headers.Authorization = 'Bearer ' + tokenval
      this.setHeader("Authorization", "Bearer " + tokenval);
    }
  }

  /**
   * Refresh token and retry the original request.
   *
   * Concurrency safety: delegates to {@link TokenRefreshService.refreshOnce},
   * which serializes all refresh attempts process-wide. Concurrent callers
   * (background timer + any HttpClient that hit 401/403) all await the same
   * in-flight refresh promise, so the backend's refresh-token rotation never
   * races.
   *
   * Sign-out policy: refresh failures never clear local auth state. The current
   * remote request fails, and later requests can retry refresh when the backend
   * or network recovers.
   *
   * Prevents infinite refresh loops by checking the isRetry flag.
   */
  private async _refreshTokenAndRetry(
    endpoint: string,
    options: RequestInit,
    isRetry = false,
    absolute = false
  ): Promise<unknown> {
    // Worker processes cannot refresh tokens (no access to Electron APIs)
    if (this._isWorker) {
      throw new Error(
        "Authentication failed: Token expired. Worker cannot refresh tokens."
      );
    }

    // Prevent infinite refresh loops: if we already retried once and the
    // retried request still hit 401/403, refresh did not help. Fail this
    // request but keep local auth state for offline/local features.
    if (isRetry) {
      log.warn("Token refresh retry still failed; keeping local session");
      throw new Error(
        "Authentication failed after token refresh retry (HTTP 401/403)."
      );
    }

    try {
      // refreshOnce() is the process-wide entrypoint. If another caller
      // (background timer or another HttpClient) is already refreshing,
      // this returns the same promise — no concurrent rotation race.
      const { TokenRefreshService } = await import("@/modules/tokenRefresh");
      const refreshResult = await TokenRefreshService.refreshOnce();

      if (refreshResult.status && refreshResult.data) {
        // Update access token in headers
        this.setHeader(
          "Authorization",
          "Bearer " + refreshResult.data.accessToken
        );

        // The new session may have a different secret key; drop the cached one.
        userSecretKeyService.invalidate();

        // Retry the original request with new token. Mark isRetry=true so a
        // second 401/403 is treated as "refresh didn't help" rather than
        // looping forever (B4 fix).
        return this._fetchJSON(endpoint, options, true, absolute);
      } else {
        throw new Error("Token refresh failed");
      }
    } catch (error) {
      log.error("Token refresh error:", error);

      // Do not sign out on refresh failure. Auth-shaped failures can be caused
      // by backend/proxy instability; keep local session state and fail only
      // this remote request.
      if (isRefreshTokenInvalidError(error)) {
        throw error;
      }

      // Transient failure: surface the original error so callers can react.
      // The next request will naturally retry the refresh.
      throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async _fetchJSON(
    endpoint: string,
    options: RequestInit,
    isRetry = false,
    absolute = false
  ): Promise<unknown> {
    // await this.setheaderToken()
    // `absolute` = first-party full URL (Plugin Hub): used as-is instead of
    // baseUrl + endpoint. Only reachable via getFirstParty(), which enforces
    // the hub-origin allowlist, so the Bearer token never leaves first-party.
    const target = absolute ? endpoint : this.baseUrl + endpoint;
    const res = await fetch(target, {
      ...options,
      headers: this._headers,
    });

    // Handle 401 Unauthorized and 403 Forbidden - Token might be expired.
    // The backend returns 401 when an access/refresh token is invalid or
    // expired (marketing/controllers/auth_controller.go), so we must treat
    // 401 the same as 403 here — otherwise a genuinely expired access token
    // forces a re-login instead of a transparent refresh (B5 fix).
    if (res.status === 401 || res.status === 403) {
      log.warn(`Received ${res.status} - Attempting token refresh`);
      const { Token } = await import("@/modules/token");
      const tokenModel = new Token();
      const refreshToken = tokenModel.getValue(REFRESHTOKEN);

      // Prevent refresh-on-403 recursion during signout.
      // If the signout endpoint itself is protected and returns 403,
      // attempting token refresh will lead to another signout attempt -> loop.
      if (endpoint === "/api/user/signout") {
        delete this._headers["Authorization"];
        throw new Error(
          "Authentication failed: token expired while signing out"
        );
      }

      // Worker processes cannot refresh tokens or access ElectronStoreService
      if (this._isWorker) {
        throw new Error(
          "Authentication failed: Token expired. Worker cannot refresh tokens."
        );
      }

      // Check if refresh token exists
      // (tokenModel/refreshToken loaded for debug logging above)
      log.info(
        "[HttpClient] Refresh token check:",
        refreshToken ? `found (length=${refreshToken.length})` : "missing",
        "| endpoint:",
        endpoint
      );

      if (refreshToken && refreshToken.trim().length > 0) {
        // Try to refresh token and retry request
        return this._refreshTokenAndRetry(endpoint, options, isRetry, absolute);
      } else {
        // No refresh token available. Fail this request but keep local auth
        // state so local features remain usable.
        log.warn(
          "[HttpClient] No refresh token available; keeping local session"
        );
        throw new Error(
          `Authentication failed: refresh token unavailable (HTTP ${res.status}).`
        );
      }
    }

    if (!res.ok) throw await this._buildHttpResponseError(res);

    //   if (options.parseResponse !== false && res.status !== 204)
    //     return res.json();
    const data = await res.json();
    //log.info(data)
    return data;
  }

  /**
   * Build a typed {@link HttpResponseError} from a non-success `fetch`
   * response. Reads at most {@link MAX_RESPONSE_BODY_BYTES} of the body,
   * parses `error.code` only when the body is valid JSON, and parses
   * `Retry-After` with an upper bound. The body is retained on the error for
   * callers that need it but is **never logged here** — provider messages can
   * contain request fragments or sensitive data. Authentication (401/403) is
   * handled separately by the refresh path before this is reached.
   */
  private async _buildHttpResponseError(
    res: Response
  ): Promise<HttpResponseError> {
    const status = res.status;
    const statusText = res.statusText ?? "";

    // Read at most MAX_RESPONSE_BODY_BYTES of the body as text. `fetch`
    // Response bodies are stream-backed; clone first so any downstream
    // consumer (and the success path) is unaffected. Use text() then bound.
    let bodyText = "";
    try {
      const raw = await res.text();
      bodyText =
        typeof raw === "string"
          ? raw.length > MAX_RESPONSE_BODY_BYTES
            ? raw.slice(0, MAX_RESPONSE_BODY_BYTES)
            : raw
          : "";
    } catch {
      // Body could not be read (e.g. already consumed, stream error). Do not
      // throw — the original failure must still surface as a typed error.
      bodyText = "";
    }

    // Parse a machine-readable server code only when the body is valid JSON
    // and exposes `error.code` as a string. Malformed JSON or a missing field
    // is ignored; the status code alone still classifies the failure.
    let serverCode: string | undefined;
    if (bodyText.length > 0) {
      try {
        const parsed = JSON.parse(bodyText) as { error?: unknown };
        const code = (parsed as { error?: { code?: unknown } }).error?.code;
        if (typeof code === "string" && code.length > 0) {
          serverCode = code;
        }
      } catch {
        // Not JSON — serverCode remains undefined.
      }
    }

    // Parse Retry-After (seconds or HTTP-date) into ms, capped at the upper
    // bound. Only the delta-seconds form is supported deterministically; an
    // HTTP-date form is ignored (serverClock skew makes it unreliable).
    let retryAfterMs: number | undefined;
    const retryAfterRaw = res.headers?.get?.("retry-after") ?? null;
    if (retryAfterRaw) {
      const seconds = Number(retryAfterRaw);
      if (Number.isFinite(seconds) && seconds >= 0) {
        retryAfterMs = Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
      }
    }

    return new HttpResponseError(
      statusText || `HTTP ${status}`,
      status,
      bodyText,
      retryAfterMs,
      serverCode
    );
  }

  setHeader(key: string, value: string) {
    this._headers[key] = value;
    return this;
  }

  getHeader(key: string): string | undefined {
    return this._headers[key];
  }

  setBasicAuth(username: string, password: string) {
    this._headers["Authorization"] = `Basic ${btoa(`${username}:${password}`)}`;
    return this;
  }

  setBearerAuth(token: string) {
    this._headers["Authorization"] = `Bearer ${token}`;
    return this;
  }

  /**
   * JSON responses vary by route; explicit `get<MyType>()` is preferred.
   * Default `any` preserves legacy property access (`res.data.data`, etc.).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async get<T = any>(endpoint: string, options = {}): Promise<T> {
    return (await this._fetchJSON(endpoint, {
      ...options,
      method: "GET",
    })) as T;
  }

  /**
   * GET an absolute first-party URL (AiFetchly Plugin Hub) with the same
   * auth-header attach + 401-refresh-retry semantics as relative endpoints.
   *
   * The URL's origin must match the configured hub base — enforced by
   * assertFirstPartyHubUrl (src/config/pluginHubUrl.ts) so the marketing JWT
   * can never be attached to a third-party URL. Community Plugin Page PRD §6.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async getFirstParty<T = any>(
    absoluteUrl: string,
    options: RequestInit = {}
  ): Promise<T> {
    assertFirstPartyHubUrl(absoluteUrl);
    // Attach the token deterministically: the constructor's setheaderToken()
    // is fire-and-forget behind a dynamic import(), and callers (e.g. the
    // hub fetcher) construct + call in the same synchronous block — without
    // this await, the first request races ahead of the Authorization header.
    if (!this._isWorker) {
      await this.setheaderToken();
    }
    return (await this._fetchJSON(
      absoluteUrl,
      {
        ...options,
        method: "GET",
      },
      false,
      true
    )) as T;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async post<T = any>(
    endpoint: string,
    formData: FormData | FormDataLib,
    options = {}
  ): Promise<T> {
    // const body=new URLSearchParams(formData)
    // const body=formData
    // var requestOptions = {
    //   method: 'POST',
    //   headers: this._headers,
    //   body: formData,

    // };
    // return fetch("http://localhost:8082/user/login", requestOptions)
    // .then(response => {return response.json()})
    // const postheader={'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'}
    // let mergedhead = {...this._headers, ...postheader};
    return (await this._fetchJSON(endpoint, {
      ...options,
      // headers: this._headers,
      body: formData as BodyInit,
      method: "POST",
    })) as T;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async put<T = any>(endpoint: string, data: unknown): Promise<T> {
    log.info(JSON.stringify(data));
    return (await this._fetchJSON(endpoint, {
      // headers: this._headers,
      body: data ? JSON.stringify(data) : undefined,
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    })) as T;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async patch<T = any>(
    endpoint: string,
    operations: unknown,
    options = {}
  ): Promise<T> {
    return (await this._fetchJSON(endpoint, {
      ...options,
      body: JSON.stringify(operations),
      method: "PATCH",
      // headers: this._headers,
    })) as T;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async delete<T = any>(endpoint: string, options = {}): Promise<T> {
    return (await this._fetchJSON(endpoint, {
      ...options,
      method: "DELETE",
      // headers: this._headers,
    })) as T;
  }
  // post json data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async postJson<T = any>(
    endpoint: string,
    data: unknown,
    options = {}
  ): Promise<T> {
    // this.setHeader('Accept', 'application/json')
    // this.setHeader('Content-Type', 'application/json')
    return (await this._fetchJSON(endpoint, {
      ...options,
      body: JSON.stringify(data),
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      // headers: this._headers,
    })) as T;
  }

  /** Post JSON and return stream response. Callers may pass options.signal (AbortSignal) to abort the request. */
  public async postStream(
    endpoint: string,
    data: unknown,
    options: RequestInit = {},
    isRetry = false
  ): Promise<Response> {
    const res = await fetch(this.baseUrl + endpoint, {
      ...options,
      body: JSON.stringify(data),
      method: "POST",
      headers: {
        ...this._headers,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
    });

    // Handle 401 Unauthorized and 403 Forbidden - Token might be expired.
    // See _fetchJSON: backend returns 401 for invalid/expired tokens, so we
    // must refresh on both (B5 fix).
    if (res.status === 401 || res.status === 403) {
      log.warn(`Received ${res.status} - Attempting token refresh`);

      // Prevent refresh recursion during signout.
      // postStream isn't used by removeRemoteToken today, but keep behavior consistent.
      if (endpoint === "/api/user/signout") {
        delete this._headers["Authorization"];
        throw new Error(
          "Authentication failed: token expired while signing out"
        );
      }

      // Worker processes cannot refresh tokens or access ElectronStoreService
      if (this._isWorker) {
        throw new Error(
          "Authentication failed: Token expired. Worker cannot refresh tokens."
        );
      }

      // Prevent infinite refresh loops: already retried once. Fail this request
      // but keep local auth state.
      if (isRetry) {
        log.warn("Token refresh retry still failed; keeping local session");
        throw new Error(
          `Authentication failed after token refresh retry (HTTP ${res.status}).`
        );
      }

      // Check if refresh token exists
      const { Token } = await import("@/modules/token");
      const tokenModel = new Token();
      const refreshToken = tokenModel.getValue(REFRESHTOKEN);

      if (refreshToken && refreshToken.trim().length > 0) {
        try {
          // Process-wide refresh mutex: see _refreshTokenAndRetry.
          const { TokenRefreshService } = await import(
            "@/modules/tokenRefresh"
          );
          const refreshResult = await TokenRefreshService.refreshOnce();

          if (refreshResult.status && refreshResult.data) {
            // Update access token in headers
            this.setHeader(
              "Authorization",
              "Bearer " + refreshResult.data.accessToken
            );

            // The new session may have a different secret key; drop the cached one.
            userSecretKeyService.invalidate();

            // Retry the original request with new token
            return this.postStream(endpoint, data, options, true);
          } else {
            throw new Error("Token refresh failed");
          }
        } catch (error) {
          log.error("Token refresh error:", error);

          // Do not sign out on refresh failure. Keep local session state and
          // fail only this stream request.
          if (isRefreshTokenInvalidError(error)) {
            throw error;
          }

          // Transient failure: surface the original error.
          throw error;
        }
      } else {
        // No refresh token available. Fail this request but keep local auth
        // state so local features remain usable.
        log.warn("No refresh token available; keeping local session");
        throw new Error(
          `Authentication failed: refresh token unavailable (HTTP ${res.status}).`
        );
      }
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res;
  }
}

export default HttpClient;
