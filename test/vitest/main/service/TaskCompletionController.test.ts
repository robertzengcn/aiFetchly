import { describe, expect, it } from "vitest";
import { TaskCompletionController } from "@/service/aiTaskExecution/TaskCompletionController";
import type { TaskEndCandidate } from "@/entityTypes/aiTaskExecutionTypes";

function baseCandidate(overrides: Partial<TaskEndCandidate>): TaskEndCandidate {
  return {
    candidateId: "cand-1",
    executionId: "exec-1",
    content: "Done.",
    finishReason: "stop",
    provenance: "provider",
    streamTerminalSeen: true,
    boundary: "response_end",
    pendingPermission: false,
    pendingQuestion: false,
    pendingPlanApproval: false,
    safetyRestriction: false,
    ...overrides,
  };
}

describe("TaskCompletionController.decide (shadow mode, FR-05/06/16)", () => {
  it("returns finish_response for a response-only route candidate (AC-14)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(baseCandidate({}), {
      route: "response_only",
    });
    expect(decision.type).toBe("finish_response");
  });

  it("returns finish verified_complete when all required evidence passes (AC-03)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_verified",
        passedCriterionIds: ["rec-1"],
        requiredCriterionIds: ["rec-1"],
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("verified_complete");
      expect(decision.reasonCode).toBe("CRITERIA_SATISFIED");
    }
  });

  it("returns finish incomplete when required criteria are unmet (first-response stop, AC-18)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({ content: "I will check.", finishReason: null }),
      {
        route: "task_verified",
        passedCriterionIds: [],
        requiredCriterionIds: ["rec-1"],
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
    }
  });

  it("returns wait when a permission is pending (FR-06 stop conditions)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({ pendingPermission: true }),
      { route: "task_verified" }
    );
    expect(decision.type).toBe("wait");
    if (decision.type === "wait") {
      expect(decision.reason).toBe("permission");
    }
  });

  it("returns finish blocked_by_policy on a safety restriction (FR-06, no bypass)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({ safetyRestriction: true, content: "I can't help." }),
      { route: "task_verified" }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("blocked_by_policy");
      expect(decision.reasonCode).toBe("CONTENT_RESTRICTED");
    }
  });

  it("records synthetic provenance for a missing-terminal candidate (AC-12, FR-16)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "synthetic",
        streamTerminalSeen: false,
        finishReason: null,
        boundary: "budget_cap",
      }),
      { route: "task_verified" }
    );
    // Synthetic/budget_cap candidates never pass verified (AC-12).
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).not.toBe("verified_complete");
    }
  });

  it("shadow mode never returns continue (Slice 1: no live continuation dispatch)", async () => {
    const ctrl = new TaskCompletionController({ executionId: "exec-1" });
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 50/100." }),
      {
        route: "task_verified",
        passedCriterionIds: [],
        requiredCriterionIds: ["rec-1"],
      }
    );
    // Slice 1: shadow evaluation. Even when work is unfinished, the shadow
    // controller returns finish (incomplete) — it never dispatches a
    // continuation. Live continue is Slice 2.
    expect(decision.type).not.toBe("continue");
  });
});
