import { describe, expect, it } from "vitest";
import { TaskCompletionController } from "@/service/aiTaskExecution/TaskCompletionController";
import { TaskRunBudget, BudgetReservationResult, MANUAL_BUDGET_DEFAULTS } from "@/service/aiTaskExecution/TaskRunBudget";
import type { TaskEndCandidate, TaskCompletionContract } from "@/entityTypes/aiTaskExecutionTypes";

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

  // ----- D2: FR-04 best-effort route verification boundary (refined by B01) -----
  // FR-04: a best-effort task verifies ONLY through a trusted, complete
  // derived contract (frozen, source-anchored, no ambiguity fallback) plus
  // real evaluated evidence. Caller-supplied criterion IDs with no contract
  // or no evidence service — the case below — stay incomplete, as do
  // zero-criteria and ambiguous-fallback contracts. A future refactor that
  // drops the trust gate would silently upgrade unverifiable best-effort
  // work to verified — a correctness violation users would notice.
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

  // ----- B01: trusted complete best-effort contracts verify (FR-04/17/19/22) -----
  // Ordinary manual tasks (no approved plan/template) freeze a derived
  // best-effort contract. When that contract is trusted-complete (required
  // criteria, every one source-anchored to approved content, no ambiguity
  // fallback) and real evaluated evidence passes every required criterion,
  // the outcome is verified_complete — the normal Completed behavior.
  function bestEffortContract(criteria: TaskCompletionContract["criteria"]): TaskCompletionContract {
    return {
      schemaVersion: 1 as const,
      contractId: "contract-be",
      contractHash: "hash-be",
      objective: "Save 100 qualifying contacts to campaign camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "best_effort" as const,
      criteria,
    };
  }

  function anchoredRecordCount(id: string): TaskCompletionContract["criteria"][number] {
    return {
      id,
      required: true,
      kind: "record_count" as const,
      description: "Save at least 100 qualifying contacts",
      adapterKey: "record_count",
      targetId: "qualifying contacts",
      scope: "execution" as const,
      minimum: 100,
      sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 20 }],
    };
  }

  function ambiguousFallback(id: string): TaskCompletionContract["criteria"][number] {
    return {
      id,
      required: true,
      kind: "qualitative" as const,
      description: "User request: save some contacts please",
      sourceSelectorKeys: [],
      sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 27 }],
    };
  }

  it("B01a: best-effort + trusted complete contract + real evidence passing all → verified_complete (FR-04/17/19/22)", async () => {
    const ctrl = new TaskCompletionController();
    const fakeService = {
      checkCandidate: async () => ({
        passedCriterionIds: ["crit-record_count-0"],
        unmetCriterionIds: [],
        evidenceIds: ["evidence-be-1"],
      }),
    };
    const decision = await ctrl.decide(
      baseCandidate({
        content: "Saved 100 qualifying contacts to camp-1.",
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
      }),
      {
        route: "task_best_effort",
        evidenceService: fakeService,
        contract: bestEffortContract([anchoredRecordCount("crit-record_count-0")]),
        evidenceContext: {
          content: "Saved 100 qualifying contacts to camp-1.",
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
      expect(decision.evidenceIds).toEqual(["evidence-be-1"]);
    }
  });

  it("B01b: best-effort + zero-criteria contract → incomplete, never verified (FR-04)", async () => {
    const ctrl = new TaskCompletionController();
    const fakeService = {
      checkCandidate: async () => ({
        passedCriterionIds: [],
        unmetCriterionIds: [],
        evidenceIds: [],
      }),
    };
    const decision = await ctrl.decide(
      baseCandidate({
        content: "Hello.",
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
      }),
      {
        route: "task_best_effort",
        evidenceService: fakeService,
        contract: bestEffortContract([]),
        evidenceContext: {
          content: "Hello.",
          source: "provider",
          sourceRevision: "rev-1",
          expectedStateVersion: 0,
        },
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.outcome).not.toBe("verified_complete");
    }
  });

  it("B01c: best-effort + ambiguous-fallback contract stays unverified even when the checker passes it (FR-04/AC-21)", async () => {
    const ctrl = new TaskCompletionController();
    const fakeService = {
      checkCandidate: async () => ({
        passedCriterionIds: ["crit-qualitative-0"],
        unmetCriterionIds: [],
        evidenceIds: ["evidence-be-2"],
      }),
    };
    const decision = await ctrl.decide(
      baseCandidate({
        content: "I saved some contacts.",
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
      }),
      {
        route: "task_best_effort",
        evidenceService: fakeService,
        contract: bestEffortContract([ambiguousFallback("crit-qualitative-0")]),
        evidenceContext: {
          content: "I saved some contacts.",
          source: "provider",
          sourceRevision: "rev-1",
          expectedStateVersion: 0,
        },
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      // The fallback spans the whole message with no structured selectors —
      // passing it proves nothing about the request. Stays unverified.
      expect(decision.outcome).toBe("incomplete");
      expect(decision.outcome).not.toBe("verified_complete");
    }
  });

  it("B01d: best-effort + complete contract but caller-supplied IDs (no evidence service) → incomplete (FR-04)", async () => {
    // Without a real evaluation (no evidence service wired) there is no
    // admissible evidence — mock-path IDs must never verify, even with a
    // trusted contract present.
    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({
        content: "Saved 100 qualifying contacts to camp-1.",
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
      }),
      {
        route: "task_best_effort",
        passedCriterionIds: ["crit-record_count-0"],
        requiredCriterionIds: ["crit-record_count-0"],
        contract: bestEffortContract([anchoredRecordCount("crit-record_count-0")]),
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.outcome).not.toBe("verified_complete");
    }
  });

  // ----- T21b: distinct finishReason/recovery mapping (FR-05/06/16, AC-12/30) -----
  // The controller used to gate safety ONLY via the candidate.safetyRestriction
  // boolean and map every non-verified outcome through incompleteReasonCode's
  // provenance/boundary branches — finishReason content_filter/length/error
  // and auth/quota recovery reasons were indistinct. These tests lock the
  // distinct mapping: content_filter → blocked_by_policy without relying on
  // the manually supplied safety boolean; length → OUTPUT_TRUNCATED; error →
  // PROVIDER_ERROR; auth/quota/non_recoverable → distinct permanent codes.
  // A recoverable recovery reason does NOT become a permanent code — it stays
  // a controller-decided incomplete (held for decision, not blind-failed).

  it("T21b: content_filter finishReason → blocked_by_policy CONTENT_RESTRICTED (independent of safetyRestriction boolean)", async () => {
    const ctrl = new TaskCompletionController();
    // safetyRestriction boolean is FALSE here — the controller must derive
    // the restriction from finishReason itself, not trust a manual flag.
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "content_filter",
        safetyRestriction: false,
        content: "I can",
      }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"] }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("blocked_by_policy");
      expect(decision.reasonCode).toBe("CONTENT_RESTRICTED");
    }
  });

  it("T21b: length finishReason with partial content → incomplete OUTPUT_TRUNCATED (distinct from CONTINUATION_LIMIT)", async () => {
    const ctrl = new TaskCompletionController();
    // response_end + length + partial content → truncation, NOT a budget cap
    // and NOT generic NO_PROGRESS.
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "length",
        content: "Partial answer that ran",
      }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"] }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("OUTPUT_TRUNCATED");
    }
  });

  it("T21b: error finishReason → incomplete PROVIDER_ERROR (distinct from truncation)", async () => {
    const ctrl = new TaskCompletionController();
    // error finishReason means the provider reported a transient server-side
    // failure; the controller maps it distinctly from length truncation.
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "error",
        content: "Some partial",
      }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"] }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("PROVIDER_ERROR");
    }
  });

  it("T21b: auth recovery reason → incomplete AUTH_FAILURE (permanent, distinct from quota)", async () => {
    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
        content: "Partial",
      }),
      {
        route: "task_verified",
        requiredCriterionIds: ["rec-1"],
        recoveryReason: "auth",
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("AUTH_FAILURE");
    }
  });

  it("T21b: quota recovery reason → incomplete QUOTA_EXHAUSTED (distinct from auth)", async () => {
    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
        content: "Partial",
      }),
      {
        route: "task_verified",
        requiredCriterionIds: ["rec-1"],
        recoveryReason: "quota",
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("QUOTA_EXHAUSTED");
    }
  });

  it("T21b: non_recoverable recovery reason → incomplete NON_RECOVERABLE", async () => {
    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
        content: "Partial",
      }),
      {
        route: "task_verified",
        requiredCriterionIds: ["rec-1"],
        recoveryReason: "non_recoverable",
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.reasonCode).toBe("NON_RECOVERABLE");
    }
  });

  it("T21b: recoverable recovery reason (network) → NOT a permanent code (held for controller decision)", async () => {
    const ctrl = new TaskCompletionController();
    // A recoverable reason must NOT become AUTH_FAILURE/QUOTA_EXHAUSTED. The
    // controller holds it for decision — it surfaces as a recoverable
    // incomplete (STREAM_INCOMPLETE / NO_PROGRESS), not a permanent error.
    const decision = await ctrl.decide(
      baseCandidate({
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        finishReason: "stop",
        content: "Some text",
      }),
      {
        route: "task_verified",
        requiredCriterionIds: ["rec-1"],
        recoveryReason: "network",
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).not.toBe("AUTH_FAILURE");
      expect(decision.reasonCode).not.toBe("QUOTA_EXHAUSTED");
      expect(decision.reasonCode).not.toBe("NON_RECOVERABLE");
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

  // ----- Slice 2 (Unit 2): live budget consult (D4, FR-08/09, AC-09/10) -----

  it("Slice 2 budget: continuation exhausted → finish(incomplete, CONTINUATION_LIMIT)", async () => {
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS, maxContinuations: 1 });
    budget.reserveContinuation("cont-1");
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 50/100.", finishReason: "length", boundary: "round_cap" }),
      { route: "task_verified", budget }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("CONTINUATION_LIMIT");
    }
  });

  it("Slice 2 budget: provider attempts exhausted → finish(incomplete, MODEL_ATTEMPT_LIMIT)", async () => {
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS, maxProviderAttempts: 2 });
    budget.reserveProviderAttempt("prov-1");
    budget.reserveProviderAttempt("prov-2");
    const decision = await ctrl.decide(
      baseCandidate({ content: "Partial.", finishReason: "length", boundary: "budget_cap" }),
      { route: "task_verified", budget }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("MODEL_ATTEMPT_LIMIT");
    }
  });

  it("Slice 2 budget: continuation consult wins over provider consult (both exhausted → CONTINUATION_LIMIT)", async () => {
    // Precedence: continuation-limit is checked before provider-limit so the
    // reason code is deterministic when both allowances are spent.
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS, maxContinuations: 0, maxProviderAttempts: 0 });
    const decision = await ctrl.decide(baseCandidate({}), { route: "task_verified", budget });
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.reasonCode).toBe("CONTINUATION_LIMIT");
    }
  });

  it("Slice 2 budget: with allowance remaining, decision falls through to criteria evaluation", async () => {
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    budget.reserveContinuation("cont-1");
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_verified",
        passedCriterionIds: ["rec-1"],
        requiredCriterionIds: ["rec-1"],
        budget,
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("verified_complete");
    }
  });

  // ----- T07 (FR-06/08, AC-03/08): evidence-first completion at exhausted
  // maker budgets. Already-collected evidence can establish genuine
  // completion on the final allowed attempt; only UNFINISHED work is
  // rejected when the maker budget is spent. -----

  it("T07: continuation exhausted + all required criteria passed → verified_complete (not CONTINUATION_LIMIT)", async () => {
    // The audit probe: spend the sole continuation, supply a clean terminal
    // with all required criteria passed. Before T07 this returned
    // incomplete/CONTINUATION_LIMIT with remainingWork empty. Now evidence
    // is evaluated BEFORE the maker-budget gate, so genuine completion wins.
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS, maxContinuations: 1 });
    budget.reserveContinuation("cont-spent"); // sole continuation spent
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_verified",
        passedCriterionIds: ["rec-1"],
        requiredCriterionIds: ["rec-1"],
        budget,
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("verified_complete");
      expect(decision.reasonCode).toBe("CRITERIA_SATISFIED");
      expect(decision.remainingWork).toEqual([]);
    }
  });

  it("T07: provider exhausted + all required criteria passed → verified_complete (not MODEL_ATTEMPT_LIMIT)", async () => {
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS, maxProviderAttempts: 2 });
    budget.reserveProviderAttempt("prov-1");
    budget.reserveProviderAttempt("prov-2"); // provider allowance spent
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_verified",
        passedCriterionIds: ["rec-1"],
        requiredCriterionIds: ["rec-1"],
        budget,
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("verified_complete");
      expect(decision.reasonCode).toBe("CRITERIA_SATISFIED");
    }
  });

  it("T07: continuation exhausted + unfinished work → incomplete/CONTINUATION_LIMIT (evidence evaluated, no false verified)", async () => {
    // Unfinished task → explicit non-success, no further dispatch. Evidence
    // is still evaluated (evidenceIds populated, remainingWork from unmet).
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS, maxContinuations: 1 });
    budget.reserveContinuation("cont-spent");
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 50/100.", finishReason: "length", boundary: "round_cap" }),
      {
        route: "task_verified",
        passedCriterionIds: [],
        requiredCriterionIds: ["rec-1"],
        budget,
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("CONTINUATION_LIMIT");
      expect(decision.remainingWork).toEqual(["rec-1"]);
    }
  });

  it("T07: both continuations and provider exhausted + unfinished → CONTINUATION_LIMIT (precedence preserved)", async () => {
    // The continuation-before-provider precedence still holds when evidence
    // does not verify.
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({
      ...MANUAL_BUDGET_DEFAULTS,
      maxContinuations: 0,
      maxProviderAttempts: 0,
    });
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 50/100.", finishReason: "length", boundary: "round_cap" }),
      {
        route: "task_verified",
        passedCriterionIds: [],
        requiredCriterionIds: ["rec-1"],
        budget,
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("CONTINUATION_LIMIT");
    }
  });

  it("T07: genuine completion on the LAST allowed provider attempt → verified (final attempt not mislabeled incomplete)", async () => {
    // Do not incorrectly label work completed on the final allowed attempt
    // incomplete (audit regression). Spend all but the boundary is clean,
    // criteria pass → verified regardless of maker-budget state.
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS, maxProviderAttempts: 3 });
    budget.reserveProviderAttempt("prov-1");
    budget.reserveProviderAttempt("prov-2");
    budget.reserveProviderAttempt("prov-3"); // final allowed attempt spent
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_verified",
        passedCriterionIds: ["rec-1"],
        requiredCriterionIds: ["rec-1"],
        budget,
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("verified_complete");
    }
  });

  it("Slice 2 budget: undefined budget → no consult (Slice 1 behavior preserved)", async () => {
    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 50/100.", finishReason: "length", boundary: "round_cap" }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"] }
    );
    // Without a budget, the boundary-derived reason code (not a budget
    // accessor) drives the reason.
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.reasonCode).toBe("CONTINUATION_LIMIT");
    }
  });

  it("Slice 2 budget: safety restriction still wins over budget exhaustion", async () => {
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS, maxContinuations: 0 });
    const decision = await ctrl.decide(
      baseCandidate({ safetyRestriction: true, content: "I can't help." }),
      { route: "task_verified", budget }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("blocked_by_policy");
    }
  });

  it("Slice 2 budget: budget-gated checker reserve reaches the evidence service (per-candidate window)", async () => {
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS, maxCheckerAttempts: 1 });
    const reserveCalls: BudgetReservationResult[] = [];
    const fakeService = {
      checkCandidate: async (
        _candidate: TaskEndCandidate,
        _contract: TaskCompletionContract,
        context: { budgetReserveChecker?: () => BudgetReservationResult }
      ) => {
        // Simulate the qualitative evaluator consuming the reserve function.
        const reserve = context.budgetReserveChecker;
        if (reserve) {
          reserveCalls.push(reserve());
          reserveCalls.push(reserve());
        }
        return { passedCriterionIds: ["rec-1"], unmetCriterionIds: [], evidenceIds: ["evidence-1"] };
      },
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
        evidenceContext: { content: "Saved 100 contacts.", source: "provider", sourceRevision: "rev-1" },
        budget,
      }
    );
    // First reserve succeeds (1 of 1 per-run), second is exhausted.
    expect(reserveCalls).toEqual([BudgetReservationResult.Reserved, BudgetReservationResult.Exhausted]);
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("verified_complete");
    }
  });

  // ----- Slice 2 (Unit 4): LIVE continuation branch (§7.2 step 10, FR-07) -----
  // Budget presence is the live-mode signal. With a budget injected and
  // feasible unmet work, decide() returns `continue` with the §7.3 targeted
  // prompt. Without a budget (shadow mode / flag off), the same candidate
  // still returns finish(incomplete) — byte-identical to Slice 1.

  it("Slice 2 live: budget + unmet criteria → continue with the §7.3 targeted prompt", async () => {
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 54/100 contacts.", boundary: "round_cap", finishReason: "length" }),
      {
        route: "task_verified",
        requiredCriterionIds: ["rec-1"],
        budget,
      }
    );
    expect(decision.type).toBe("continue");
    if (decision.type === "continue") {
      expect(decision.unmetCriterionIds).toEqual(["rec-1"]);
      expect(decision.continuationId).toContain("cand-1");
      expect(decision.prompt).toContain("Continue the same approved task execution");
      expect(decision.prompt).toContain("Unmet criteria: rec-1");
      expect(decision.prompt).toContain("Do not claim completion without required evidence");
      expect(decision.prompt).toContain("Remaining limits:");
    }
  });

  it("Slice 2 live: continue carries the contract objective when present", async () => {
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 54/100." }),
      {
        route: "task_verified",
        requiredCriterionIds: ["rec-1"],
        budget,
        contract: {
          schemaVersion: 1 as const,
          contractId: "contract-1",
          contractHash: "hash-abc",
          objective: "Save 100 qualifying contacts",
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
        },
      }
    );
    expect(decision.type).toBe("continue");
    if (decision.type === "continue") {
      expect(decision.prompt).toContain("Objective: Save 100 qualifying contacts");
    }
  });

  it("Slice 2 live: all criteria passing on task_best_effort → finish(incomplete), never continue (FR-04 no-loop guard)", async () => {
    // A best-effort task with all criteria passing cannot verify (FR-04) —
    // but it is DONE by design. If the continue branch fired on "unverified"
    // rather than "unmet", this candidate would loop forever. The branch
    // must fire only on actual unmet work.
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 100 contacts." }),
      {
        route: "task_best_effort",
        passedCriterionIds: ["rec-1"],
        requiredCriterionIds: ["rec-1"],
        budget,
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.remainingWork).toEqual([]);
    }
  });

  it("Slice 2 live: budget_cap boundary never continues — runtime caps were the limiter", async () => {
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const decision = await ctrl.decide(
      baseCandidate({ content: "Partial.", boundary: "budget_cap", finishReason: "length" }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"], budget }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("CONTINUATION_LIMIT");
    }
  });

  it("Slice 2 live: missing terminal never continues — truncated stream routes to recovery", async () => {
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const decision = await ctrl.decide(
      baseCandidate({ streamTerminalSeen: false, finishReason: null, content: "" }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"], budget }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.reasonCode).toBe("STREAM_INCOMPLETE");
    }
  });

  it("Slice 2 live: continuation exhausted guard holds before the continue branch (CONTINUATION_LIMIT)", async () => {
    // isContinuationBudgetExhausted is consulted at step 6 (D4 gate) AND
    // re-guarded in the continue branch — but the step-6 consult already
    // returns finish(CONTINUATION_LIMIT) for a fully-spent allowance, so
    // the continue branch is unreachable with an exhausted budget. This
    // locks the invariant from the other side.
    const ctrl = new TaskCompletionController();
    const budget = new TaskRunBudget({ ...MANUAL_BUDGET_DEFAULTS, maxContinuations: 1 });
    budget.reserveContinuation("cont-spent");
    const decision = await ctrl.decide(
      baseCandidate({ content: "Saved 54/100.", boundary: "round_cap", finishReason: "length" }),
      { route: "task_verified", requiredCriterionIds: ["rec-1"], budget }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.reasonCode).toBe("CONTINUATION_LIMIT");
    }
  });
});
