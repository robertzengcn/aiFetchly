"use strict";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ----------------------------------------------------------------
//
// TokenRefreshService depends on Token (encrypted store), User (signout),
// Logger, and fetch(). All are mocked so the test exercises only the
// serialization + error-classification logic.

const mockTokenGetValue = vi.hoisted(() =>
  vi.fn<[string], string>().mockReturnValue("")
);
const mockTokenSetValue = vi.hoisted(() => vi.fn<[string, string], void>());

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: mockTokenGetValue,
    setValue: mockTokenSetValue,
  })),
}));

const mockSignout = vi.hoisted(() => vi.fn<[], Promise<void>>());
const mockRemoveToken = vi.hoisted(() => vi.fn<[], void>());

vi.mock("@/modules/user", () => ({
  User: vi.fn().mockImplementation(() => ({
    Signout: mockSignout,
    removeToken: mockRemoveToken,
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

// Set the login URL that resolveViteLoginBase() reads at constructor time.
process.env.VITE_LOGIN_URL = "http://localhost:3000";

import { TokenRefreshService } from "@/modules/tokenRefresh";

// Helper: build a fetch mock that resolves with the given response payload.
function buildFetchResponse(
  payload: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {}
): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  return {
    ok,
    status,
    statusText: init.statusText ?? "",
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

describe("TokenRefreshService", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Clear individual mocks (vi.clearAllMocks() would wipe the Token/User
    // mock implementations set inside the vi.mock factories above).
    mockTokenGetValue.mockClear();
    mockTokenSetValue.mockClear();
    mockSignout.mockClear();
    mockRemoveToken.mockClear();
    fetchSpy = vi.fn() as unknown as typeof fetchSpy;
    vi.stubGlobal("fetch", fetchSpy);

    // Default valid refresh token + no expiry issues. Key strings must match
    // the real constants in @/config/usersetting.
    mockTokenGetValue.mockImplementation((key: string) => {
      if (key === "user_refresh_token") return "valid-refresh-token";
      if (key === "user_refresh_token_expiry") return "";
      if (key === "user_token_expiry") return "";
      if (key === "user-social-market-token") return "current-access-token";
      return "";
    });
    mockTokenSetValue.mockImplementation(() => undefined);
    mockSignout.mockReset();
    mockSignout.mockResolvedValue(undefined);
    mockRemoveToken.mockReset();

    // Reset the private static state between tests so each test starts clean.
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
  });

  afterEach(() => {
    // Note: do NOT call vi.restoreAllMocks() here — it would wipe the
    // Token/User mockImplementation factories set in vi.mock above, breaking
    // every test after the first. vi.unstubAllGlobals restores the fetch
    // global; spies are cleaned individually via mockRestore() in-test.
    vi.unstubAllGlobals();
  });

  describe("refreshOnce — process-wide serialization", () => {
    it("runs only one network refresh for two concurrent callers", async () => {
      // Make fetch resolve slowly so both callers are definitely in flight
      // at the same time.
      let resolveFetch!: (value: Response) => void;
      fetchSpy.mockImplementation(
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

      resolveFetch(buildFetchResponse(payload));

      const [r1, r2] = await Promise.all([p1, p2]);

      // Critical assertion: exactly one fetch call despite two callers.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(r1).toBe(r2); // same resolved value object
      expect(r1.status).toBe(true);
      expect(r1.data?.accessToken).toBe("new-access");

      // Slot cleared after completion.
      expect(TokenRefreshService.isRefreshInFlight()).toBe(false);
    });

    it("clears the in-flight slot after a failed refresh", async () => {
      fetchSpy.mockResolvedValue(
        buildFetchResponse(
          { status: false, code: 500, msg: "server error", data: undefined },
          { ok: true, status: 200 }
        )
      );

      await expect(TokenRefreshService.refreshOnce()).rejects.toThrow(
        /server error|Token refresh failed/
      );

      expect(TokenRefreshService.isRefreshInFlight()).toBe(false);

      // A subsequent call must issue a NEW fetch (slot was cleared).
      fetchSpy.mockResolvedValue(
        buildFetchResponse({
          status: true,
          code: 0,
          msg: "ok",
          data: { accessToken: "a", refreshToken: "r", expiresIn: 60 },
        })
      );
      await TokenRefreshService.refreshOnce();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("preserves backward-compat instance.refreshAccessToken() by delegating to refreshOnce()", async () => {
      fetchSpy.mockResolvedValue(
        buildFetchResponse({
          status: true,
          code: 0,
          msg: "ok",
          data: { accessToken: "a", refreshToken: "r", expiresIn: 60 },
        })
      );

      const service = new TokenRefreshService();
      const result = await service.refreshAccessToken();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(true);
      expect(result.data?.accessToken).toBe("a");
    });
  });

  describe("case-insensitive refresh-token-invalid handling", () => {
    // The auto-refresh code path checks the error message and stops the
    // auto-refresh timer when the refresh token is invalid. We exercise the
    // lowercase backend message that previously slipped past a capital-I
    // match (B6 fix).
    it("stops auto-refresh on lowercase 'invalid or expired refresh token'", async () => {
      fetchSpy.mockResolvedValue(
        buildFetchResponse({
          status: false,
          code: 401,
          msg: "invalid or expired refresh token",
          data: undefined,
        })
      );

      // Spy on stopAutoRefresh to verify the early-stop branch fires,
      // without actually running it (we'll stop the timer manually below).
      const stopSpy = vi
        .spyOn(TokenRefreshService, "stopAutoRefresh")
        .mockImplementation(() => undefined);

      TokenRefreshService.startAutoRefresh();

      // Wait for the initial auto-refresh check to settle.
      await vi.waitFor(() => {
        expect(stopSpy).toHaveBeenCalled();
      });

      // Restore the real implementation and force-stop the timer to clean up.
      stopSpy.mockRestore();
      TokenRefreshService.stopAutoRefresh();
    });
  });
});
