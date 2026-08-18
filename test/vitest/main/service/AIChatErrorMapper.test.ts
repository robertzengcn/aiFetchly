import { describe, expect, it, vi } from "vitest";

import {
  AUTH_EXPIRED_SENTINEL,
  QUOTA_EXHAUSTED_SENTINEL,
  describeErrorDetail,
  isAuthExpiredError,
  isContentLevelTransientError,
  isTransientRetryableError,
  userSafeError,
} from "@/service/AIChatErrorMapper";
import { AIChatRecoverableError } from "@/service/AIChatRecoveryTypes";
import { AIProviderError } from "@/service/aiProvider/AIProviderError";

describe("AIChatErrorMapper - userSafeError", () => {
  it("returns the quota sentinel on 402 / insufficient_quota", () => {
    expect(userSafeError(new Error("402 Payment Required"))).toBe(
      QUOTA_EXHAUSTED_SENTINEL
    );
    expect(userSafeError(new Error("insufficient_quota"))).toBe(
      QUOTA_EXHAUSTED_SENTINEL
    );
  });

  it("returns the auth-expired sentinel on 401/403 and refresh failures", () => {
    expect(userSafeError(new Error("401 Unauthorized"))).toBe(
      AUTH_EXPIRED_SENTINEL
    );
    expect(
      userSafeError(
        new Error("Authentication failed: Token expired. Please login again.")
      )
    ).toBe(AUTH_EXPIRED_SENTINEL);
    expect(userSafeError(new Error("Refresh token rejected (HTTP 401)"))).toBe(
      AUTH_EXPIRED_SENTINEL
    );
    expect(
      userSafeError(
        new Error("Authentication failed after token refresh retry (HTTP 403).")
      )
    ).toBe(AUTH_EXPIRED_SENTINEL);
    expect(
      isAuthExpiredError(
        new AIChatRecoverableError({
          reason: "auth",
          message: "HTTP 403 Forbidden (auth)",
          status: 403,
        })
      )
    ).toBe(true);
  });

  it("does not treat local provider auth errors as hosted session expiry", () => {
    const auth = new AIProviderError(
      "AI provider authentication failed. Check your API key.",
      "auth",
      { status: 401 }
    );
    expect(isAuthExpiredError(auth)).toBe(false);
    expect(userSafeError(auth)).toBe(
      "AI provider authentication failed. Check your API key."
    );
  });

  it("surfaces AIProviderError messages directly instead of the generic fallback", () => {
    const auth = new AIProviderError(
      "AI provider authentication failed. Check your API key.",
      "auth",
      { status: 401 }
    );
    // The message has no "401" substring, so without the instanceof check it
    // would fall through to "An unexpected error occurred."
    expect(userSafeError(auth)).toBe(
      "AI provider authentication failed. Check your API key."
    );

    const network = new AIProviderError(
      "Could not connect to the AI provider.",
      "network"
    );
    expect(userSafeError(network)).toBe(
      "Could not connect to the AI provider."
    );
  });

  it("returns a model-missing message on 404", () => {
    expect(userSafeError(new Error("404 Not Found"))).toBe(
      "Selected model is not available."
    );
  });

  it("returns a no-model message on 503", () => {
    expect(userSafeError(new Error("503 Service Unavailable"))).toBe(
      "No chat model is configured on the AI server."
    );
  });

  it("returns a connection message on network errors", () => {
    expect(userSafeError(new Error("Failed to fetch"))).toBe(
      "Could not connect to the AI server."
    );
  });

  it("maps finish_reason=error to the transient-issue message", () => {
    const msg = userSafeError(
      new Error(
        "AI server returned finish_reason=error (transient server-side failure, e.g. overload, rate limit, or timeout). Please try sending your message again."
      )
    );
    expect(msg).toBe(
      "The AI service is busy or had a transient issue. Please try again in a moment."
    );
  });

  it("maps empty-response / no-finish-reason errors to the transient-issue message", () => {
    expect(
      userSafeError(
        new Error(
          "AI server returned an empty response with no finish reason. This is typically a transient server issue (rate limit, timeout, or 502)."
        )
      )
    ).toBe(
      "The AI service is busy or had a transient issue. Please try again in a moment."
    );
  });

  it("maps AI server JSON envelope errors to the transient-issue message", () => {
    expect(
      userSafeError(
        new Error("AI server error code=500: database connection is not open")
      )
    ).toBe(
      "The AI service is busy or had a transient issue. Please try again in a moment."
    );
  });

  it("maps a classified HTTP 520 server failure to the transient-issue message", () => {
    expect(
      userSafeError(
        new AIChatRecoverableError({
          reason: "server_error",
          status: 520,
          message: "HTTP 520: <none>",
        })
      )
    ).toBe(
      "The AI service is busy or had a transient issue. Please try again in a moment."
    );
  });

  it("still falls back to the generic message for unknown errors", () => {
    expect(userSafeError(new Error("something else entirely"))).toBe(
      "An unexpected error occurred. Please try again."
    );
  });

  it("describeErrorDetail renders the top error plus its cause chain", () => {
    const cause = new Error("ECONNRESET");
    (cause as { code?: string }).code = "ECONNRESET";
    const terminated = new Error("terminated");
    (terminated as { cause?: unknown }).cause = cause;
    const detail = describeErrorDetail(terminated);
    expect(detail).toContain('error: name=Error message="terminated"');
    expect(detail).toContain('cause[0]: name=Error message="ECONNRESET"');
    expect(detail).toContain('cause[0].code="ECONNRESET"');
  });

  it("logs the full error detail for unmapped errors so the source is traceable", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(vi.fn());
    try {
      const cause = new Error("ECONNRESET");
      (cause as { code?: string }).code = "ECONNRESET";
      const terminated = new Error("terminated");
      (terminated as { cause?: unknown }).cause = cause;
      expect(userSafeError(terminated)).toBe(
        "An unexpected error occurred. Please try again."
      );
      const logged = spy.mock.calls.map((c) => c.join(" ")).join(" ");
      expect(logged).toContain("[ai-chat-v2] unmapped error: terminated");
      expect(logged).toContain('name=Error message="terminated"');
      expect(logged).toContain("cause[0]");
      expect(logged).toContain("ECONNRESET");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("AIChatErrorMapper - isTransientRetryableError", () => {
  it("flags the broad set of transient server-side failures for the user message", () => {
    expect(
      isTransientRetryableError(
        new Error(
          "AI server returned finish_reason=error (transient server-side failure)."
        )
      )
    ).toBe(true);
    expect(isTransientRetryableError(new Error("empty response"))).toBe(true);
    expect(isTransientRetryableError(new Error("no finish reason"))).toBe(true);
    expect(isTransientRetryableError(new Error("rate limit exceeded"))).toBe(
      true
    );
    expect(isTransientRetryableError(new Error("Request timeout"))).toBe(true);
    expect(
      isTransientRetryableError(new Error("upstream returned 502 Bad Gateway"))
    ).toBe(true);
    // Patterns added on the test branch that must be preserved.
    expect(
      isTransientRetryableError(new Error("AI server error code=503"))
    ).toBe(true);
    expect(
      isTransientRetryableError(new Error("database connection is not open"))
    ).toBe(true);
  });

  it("never classifies aborts or non-Error values as retryable", () => {
    const abort = new Error("user stopped");
    abort.name = "AbortError";
    expect(isTransientRetryableError(abort)).toBe(false);
    expect(isTransientRetryableError("finish_reason=error")).toBe(false);
    expect(isTransientRetryableError(null)).toBe(false);
    expect(isTransientRetryableError(undefined)).toBe(false);
    expect(isTransientRetryableError({ message: "timeout" })).toBe(false);
  });

  it("does not flag unrelated errors", () => {
    expect(
      isTransientRetryableError(new Error("Selected model is not available"))
    ).toBe(false);
    expect(
      isTransientRetryableError(new Error("something else entirely"))
    ).toBe(false);
  });
});

describe("AIChatErrorMapper - isContentLevelTransientError", () => {
  it("flags only stream-content failures (empty response / finish_reason=error)", () => {
    expect(
      isContentLevelTransientError(
        new Error(
          "AI server returned finish_reason=error (transient server-side failure)."
        )
      )
    ).toBe(true);
    expect(
      isContentLevelTransientError(
        new Error("AI server returned an empty response with no finish reason.")
      )
    ).toBe(true);
  });

  it("does NOT flag transport-layer conditions the HTTP client already retries (anti-stacking)", () => {
    // These are retried by aiChatApi's transport layer; the query loop must NOT
    // also retry them, or the two layers stack into a burst of ~16 requests.
    expect(
      isContentLevelTransientError(
        new Error("upstream returned 502 Bad Gateway")
      )
    ).toBe(false);
    expect(isContentLevelTransientError(new Error("rate limit exceeded"))).toBe(
      false
    );
    expect(isContentLevelTransientError(new Error("Request timeout"))).toBe(
      false
    );
    expect(
      isContentLevelTransientError(new Error("transient server error"))
    ).toBe(false);
    expect(
      isContentLevelTransientError(new Error("AI server error code=503"))
    ).toBe(false);
  });

  it("never classifies aborts or non-Error values as content-level retryable", () => {
    const abort = new Error("user stopped");
    abort.name = "AbortError";
    expect(isContentLevelTransientError(abort)).toBe(false);
    expect(isContentLevelTransientError("finish_reason=error")).toBe(false);
    expect(isContentLevelTransientError(null)).toBe(false);
  });
});

describe("AIChatErrorMapper - context window exceeded", () => {
  it("surfaces an actionable message for context_window_exceeded error code", () => {
    const err = new Error(
      'AI server returned finish_reason=error (code=context_window_exceeded): Upstream LLM error: ContextWindowExceededError: The input (566014 tokens) is longer than the model\'s context length (524288 tokens).'
    );
    const result = userSafeError(err);
    expect(result).toContain("too long");
    expect(result).toContain("new conversation");
    // Must NOT be the transient "service is busy" message.
    expect(result).not.toContain("busy");
    expect(result).not.toContain("transient");
  });

  it("surfaces an actionable message for raw context length text", () => {
    const err = new Error(
      "The input (566014 tokens) is longer than the model's context length (524288 tokens)."
    );
    const result = userSafeError(err);
    expect(result).toContain("too long");
    expect(result).toContain("new conversation");
    expect(result).not.toContain("busy");
  });

  it("does NOT classify context window exceeded as transient/retryable", () => {
    const err = new Error(
      "AI server returned finish_reason=error (code=context_window_exceeded): input too long"
    );
    expect(isTransientRetryableError(err)).toBe(false);
  });
});
