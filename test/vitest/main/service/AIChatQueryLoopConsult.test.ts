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
import {
  TaskRunBudget,
} from "@/service/aiTaskExecution/TaskRunBudget";
import {
  BudgetReservationResult,
} from "@/service/aiTaskExecution/TaskRunBudget";
import { MANUAL_BUDGET_DEFAULTS } from "@/service/aiTaskExecution/budgetDefaults";
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

  it("B13c: continue + Reserved persists {continuations:1} so pause/resume keeps the spent counter", async () => {
    // Continuation spend lived only in the mirror: after a pause/resume the
    // resurrected mirror forgot it and re-spent the allowance. Persisting at
    // dispatch keeps mirror and ledger identical.
    const persists: unknown[] = [];
    const decision: TaskCompletionDecision = {
      type: "continue",
      continuationId: "cont-persist",
      prompt: "continue",
      unmetCriterionIds: [],
    };
    const binding = {
      ...makeBinding({ decision, reservation: BudgetReservationResult.Reserved }),
      persistBudget: async (delta: unknown) => {
        persists.push(delta);
        return true;
      },
    };
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "round_cap",
      ...baseParams,
    });
    expect(outcome.type).toBe("continue");
    expect(persists).toEqual([{ continuations: 1 }]);
  });

  it("B13c: continue + Reserved but persistBudget false → break (no unfunded maker dispatch)", async () => {
    // Lease lost between reserve and persist: the mirror counted a
    // continuation the ledger rejected. Continuing would dispatch maker
    // work no durable accounting funds — break instead.
    const decision: TaskCompletionDecision = {
      type: "continue",
      continuationId: "cont-nopersist",
      prompt: "continue",
      unmetCriterionIds: [],
    };
    const binding = {
      ...makeBinding({ decision, reservation: BudgetReservationResult.Reserved }),
      persistBudget: async (_delta: unknown) => false,
    };
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "round_cap",
      ...baseParams,
    });
    expect(outcome.type).toBe("break");
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

// T06a: immutable per-candidate identity, retained only on re-handling the
// same candidate. Distinct responses at the same boundary get distinct IDs;
// replay of the same response (transport retry, identical immutable state)
// retains the same ID so the budget dedups it. FR-08/23; AC-05/08/29.
describe("consultLoopEndCandidate T06a — per-candidate identity (FR-08/23, AC-05/08/29)", () => {
  it("same immutable observation at the same boundary → same candidateId (replay retained)", async () => {
    const captured: string[] = [];
    const binding = makeBinding({
      decision: { type: "finish_response", result: "response_ended" },
      capture: (c) => captured.push(c.candidateId),
    });
    const params = {
      binding,
      boundary: "response_end" as const,
      ...baseParams,
    };
    await consultLoopEndCandidate(params);
    await consultLoopEndCandidate(params); // replay: identical immutable state
    expect(captured).toHaveLength(2);
    expect(captured[0]).toBe(captured[1]);
  });

  it("distinct responses at the same boundary → distinct candidateIds", async () => {
    const captured: string[] = [];
    const binding = makeBinding({
      decision: { type: "finish_response", result: "response_ended" },
      capture: (c) => captured.push(c.candidateId),
    });
    await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
      content: "Saved 54 contacts so far.",
    });
    await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
      content: "Saved 61 contacts so far.", // genuinely different response
    });
    expect(captured[0]).not.toBe(captured[1]);
  });

  it("distinct responses consume three continuations; the fourth cannot dispatch", async () => {
    // Drive three distinct responses through continue decisions and assert
    // the budget increments continuations monotonically; the fourth exhausts.
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const continueDecision: TaskCompletionDecision = {
      type: "continue",
      continuationId: "", // filled per-candidate below
      prompt: "go",
      unmetCriterionIds: ["rec-1"],
    };
    const contents = [
      "Saved 54 contacts.",
      "Saved 61 contacts.",
      "Saved 70 contacts.",
    ];
    const binding: LoopTaskExecutionBinding = {
      executionId: "exec-1",
      consult: async (candidate) => {
        // Controller derives continuationId from candidateId; mirror that.
        return { ...continueDecision, continuationId: `cont:${candidate.candidateId}` };
      },
      reserveContinuation: (id) => budget.reserveContinuation(id),
    };
    for (const content of contents) {
      const outcome = await consultLoopEndCandidate({
        binding,
        boundary: "response_end",
        ...baseParams,
        content,
      });
      expect(outcome.type).toBe("continue");
    }
    // Three distinct continuations consumed; maxContinuations is 3 in
    // MANUAL_BUDGET_DEFAULTS, so the fourth distinct response exhausts.
    expect(budget.getConsumed().continuations).toBe(3);
    const fourth = await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
      content: "Saved 75 contacts.", // fourth distinct response
    });
    expect(fourth.type).toBe("break");
    if (fourth.type === "break") {
      expect(fourth.reason).toBe("CONTINUATION_LIMIT");
    }
    // The consumed counter did NOT over-shoot to 4 — exhaustion refuses.
    expect(budget.getConsumed().continuations).toBe(3);
  });

  it("replay of one candidate dispatches once (AlreadyReserved does not consume a second unit)", async () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const continueDecision: TaskCompletionDecision = {
      type: "continue",
      continuationId: "",
      prompt: "go",
      unmetCriterionIds: ["rec-1"],
    };
    const binding: LoopTaskExecutionBinding = {
      executionId: "exec-1",
      consult: async (candidate) => ({
        ...continueDecision,
        continuationId: `cont:${candidate.candidateId}`,
      }),
      reserveContinuation: (id) => budget.reserveContinuation(id),
    };
    // First consult on the candidate → Reserved, dispatch.
    const first = await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
      content: "Saved 54 contacts.",
    });
    expect(first.type).toBe("continue");
    expect(budget.getConsumed().continuations).toBe(1);
    // Replay: identical immutable observation → same candidateId → same
    // continuationId → AlreadyReserved. T06b: break, NOT another dispatch.
    const replay = await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
      content: "Saved 54 contacts.",
    });
    expect(replay.type).toBe("break");
    if (replay.type === "break") {
      expect(replay.reason).toBe("CANDIDATE_REPLAYED");
    }
    // The replay did NOT consume a second unit.
    expect(budget.getConsumed().continuations).toBe(1);
  });

  it("candidateId is bounded against runaway content length", async () => {
    let captured: TaskEndCandidate | undefined;
    const binding = makeBinding({
      decision: { type: "finish_response", result: "response_ended" },
      capture: (c) => {
        captured = c;
      },
    });
    const huge = "x".repeat(50_000);
    await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
      content: huge,
    });
    // candidateId stays a bounded, fixed-shape string regardless of content.
    expect(captured!.candidateId.length).toBeLessThan(200);
  });

  it("finishReason, pending flags, safetyRestriction are part of the identity", async () => {
    const captured: string[] = [];
    const binding = makeBinding({
      decision: { type: "finish_response", result: "response_ended" },
      capture: (c) => captured.push(c.candidateId),
    });
    await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
      content: "Same content.",
      finishReason: "stop",
    });
    await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
      content: "Same content.",
      finishReason: "length", // different finish reason → different candidate
    });
    expect(captured[0]).not.toBe(captured[1]);
  });
});

// T06b: AlreadyReserved must NOT cause another dispatch of the same
// continuation. The loop breaks with CANDIDATE_REPLAYED instead of re-entering.
describe("consultLoopEndCandidate T06b — AlreadyReserved breaks, no re-dispatch (FR-08/23, AC-08/29)", () => {
  it("continue + reserveContinuation AlreadyReserved → break (CANDIDATE_REPLAYED)", async () => {
    const decision: TaskCompletionDecision = {
      type: "continue",
      continuationId: "cont-replayed",
      prompt: "go",
      unmetCriterionIds: [],
    };
    const binding = makeBinding({
      decision,
      reservation: BudgetReservationResult.AlreadyReserved,
    });
    const outcome = await consultLoopEndCandidate({
      binding,
      boundary: "response_end",
      ...baseParams,
    });
    expect(outcome.type).toBe("break");
    if (outcome.type === "break") {
      expect(outcome.reason).toBe("CANDIDATE_REPLAYED");
    }
  });

  it("CANDIDATE_REPLAYED is distinct from CONTINUATION_LIMIT (Exhausted) and from a fresh continue (Reserved)", async () => {
    const decision: TaskCompletionDecision = {
      type: "continue",
      continuationId: "cont-x",
      prompt: "go",
      unmetCriterionIds: [],
    };
    const reserved = await consultLoopEndCandidate({
      binding: makeBinding({ decision, reservation: BudgetReservationResult.Reserved }),
      boundary: "response_end",
      ...baseParams,
    });
    expect(reserved.type).toBe("continue");

    const already = await consultLoopEndCandidate({
      binding: makeBinding({ decision, reservation: BudgetReservationResult.AlreadyReserved }),
      boundary: "response_end",
      ...baseParams,
    });
    expect(already.type).toBe("break");
    if (already.type === "break") {
      expect(already.reason).toBe("CANDIDATE_REPLAYED");
    }

    const exhausted = await consultLoopEndCandidate({
      binding: makeBinding({ decision, reservation: BudgetReservationResult.Exhausted }),
      boundary: "response_end",
      ...baseParams,
    });
    expect(exhausted.type).toBe("break");
    if (exhausted.type === "break") {
      expect(exhausted.reason).toBe("CONTINUATION_LIMIT");
    }
  });

  // ----- T21a: candidate diagnostics derived from actual finishReason/content -----
  // The consult sites used to hardcode `provenance: "provider",
  // streamTerminalSeen: true, safetyRestriction: false` regardless of input.
  // T21a: these must now be DERIVED from the actual finishReason + content
  // via `deriveCandidateDiagnostics`. A `content_filter` finishReason or a
  // refusal opener surfaces `safetyRestriction: true`; a missing/unrecognized
  // terminal degrades to `unknown` provenance + `streamTerminalSeen: false`.
  // The caller-supplied `safetyRestriction` (loop content-scan floor) is
  // preserved via OR — a real restriction from either source wins.
  it("T21a: stop finishReason → provider + streamTerminalSeen (preserved behavior)", async () => {
    const captured: TaskEndCandidate[] = [];
    const decision: TaskCompletionDecision = {
      type: "finish",
      outcome: "incomplete",
      reasonCode: "NO_PROGRESS",
      evidenceIds: [],
      summary: "",
      remainingWork: [],
    };
    await consultLoopEndCandidate({
      binding: makeBinding({ decision, capture: (c) => captured.push(c) }),
      boundary: "response_end",
      content: "Done.",
      finishReason: "stop",
      pendingPermission: false,
      pendingQuestion: false,
      pendingPlanApproval: false,
      safetyRestriction: false,
    });
    expect(captured[0].provenance).toBe("provider");
    expect(captured[0].streamTerminalSeen).toBe(true);
    expect(captured[0].safetyRestriction).toBe(false);
  });

  it("T21a: content_filter finishReason → safetyRestriction true (derived, not hardcoded false)", async () => {
    const captured: TaskEndCandidate[] = [];
    const decision: TaskCompletionDecision = {
      type: "finish",
      outcome: "blocked_by_policy",
      reasonCode: "CONTENT_RESTRICTED",
      evidenceIds: [],
      summary: "",
      remainingWork: [],
    };
    await consultLoopEndCandidate({
      binding: makeBinding({ decision, capture: (c) => captured.push(c) }),
      boundary: "response_end",
      content: "I can",
      finishReason: "content_filter",
      pendingPermission: false,
      pendingQuestion: false,
      pendingPlanApproval: false,
      safetyRestriction: false,
    });
    expect(captured[0].safetyRestriction).toBe(true);
    expect(captured[0].provenance).toBe("provider");
    expect(captured[0].streamTerminalSeen).toBe(true);
  });

  it("T21a: refusal opener content → safetyRestriction true (belt-and-suspenders)", async () => {
    const captured: TaskEndCandidate[] = [];
    const decision: TaskCompletionDecision = {
      type: "finish",
      outcome: "blocked_by_policy",
      reasonCode: "CONTENT_RESTRICTED",
      evidenceIds: [],
      summary: "",
      remainingWork: [],
    };
    await consultLoopEndCandidate({
      binding: makeBinding({ decision, capture: (c) => captured.push(c) }),
      boundary: "response_end",
      content: "I cannot help with that request.",
      finishReason: "stop",
      pendingPermission: false,
      pendingQuestion: false,
      pendingPlanApproval: false,
      safetyRestriction: false,
    });
    expect(captured[0].safetyRestriction).toBe(true);
  });

  it("T21a: missing terminal (finishReason null) → unknown + streamTerminalSeen false", async () => {
    const captured: TaskEndCandidate[] = [];
    const decision: TaskCompletionDecision = {
      type: "finish",
      outcome: "incomplete",
      reasonCode: "STREAM_INCOMPLETE",
      evidenceIds: [],
      summary: "",
      remainingWork: [],
    };
    await consultLoopEndCandidate({
      binding: makeBinding({ decision, capture: (c) => captured.push(c) }),
      boundary: "response_end",
      content: "Some text",
      finishReason: null,
      pendingPermission: false,
      pendingQuestion: false,
      pendingPlanApproval: false,
      safetyRestriction: false,
    });
    expect(captured[0].provenance).toBe("unknown");
    expect(captured[0].streamTerminalSeen).toBe(false);
  });

  it("T21a: caller safetyRestriction floor OR'd with derived content_filter", async () => {
    // A loop content-scan that flagged a restriction (caller passes true) must
    // win even when the finishReason is "stop". OR semantics: either source
    // flags the restriction.
    const captured: TaskEndCandidate[] = [];
    const decision: TaskCompletionDecision = {
      type: "finish",
      outcome: "blocked_by_policy",
      reasonCode: "CONTENT_RESTRICTED",
      evidenceIds: [],
      summary: "",
      remainingWork: [],
    };
    await consultLoopEndCandidate({
      binding: makeBinding({ decision, capture: (c) => captured.push(c) }),
      boundary: "response_end",
      content: "Some text",
      finishReason: "stop",
      pendingPermission: false,
      pendingQuestion: false,
      pendingPlanApproval: false,
      safetyRestriction: true,
    });
    expect(captured[0].safetyRestriction).toBe(true);
  });
});