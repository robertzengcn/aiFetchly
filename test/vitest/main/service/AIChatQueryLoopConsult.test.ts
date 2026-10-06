// test/vitest/main/service/AIChatQueryLoopConsult.test.ts
//
// Unit 4 — Loop consults controller (GAP-S2 #6, FR-05/06/07, AC-04/05/06/07/08).
//
// The loop's four terminal-stop sites (round-cap, empty-stop-after-tools,
// goal-text-stop, loop-exit) each form a TaskEndCandidate and consult the
// completion controller before deciding whether to nudge the model onward or
// break. The per-site logic is encapsulated in `consultLoopEndCandidate` so it
// can be tested in isolation from the streaming pipeline.
//
// These tests lock the candidate-formation contract (provenance, streamTerminal
// Seen, boundary, pending flags) and the decision→outcome mapping:
//   - continue + budget allows → continue with the §7.3 prompt
//   - continue + reserveContinuation Exhausted → break (budget overrides continue)
//   - finish/finish_response/yield_owner/wait → break
//   - flag-off path is the caller's responsibility (it skips the helper); the
//     helper is only invoked when the flag is on and a binding is present.
import { describe, expect, it, vi } from "vitest";
import {
  consultLoopEndCandidate,
  buildContinuationPrompt,
  type LoopTaskExecutionBinding,
} from "@/service/aiTaskExecution/TaskLoopConsult";
import { BudgetReservationResult } from "@/service/aiTaskExecution/TaskRunBudget";
import type { TaskCompletionDecision, TaskEndCandidate } from "@/entityTypes/aiTaskExecutionTypes";

/** Build a binding whose `consult` returns a fixed decision and whose
 * `reserveContinuation` returns a fixed reservation result. */
function makeBinding(opts: {
  executionId?: string;
  decision: TaskCompletionDecision;
  reservation?: BudgetReservationResult;
  capture?: (candidate: TaskEndCandidate) => void;
}): LoopTaskExecutionBinding {
  return {
    executionId: opts.executionId ?? "exec-1",
    consult: async (candidate) => {
      opts.capture?.(candidate);
      return opts.decision;
    },
    reserveContinuation: () => opts.reservation ?? BudgetReservationResult.Reserved,
  };
}

const baseParams = {
  content: "Saved 54 contacts so far.",
  finishReason: "stop" as string | null,
  pendingPermission: false,
  pendingQuestion: false,
  pendingPlanApproval: false,
  safetyRestriction: false,
};

describe("consultLoopEndCandidate — candidate formation (AC-04/05/06)", () => {
  it("forms a round_cap candidate with provider provenance + streamTerminalSeen", async () => {
    let captured: TaskEndCandidate | undefined;
    const binding = makeBinding({
      decision: { type: "finish_response", result: "response_ended" },
      capture: (c) => {
        captured = c;
      },
    });
    await consultLoopEndCandidate({
      binding,
      boundary: "round_cap",
      ...baseParams,
    });
    expect(captured).toBeDefined();
    expect(captured!.executionId).toBe("exec-1");
    expect(captured!.provenance).toBe("provider");
    expect(captured!.streamTerminalSeen).toBe(true);
    expect(captured!.boundary).toBe("round_cap");
    expect(captured!.content).toBe("Saved 54 contacts so far.");
    expect(captured!.finishReason).toBe("stop");
    expect(captured!.pendingPermission).toBe(false);
    expect(captured!.pendingQuestion).toBe(false);
    expect(captured!.pendingPlanApproval).toBe(false);
    expect(captured!.safetyRestriction).toBe(false);
    // candidateId is stable-shaped and unique per (executionId, boundary).
    expect(captured!.candidateId).toContain("exec-1");
    expect(captured!.candidateId).toContain("round_cap");
  });

  it("forms a response_end candidate at the empty-stop / goal-text / loop-exit sites", async () => {
    for (const boundary of ["response_end"] as const) {
      let captured: TaskEndCandidate | undefined;
      const binding = makeBinding({
        decision: { type: "finish_response", result: "response_ended" },
        capture: (c) => {
          captured = c;
        },
      });
      await consultLoopEndCandidate({
        binding,
        boundary,
        ...baseParams,
      });
      expect(captured!.boundary).toBe(boundary);
    }
  });

  it("candidateId differs across boundaries so the budget dedup keyspace stays unique", async () => {
    const ids: string[] = [];
    for (const boundary of ["round_cap", "response_end"] as const) {
      const binding = makeBinding({
        decision: { type: "finish_response", result: "response_ended" },
        capture: (c) => ids.push(c.candidateId),
      });
      await consultLoopEndCandidate({ binding, boundary, ...baseParams });
    }
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("consultLoopEndCandidate — decision→outcome mapping (AC-07/08)", () => {
  it("continue + reserveContinuation Reserved → continue outcome with the §7.3 prompt", async () => {
    const decision: TaskCompletionDecision = {
      type: "continue",
      continuationId: "cont-1",
      prompt: buildContinuationPrompt({
        objective: "Save 100 contacts",
        verifiedProgress: "54 contacts saved",
        unmetCriteria: ["crit-100-count"],
        failures: "",
        remainingLimits: "continuations: 2",
      }),
      unmetCriterionIds: ["crit-100-count"],
    };
    const binding = makeBinding({ decision, reservation: BudgetReservationResult.Reserved });
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "round_cap",
      ...baseParams,
    });
    expect(outcome.type).toBe("continue");
    if (outcome.type === "continue") {
      expect(outcome.prompt).toContain("Save 100 contacts");
      expect(outcome.prompt).toContain("Do not claim completion without required evidence");
    }
  });

  it("continue + reserveContinuation Exhausted → break (budget overrides continue)", async () => {
    const decision: TaskCompletionDecision = {
      type: "continue",
      continuationId: "cont-2",
      prompt: "continue",
      unmetCriterionIds: [],
    };
    const binding = makeBinding({ decision, reservation: BudgetReservationResult.Exhausted });
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "round_cap",
      ...baseParams,
    });
    expect(outcome.type).toBe("break");
    if (outcome.type === "break") {
      // The race fallback surfaces CONTINUATION_LIMIT, not a bare break.
      expect(outcome.reason).toBe("CONTINUATION_LIMIT");
    }
  });

  it("finish (verified_complete) → break", async () => {
    const decision: TaskCompletionDecision = {
      type: "finish",
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: ["ev-1"],
      summary: "done",
      remainingWork: [],
    };
    const binding = makeBinding({ decision });
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
    });
    expect(outcome.type).toBe("break");
  });

  it("finish (incomplete) → break", async () => {
    const decision: TaskCompletionDecision = {
      type: "finish",
      outcome: "incomplete",
      reasonCode: "CONTINUATION_LIMIT",
      evidenceIds: [],
      summary: "partial",
      remainingWork: ["crit-1"],
    };
    const binding = makeBinding({ decision });
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "round_cap",
      ...baseParams,
    });
    expect(outcome.type).toBe("break");
  });

  it("finish_response → break", async () => {
    const binding = makeBinding({
      decision: { type: "finish_response", result: "response_ended" },
    });
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
    });
    expect(outcome.type).toBe("break");
  });

  it("yield_owner → break", async () => {
    const binding = makeBinding({
      decision: { type: "yield_owner", owner: "goal", result: "maker_iteration_ended" },
    });
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
    });
    expect(outcome.type).toBe("break");
  });

  it("wait → break (pending states pause the turn elsewhere; the loop stops)", async () => {
    const binding = makeBinding({
      decision: { type: "wait", reason: "permission" },
    });
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
    });
    expect(outcome.type).toBe("break");
  });

  it("safetyRestriction on the candidate → controller decides blocked_by_policy → break", async () => {
    // The controller returns blocked_by_policy; the helper maps it to break.
    const decision: TaskCompletionDecision = {
      type: "finish",
      outcome: "blocked_by_policy",
      reasonCode: "CONTENT_RESTRICTED",
      evidenceIds: [],
      summary: "",
      remainingWork: [],
    };
    const binding = makeBinding({ decision });
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
      safetyRestriction: true,
    });
    expect(outcome.type).toBe("break");
  });
});

describe("consultLoopEndCandidate — budget reservation contract", () => {
  it("reserves with the decision's continuationId (dedup key)", async () => {
    let reservedId = "";
    const decision: TaskCompletionDecision = {
      type: "continue",
      continuationId: "cont-xyz",
      prompt: "go",
      unmetCriterionIds: [],
    };
    const binding: LoopTaskExecutionBinding = {
      executionId: "exec-1",
      consult: async () => decision,
      reserveContinuation: (id) => {
        reservedId = id;
        return BudgetReservationResult.Reserved;
      },
    };
    await consultLoopEndCandidate({
      binding,
      boundary: "round_cap",
      ...baseParams,
    });
    expect(reservedId).toBe("cont-xyz");
  });

  it("does NOT call reserveContinuation when the decision is not continue", async () => {
    const reserveSpy = vi.fn();
    const binding: LoopTaskExecutionBinding = {
      executionId: "exec-1",
      consult: async () => ({
        type: "finish",
        outcome: "incomplete",
        reasonCode: "NO_PROGRESS",
        evidenceIds: [],
        summary: "",
        remainingWork: [],
      }),
      reserveContinuation: () => {
        reserveSpy();
        return BudgetReservationResult.Reserved;
      },
    };
    await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
    });
    expect(reserveSpy).not.toHaveBeenCalled();
  });
});

describe("buildContinuationPrompt — §7.3 template", () => {
  it("contains objective, verified progress, unmet criteria, remaining limits, and the do-not-repeat/don't-claim guardrails", () => {
    const prompt = buildContinuationPrompt({
      objective: "Save 100 qualifying contacts",
      verifiedProgress: "54 contacts saved to the contact store",
      unmetCriteria: ["crit-100-count", "crit-qualifying-filter"],
      failures: "",
      remainingLimits: "continuations: 2, providerAttempts: 55",
    });
    expect(prompt).toContain("Continue the same approved task execution");
    expect(prompt).toContain("Save 100 qualifying contacts");
    expect(prompt).toContain("54 contacts saved");
    expect(prompt).toContain("crit-100-count");
    expect(prompt).toContain("crit-qualifying-filter");
    expect(prompt).toContain("continuations: 2, providerAttempts: 55");
    expect(prompt).toContain("Do not repeat operations with receipts");
    expect(prompt).toContain("Do not claim completion without required evidence");
    expect(prompt).toContain("Do not save continuation as another user request");
  });

  it("omits the failures line when there are none", () => {
    const prompt = buildContinuationPrompt({
      objective: "x",
      verifiedProgress: "y",
      unmetCriteria: [],
      failures: "",
      remainingLimits: "continuations: 2",
    });
    expect(prompt).not.toContain("Failures or restrictions:");
  });

  it("includes the failures line when present", () => {
    const prompt = buildContinuationPrompt({
      objective: "x",
      verifiedProgress: "y",
      unmetCriteria: [],
      failures: "tool search_maps_businesses timed out twice",
      remainingLimits: "continuations: 2",
    });
    expect(prompt).toContain("Failures or restrictions:");
    expect(prompt).toContain("search_maps_businesses timed out");
  });
});
