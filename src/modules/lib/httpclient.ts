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
import { User } from "@/modules/user";
import { TokenRefreshService } from "@/modules/tokenRefresh";
import { resolveViteLoginBase } from "@/config/viteLoginUrl";
import { userSecretKeyService } from "@/modules/fieldCipher";

// export type RemoteResp = {
//   status: boolean,
//   msg: string,
//   data?: any,
// }
export class HttpClient {
  private _headers: HeadersInit = {};
  private baseUrl: string;
  private _tokenRefreshService: TokenRefreshService | null = null;
  private _refreshInProgress = false;
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
      this._tokenRefreshService = new TokenRefreshService();
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
   * Refresh token and retry the original request
   * Prevents infinite loops by checking if refresh is already in progress
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

    // Prevent infinite refresh loops
    if (isRetry) {
      // Already retried once, sign out user
      console.warn("Token refresh failed after retry, signing out user");
      try {
        const userModel = new User();
        await userModel.removeToken();
      } catch (error) {
        console.error("Error during signout:", error);
      }
      delete this._headers["Authorization"];
      throw new Error(
        "Authentication failed: Token expired. Please login again."
      );
    }

    // Check if refresh is already in progress
    if (this._refreshInProgress) {
      // Wait a bit and retry the original request
      await new Promise((resolve) => setTimeout(resolve, 500));
      return this._fetchJSON(endpoint, options);
    }

    this._refreshInProgress = true;

    try {
      // Attempt to refresh the token
      if (!this._tokenRefreshService) {
        throw new Error("Token refresh service not available");
      }
      const refreshResult =
        await this._tokenRefreshService.refreshAccessToken();

      if (refreshResult.status && refreshResult.data) {
        // Update access token in headers
        this.setHeader(
          "Authorization",
          "Bearer " + refreshResult.data.accessToken
        );

        // The new session may have a different secret key; drop the cached one.
        userSecretKeyService.invalidate();

        // Retry the original request with new token
        return this._fetchJSON(endpoint, options);
      } else {
        throw new Error("Token refresh failed");
      }
    } catch (error) {
      console.error("Token refresh error:", error);

      // Sign out user on refresh failure
      try {
        const userModel = new User();
        await userModel.removeToken();
      } catch (signoutError) {
        console.error("Error during signout:", signoutError);
      }

      delete this._headers["Authorization"];
      throw new Error(
        "Authentication failed: Token expired. Please login again."
      );
    } finally {
      this._refreshInProgress = false;
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

    // Handle 403 Forbidden - Token expired
    if (res.status === 403) {
      console.warn("Received 403 Forbidden - Attempting token refresh");
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
        // No refresh token available, sign out user
        console.warn(
          "[HttpClient] No refresh token available, signing out user"
        );
        try {
          const userModel = new User();
          await userModel.removeToken();
        } catch (error) {
          console.error("Error during signout:", error);
        }

        delete this._headers["Authorization"];
        throw new Error(
          "Authentication failed: Token expired. Please login again."
        );
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

    // Handle 403 Forbidden - Token expired
    if (res.status === 403) {
      console.warn("Received 403 Forbidden - Attempting token refresh");

      // Prevent refresh-on-403 recursion during signout.
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

      // Prevent infinite refresh loops
      if (isRetry) {
        console.warn("Token refresh failed after retry, signing out user");
        try {
          const userModel = new User();
          await userModel.removeToken();
        } catch (error) {
          console.error("Error during signout:", error);
        }
        delete this._headers["Authorization"];
        throw new Error(
          "Authentication failed: Token expired. Please login again."
        );
      }

      // Check if refresh token exists
      const tokenModel = new Token();
      const refreshToken = tokenModel.getValue(REFRESHTOKEN);

      if (refreshToken && refreshToken.trim().length > 0) {
        // Check if refresh is already in progress
        if (this._refreshInProgress) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return this.postStream(endpoint, data, options, true);
        }

        this._refreshInProgress = true;

        try {
          // Attempt to refresh the token
          if (!this._tokenRefreshService) {
            throw new Error("Token refresh service not available");
          }
          const refreshResult =
            await this._tokenRefreshService.refreshAccessToken();

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

          // Sign out user on refresh failure
          try {
            const userModel = new User();
            await userModel.removeToken();
          } catch (signoutError) {
            console.error("Error during signout:", signoutError);
          }

          delete this._headers["Authorization"];
          throw new Error(
            "Authentication failed: Token expired. Please login again."
          );
        } finally {
          this._refreshInProgress = false;
        }
      } else {
        // No refresh token available, sign out user
        console.warn("No refresh token available, signing out user");
        try {
          const userModel = new User();
          await userModel.removeToken();
        } catch (error) {
          console.error("Error during signout:", error);
        }

        delete this._headers["Authorization"];
        throw new Error(
          "Authentication failed: Token expired. Please login again."
        );
      }
    }

    if (!res.ok) throw new Error(res.statusText);
    return res;
  }
}

export default HttpClient;
