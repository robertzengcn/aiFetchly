"use strict";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted shared mocks (must be created inside vi.hoisted so vi.mock factories
// can reference them — factory runs before top-level imports resolve).
// ---------------------------------------------------------------------------
const mockSignout = vi.hoisted(() => vi.fn());
const mockRemoveToken = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

const mockGetValue = vi.hoisted(() => vi.fn());
const mockSetValue = vi.hoisted(() => vi.fn());

// Mutable token store keyed by the real usersetting key strings.
const tokenState = vi.hoisted(() => ({ values: {} as Record<string, string> }));

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock("@/modules/user", () => ({
  User: vi.fn().mockImplementation(() => ({
    Signout: mockSignout,
    removeToken: mockRemoveToken,
  })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: mockGetValue,
    setValue: mockSetValue,
  })),
}));

vi.mock("@/modules/remotesource", () => ({
  RemoteSource: vi.fn().mockImplementation(() => ({
    removeRemoteToken: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("@/modules/Logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/config/viteLoginUrl", () => ({
  resolveViteLoginBase: vi.fn(() => ({
    value: "http://localhost:3000",
    source: "process.env.VITE_LOGIN_URL",
  })),
}));

import {
  TokenRefreshService,
  RefreshTokenInvalidError,
  isTransientBackendError,
} from "@/modules/tokenRefresh";
import {
  TOKENNAME,
  TOKENEXPIRY,
  REFRESHTOKEN,
  REFRESHTOKENEXPIRY,
} from "@/config/usersetting";

// Helper: build a fake fetch Response-like object.
function fakeResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {}
): Response {
  const ok = init.ok ?? true;
  return {
    ok,
    status: init.status ?? (ok ? 200 : 500),
    statusText: init.statusText ?? "",
    json: async () => body,
  } as unknown as Response;
}

// Reset the private static singletons between tests so each starts clean.
// stopAutoRefresh() handles the timer/counter/running flag; _inFlight must be
// cleared manually (it self-clears on settle, but this is belt-and-suspenders
// if a prior test's promise did not settle).
function resetStaticState(): void {
  const staticState = TokenRefreshService as unknown as {
    _inFlight: unknown;
    _isAutoRefreshRunning: boolean;
    _autoRefreshTimer: ReturnType<typeof setInterval> | null;
    _consecutiveFailures: number;
  };
  staticState._inFlight = null;
  staticState._isAutoRefreshRunning = false;
  staticState._autoRefreshTimer = null;
  staticState._consecutiveFailures = 0;
}

describe("isTransientBackendError", () => {
  test("TypeError 'fetch failed' is transient (backend unreachable)", () => {
    expect(isTransientBackendError(new TypeError("fetch failed"))).toBe(true);
  });

  test("Error whose cause is a system network error is transient", () => {
    const e = new TypeError("fetch failed");
    (e as Error & { cause?: unknown }).cause = new Error(
      "connect ECONNREFUSED 127.0.0.1:3000"
    );
    expect(isTransientBackendError(e)).toBe(true);
  });

  test("DNS failure carried on cause is transient", () => {
    const e = new Error("request failed");
    (e as Error & { cause?: unknown }).cause = new Error(
      "getaddrinfo EAI_AGAIN api.example.com"
    );
    expect(isTransientBackendError(e)).toBe(true);
  });

  test("HTTP 5xx is transient (backend up but erroring)", () => {
    expect(
      isTransientBackendError(new Error("HTTP error: 500 Internal Server Error"))
    ).toBe(true);
    expect(
      isTransientBackendError(new Error("HTTP error: 503 Service Unavailable"))
    ).toBe(true);
    expect(
      isTransientBackendError(new Error("HTTP error: 502 Bad Gateway"))
    ).toBe(true);
  });

  test("RefreshTokenInvalidError is NOT transient", () => {
    expect(
      isTransientBackendError(new RefreshTokenInvalidError("expired"))
    ).toBe(false);
  });

  test("HTTP 401 is NOT transient (it is an auth failure)", () => {
    expect(
      isTransientBackendError(new Error("HTTP error: 401 Unauthorized"))
    ).toBe(false);
  });

  test("Generic unexpected error is NOT transient", () => {
    expect(isTransientBackendError(new Error("something weird"))).toBe(false);
  });
});

describe("RefreshTokenInvalidError", () => {
  test("is an Error subclass carrying its message", () => {
    const e = new RefreshTokenInvalidError("Refresh token not found");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(RefreshTokenInvalidError);
    expect(e.message).toBe("Refresh token not found");
  });
});

describe("refreshOnce — process-wide serialization", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockSignout.mockClear();
    mockRemoveToken.mockClear();
    mockGetValue.mockClear();
    mockSetValue.mockClear();
    mockFetch.mockReset();
    resetStaticState();

    // Valid refresh token, no access-token expiry stored → refresh runs.
    tokenState.values = {
      [TOKENNAME]: "current-access-token",
      [TOKENEXPIRY]: "",
      [REFRESHTOKEN]: "valid-refresh-token",
      [REFRESHTOKENEXPIRY]: "",
    };
    mockGetValue.mockImplementation(
      (key: string) => tokenState.values[key] ?? ""
    );
    mockSetValue.mockImplementation((key: string, val: string) => {
      tokenState.values[key] = val;
    });
  });

  afterEach(() => {
    TokenRefreshService.stopAutoRefresh();
    vi.unstubAllGlobals();
  });

  test("runs only one network refresh for two concurrent callers", async () => {
    // Make fetch resolve slowly so both callers are definitely in flight.
    let resolveFetch!: (value: Response) => void;
    mockFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const payload = {
      status: true,
      code: 0,
      msg: "ok",
      data: {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 3600,
      },
    };

    const p1 = TokenRefreshService.refreshOnce();
    const p2 = TokenRefreshService.refreshOnce();

    // While in flight, the static slot must be populated.
    expect(TokenRefreshService.isRefreshInFlight()).toBe(true);

    resolveFetch(fakeResponse(payload));

    const [r1, r2] = await Promise.all([p1, p2]);

    // Critical assertion: exactly one fetch call despite two callers.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2); // same resolved value object
    expect(r1.status).toBe(true);
    expect(r1.data?.accessToken).toBe("new-access");

    // Slot cleared after completion.
    expect(TokenRefreshService.isRefreshInFlight()).toBe(false);
  });

  test("clears the in-flight slot after a failed refresh", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(
        { status: false, code: 500, msg: "server error", data: null },
        { ok: true, status: 200 }
      )
    );

    await expect(TokenRefreshService.refreshOnce()).rejects.toThrow(
      /server error|Token refresh failed/
    );

    expect(TokenRefreshService.isRefreshInFlight()).toBe(false);

    // A subsequent call must issue a NEW fetch (slot was cleared).
    mockFetch.mockResolvedValue(
      fakeResponse({
        status: true,
        code: 0,
        msg: "ok",
        data: { accessToken: "a", refreshToken: "r", expiresIn: 60 },
      })
    );
    await TokenRefreshService.refreshOnce();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("preserves backward-compat instance.refreshAccessToken() by delegating to refreshOnce()", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse({
        status: true,
        code: 0,
        msg: "ok",
        data: { accessToken: "a", refreshToken: "r", expiresIn: 60 },
      })
    );

    const service = new TokenRefreshService();
    const result = await service.refreshAccessToken();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(true);
    expect(result.data?.accessToken).toBe("a");
  });
});

describe("case-insensitive refresh-token-invalid handling", () => {
  // The background refresh path stops the auto-refresh timer when the refresh
  // token is invalid. With the merged typed-error design, a body-level code 401
  // throws RefreshTokenInvalidError regardless of message casing, so the
  // lowercase backend message that previously slipped past a capital-I match
  // is now handled. This test guards that behavior end-to-end.
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockSignout.mockClear();
    mockRemoveToken.mockClear();
    mockGetValue.mockClear();
    mockSetValue.mockClear();
    mockFetch.mockReset();
    resetStaticState();

    tokenState.values = {
      [TOKENNAME]: "current-access-token",
      [TOKENEXPIRY]: "",
      [REFRESHTOKEN]: "valid-refresh-token",
      [REFRESHTOKENEXPIRY]: "",
    };
    mockGetValue.mockImplementation(
      (key: string) => tokenState.values[key] ?? ""
    );
    mockSetValue.mockImplementation((key: string, val: string) => {
      tokenState.values[key] = val;
    });
  });

  afterEach(() => {
    TokenRefreshService.stopAutoRefresh();
    vi.unstubAllGlobals();
  });

  test("stops auto-refresh on lowercase 'invalid or expired refresh token'", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse({
        status: false,
        code: 401,
        msg: "invalid or expired refresh token",
        data: null,
      })
    );

    // Spy on stopAutoRefresh to verify the auth-failure branch fires, without
    // actually clearing the timer (cleaned up manually below).
    const stopSpy = vi
      .spyOn(TokenRefreshService, "stopAutoRefresh")
      .mockImplementation(() => undefined);

    TokenRefreshService.startAutoRefresh();

    await vi.waitFor(() => {
      expect(stopSpy).toHaveBeenCalled();
    });

    stopSpy.mockRestore();
    TokenRefreshService.stopAutoRefresh();
  });
});

describe("TokenRefreshService.performAutoRefreshCheck", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockSignout.mockClear();
    mockRemoveToken.mockClear();
    mockGetValue.mockClear();
    mockSetValue.mockClear();
    mockFetch.mockReset();
    resetStaticState();

    // Valid refresh token, expired access token → forces a refresh attempt.
    tokenState.values = {
      [TOKENNAME]: "access-token-value",
      [TOKENEXPIRY]: String(Date.now() - 100_000), // already expired
      [REFRESHTOKEN]: "refresh-token-value",
      [REFRESHTOKENEXPIRY]: String(Date.now() + 10_000_000), // valid
    };
    mockGetValue.mockImplementation(
      (key: string) => tokenState.values[key] ?? ""
    );
    mockSetValue.mockImplementation((key: string, val: string) => {
      tokenState.values[key] = val;
    });

    TokenRefreshService.stopAutoRefresh();
  });

  afterEach(() => {
    TokenRefreshService.stopAutoRefresh();
    vi.unstubAllGlobals();
  });

  test("network error (fetch failed) does NOT sign out and keeps auto-refresh running", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    TokenRefreshService.startAutoRefresh();
    // Drive a deterministic check (also lets startAutoRefresh's immediate
    // fire-and-forget check settle, since both consume the same sync mock).
    await TokenRefreshService.performAutoRefreshCheck();

    expect(mockFetch).toHaveBeenCalled();
    expect(mockSignout).not.toHaveBeenCalled();
    expect(mockRemoveToken).not.toHaveBeenCalled();
    // Auto-refresh must still be running so it retries on the next cycle.
    expect(TokenRefreshService.isAutoRefreshRunning()).toBe(true);
  });

  test("HTTP 5xx from refresh endpoint does NOT sign out and keeps running", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(null, {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })
    );

    TokenRefreshService.startAutoRefresh();
    await TokenRefreshService.performAutoRefreshCheck();

    expect(mockFetch).toHaveBeenCalled();
    expect(mockSignout).not.toHaveBeenCalled();
    expect(TokenRefreshService.isAutoRefreshRunning()).toBe(true);
  });

  test("repeated network errors never sign out, even after many cycles", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    for (let i = 0; i < 6; i++) {
      await TokenRefreshService.performAutoRefreshCheck();
    }

    expect(mockSignout).not.toHaveBeenCalled();
    expect(mockRemoveToken).not.toHaveBeenCalled();
  });

  test("Case C: unexpected (non-auth, non-transient) error at MAX threshold stops the timer but does NOT sign out", async () => {
    // Body returns an unsuccessful status with a non-401 code → _performRefreshNetwork
    // throws a plain Error (not RefreshTokenInvalidError, not transient) → Case C.
    mockFetch.mockResolvedValue(
      fakeResponse(
        { status: false, code: 500, msg: "unexpected backend error", data: null },
        { ok: true, status: 200 }
      )
    );

    TokenRefreshService.startAutoRefresh();
    // MAX_CONSECUTIVE_FAILURES === 3; the startAutoRefresh immediate check plus
    // these calls push the counter past the threshold.
    for (let i = 0; i < 3; i++) {
      await TokenRefreshService.performAutoRefreshCheck();
    }

    expect(mockSignout).not.toHaveBeenCalled();
    expect(mockRemoveToken).not.toHaveBeenCalled();
    // Timer stopped to avoid hammering the server, but the user stays logged in.
    expect(TokenRefreshService.isAutoRefreshRunning()).toBe(false);
  });

  test("refresh token genuinely invalid (API code 401) DOES sign out and stops auto-refresh", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(
        {
          status: false,
          code: 401,
          msg: "Invalid or expired refresh token",
          data: null,
        },
        { ok: true, status: 200 }
      )
    );

    TokenRefreshService.startAutoRefresh();
    await TokenRefreshService.performAutoRefreshCheck();

    expect(mockSignout).toHaveBeenCalled();
    expect(TokenRefreshService.isAutoRefreshRunning()).toBe(false);
  });

  test("expired refresh token DOES sign out (detected before hitting the network)", async () => {
    tokenState.values[REFRESHTOKENEXPIRY] = String(Date.now() - 1_000); // refresh token expired

    TokenRefreshService.startAutoRefresh();
    await TokenRefreshService.performAutoRefreshCheck();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSignout).toHaveBeenCalled();
    expect(TokenRefreshService.isAutoRefreshRunning()).toBe(false);
  });

  test("successful refresh updates tokens and does NOT sign out", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(
        {
          status: true,
          code: 200,
          msg: "ok",
          data: {
            accessToken: "new-access-token",
            refreshToken: "new-refresh-token",
            expiresIn: 3600,
          },
        },
        { ok: true, status: 200 }
      )
    );

    await TokenRefreshService.performAutoRefreshCheck();

    expect(mockSignout).not.toHaveBeenCalled();
    // New access token persisted.
    expect(mockSetValue).toHaveBeenCalledWith(TOKENNAME, "new-access-token");
  });
});

describe("TokenRefreshService.refreshAccessToken throw-type contract", () => {
  // The linchpin of the transient-vs-auth design: every genuine auth failure
  // MUST throw RefreshTokenInvalidError so performAutoRefreshCheck signs the
  // user out (and HttpClient callers handle it). A regression to a plain Error
  // would silently keep rejected sessions alive.

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    mockGetValue.mockClear();
    mockSetValue.mockClear();
    resetStaticState();

    tokenState.values = {
      [TOKENNAME]: "access-token-value",
      [TOKENEXPIRY]: String(Date.now() - 100_000),
      [REFRESHTOKEN]: "refresh-token-value",
      [REFRESHTOKENEXPIRY]: String(Date.now() + 10_000_000), // valid
    };
    mockGetValue.mockImplementation(
      (key: string) => tokenState.values[key] ?? ""
    );
    mockSetValue.mockImplementation((key: string, val: string) => {
      tokenState.values[key] = val;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("missing refresh token throws RefreshTokenInvalidError", async () => {
    tokenState.values[REFRESHTOKEN] = "";
    await expect(
      new TokenRefreshService().refreshAccessToken()
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  test("expired refresh token throws RefreshTokenInvalidError", async () => {
    tokenState.values[REFRESHTOKENEXPIRY] = String(Date.now() - 1_000);
    await expect(
      new TokenRefreshService().refreshAccessToken()
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  test("HTTP 401 from refresh endpoint throws RefreshTokenInvalidError", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(null, { ok: false, status: 401, statusText: "Unauthorized" })
    );
    await expect(
      new TokenRefreshService().refreshAccessToken()
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  test("HTTP 403 from refresh endpoint throws RefreshTokenInvalidError", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(null, { ok: false, status: 403, statusText: "Forbidden" })
    );
    await expect(
      new TokenRefreshService().refreshAccessToken()
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  test("body code 401 (HTTP 200) throws RefreshTokenInvalidError", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(
        {
          status: false,
          code: 401,
          msg: "Invalid or expired refresh token",
          data: null,
        },
        { ok: true, status: 200 }
      )
    );
    await expect(
      new TokenRefreshService().refreshAccessToken()
    ).rejects.toBeInstanceOf(RefreshTokenInvalidError);
  });

  test("network failure throws a plain Error (NOT RefreshTokenInvalidError)", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      new TokenRefreshService().refreshAccessToken()
    ).rejects.not.toBeInstanceOf(RefreshTokenInvalidError);
  });
});
