import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// We exercise the real HttpClient._fetchJSON path with a mocked global fetch.
// Stub the modules HttpClient imports so the class can construct in node.
vi.mock("@/modules/lib/electronStore", () => ({
  ElectronStoreService: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));
vi.mock("@/config/usersetting", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn(() => "tok"),
    setValue: vi.fn(),
  })),
  REFRESHTOKEN: "refreshtoken",
  USER_AI_ENABLED: "true",
}));
vi.mock("@/modules/lib/webWorkerIdentifier", () => ({
  isWorker: () => false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workerIdentifier: {} as any,
}));

import { HttpClient } from "@/modules/lib/httpclient";

function makeResponse(
  status: number,
  statusText: string,
  body: unknown
): Response {
  return {
    status,
    statusText,
    ok: status >= 200 && status < 300,
    json: async () => body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("HttpResponseError", () => {
  let originalFetch: typeof globalThis.fetch;
  const client = new HttpClient();

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("is thrown with numeric status for 413 payload too large", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(makeResponse(413, "Payload Too Large", {}));
    await expect(client.get("/x")).rejects.toMatchObject({
      name: "HttpResponseError",
      status: 413,
      statusText: "Payload Too Large",
    });
  });

  it("is thrown for 429 rate limited", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(makeResponse(429, "Too Many Requests", {}));
    await expect(client.get("/x")).rejects.toMatchObject({ status: 429 });
  });

  it("is thrown for 500 server error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(makeResponse(500, "Internal Server Error", {}));
    await expect(client.get("/x")).rejects.toMatchObject({ status: 500 });
  });

  it("is thrown for 422 invalid", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(makeResponse(422, "Unprocessable Entity", {}));
    await expect(client.get("/x")).rejects.toMatchObject({ status: 422 });
  });

  it("passes through 2xx responses unchanged", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(makeResponse(200, "OK", { ok: true }));
    await expect(client.get<{ ok: boolean }>("/x")).resolves.toEqual({
      ok: true,
    });
  });
});
