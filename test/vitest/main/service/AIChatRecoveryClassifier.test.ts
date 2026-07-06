import { describe, expect, it } from "vitest";
import {
  AIChatRecoveryClassifier,
  looksTruncatedJson,
  parseRateLimitReset,
  parseRetryAfter,
  snapshotHeaders,
} from "@/service/AIChatRecoveryClassifier";
import { AIChatRecoverableError } from "@/service/AIChatRecoveryTypes";

const classifier = new AIChatRecoveryClassifier();

function headersFrom(obj: Record<string, string>): Headers {
  return new Headers(obj);
}

describe("AIChatRecoveryClassifier", () => {
  describe("classifyHttpFailure", () => {
    it("classifies 401/403 as auth", () => {
      expect(
        classifier.classifyHttpFailure({ status: 401 }).reason
      ).toBe("auth");
      expect(
        classifier.classifyHttpFailure({ status: 403 }).reason
      ).toBe("auth");
    });

    it("classifies 402 as quota", () => {
      expect(classifier.classifyHttpFailure({ status: 402 }).reason).toBe(
        "quota"
      );
    });

    it("classifies 408 and 409 as timeout", () => {
      expect(classifier.classifyHttpFailure({ status: 408 }).reason).toBe(
        "timeout"
      );
      expect(classifier.classifyHttpFailure({ status: 409 }).reason).toBe(
        "timeout"
      );
    });

    it("classifies 413 with image body as media_overflow", () => {
      const err = classifier.classifyHttpFailure({
        status: 413,
        responseBody: "Image too large for processing",
      });
      expect(err.reason).toBe("media_overflow");
    });

    it("classifies 413 with prompt body as context_overflow", () => {
      const err = classifier.classifyHttpFailure({
        status: 413,
        responseBody: "Prompt Too Long for context limit",
      });
      expect(err.reason).toBe("context_overflow");
    });

    it("classifies 429 as rate_limit and parses Retry-After seconds", () => {
      const err = classifier.classifyHttpFailure({
        status: 429,
        headers: headersFrom({ "retry-after": "30" }),
      });
      expect(err.reason).toBe("rate_limit");
      expect(err.retryAfterMs).toBe(30_000);
    });

    it("classifies 404/410 as model_unavailable", () => {
      expect(classifier.classifyHttpFailure({ status: 404 }).reason).toBe(
        "model_unavailable"
      );
      expect(classifier.classifyHttpFailure({ status: 410 }).reason).toBe(
        "model_unavailable"
      );
    });

    it("classifies 529 as overload", () => {
      expect(classifier.classifyHttpFailure({ status: 529 }).reason).toBe(
        "overload"
      );
    });

    it("classifies 500/502/503/504 as server_error", () => {
      expect(classifier.classifyHttpFailure({ status: 500 }).reason).toBe(
        "server_error"
      );
      expect(classifier.classifyHttpFailure({ status: 502 }).reason).toBe(
        "server_error"
      );
      expect(classifier.classifyHttpFailure({ status: 503 }).reason).toBe(
        "server_error"
      );
      expect(classifier.classifyHttpFailure({ status: 504 }).reason).toBe(
        "server_error"
      );
    });

    it("overrides 500 body with overloaded_error → overload", () => {
      const err = classifier.classifyHttpFailure({
        status: 500,
        responseBody: '{"error":"overloaded_error"}',
      });
      expect(err.reason).toBe("overload");
    });

    it("overrides 500 body with max_output_tokens → output_limit", () => {
      const err = classifier.classifyHttpFailure({
        status: 500,
        responseBody: "Hit max_output_tokens limit",
      });
      expect(err.reason).toBe("output_limit");
    });

    it("parses HTTP-date Retry-After", () => {
      const future = new Date(Date.now() + 60_000).toUTCString();
      const err = classifier.classifyHttpFailure({
        status: 429,
        headers: headersFrom({ "retry-after": future }),
      });
      expect(err.retryAfterMs).toBeGreaterThan(30_000);
      expect(err.retryAfterMs).toBeLessThanOrEqual(60_000);
    });

    it("parses anthropic-ratelimit-unified-reset", () => {
      const err = classifier.classifyHttpFailure({
        status: 429,
        headers: headersFrom({
          "anthropic-ratelimit-unified-reset": "80",
        }),
      });
      expect(err.rateLimitResetMs).toBe(80_000);
    });

    it("returns non_recoverable for unknown status without body", () => {
      expect(classifier.classifyHttpFailure({ status: 418 }).reason).toBe(
        "non_recoverable"
      );
    });

    it("snapshots headers", () => {
      const err = classifier.classifyHttpFailure({
        status: 429,
        headers: headersFrom({ "Retry-After": "2" }),
      });
      expect(err.headers?.["retry-after"]).toBe("2");
    });
  });

  describe("classifyThrown", () => {
    it("passes through existing AIChatRecoverableError", () => {
      const original = new AIChatRecoverableError({
        reason: "overload",
        message: "x",
      });
      expect(classifier.classifyThrown(original)).toBe(original);
    });

    it("classifies AbortError as cancelled", () => {
      const err = new DOMException("aborted", "AbortError");
      const result = classifier.classifyThrown(err);
      expect(result.reason).toBe("cancelled");
      expect(result.originalError).toBe(err);
    });

    it("classifies ECONNRESET as network", () => {
      const err = new Error("read ECONNRESET");
      expect(classifier.classifyThrown(err).reason).toBe("network");
    });

    it("classifies fetch failed as network", () => {
      const err = new Error("fetch failed");
      expect(classifier.classifyThrown(err).reason).toBe("network");
    });

    it("classifies Failed to fetch as network", () => {
      const err = new Error("Failed to fetch");
      expect(classifier.classifyThrown(err).reason).toBe("network");
    });

    it("classifies ETIMEDOUT as timeout", () => {
      const err = new Error("connect ETIMEDOUT 10.0.0.1:443");
      expect(classifier.classifyThrown(err).reason).toBe("timeout");
    });

    it("classifies TimeoutError by name as timeout", () => {
      const err = new Error("operation timed out");
      err.name = "TimeoutError";
      expect(classifier.classifyThrown(err).reason).toBe("timeout");
    });

    it("classifies AI server JSON envelope 500 errors as server_error", () => {
      const err = new Error(
        "AI server error code=500: database connection is not open"
      );
      expect(classifier.classifyThrown(err).reason).toBe("server_error");
    });

    it("classifies unknown errors as non_recoverable", () => {
      const err = new Error("something unusual");
      expect(classifier.classifyThrown(err).reason).toBe("non_recoverable");
    });

    it("classifies string errors", () => {
      expect(
        classifier.classifyThrown("connect ECONNREFUSED").reason
      ).toBe("network");
      expect(classifier.classifyThrown("anything else").reason).toBe(
        "non_recoverable"
      );
    });

    it("classifies non-error, non-string throws", () => {
      const result = classifier.classifyThrown({ weird: true });
      expect(result.reason).toBe("non_recoverable");
    });
  });

  describe("classifyStreamFinish", () => {
    it("returns null for normal content", () => {
      expect(
        classifier.classifyStreamFinish({
          finishReason: "stop",
          fullContent: "hello",
          sawToolCallDelta: false,
        })
      ).toBeNull();
    });

    it("classifies finish_reason=length as output_limit", () => {
      const err = classifier.classifyStreamFinish({
        finishReason: "length",
        fullContent: "partial",
        sawToolCallDelta: false,
      });
      expect(err?.reason).toBe("output_limit");
    });

    it("classifies finish_reason=max_tokens as output_limit", () => {
      const err = classifier.classifyStreamFinish({
        finishReason: "max_tokens",
        fullContent: "partial",
        sawToolCallDelta: false,
      });
      expect(err?.reason).toBe("output_limit");
    });

    it("classifies finish_reason=error with empty content as server_error", () => {
      const err = classifier.classifyStreamFinish({
        finishReason: "error",
        fullContent: "",
        sawToolCallDelta: false,
      });
      expect(err?.reason).toBe("server_error");
    });

    it("classifies empty content and no finish reason as server_error", () => {
      const err = classifier.classifyStreamFinish({
        finishReason: null,
        fullContent: "   ",
        sawToolCallDelta: false,
      });
      expect(err?.reason).toBe("server_error");
    });

    it("classifies truncated tool-call JSON as output_limit", () => {
      const err = classifier.classifyStreamFinish({
        finishReason: "stop",
        fullContent: "",
        sawToolCallDelta: true,
        rawToolArguments: ['{"path":"/foo","lim'],
      });
      expect(err?.reason).toBe("output_limit");
    });

    it("does not flag well-formed tool-call JSON as truncated", () => {
      const err = classifier.classifyStreamFinish({
        finishReason: "stop",
        fullContent: "",
        sawToolCallDelta: true,
        rawToolArguments: ['{"path":"/foo"}'],
      });
      // No truncation, finishReason=stop with content "" but sawToolCallDelta
      // → not a recoverable stream-finish case here.
      expect(err).toBeNull();
    });
  });
});

describe("parseRetryAfter", () => {
  it("returns undefined for empty/missing input", () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("   ")).toBeUndefined();
  });

  it("parses integer seconds", () => {
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter("120")).toBe(120_000);
  });

  it("parses HTTP-date", () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThan(30_000);
    expect(ms).toBeLessThanOrEqual(60_000);
  });

  it("caps at MAX_RETRY_AFTER_MS (5 min)", () => {
    expect(parseRetryAfter("99999999")).toBe(5 * 60_000);
  });

  it("returns undefined for garbage", () => {
    expect(parseRetryAfter("not-a-date")).toBeUndefined();
    expect(parseRetryAfter("abc123")).toBeUndefined();
  });
});

describe("parseRateLimitReset", () => {
  it("parses seconds form", () => {
    expect(parseRateLimitReset("80")).toBe(80_000);
  });

  it("parses explicit 's' suffix", () => {
    expect(parseRateLimitReset("80s")).toBe(80_000);
  });

  it("parses 'ms' suffix", () => {
    expect(parseRateLimitReset("800ms")).toBe(800);
  });

  it("parses decimal seconds", () => {
    expect(parseRateLimitReset("1.5")).toBe(1500);
  });

  it("parses HTTP-date", () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    expect(parseRateLimitReset(future)).toBeGreaterThan(10_000);
  });

  it("returns undefined for garbage", () => {
    expect(parseRateLimitReset("soon")).toBeUndefined();
  });

  it("returns 0 for past HTTP-date", () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRateLimitReset(past)).toBe(0);
  });
});

describe("snapshotHeaders", () => {
  it("returns undefined for empty input", () => {
    expect(snapshotHeaders(undefined)).toBeUndefined();
    expect(snapshotHeaders(null)).toBeUndefined();
  });

  it("snapshots a Headers object with lowercased keys", () => {
    const h = new Headers({ "Retry-After": "10", "X-Custom": "v" });
    const snap = snapshotHeaders(h);
    expect(snap?.["retry-after"]).toBe("10");
    expect(snap?.["x-custom"]).toBe("v");
  });
});

describe("looksTruncatedJson", () => {
  it("flags unclosed object", () => {
    expect(looksTruncatedJson('{"a":1')).toBe(true);
  });

  it("flags unclosed array", () => {
    expect(looksTruncatedJson('["a","b"')).toBe(true);
  });

  it("does not flag complete object", () => {
    expect(looksTruncatedJson('{"a":1}')).toBe(false);
  });

  it("does not flag complete array", () => {
    expect(looksTruncatedJson('["a"]')).toBe(false);
  });

  it("does not flag empty string or non-json", () => {
    expect(looksTruncatedJson("")).toBe(false);
    expect(looksTruncatedJson("not json")).toBe(false);
  });
});
