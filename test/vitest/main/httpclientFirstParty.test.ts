"use strict";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// --- Mocks (mirrors test/vitest/utilitycode/httpclientRefresh.test.ts) ------

const mockTokenGetValue = vi.hoisted(() =>
  vi.fn<(...args: [string]) => string>().mockReturnValue("")
);

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: mockTokenGetValue,
  })),
}));

const mockRefreshOnce = vi.hoisted(() =>
  vi.fn<(...args: []) => Promise<unknown>>()
);

vi.mock("@/modules/tokenRefresh", () => {
  class RefreshTokenInvalidError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RefreshTokenInvalidError";
    }
  }
  const Stub = vi.fn().mockImplementation(() => ({}));
  (Stub as unknown as { refreshOnce: typeof mockRefreshOnce }).refreshOnce =
    mockRefreshOnce;
  return { RefreshTokenInvalidError, TokenRefreshService: Stub };
});

vi.mock("@/modules/fieldCipher", () => ({
  userSecretKeyService: {
    invalidate: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: {
    getName: vi.fn(() => "aiFetchly"),
    getPath: vi.fn(() => "/tmp/test"),
  },
  BrowserWindow: vi.fn(),
}));

process.env.VITE_LOGIN_URL = "http://localhost:3000";
process.env.VITE_PLUGIN_HUB_URL = "https://plugins.example.com";

import { HttpClient } from "@/modules/lib/httpclient";

const HUB_URL = "https://plugins.example.com/api/v1/plugins/catalog";

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

describe("HttpClient.getFirstParty", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let client: HttpClient;

  beforeEach(() => {
    mockTokenGetValue.mockReset();
    mockRefreshOnce.mockReset();
    mockTokenGetValue.mockImplementation((key: string) => {
      if (key === "user-social-market-token") return "current-access";
      return "";
    });
    fetchSpy = vi.fn() as unknown as typeof fetchSpy;
    vi.stubGlobal("fetch", fetchSpy);
    client = new HttpClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the absolute hub URL as-is (no baseUrl prefix)", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ plugins: [] }));
    const res = await client.getFirstParty<{ plugins: unknown[] }>(HUB_URL);
    expect(res.plugins).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(HUB_URL);
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe("GET");
  });

  it("attaches the marketing Bearer token from the Token store", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client.getFirstParty(HUB_URL);
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer current-access");
  });

  it("refuses a URL outside the configured hub origin (no fetch, no token)", async () => {
    await expect(
      client.getFirstParty("https://attacker.example.com/catalog")
    ).rejects.toThrow(/first-party/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a malformed URL", async () => {
    await expect(client.getFirstParty("not-a-url")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("on 401 refreshes once and retries the SAME absolute URL", async () => {
    mockTokenGetValue.mockImplementation((key: string) => {
      if (key === "user_refresh_token") return "stored-refresh-token";
      if (key === "user-social-market-token") return "stale-access";
      return "";
    });
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ plugins: [{ slug: "x" }] }));
    mockRefreshOnce.mockResolvedValue({
      status: true,
      data: { accessToken: "fresh-access" },
    });

    const res = await client.getFirstParty<{ plugins: unknown[] }>(HUB_URL);

    expect(res.plugins).toEqual([{ slug: "x" }]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(HUB_URL);
    expect(fetchSpy.mock.calls[1][0]).toBe(HUB_URL);
    const retryHeaders = (fetchSpy.mock.calls[1][1] as RequestInit)
      .headers as Record<string, string>;
    expect(retryHeaders["Authorization"]).toBe("Bearer fresh-access");
  });
});
