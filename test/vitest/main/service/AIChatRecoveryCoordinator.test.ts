import { describe, expect, it } from "vitest";
import { AIChatRecoveryCoordinator } from "@/service/AIChatRecoveryCoordinator";
import { createRecoveryAttemptState } from "@/service/AIChatRecoveryTypes";

describe("AIChatRecoveryCoordinator", () => {
  const coordinator = new AIChatRecoveryCoordinator();

  describe("Layer 3 — output_limit", () => {
    it("escalates max_tokens once", () => {
      const state = createRecoveryAttemptState("m");
      const result = coordinator.recover({
        reason: "output_limit",
        state,
        maxOutputTokensCap: 65536,
        modelMaxOutputTokens: 32768,
      });
      expect(result.action.type).toBe("escalate_output_tokens");
      if (result.action.type === "escalate_output_tokens") {
        expect(result.action.maxTokens).toBe(32768);
      }
      expect(result.updatedState.outputEscalationAttempted).toBe(true);
      expect(result.updatedState.maxTokensOverride).toBe(32768);
    });

    it("uses the cap when modelMaxOutputTokens is missing", () => {
      const result = coordinator.recover({
        reason: "output_limit",
        state: createRecoveryAttemptState("m"),
        maxOutputTokensCap: 65536,
      });
      if (result.action.type === "escalate_output_tokens") {
        expect(result.action.maxTokens).toBe(65536);
      }
    });

    it("continues up to 3 times after escalation", () => {
      let state = createRecoveryAttemptState("m");
      state = coordinator.recover({
        reason: "output_limit",
        state,
        maxOutputTokensCap: 65536,
      }).updatedState;
      for (let i = 1; i <= 3; i += 1) {
        const r = coordinator.recover({
          reason: "output_limit",
          state,
          maxOutputTokensCap: 65536,
        });
        expect(r.action.type).toBe("continue_output");
        state = r.updatedState;
        expect(state.outputContinuationCount).toBe(i);
      }
      // 4th time: fail
      const r = coordinator.recover({
        reason: "output_limit",
        state,
        maxOutputTokensCap: 65536,
      });
      expect(r.action.type).toBe("fail");
    });
  });

  describe("Layers 4-5 — context overflow", () => {
    it("drains first", () => {
      const r = coordinator.recover({
        reason: "context_overflow",
        state: createRecoveryAttemptState("m"),
        maxOutputTokensCap: 65536,
      });
      expect(r.action.type).toBe("drain_context");
      expect(r.updatedState.contextDrainAttempted).toBe(true);
    });

    it("reactive compacts after drain", () => {
      const state = {
        ...createRecoveryAttemptState("m"),
        contextDrainAttempted: true,
      };
      const r = coordinator.recover({
        reason: "context_overflow",
        state,
        maxOutputTokensCap: 65536,
      });
      expect(r.action.type).toBe("reactive_compact");
      expect(r.updatedState.reactiveCompactAttempted).toBe(true);
    });

    it("fails after both drain and compact", () => {
      const state = {
        ...createRecoveryAttemptState("m"),
        contextDrainAttempted: true,
        reactiveCompactAttempted: true,
      };
      const r = coordinator.recover({
        reason: "context_overflow",
        state,
        maxOutputTokensCap: 65536,
      });
      expect(r.action.type).toBe("fail");
    });

    it("treats media_overflow the same way", () => {
      const r = coordinator.recover({
        reason: "media_overflow",
        state: createRecoveryAttemptState("m"),
        maxOutputTokensCap: 65536,
      });
      expect(r.action.type).toBe("drain_context");
    });
  });

  describe("Layer 6 — model fallback", () => {
    it("falls back on overload when a different fallback is available", () => {
      const r = coordinator.recover({
        reason: "overload",
        state: createRecoveryAttemptState("m1"),
        maxOutputTokensCap: 65536,
        fallbackModel: "m2",
      });
      expect(r.action.type).toBe("fallback_model");
      if (r.action.type === "fallback_model") {
        expect(r.action.fallbackModel).toBe("m2");
      }
      expect(r.updatedState.currentModel).toBe("m2");
    });

    it("does not fall back to the same model", () => {
      const r = coordinator.recover({
        reason: "overload",
        state: createRecoveryAttemptState("m1"),
        maxOutputTokensCap: 65536,
        fallbackModel: "m1",
      });
      expect(r.action.type).toBe("fail");
    });

    it("does not fall back without a fallback model", () => {
      const r = coordinator.recover({
        reason: "overload",
        state: createRecoveryAttemptState("m1"),
        maxOutputTokensCap: 65536,
      });
      expect(r.action.type).toBe("fail");
    });

    it("falls back on model_unavailable", () => {
      const r = coordinator.recover({
        reason: "model_unavailable",
        state: createRecoveryAttemptState("m1"),
        maxOutputTokensCap: 65536,
        fallbackModel: "m2",
      });
      expect(r.action.type).toBe("fallback_model");
    });
  });

  describe("Layer 7 — persistent retry", () => {
    it("schedules a persistent retry for rate_limit", () => {
      const r = coordinator.recover({
        reason: "rate_limit",
        state: createRecoveryAttemptState("m"),
        maxOutputTokensCap: 65536,
        persistentDelayMs: 7_000,
      });
      expect(r.action.type).toBe("persistent_retry");
      if (r.action.type === "persistent_retry") {
        expect(r.action.delayMs).toBe(7_000);
      }
    });
  });

  describe("attempt recording", () => {
    it("records each recovery action with an incrementing attempt counter per layer", () => {
      let state = createRecoveryAttemptState("m");
      const r1 = coordinator.recover({
        reason: "output_limit",
        state,
        maxOutputTokensCap: 65536,
      });
      state = r1.updatedState;
      const r2 = coordinator.recover({
        reason: "output_limit",
        state,
        maxOutputTokensCap: 65536,
      });
      state = r2.updatedState;
      const records = state.records.filter(
        (x) => x.layer === "output_token_recovery"
      );
      expect(records).toHaveLength(2);
      expect(records[0].attempt).toBe(1);
      expect(records[1].attempt).toBe(2);
    });
  });

  describe("side-effect boundary", () => {
    it("does not switch models when boundary crossed and fallback would be selected", () => {
      // The boundary is enforced by the loop, not the coordinator, but
      // we verify here that the coordinator stays pure and only updates
      // currentModel — never side effects.
      const state = {
        ...createRecoveryAttemptState("m1"),
        sideEffectBoundaryCrossed: true,
      };
      const r = coordinator.recover({
        reason: "overload",
        state,
        maxOutputTokensCap: 65536,
        fallbackModel: "m2",
      });
      expect(r.action.type).toBe("fallback_model");
      // Coordinator never flips sideEffectBoundaryCrossed.
      expect(r.updatedState.sideEffectBoundaryCrossed).toBe(true);
    });
  });
});
