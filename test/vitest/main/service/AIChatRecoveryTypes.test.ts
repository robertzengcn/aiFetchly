import { describe, expect, it } from "vitest";
import {
  AIChatRecoverableError,
  buildRecoveryMetadata,
  createRecoveryAttemptState,
  isAIChatRecoverableError,
  isRetryableReason,
  NON_RETRYABLE_REASONS,
  recordRecoveryAttempt,
} from "@/service/AIChatRecoveryTypes";

describe("AIChatRecoveryTypes", () => {
  describe("createRecoveryAttemptState", () => {
    it("initializes with model and default flags", () => {
      const state = createRecoveryAttemptState("gpt-test");
      expect(state.originalModel).toBe("gpt-test");
      expect(state.currentModel).toBe("gpt-test");
      expect(state.outputEscalationAttempted).toBe(false);
      expect(state.outputContinuationCount).toBe(0);
      expect(state.reactiveCompactAttempted).toBe(false);
      expect(state.contextDrainAttempted).toBe(false);
      expect(state.consecutiveOverloadCount).toBe(0);
      expect(state.sideEffectBoundaryCrossed).toBe(false);
      expect(state.records).toEqual([]);
      expect(typeof state.turnStartedAt).toBe("number");
    });

    it("supports undefined model", () => {
      const state = createRecoveryAttemptState(undefined);
      expect(state.originalModel).toBeUndefined();
      expect(state.currentModel).toBeUndefined();
    });
  });

  describe("AIChatRecoverableError", () => {
    it("preserves all fields", () => {
      const err = new AIChatRecoverableError({
        reason: "overload",
        message: "Server overloaded",
        status: 529,
        retryAfterMs: 2000,
        rateLimitResetMs: 5000,
        responseBody: '{"error":"overloaded_error"}',
        headers: { "retry-after": "2" },
      });
      expect(err.reason).toBe("overload");
      expect(err.status).toBe(529);
      expect(err.retryAfterMs).toBe(2000);
      expect(err.rateLimitResetMs).toBe(5000);
      expect(err.responseBody).toContain("overloaded_error");
      expect(err.headers?.["retry-after"]).toBe("2");
      expect(err.name).toBe("AIChatRecoverableError");
      expect(err.message).toBe("Server overloaded");
      expect(err instanceof Error).toBe(true);
    });

    it("can be detected by isAIChatRecoverableError", () => {
      const err = new AIChatRecoverableError({
        reason: "network",
        message: "fetch failed",
      });
      expect(isAIChatRecoverableError(err)).toBe(true);
      expect(isAIChatRecoverableError(new Error("nope"))).toBe(false);
      expect(isAIChatRecoverableError(null)).toBe(false);
      expect(isAIChatRecoverableError(undefined)).toBe(false);
    });

    it("preserves originalError", () => {
      const cause = new Error("underlying");
      const err = new AIChatRecoverableError({
        reason: "network",
        message: "wrapped",
        originalError: cause,
      });
      expect(err.originalError).toBe(cause);
    });

    it("retains instanceof across transpile targets", () => {
      const err = new AIChatRecoverableError({
        reason: "timeout",
        message: "timed out",
      });
      // After Object.setPrototypeOf, instanceof must still work.
      expect(err instanceof AIChatRecoverableError).toBe(true);
    });
  });

  describe("isRetryableReason / NON_RETRYABLE_REASONS", () => {
    it("treats auth, quota, cancelled, non_recoverable as non-retryable", () => {
      expect(NON_RETRYABLE_REASONS.has("auth")).toBe(true);
      expect(NON_RETRYABLE_REASONS.has("quota")).toBe(true);
      expect(NON_RETRYABLE_REASONS.has("cancelled")).toBe(true);
      expect(NON_RETRYABLE_REASONS.has("non_recoverable")).toBe(true);
    });

    it("treats recoverable transport/server reasons as retryable", () => {
      expect(isRetryableReason("network")).toBe(true);
      expect(isRetryableReason("timeout")).toBe(true);
      expect(isRetryableReason("rate_limit")).toBe(true);
      expect(isRetryableReason("overload")).toBe(true);
      expect(isRetryableReason("server_error")).toBe(true);
      expect(isRetryableReason("output_limit")).toBe(true);
      expect(isRetryableReason("context_overflow")).toBe(true);
      expect(isRetryableReason("model_unavailable")).toBe(true);
    });

    it("treats non-retryable reasons correctly", () => {
      expect(isRetryableReason("auth")).toBe(false);
      expect(isRetryableReason("quota")).toBe(false);
      expect(isRetryableReason("cancelled")).toBe(false);
      expect(isRetryableReason("non_recoverable")).toBe(false);
    });
  });

  describe("recordRecoveryAttempt", () => {
    it("appends without mutating the original state", () => {
      const original = createRecoveryAttemptState("m");
      const updated = recordRecoveryAttempt(original, {
        layer: "api_retry",
        reason: "network",
        attempt: 1,
        delayMs: 500,
      });
      expect(original.records).toEqual([]);
      expect(updated.records).toHaveLength(1);
      expect(updated.records[0].layer).toBe("api_retry");
      expect(updated.records[0].reason).toBe("network");
      expect(typeof updated.records[0].at).toBe("number");
    });

    it("supports multiple appends", () => {
      let state = createRecoveryAttemptState("m");
      state = recordRecoveryAttempt(state, {
        layer: "api_retry",
        reason: "network",
        attempt: 1,
      });
      state = recordRecoveryAttempt(state, {
        layer: "overload_retry",
        reason: "overload",
        attempt: 2,
      });
      expect(state.records).toHaveLength(2);
      expect(state.records[0].layer).toBe("api_retry");
      expect(state.records[1].layer).toBe("overload_retry");
    });
  });

  describe("buildRecoveryMetadata", () => {
    it("summarizes layers used and counts", () => {
      let state = createRecoveryAttemptState("m1");
      state = {
        ...state,
        currentModel: "m2",
        outputEscalationAttempted: true,
        outputContinuationCount: 2,
        reactiveCompactAttempted: true,
      };
      state = recordRecoveryAttempt(state, {
        layer: "api_retry",
        reason: "network",
        attempt: 1,
      });
      state = recordRecoveryAttempt(state, {
        layer: "output_token_recovery",
        reason: "output_limit",
        attempt: 1,
      });
      state = recordRecoveryAttempt(state, {
        layer: "model_fallback",
        reason: "overload",
        attempt: 1,
        model: "m2",
      });
      const meta = buildRecoveryMetadata(state);
      expect(meta.attempts).toBe(3);
      expect(meta.layersUsed).toContain("api_retry");
      expect(meta.layersUsed).toContain("output_token_recovery");
      expect(meta.layersUsed).toContain("model_fallback");
      expect(meta.originalModel).toBe("m1");
      expect(meta.finalModel).toBe("m2");
      expect(meta.fallbackModel).toBe("m2");
      expect(meta.outputEscalated).toBe(true);
      expect(meta.outputContinuationCount).toBe(2);
      expect(meta.contextCompacted).toBe(true);
    });

    it("omits fallbackModel when currentModel equals originalModel", () => {
      const state = createRecoveryAttemptState("m1");
      const meta = buildRecoveryMetadata(state);
      expect(meta.fallbackModel).toBeUndefined();
      expect(meta.originalModel).toBe("m1");
      expect(meta.finalModel).toBe("m1");
    });
  });
});
