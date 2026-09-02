"use strict";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ----------------------------------------------------------------

const mockTokenGetValue = vi.hoisted(() =>
  vi.fn<(key: string) => string>().mockReturnValue("")
);
const mockTokenSetValue = vi.hoisted(() =>
  vi.fn<(key: string, value: string) => void>()
);

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: mockTokenGetValue,
    setValue: mockTokenSetValue,
  })),
}));

const mockRemoveToken = vi.hoisted(() => vi.fn<() => void>());

vi.mock("@/modules/user", () => ({
  User: vi.fn().mockImplementation(() => ({
    removeToken: mockRemoveToken,
  })),
}));

// Mock TokenRefreshService so we can control refresh outcomes without going
// through real network code in these HttpClient-level tests.
const mockRefreshOnce = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
// Hoist the typed error class so the vi.mock factory and the static
// `import { RefreshTokenInvalidError }` below share one binding. Declaring it
// inside the mock factory triggers vitest 3's TDZ: the namespace binding
// (__vi_import_N) is accessed before the async factory initializes, throwing
// "Cannot access '__vi_import_1__' before initialization".
const MockRefreshTokenInvalidError = vi.hoisted(() => {
  return class RefreshTokenInvalidError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RefreshTokenInvalidError";
    }
  };
});

vi.mock("@/modules/tokenRefresh", () => {
  // Constructor-callable stub: HttpClient does `new TokenRefreshService()`
  // in its constructor. We attach a static `refreshOnce` method that the
  // source code calls for refreshes.
  const Stub = vi.fn().mockImplementation(() => ({}));
  (Stub as unknown as { refreshOnce: typeof mockRefreshOnce }).refreshOnce =
    mockRefreshOnce;
  return {
    RefreshTokenInvalidError: MockRefreshTokenInvalidError,
    TokenRefreshService: Stub,
  };
});

// invalidate() is called after a successful refresh; make it a no-op.
vi.mock("@/modules/fieldCipher", () => ({
  userSecretKeyService: {
    invalidate: vi.fn(),
  },
}));

// Set login URL for resolveViteLoginBase() used by HttpClient constructor.
process.env.VITE_LOGIN_URL = "http://localhost:3000";

import { HttpClient } from "@/modules/lib/httpclient";
import { RefreshTokenInvalidError } from "@/modules/tokenRefresh";

function jsonResponse(
  payload: unknown,
  init: { status?: number; statusText?: string } = {}
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? "",
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

describe("HttpClient token-refresh behavior", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let client: HttpClient;

  beforeEach(() => {
    mockTokenGetValue.mockClear();
    mockTokenSetValue.mockClear();
    mockRemoveToken.mockClear();
    mockRefreshOnce.mockReset();

    // Default: a refresh token is present so refresh is attempted on 401/403.
    mockTokenGetValue.mockImplementation((key: string) => {
      if (key === "user_refresh_token") return "stored-refresh-token";
      if (key === "user-social-market-token") return "current-access";
      return "";
    });
    mockTokenSetValue.mockImplementation(() => undefined);
    mockRemoveToken.mockImplementation(() => undefined);

    fetchSpy = vi.fn() as unknown as typeof fetchSpy;
    vi.stubGlobal("fetch", fetchSpy);

    client = new HttpClient();
  });

  afterEach(() => {
    // Do NOT call vi.restoreAllMocks() — it wipes the vi.mock factories.
    vi.unstubAllGlobals();
  });

  it("on 401 attempts refresh and retries the original request with the new token", async () => {
    // First call returns 401 (token expired), retry returns success.
    const successPayload = {
      status: true,
      code: 0,
      msg: "ok",
      data: { hello: "world" },
    };
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(null, { status: 401, statusText: "Unauthorized" })
      )
      .mockResolvedValueOnce(jsonResponse(successPayload));

    mockRefreshOnce.mockResolvedValue({
      status: true,
      code: 0,
      msg: "ok",
      data: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 3600,
      },
    });

    const result = await client._fetchJSON("/api/test", { method: "GET" });

    // Refresh was attempted exactly once.
    expect(mockRefreshOnce).toHaveBeenCalledTimes(1);
    // Fetch was called twice: initial 401 + retry.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // The retry request carried the new access token.
    const retryOpts = fetchSpy.mock.calls[1][1] as RequestInit;
    const headers = retryOpts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer new-access");
    // User was NOT signed out (refresh succeeded).
    expect(mockRemoveToken).not.toHaveBeenCalled();
    // Result is the retried payload.
    expect(result).toEqual(successPayload);
  });

  it("does NOT sign out when refresh fails with a transient/network error", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(null, { status: 401, statusText: "Unauthorized" })
    );

    // Simulate a network/transient failure during refresh.
    mockRefreshOnce.mockRejectedValue(new Error("network down"));

    await expect(
      client._fetchJSON("/api/test", { method: "GET" })
    ).rejects.toThrow(/network down/);

    // Critical: user must NOT be signed out for transient failures.
    expect(mockRemoveToken).not.toHaveBeenCalled();
    // Refresh was attempted once.
    expect(mockRefreshOnce).toHaveBeenCalledTimes(1);
  });

  it("does NOT sign out when refresh returns an auth-shaped failure", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(null, { status: 401, statusText: "Unauthorized" })
    );

    // TokenRefreshService throws a message that signals the refresh token
    // itself was rejected. The client must keep local auth state because
    // backend/proxy/network instability can produce auth-shaped failures.
    mockRefreshOnce.mockRejectedValue(
      new Error("invalid or expired refresh token")
    );

    await expect(
      client._fetchJSON("/api/test", { method: "GET" })
    ).rejects.toThrow(/invalid or expired refresh token/);

    expect(mockRemoveToken).not.toHaveBeenCalled();
  });

  it("does NOT sign out when refresh endpoint rejects the refresh token with typed error", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(null, { status: 403, statusText: "Forbidden" })
    );

    mockRefreshOnce.mockRejectedValue(
      new RefreshTokenInvalidError("Refresh token rejected (HTTP 401)")
    );

    await expect(
      client._fetchJSON("/api/test", { method: "GET" })
    ).rejects.toThrow(/Refresh token rejected/);

    expect(mockRemoveToken).not.toHaveBeenCalled();
  });

  it("does not loop infinitely when the retried request still 401s", async () => {
    // Initial 401, retry also 401. Should refresh once, retry once, then fail
    // this request without clearing local auth state.
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(null, { status: 401, statusText: "Unauthorized" })
      )
      .mockResolvedValueOnce(
        jsonResponse(null, { status: 401, statusText: "Unauthorized" })
      );

    mockRefreshOnce.mockResolvedValue({
      status: true,
      code: 0,
      msg: "ok",
      data: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 3600,
      },
    });

    await expect(
      client._fetchJSON("/api/test", { method: "GET" })
    ).rejects.toThrow(/Authentication failed after token refresh retry/);

    // Refresh attempted exactly once (no infinite loop).
    expect(mockRefreshOnce).toHaveBeenCalledTimes(1);
    // Fetch called exactly twice (initial + one retry), then request failure.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mockRemoveToken).not.toHaveBeenCalled();
  });

  it("does NOT sign out when no refresh token is available", async () => {
    mockTokenGetValue.mockImplementation((key: string) => {
      if (key === "user-social-market-token") return "current-access";
      return "";
    });
    client = new HttpClient();

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(null, { status: 401, statusText: "Unauthorized" })
    );

    await expect(
      client._fetchJSON("/api/test", { method: "GET" })
    ).rejects.toThrow(/refresh token unavailable/);

    expect(mockRefreshOnce).not.toHaveBeenCalled();
    expect(mockRemoveToken).not.toHaveBeenCalled();
  });
});
