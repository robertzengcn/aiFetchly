import { describe, expect, it, vi, afterEach } from "vitest";
import { HttpClient } from "@/modules/lib/httpclient";

/**
 * Titles audit B05: strict single-dispatch requests must never be replayed by
 * the shared HTTP layer's auth-refresh path. This exercises the REAL
 * HttpClient boundary (only global fetch is stubbed) — mocking postJson in
 * the routing suites hides exactly this replay.
 */
describe("HttpClient noAuthReplay (titles B05)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("a 401 with noAuthReplay throws after exactly ONE POST — no refresh, no replay", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { message: "token expired" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpClient();
    await expect(
      client.postJson("/api/ai/v1/chat/completions", { model: "small" }, {
        noAuthReplay: true,
      } as Parameters<HttpClient["postJson"]>[2])
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a 403 with noAuthReplay also surfaces after exactly ONE POST", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(403, { message: "forbidden" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpClient();
    await expect(
      client.postJson("/api/ai/v1/chat/completions", { model: "small" }, {
        noAuthReplay: true,
      } as Parameters<HttpClient["postJson"]>[2])
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a 404 is unaffected (still a typed single-request error)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(404, { message: "no small model" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpClient();
    await expect(
      client.postJson("/api/ai/v1/chat/completions", { model: "small" }, {
        noAuthReplay: true,
      } as Parameters<HttpClient["postJson"]>[2])
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
