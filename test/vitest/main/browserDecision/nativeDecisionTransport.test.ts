import { describe, expect, it, vi } from "vitest";
import {
  NativeEndpointError,
  postNativeDecision,
  validateNativeEndpoint,
} from "@/service/browserDecision/NativeDecisionTransport";

/**
 * B03/D-FR-02–04: the native transport posts to the EXACT profile
 * endpoint with ONLY the explicitly selected credential — never the
 * hosted base or hosted auth state. A fake fetch captures the final URL
 * and header PRESENCE (never secret values).
 */
const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

describe("NativeDecisionTransport (B03)", () => {
  it("posts to the EXACT endpoint with no hosted headers, Bearer only when a key is selected", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(okResponse({ status: "decided" }));
    await postNativeDecision(
      "https://native.example.test/v1/decision",
      { model: "m", question: {} },
      { apiKey: "chat-key-1" },
      new AbortController().signal
    );
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    // The destination is the profile URL AS CONFIGURED.
    expect(url).toBe("https://native.example.test/v1/decision");
    expect(init.headers["Content-Type"]).toBe("application/json");
    // The selected credential rides as Bearer.
    expect(init.headers.Authorization).toBe("Bearer chat-key-1");
  });

  it("no selected credential sends NO Authorization header at all", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(okResponse({ status: "decided" }));
    await postNativeDecision(
      "https://native.example.test/v1/decision",
      {},
      { apiKey: null },
      new AbortController().signal
    );
    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("non-2xx surfaces a typed status failure (401 is an auth failure)", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as unknown as Response);
    await expect(
      postNativeDecision(
        "https://native.example.test/v1/decision",
        {},
        { apiKey: "k" },
        new AbortController().signal
      )
    ).rejects.toThrow("native_request_failed_401");
  });

  it("HTTP (non-HTTPS) and unparseable endpoints are refused BEFORE any request", async () => {
    fetchMock.mockReset();
    expect(() =>
      validateNativeEndpoint("http://native.example.test/v1")
    ).toThrow(NativeEndpointError);
    expect(() => validateNativeEndpoint("not a url")).toThrow(
      NativeEndpointError
    );
    await expect(
      postNativeDecision(
        "http://native.example.test/v1",
        {},
        { apiKey: null },
        new AbortController().signal
      )
    ).rejects.toThrow(NativeEndpointError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
