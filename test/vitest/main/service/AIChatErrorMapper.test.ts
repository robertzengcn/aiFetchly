import { describe, expect, it, vi } from "vitest";
import {
  QUOTA_EXHAUSTED_SENTINEL,
  describeErrorDetail,
  userSafeError,
} from "@/service/AIChatErrorMapper";
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

  it("returns a sign-in prompt on 401/403", () => {
    expect(userSafeError(new Error("401 Unauthorized"))).toBe(
      "Please sign in again."
    );
    expect(
      userSafeError(
        new Error("Authentication failed: Token expired. Please login again.")
      )
    ).toBe("Please sign in again.");
    expect(
      userSafeError(new Error("Refresh token rejected (HTTP 401)"))
    ).toBe("Please sign in again.");
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
