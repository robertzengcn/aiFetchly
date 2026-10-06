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
    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(baseCandidate({}), {
      route: "response_only",
    });
    expect(decision.type).toBe("finish_response");
  });

  it("returns finish verified_complete when all required evidence passes (AC-03)", async () => {
    const ctrl = new TaskCompletionController();
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
    const ctrl = new TaskCompletionController();
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
    const ctrl = new TaskCompletionController();
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
    const ctrl = new TaskCompletionController();
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
    const ctrl = new TaskCompletionController();
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
    const ctrl = new TaskCompletionController();
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

  it("emits evidenceIds:[] in shadow mode (criterion IDs are not evidence, §5.2/§8.2, B9)", async () => {
    // Shadow mode collects no real evidence. The previous behavior stuffed
    // passed criterion IDs into evidenceIds, but TaskEvidence.evidenceId is
    // a separate evidence identity — downstream §8.2 consumers would
    // reject or misattribute them. evidenceIds must be [] until
    // TaskEvidenceService (Slice 2) records real evidence rows.
    const ctrl = new TaskCompletionController();

    // verified_complete branch
    const verified = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_verified",
        passedCriterionIds: ["rec-1", "rec-2"],
        requiredCriterionIds: ["rec-1", "rec-2"],
      }
    );
    expect(verified.type).toBe("finish");
    if (verified.type === "finish") {
      expect(verified.evidenceIds).toEqual([]);
    }

    // incomplete branch
    const incomplete = await ctrl.decide(
      baseCandidate({ content: "Saved 50/100.", finishReason: null }),
      {
        route: "task_verified",
        passedCriterionIds: ["rec-1"],
        requiredCriterionIds: ["rec-1", "rec-2"],
      }
    );
    expect(incomplete.type).toBe("finish");
    if (incomplete.type === "finish") {
      expect(incomplete.evidenceIds).toEqual([]);
      // Criterion pass/fail is reported via remainingWork, not evidenceIds.
      expect(incomplete.remainingWork).toEqual(["rec-2"]);
    }
  });

  // ----- D2: incompleteReasonCode 4 branches (FR-16, §14) -----
  // Precedence is documented on TaskCompletionController.incompleteReasonCode:
  // synthetic/missing-terminal wins over boundary; then boundary; then
  // unknown provenance; then no-signal fallthrough. Reordering these would
  // silently shift the reason-code distribution downstream. Each branch is
  // asserted on its own so a precedence swap cannot hide behind another.
  it("incompleteReasonCode: synthetic provenance → STREAM_INCOMPLETE (provenance wins over boundary)", async () => {
    const ctrl = new TaskCompletionController();
    // synthetic + budget_cap: synthetic must win — the stream never truly
    // ended, so CONTINUATION_LIMIT would mislabel it.
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "synthetic",
        streamTerminalSeen: false,
        boundary: "budget_cap",
        finishReason: null,
      }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"] }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("STREAM_INCOMPLETE");
    }
  });

  it("incompleteReasonCode: missing terminal + budget_cap boundary → STREAM_INCOMPLETE (stream-never-ended wins)", async () => {
    const ctrl = new TaskCompletionController();
    // provider provenance but streamTerminalSeen=false (e.g. an error
    // truncated the stream). Boundary is budget_cap. The stream never
    // truly ended, so STREAM_INCOMPLETE wins over CONTINUATION_LIMIT.
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: false,
        boundary: "budget_cap",
        finishReason: null,
      }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"] }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.reasonCode).toBe("STREAM_INCOMPLETE");
    }
  });

  it("incompleteReasonCode: budget_cap boundary with a real terminal → CONTINUATION_LIMIT", async () => {
    const ctrl = new TaskCompletionController();
    // streamTerminalSeen=true + boundary=budget_cap → the stream ended
    // cleanly but hit a continuation cap. CONTINUATION_LIMIT, not
    // STREAM_INCOMPLETE.
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "budget_cap",
        finishReason: "length",
      }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"] }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.reasonCode).toBe("CONTINUATION_LIMIT");
    }
  });

  it("incompleteReasonCode: round_cap boundary with a real terminal → CONTINUATION_LIMIT", async () => {
    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "round_cap",
        finishReason: "length",
      }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"] }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.reasonCode).toBe("CONTINUATION_LIMIT");
    }
  });

  it("incompleteReasonCode: unknown provenance with a real terminal → EVIDENCE_UNAVAILABLE", async () => {
    const ctrl = new TaskCompletionController();
    // unknown provenance + response_end boundary (no cap hit) → cannot
    // attribute a clear reason, so EVIDENCE_UNAVAILABLE. This is the
    // third-precedence branch: synthetic/missing-terminal already
    // returned above; boundary didn't match; provenance is unknown.
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "unknown",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
      }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"] }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.reasonCode).toBe("EVIDENCE_UNAVAILABLE");
    }
  });

  it("incompleteReasonCode: provider provenance + response_end + no signal → NO_PROGRESS (fallthrough)", async () => {
    const ctrl = new TaskCompletionController();
    // The fallthrough: real provider terminal, response_end boundary (no
    // cap), known provenance — none of the above. The work simply made no
    // progress against the criteria.
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
        content: "I looked but found nothing.",
      }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"] }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.reasonCode).toBe("NO_PROGRESS");
    }
  });

  // ----- D2: FR-04 best-effort route never verifies -----
  // FR-04: a best-effort task can never reach verified_complete — even if
  // every required criterion passes, the absence of a verified contract
  // means the outcome is at most "incomplete". A future refactor that drops
  // the `route === "task_verified"` guard on canVerify would silently
  // upgrade best-effort tasks to verified — a correctness violation users
  // would notice. This test locks the invariant.
  it("task_best_effort + all required criteria pass → incomplete, never verified_complete (FR-04)", async () => {
    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({
        content: "Saved 100 contacts.",
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
      }),
      {
        route: "task_best_effort",
        passedCriterionIds: ["rec-1", "rec-2"],
        requiredCriterionIds: ["rec-1", "rec-2"],
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      // FR-04: best-effort never verifies, even with all criteria passing.
      expect(decision.outcome).toBe("incomplete");
      expect(decision.outcome).not.toBe("verified_complete");
    }
  });

  // ----- Slice 2: evidence service injection (FR-05/06/16, AC-12/13) -----
  // When the caller injects an evidence service + contract + context, the
  // controller calls checkCandidate itself and populates evidenceIds from
  // real TaskEvidence rows. Slice 1 callers (no injection) keep getting
  // evidenceIds:[] — the shadow-mode placeholder, preserved byte-identical.

  it("Slice 2: verified_complete carries real evidenceIds when evidence service is injected", async () => {
    const ctrl = new TaskCompletionController();
    const fakeService = {
      checkCandidate: async () => ({
        passedCriterionIds: ["rec-1"],
        unmetCriterionIds: [],
        evidenceIds: ["evidence-aaa", "evidence-bbb"],
      }),
    };
    const contract = {
      schemaVersion: 1 as const,
      contractId: "contract-1",
      contractHash: "hash-abc",
      objective: "Save contacts",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified" as const,
      criteria: [
        {
          id: "rec-1",
          required: true,
          kind: "observation" as const,
          description: "observes 100 contacts",
          adapterKey: "observation",
          targetId: "100 contacts",
          sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
        },
      ],
    };
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_verified",
        evidenceService: fakeService,
        contract,
        evidenceContext: {
          content: "Saved 100 contacts.",
          source: "provider",
          sourceRevision: "rev-1",
          expectedStateVersion: 0,
        },
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("verified_complete");
      expect(decision.reasonCode).toBe("CRITERIA_SATISFIED");
      // Real evidence row identities from the service, not [].
      expect(decision.evidenceIds).toEqual(["evidence-aaa", "evidence-bbb"]);
    }
  });

  it("Slice 2: incomplete carries real evidenceIds when evidence service is injected (criteria unmet)", async () => {
    const ctrl = new TaskCompletionController();
    const fakeService = {
      checkCandidate: async () => ({
        passedCriterionIds: ["rec-1"],
        unmetCriterionIds: ["rec-2"],
        evidenceIds: ["evidence-ccc"],
      }),
    };
    const contract = {
      schemaVersion: 1 as const,
      contractId: "contract-1",
      contractHash: "hash-abc",
      objective: "Save contacts",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified" as const,
      criteria: [
        {
          id: "rec-1",
          required: true,
          kind: "observation" as const,
          description: "observes 100 contacts",
          adapterKey: "observation",
          targetId: "100 contacts",
          sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
        },
        {
          id: "rec-2",
          required: true,
          kind: "observation" as const,
          description: "observes confirmation email",
          adapterKey: "observation",
          targetId: "confirmation email",
          sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 10 }],
        },
      ],
    };
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_verified",
        evidenceService: fakeService,
        contract,
        evidenceContext: {
          content: "Saved 100 contacts.",
          source: "provider",
          sourceRevision: "rev-1",
          expectedStateVersion: 0,
        },
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      // Real evidence row identity, not [].
      expect(decision.evidenceIds).toEqual(["evidence-ccc"]);
      // remainingWork derived from the contract's required criteria minus
      // the evidence service's passed set.
      expect(decision.remainingWork).toEqual(["rec-2"]);
    }
  });

  it("Slice 2: partial injection (service but no contract) falls back to caller-supplied criterion IDs + evidenceIds:[]", async () => {
    // If the caller forgets the contract/context, the controller must not
    // call the service with undefined — it falls back to Slice 1 behavior.
    const ctrl = new TaskCompletionController();
    const fakeService = {
      checkCandidate: async () => {
        throw new Error("should not be called without a contract + context");
      },
    };
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_verified",
        evidenceService: fakeService,
        // contract + evidenceContext intentionally omitted.
        passedCriterionIds: ["rec-1"],
        requiredCriterionIds: ["rec-1"],
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("verified_complete");
      // Slice 1 fallback: no evidence rows collected.
      expect(decision.evidenceIds).toEqual([]);
    }
  });
});
