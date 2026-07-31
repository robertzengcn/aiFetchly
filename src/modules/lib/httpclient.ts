export type HttpClientOptions = {
  headers?: HeadersInit;
};
// export type FetchOptions = {
//     headers?: HeadersInit;
// }
//import { AuthInterceptor } from '@/modules/lib/authInterceptor';
import type FormDataLib from "form-data";
import { Token } from "@/modules/token";
import { TOKENNAME, REFRESHTOKEN } from "@/config/usersetting";
import {
  RefreshTokenInvalidError,
  TokenRefreshService,
} from "@/modules/tokenRefresh";
import { resolveViteLoginBase } from "@/config/viteLoginUrl";
import { userSecretKeyService } from "@/modules/fieldCipher";

/**
 * Decide whether a refresh failure is auth-shaped versus a transient/network
 * failure. Both paths keep local auth state; auth-shaped failures only stop
 * the current remote request so local app features remain available.
 *
 * Matches case-insensitively because the backend returns lowercase messages
 * (e.g. "invalid or expired refresh token") and the prior capital-I match let
 * this branch silently never fire.
 */
function isRefreshTokenInvalidError(error: unknown): boolean {
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
  private _headers: HeadersInit = {};
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
      console.warn(
        `Invalid VITE_LOGIN_URL: ${loginUrl}, falling back to default`
      );
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
      this.setheaderToken();
    }
    // const tokenModel=new Token()
    // const tokenval=tokenModel.getValue("social-market-token")
    // if (tokenval) {
    //   //config.headers.Authorization = 'Bearer ' + tokenval
    //   this.setHeader('Authorization', 'Bearer ' + tokenval)
    // }
  }

  public setheaderToken() {
    const tokenModel = new Token();
    const tokenval = tokenModel.getValue(TOKENNAME);
    //console.log("prepare to set token:"+tokenval)
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
    isRetry = false
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
      console.warn("Token refresh retry still failed; keeping local session");
      throw new Error("Authentication failed after token refresh retry.");
    }

    try {
      // refreshOnce() is the process-wide entrypoint. If another caller
      // (background timer or another HttpClient) is already refreshing,
      // this returns the same promise — no concurrent rotation race.
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
        return this._fetchJSON(endpoint, options, true);
      } else {
        throw new Error("Token refresh failed");
      }
    } catch (error) {
      console.error("Token refresh error:", error);

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
    isRetry = false
  ): Promise<unknown> {
    // await this.setheaderToken()
    const res = await fetch(this.baseUrl + endpoint, {
      ...options,
      headers: this._headers,
    });

    // Handle 401 Unauthorized and 403 Forbidden - Token might be expired.
    // The backend returns 401 when an access/refresh token is invalid or
    // expired (marketing/controllers/auth_controller.go), so we must treat
    // 401 the same as 403 here — otherwise a genuinely expired access token
    // forces a re-login instead of a transparent refresh (B5 fix).
    if (res.status === 401 || res.status === 403) {
      console.warn(`Received ${res.status} - Attempting token refresh`);
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
      console.log(
        "[HttpClient] Refresh token check:",
        refreshToken ? `found (length=${refreshToken.length})` : "missing",
        "| endpoint:",
        endpoint
      );

      if (refreshToken && refreshToken.trim().length > 0) {
        // Try to refresh token and retry request
        return this._refreshTokenAndRetry(endpoint, options, isRetry);
      } else {
        // No refresh token available. Fail this request but keep local auth
        // state so local features remain usable.
        console.warn(
          "[HttpClient] No refresh token available; keeping local session"
        );
        throw new Error("Authentication failed: refresh token unavailable.");
      }
    }

    if (!res.ok) throw new Error(res.statusText);

    //   if (options.parseResponse !== false && res.status !== 204)
    //     return res.json();
    const data = await res.json();
    //console.log(data)
    return data;
  }

  setHeader(key, value) {
    this._headers[key] = value;
    return this;
  }

  getHeader(key) {
    return this._headers[key];
  }

  setBasicAuth(username, password) {
    this._headers["Authorization"] = `Basic ${btoa(`${username}:${password}`)}`;
    return this;
  }

  setBearerAuth(token) {
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
  public async put<T = any>(endpoint: string, data): Promise<T> {
    console.log(JSON.stringify(data));
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
    operations,
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
    data,
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
    data,
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
      console.warn(`Received ${res.status} - Attempting token refresh`);

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
        console.warn("Token refresh retry still failed; keeping local session");
        throw new Error("Authentication failed after token refresh retry.");
      }

      // Check if refresh token exists
      const tokenModel = new Token();
      const refreshToken = tokenModel.getValue(REFRESHTOKEN);

      if (refreshToken && refreshToken.trim().length > 0) {
        try {
          // Process-wide refresh mutex: see _refreshTokenAndRetry.
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
          console.error("Token refresh error:", error);

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
        console.warn("No refresh token available; keeping local session");
        throw new Error("Authentication failed: refresh token unavailable.");
      }
    }

    if (!res.ok) throw new Error(res.statusText);
    return res;
  }
}

export default HttpClient;
