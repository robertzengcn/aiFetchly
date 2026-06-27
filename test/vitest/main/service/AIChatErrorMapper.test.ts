import { describe, expect, it } from "vitest";
import {
  QUOTA_EXHAUSTED_SENTINEL,
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
