"use strict";
// Session-expiry re-login requirement: when a first-party AI API call
// (POST /api/ai/v1/chat/completions stream, GET /api/ai/v1/models) receives
// a 401/403, HttpClient attempts a token refresh; when the refresh fails in
// a DEFINITIVE auth-shaped way the user must be signed out so they can
// re-login. Transient refresh failures (network / HTTP 5xx) must NOT sign
// the user out.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// In-memory token store shared by HttpClient and TokenRefreshService.
const store = new Map<string, string>();

vi.mock("@/modules/token", () => ({
  // Vitest 4: vi.fn().mockImplementation(() => ({})) is not constructable.
  Token: class {
    getValue(key: string): string {
      return store.get(key) ?? "";
    }
    setValue(key: string, value: string): void {
      store.set(key, value);
    }
  },
}));

const mockSignout = vi.hoisted(() => vi.fn<(...args: []) => Promise<void>>());

vi.mock("@/modules/user", () => ({
  User: class {
    Signout = mockSignout;
  },
}));

// invalidate() is called after a successful refresh; make it a no-op.
vi.mock("@/modules/fieldCipher", () => ({
  userSecretKeyService: { invalidate: vi.fn() },
}));

process.env.VITE_LOGIN_URL = "http://localhost:3000";

import { HttpClient } from "@/modules/lib/httpclient";
import { TokenRefreshService } from "@/modules/tokenRefresh";
import { userSafeError } from "@/service/AIChatErrorMapper";
import { AUTH_EXPIRED_SENTINEL } from "@/service/AIChatErrorSentinels";
import { resetAuthSessionExpiryGuardForTests } from "@/service/AuthSessionExpiryGuard";

function jsonResponse(
  payload: unknown,
  init: { status?: number; statusText?: string } = {}
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? "",
    headers: new Map() as unknown as Headers,
    text: () => Promise.resolve(JSON.stringify(payload)),
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

describe("HttpClient 403 → refresh → sign-out (session expiry re-login)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let client: HttpClient;

  beforeEach(() => {
    store.clear();
    store.set("user-social-market-token", "stale-access");
    store.set("user_refresh_token", "expired-refresh");
    mockSignout.mockClear();
    mockSignout.mockImplementation(() => Promise.resolve());
    resetAuthSessionExpiryGuardForTests();
    fetchSpy = vi.fn() as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchSpy);
    client = new HttpClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TokenRefreshService.stopAutoRefresh();
    resetAuthSessionExpiryGuardForTests();
  });

  it("postStream (chat completions): 403 → refresh rejected → signs out + auth sentinel", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 403 } }, { status: 403 })
      )
      // TokenRefreshService raw-fetches /api/auth/refresh → rejected.
      .mockResolvedValueOnce(
        jsonResponse(
          { status: false, code: 401, msg: "invalid refresh token" },
          { status: 401 }
        )
      );

    await expect(
      client.postStream("/api/ai/v1/chat/completions", { stream: true })
    ).rejects.toThrow(/Refresh token rejected/);

    await vi.waitFor(() => expect(mockSignout).toHaveBeenCalledTimes(1));
  });

  it("get (models): 403 → refresh rejected → signs out + auth sentinel", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 403 } }, { status: 403 })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { status: false, code: 401, msg: "invalid refresh token" },
          { status: 401 }
        )
      );

    await expect(client.get("/api/ai/v1/models")).rejects.toThrow(
      /Refresh token rejected/
    );

    await vi.waitFor(() => expect(mockSignout).toHaveBeenCalledTimes(1));
  });

  it("postStream: 403 → refresh succeeds → retry still 403 → signs out", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 403 } }, { status: 403 })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            status: true,
            code: 0,
            msg: "ok",
            data: {
              accessToken: "new-access",
              refreshToken: "new-refresh",
              expiresIn: 3600,
            },
          },
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 403 } }, { status: 403 })
      );

    await expect(
      client.postStream("/api/ai/v1/chat/completions", { stream: true })
    ).rejects.toThrow(/Authentication failed after token refresh retry/);

    await vi.waitFor(() => expect(mockSignout).toHaveBeenCalledTimes(1));
  });

  it("transient refresh failure (network down) does NOT sign out", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 403 } }, { status: 403 })
      )
      .mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(
      client.postStream("/api/ai/v1/chat/completions", { stream: true })
    ).rejects.toThrow();

    expect(mockSignout).not.toHaveBeenCalled();
  });

  it("auth-shaped failure maps to the AUTH_EXPIRED sentinel for the chat UI", async () => {
    const err = new Error(
      "Authentication failed after token refresh retry (HTTP 403)."
    );
    expect(userSafeError(err)).toBe(AUTH_EXPIRED_SENTINEL);
    expect(userSafeError(new Error("Failed to refresh access token"))).toBe(
      AUTH_EXPIRED_SENTINEL
    );
    expect(userSafeError(new Error("Token refresh failed"))).toBe(
      AUTH_EXPIRED_SENTINEL
    );
  });

  it("postStream: 403 → refresh returns { status: false, code: 500, msg: 'Failed to refresh access token' } → signs out", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 403 } }, { status: 403 })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            status: false,
            code: 500,
            msg: "Failed to refresh access token",
          },
          { status: 200 }
        )
      );

    await expect(
      client.postStream("/api/ai/v1/chat/completions", { stream: true })
    ).rejects.toThrow(/Failed to refresh access token/);

    await vi.waitFor(() => expect(mockSignout).toHaveBeenCalledTimes(1));
  });

  it("get (models): 403 → refresh returns { status: false, code: 500, msg: 'Failed to refresh access token' } → signs out", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 403 } }, { status: 403 })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            status: false,
            code: 500,
            msg: "Failed to refresh access token",
          },
          { status: 200 }
        )
      );

    await expect(client.get("/api/ai/v1/models")).rejects.toThrow(
      /Failed to refresh access token/
    );

    await vi.waitFor(() => expect(mockSignout).toHaveBeenCalledTimes(1));
  });

  it("no refresh token stored → signs out so the user can re-login", async () => {
    store.delete("user_refresh_token");
    client = new HttpClient();

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: { code: 403 } }, { status: 403 })
    );

    await expect(
      client.postStream("/api/ai/v1/chat/completions", { stream: true })
    ).rejects.toThrow(/refresh token unavailable/);

    await vi.waitFor(() => expect(mockSignout).toHaveBeenCalledTimes(1));
  });
});
