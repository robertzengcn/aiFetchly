import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HttpClient } from "@/modules/lib/httpclient";
import { HttpResponseError } from "@/modules/lib/httpResponseError";

// HttpClient's constructor and refresh path pull in Token/user/tokenRefresh,
// whose transitive imports (WebSocketClient → ws) cannot resolve in vitest.
// Mock them at the boundary, matching the established httpclientRefresh test.
const mockTokenGetValue = vi.hoisted(() =>
  vi.fn<(key: string) => string>().mockReturnValue("")
);

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: mockTokenGetValue,
    setValue: vi.fn(),
  })),
}));

vi.mock("@/modules/user", () => ({
  User: vi.fn().mockImplementation(() => ({ removeToken: vi.fn() })),
}));

vi.mock("@/modules/tokenRefresh", () => {
  class RefreshTokenInvalidError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RefreshTokenInvalidError";
    }
  }
  const Stub = vi.fn().mockImplementation(() => ({}));
  (Stub as unknown as { refreshOnce: () => Promise<unknown> }).refreshOnce =
    () =>
      Promise.reject(new RefreshTokenInvalidError("no refresh in this test"));
  return { RefreshTokenInvalidError, TokenRefreshService: Stub };
});

vi.mock("@/modules/fieldCipher", () => ({
  userSecretKeyService: { invalidate: vi.fn() },
}));

// HttpClient constructor calls resolveViteLoginBase() + Token; both are
// env/store driven. Set a login URL so the constructor does not throw.
process.env.VITE_LOGIN_URL = "http://localhost:3000";

/**
 * Build a fake fetch Response that returns a JSON body and the given status.
 * `ok` follows fetch semantics. `headers` is a plain map for Retry-After etc.
 */
function jsonResponse(
  payload: unknown,
  init: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  } = {}
): Response {
  const status = init.status ?? 200;
  const headers = new Map<string, string>(Object.entries(init.headers ?? {}));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? "",
    json: () => Promise.resolve(payload),
    text: () =>
      Promise.resolve(
        typeof payload === "string" ? payload : JSON.stringify(payload)
      ),
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    } as unknown as Headers,
  } as unknown as Response;
}

describe("HttpResponseError", () => {
  it("is an Error subclass carrying status, body, serverCode, and retryAfterMs", () => {
    const err = new HttpResponseError(
      "no small model",
      404,
      "{}",
      5000,
      "small_model_unavailable"
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpResponseError);
    expect(err.name).toBe("HttpResponseError");
    expect(err.status).toBe(404);
    expect(err.responseBody).toBe("{}");
    expect(err.serverCode).toBe("small_model_unavailable");
    expect(err.retryAfterMs).toBe(5000);
    expect(err.message).toBe("no small model");
  });

  it("allows optional serverCode and retryAfterMs to be absent", () => {
    const err = new HttpResponseError("boom", 500, "body");
    expect(err.serverCode).toBeUndefined();
    expect(err.retryAfterMs).toBeUndefined();
  });
});

describe("HttpClient._fetchJSON typed non-success errors", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let client: HttpClient;

  /**
   * Capture the thrown error from a rejecting promise as an
   * {@link HttpResponseError}. Asserts the value is an HttpResponseError so
   * downstream property access is statically safe.
   */
  async function captureError(p: Promise<unknown>): Promise<HttpResponseError> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(HttpResponseError);
      return e as HttpResponseError;
    }
    throw new Error("expected _fetchJSON to reject, but it resolved");
  }

  beforeEach(() => {
    fetchSpy = vi.fn() as unknown as typeof fetchSpy;
    vi.stubGlobal("fetch", fetchSpy);
    client = new HttpClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws HttpResponseError preserving status, server code, and bounded body on a 404", async () => {
    const body = {
      error: {
        code: "small_model_unavailable",
        message: "No small model configured",
      },
    };
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(body, { status: 404, statusText: "Not Found" })
    );

    await expect(
      client._fetchJSON("/api/ai/v1/chat/completions", { method: "POST" })
    ).rejects.toMatchObject({
      name: "HttpResponseError",
      status: 404,
      serverCode: "small_model_unavailable",
    });
  });

  it("parses Retry-After (seconds) into retryAfterMs with an upper bound", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "rate_limited" } },
        {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "retry-after": "2" },
        }
      )
    );

    await expect(
      client._fetchJSON("/x", { method: "GET" })
    ).rejects.toMatchObject({ name: "HttpResponseError", status: 429 });
  });

  it("caps an absurd Retry-After value at the configured upper bound", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {},
        {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "retry-after": "999999" },
        }
      )
    );

    const err = await captureError(client._fetchJSON("/x", { method: "GET" }));
    expect(err).toBeInstanceOf(HttpResponseError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("does not log the response body", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        { secret: "sk-leaked-key" },
        {
          status: 500,
          statusText: "Internal Server Error",
        }
      )
    );

    await expect(
      client._fetchJSON("/x", { method: "GET" })
    ).rejects.toBeInstanceOf(HttpResponseError);

    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .some((c) => typeof c === "string" && c.includes("sk-leaked-key"));
    expect(logged).toBe(false);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("reads at most 16 KiB of the response body", async () => {
    // Build a body larger than 16 KiB; only the first 16 KiB should be retained.
    const overlong = "x".repeat(20_000);
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(overlong, { status: 500, statusText: "err" })
    );

    const err = await captureError(client._fetchJSON("/x", { method: "GET" }));
    expect(err).toBeInstanceOf(HttpResponseError);
    expect(err.responseBody.length).toBeLessThanOrEqual(16_384);
  });

  it("tolerates a non-JSON body without throwing during code parsing", async () => {
    const res = {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("plain text not json"),
      headers: { get: () => null } as unknown as Headers,
    } as unknown as Response;
    fetchSpy.mockResolvedValueOnce(res);

    const err = await captureError(client._fetchJSON("/x", { method: "GET" }));
    expect(err).toBeInstanceOf(HttpResponseError);
    expect(err.status).toBe(502);
    expect(err.serverCode).toBeUndefined();
  });
});
