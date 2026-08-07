import { describe, expect, it } from "vitest";
import {
  QUOTA_EXHAUSTED_SENTINEL,
  isTransientRetryableError,
  userSafeError,
} from "@/service/AIChatErrorMapper";

describe("AIChatErrorMapper - userSafeError", () => {
  it("returns the quota sentinel on 402 / insufficient_quota", () => {
    expect(userSafeError(new Error("402 Payment Required"))).toBe(
      QUOTA_EXHAUSTED_SENTINEL
    );
    expect(userSafeError(new Error("insufficient_quota"))).toBe(
      QUOTA_EXHAUSTED_SENTINEL
    );
  });

  it("returns a sign-in prompt on 401/403", () => {
    expect(userSafeError(new Error("401 Unauthorized"))).toBe(
      "Please sign in again."
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

  it("still falls back to the generic message for unknown errors", () => {
    expect(userSafeError(new Error("something else entirely"))).toBe(
      "An unexpected error occurred. Please try again."
    );
  });
});

describe("AIChatErrorMapper - isTransientRetryableError", () => {
  it("flags finish_reason=error as retryable", () => {
    expect(
      isTransientRetryableError(
        new Error(
          "AI server returned finish_reason=error (transient server-side failure)."
        )
      )
    ).toBe(true);
  });

  it("flags empty-response / no-finish-reason errors as retryable", () => {
    expect(
      isTransientRetryableError(
        new Error("AI server returned an empty response with no finish reason.")
      )
    ).toBe(true);
  });

  it("flags rate limit, timeout, and 502 as retryable", () => {
    expect(isTransientRetryableError(new Error("rate limit exceeded"))).toBe(
      true
    );
    expect(isTransientRetryableError(new Error("request timeout"))).toBe(true);
    expect(isTransientRetryableError(new Error("upstream returned 502"))).toBe(
      true
    );
  });

  it("does not flag auth, quota, or unknown errors as retryable", () => {
    expect(isTransientRetryableError(new Error("401 Unauthorized"))).toBe(
      false
    );
    expect(isTransientRetryableError(new Error("402 Payment Required"))).toBe(
      false
    );
    expect(
      isTransientRetryableError(new Error("something else entirely"))
    ).toBe(false);
  });

  it("does not flag aborts as retryable", () => {
    const err = new Error("stopped");
    err.name = "AbortError";
    expect(isTransientRetryableError(err)).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isTransientRetryableError("a string")).toBe(false);
    expect(isTransientRetryableError(null)).toBe(false);
    expect(isTransientRetryableError(undefined)).toBe(false);
  });
});
