import { describe, it, expect } from "vitest";
import {
  classifyLightweightFailure,
  isSameRouteRetryable,
  allowsNormalFallback,
} from "@/service/AIChatLightweightFailureClassifier";
import { HttpResponseError } from "@/modules/lib/httpResponseError";
import { AIProviderError } from "@/service/aiProvider/AIProviderError";
import { AIChatLightweightFailure } from "@/service/AIChatLightweightTypes";

describe("classifyLightweightFailure", () => {
  it("classifies a 404 HttpResponseError as small_model_unavailable", () => {
    const err = new HttpResponseError("Not Found", 404, "{}");
    const c = classifyLightweightFailure(err);
    expect(c.reason).toBe("small_model_unavailable");
    expect(c.definitive).toBe(true);
    expect(c.status).toBe(404);
  });

  it("classifies a server code small_model_unavailable regardless of status", () => {
    const err = new HttpResponseError(
      "no small",
      503,
      '{"error":{"code":"small_model_unavailable"}}',
      undefined,
      "small_model_unavailable"
    );
    const c = classifyLightweightFailure(err);
    expect(c.reason).toBe("small_model_unavailable");
    expect(c.serverCode).toBe("small_model_unavailable");
  });

  it("classifies 401/403 as authentication", () => {
    expect(
      classifyLightweightFailure(new HttpResponseError("u", 401, "")).reason
    ).toBe("authentication");
    expect(
      classifyLightweightFailure(new HttpResponseError("f", 403, "")).reason
    ).toBe("authentication");
  });

  it("classifies 402 as quota", () => {
    expect(
      classifyLightweightFailure(new HttpResponseError("q", 402, "")).reason
    ).toBe("quota");
  });

  it("classifies 429 as rate_limit with retryAfterMs", () => {
    const c = classifyLightweightFailure(
      new HttpResponseError("rl", 429, "", 5000)
    );
    expect(c.reason).toBe("rate_limit");
    expect(c.retryAfterMs).toBe(5000);
  });

  it("classifies 500/502/503/504 as server_error", () => {
    for (const s of [500, 502, 503, 504]) {
      expect(
        classifyLightweightFailure(new HttpResponseError("se", s, "")).reason
      ).toBe("server_error");
    }
  });

  it("classifies 400/422 as invalid_request", () => {
    expect(
      classifyLightweightFailure(new HttpResponseError("b", 400, "")).reason
    ).toBe("invalid_request");
    expect(
      classifyLightweightFailure(new HttpResponseError("u", 422, "")).reason
    ).toBe("invalid_request");
  });

  it("classifies HTTP 413 as context_overflow (definitive)", () => {
    const c = classifyLightweightFailure(
      new HttpResponseError("too big", 413, "")
    );
    expect(c.reason).toBe("context_overflow");
    expect(c.definitive).toBe(true);
    expect(c.status).toBe(413);
  });

  it("classifies a model_specific_overload server code as model_specific_overload", () => {
    const c = classifyLightweightFailure(
      new HttpResponseError(
        "overloaded",
        503,
        '{"error":{"code":"small_model_overloaded"}}',
        undefined,
        "small_model_overloaded"
      )
    );
    expect(c.reason).toBe("model_specific_overload");
    expect(c.definitive).toBe(true);
    expect(c.serverCode).toBe("small_model_overloaded");
  });

  it("classifies caller-abort as cancelled when the caller signal aborted", () => {
    const controller = new AbortController();
    controller.abort();
    const c = classifyLightweightFailure(
      new DOMException("aborted", "AbortError"),
      controller.signal
    );
    expect(c.reason).toBe("cancelled");
    expect(c.definitive).toBe(true);
  });

  it("classifies a non-caller AbortError as timeout_ambiguous (not retried)", () => {
    const c = classifyLightweightFailure(
      new DOMException("aborted", "AbortError")
    );
    expect(c.reason).toBe("timeout_ambiguous");
    expect(c.definitive).toBe(false);
  });

  it("classifies fetch-failed messages as network_ambiguous", () => {
    const c = classifyLightweightFailure(new Error("fetch failed: ECONNRESET"));
    expect(c.reason).toBe("network_ambiguous");
    expect(c.definitive).toBe(false);
  });

  it("classifies timeout messages as timeout_ambiguous", () => {
    const c = classifyLightweightFailure(new Error("Request timed out"));
    expect(c.reason).toBe("timeout_ambiguous");
  });

  it("classifies AIProviderError auth -> authentication", () => {
    const c = classifyLightweightFailure(
      new AIProviderError("no key", "auth", { status: 401 })
    );
    expect(c.reason).toBe("authentication");
  });

  it("classifies AIProviderError network -> network_ambiguous", () => {
    const c = classifyLightweightFailure(
      new AIProviderError("down", "network")
    );
    expect(c.reason).toBe("network_ambiguous");
    expect(c.definitive).toBe(false);
  });

  it("classifies AIProviderError not_found -> invalid_request (not small_model_unavailable)", () => {
    const c = classifyLightweightFailure(
      new AIProviderError("no model", "not_found", { status: 404 })
    );
    expect(c.reason).toBe("invalid_request");
  });

  it("collapses unknown shapes to unknown", () => {
    const c = classifyLightweightFailure({ weird: true });
    expect(c.reason).toBe("unknown");
  });
});

describe("retry / fallback predicates", () => {
  it("isSameRouteRetryable is true only for rate_limit and server_error", () => {
    expect(isSameRouteRetryable("rate_limit")).toBe(true);
    expect(isSameRouteRetryable("server_error")).toBe(true);
    expect(isSameRouteRetryable("small_model_unavailable")).toBe(false);
    expect(isSameRouteRetryable("timeout_ambiguous")).toBe(false);
    expect(isSameRouteRetryable("authentication")).toBe(false);
  });

  it("allowsNormalFallback covers the definitive small-route reasons compact may fall back from", () => {
    expect(allowsNormalFallback("small_model_unavailable")).toBe(true);
    expect(allowsNormalFallback("context_overflow")).toBe(true);
    expect(allowsNormalFallback("invalid_output")).toBe(true);
    expect(allowsNormalFallback("model_specific_overload")).toBe(true);
    // Ambiguous and definitive non-small reasons do not permit fallback.
    expect(allowsNormalFallback("timeout_ambiguous")).toBe(false);
    expect(allowsNormalFallback("authentication")).toBe(false);
    expect(allowsNormalFallback("server_error")).toBe(false);
  });
});

describe("AIChatLightweightFailure", () => {
  it("carries the typed reason and definitive flag", () => {
    const f = new AIChatLightweightFailure({
      reason: "small_model_unavailable",
      message: "no small",
      status: 404,
      definitive: true,
    });
    expect(f.reason).toBe("small_model_unavailable");
    expect(f.definitive).toBe(true);
    expect(f).toBeInstanceOf(Error);
  });

  it("defaults definitive to true", () => {
    const f = new AIChatLightweightFailure({
      reason: "unknown",
      message: "x",
    });
    expect(f.definitive).toBe(true);
  });
});
