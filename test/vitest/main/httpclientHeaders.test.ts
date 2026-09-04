"use strict";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ----------------------------------------------------------------

const mockTokenGetValue = vi.hoisted(() =>
  vi.fn<(key: string) => string>().mockReturnValue("")
);

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: mockTokenGetValue,
  })),
}));

vi.mock("@/modules/fieldCipher", () => ({
  userSecretKeyService: {
    invalidate: vi.fn(),
  },
}));

// Set login URL for resolveViteLoginBase() used by HttpClient constructor.
process.env.VITE_LOGIN_URL = "http://localhost:3000";

import { HttpClient } from "@/modules/lib/httpclient";

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "",
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

describe("HttpClient per-call header preservation", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let client: HttpClient;

  beforeEach(() => {
    mockTokenGetValue.mockClear();
    // No stored access token: constructor's setheaderToken() resolves to no-op,
    // so this._headers stays empty and only per-call headers apply.
    mockTokenGetValue.mockImplementation(() => "");

    fetchSpy = vi.fn() as unknown as typeof fetchSpy;
    vi.stubGlobal("fetch", fetchSpy);

    client = new HttpClient();
  });

  afterEach(() => {
    // Do NOT call vi.restoreAllMocks() — it wipes the vi.mock factories.
    vi.unstubAllGlobals();
  });

  it("postJson sends Content-Type: application/json on the wire", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: true }));

    await client.postJson("/api/ai/content-reports", { schemaVersion: 1 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> }
    ];
    expect(url).toContain("/api/ai/content-reports");
    // The strict backend (marketing ai_content_report_controller) answers 415
    // unless Content-Type is application/json — the per-call header must
    // survive _fetchJSON's instance-header spread.
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
  });

  it("postJson merges Authorization with per-call Content-Type", async () => {
    client.setHeader("Authorization", "Bearer stored-token");
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: true }));

    await client.postJson("/api/ai/content-reports", { schemaVersion: 1 });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> }
    ];
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer stored-token",
    });
  });

  it("put sends Content-Type: application/json on the wire", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: true }));

    await client.put("/api/emailfilter/create", { name: "x" });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> }
    ];
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
    });
  });

  it("per-call options.headers override instance headers (caller wins)", async () => {
    client.setHeader("Authorization", "Bearer stored-token");
    client.setHeader("Content-Type", "application/xml");
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: true }));

    await client.postJson("/api/ai/content-reports", { schemaVersion: 1 });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> }
    ];
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
    });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
  });

  it("postJson preserves a caller-supplied custom header (e.g. install id)", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: true }));

    await client.postJson(
      "/api/ai/content-reports",
      { schemaVersion: 1 },
      { headers: { "X-AiFetchly-Install-Id": "inst-123" } }
    );

    const [, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> }
    ];
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-AiFetchly-Install-Id": "inst-123",
    });
  });
});
