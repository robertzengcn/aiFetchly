import { describe, expect, it } from "vitest";
import {
  taskOutcomeSchema,
  taskCompletionContractSchema,
  taskCriterionSchema,
  taskEvidenceSchema,
  taskEndCandidateSchema,
  taskCompletionDecisionSchema,
  taskExecutionOriginSchema,
  taskExecutionRouteSchema,
  TASK_EXECUTION_LEDGER_STATUSES,
  TASK_EXECUTION_REASON_CODES,
} from "@/entityTypes/aiTaskExecutionTypes";
import type {
  TaskCompletionDecision,
  TaskEndCandidate,
} from "@/entityTypes/aiTaskExecutionTypes";
import type { DecideContext } from "@/service/aiTaskExecution/TaskCompletionController";
import { TaskCompletionController } from "@/service/aiTaskExecution/TaskCompletionController";
import { mapDecisionToOutcome } from "@/service/ScheduledLoopEventSink";

describe("aiTaskExecutionTypes schemas", () => {
  it("parses a valid task outcome", () => {
    const result = taskOutcomeSchema.parse("verified_complete");
    expect(result).toBe("verified_complete");
  });

  it("rejects an invalid task outcome", () => {
    expect(() => taskOutcomeSchema.parse("done")).toThrow();
  });

  it("parses a valid observation criterion", () => {
    const criterion = {
      id: "obs-1",
      required: true,
      kind: "observation",
      description: "deployment status queried",
      adapterKey: "deploy-status",
      targetId: "deploy-prod",
      sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 40 }],
    };
    const result = taskCriterionSchema.parse(criterion);
    expect(result.kind).toBe("observation");
    expect(result.required).toBe(true);
  });

  it("parses a valid record_count criterion with cumulative scope", () => {
    const criterion = {
      id: "rec-1",
      required: true,
      kind: "record_count",
      description: "save 100 contacts",
      adapterKey: "contact-campaign",
      targetId: "camp-1",
      scope: "cumulative",
      minimum: 100,
      sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 20 }],
    };
    const result = taskCriterionSchema.parse(criterion);
    expect(result.kind).toBe("record_count");
    if (result.kind === "record_count") {
      expect(result.scope).toBe("cumulative");
      expect(result.minimum).toBe(100);
    }
  });

  it("parses a valid contract", () => {
    const contract = {
      schemaVersion: 1,
      contractId: "contract-1",
      contractHash: "sha256:abc",
      objective: "Save 100 qualifying contacts to campaign camp-1",
      sourceUserMessageId: "msg-1",
      approvedSourceMessageIds: ["msg-1"],
      mode: "verified" as const,
      criteria: [
        {
          id: "rec-1",
          required: true,
          kind: "record_count",
          description: "save 100 contacts",
          adapterKey: "contact-campaign",
          targetId: "camp-1",
          scope: "cumulative",
          minimum: 100,
          sourceRefs: [{ messageId: "msg-1", startOffset: 0, endOffset: 20 }],
        },
      ],
    };
    const result = taskCompletionContractSchema.parse(contract);
    expect(result.schemaVersion).toBe(1);
    expect(result.criteria).toHaveLength(1);
  });

  it("parses a manual execution origin", () => {
    const origin = { type: "manual", submissionId: "sub-1" };
    const result = taskExecutionOriginSchema.parse(origin);
    expect(result.type).toBe("manual");
  });

  it("parses a scheduled execution origin", () => {
    const origin = {
      type: "scheduled",
      taskId: 5,
      runId: 10,
      occurrenceKey: "scheduled-loop:3:1",
    };
    const result = taskExecutionOriginSchema.parse(origin);
    expect(result.type).toBe("scheduled");
    if (result.type === "scheduled") {
      expect(result.taskId).toBe(5);
    }
  });

  it("parses a valid evidence record", () => {
    const evidence = {
      evidenceId: "ev-1",
      criterionId: "rec-1",
      contractHash: "sha256:abc",
      executionId: "exec-1",
      observedAt: "2026-10-04T12:00:00Z",
      source: "contact-campaign",
      sourceRevision: "rev-1",
      state: "pass",
      referenceIds: ["camp-1"],
      summary: "100 contacts saved",
    };
    const result = taskEvidenceSchema.parse(evidence);
    expect(result.state).toBe("pass");
    expect(result.criterionId).toBe("rec-1");
  });

  it("parses a valid task end candidate", () => {
    const candidate = {
      candidateId: "cand-1",
      executionId: "exec-1",
      content: "done",
      finishReason: "stop",
      provenance: "provider",
      streamTerminalSeen: true,
      boundary: "response_end",
      pendingPermission: false,
      pendingQuestion: false,
      pendingPlanApproval: false,
      safetyRestriction: false,
    };
    const result = taskEndCandidateSchema.parse(candidate);
    expect(result.boundary).toBe("response_end");
    expect(result.streamTerminalSeen).toBe(true);
  });

  it("parses a valid execution route", () => {
    const result = taskExecutionRouteSchema.parse("task_verified");
    expect(result).toBe("task_verified");
  });

  it("rejects an invalid execution route", () => {
    expect(() => taskExecutionRouteSchema.parse("unknown")).toThrow();
  });

  it("parses a finish decision", () => {
    const decision = {
      type: "finish",
      outcome: "verified_complete",
      reasonCode: "CRITERIA_SATISFIED",
      evidenceIds: ["ev-1"],
      summary: "All criteria passed",
      remainingWork: [],
    };
    const result = taskCompletionDecisionSchema.parse(decision);
    expect(result.type).toBe("finish");
  });

  it("exposes the full reason-code set", () => {
    expect(TASK_EXECUTION_REASON_CODES).toContain("CRITERIA_SATISFIED");
    expect(TASK_EXECUTION_REASON_CODES).toContain("UNKNOWN_ACTION_OUTCOME");
    expect(TASK_EXECUTION_REASON_CODES).toContain("PERSISTENCE_FAILED");
    expect(TASK_EXECUTION_REASON_CODES).toContain("USER_CANCELLED");
  });

  it("exposes the ledger-status set", () => {
    expect(TASK_EXECUTION_LEDGER_STATUSES).toContain("active");
    expect(TASK_EXECUTION_LEDGER_STATUSES).toContain("released");
  });
});

/**
 * D8 review finding — reason-code vocabulary drift. The durable
 * `outcome_reason_code` column (varchar(64)) and the §17 rollout histogram
 * are keyed by TASK_EXECUTION_REASON_CODES. Writers must never emit a code
 * outside the vocabulary, or the histogram grows a bucket per novel string
 * (format drift) and the i18n display map misses the code.
 *
 * This suite drives the reason-producing writer paths that can be exercised
 * with light imports (controller + sink mapping; the runner's finalize
 * statics are covered in ScheduledAiMessageRunnerFinalize.test.ts where the
 * heavy module's mocks already exist):
 *   - TaskCompletionController.decide (the controller's classified codes,
 *     including T21b's distinct finishReason/recovery mappings)
 *   - ScheduledLoopEventSink.mapDecisionToOutcome (decision → outcome kind)
 * and asserts every emitted code lands in the vocabulary. Any writer that
 * introduces a new code (or removes a code the fallbacks rely on) fails
 * here first, forcing a vocabulary + 6-language i18n update in the same
 * change.
 */
describe("TASK_EXECUTION_REASON_CODES vocabulary — writer format-drift guard", () => {
  function baseCandidate(
    overrides: Partial<TaskEndCandidate>
  ): TaskEndCandidate {
    return {
      candidateId: "cand-1",
      executionId: "exec-1",
      content: "Partial",
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

  type DecideContextOverrides = Partial<
    Pick<DecideContext, "route" | "passedCriterionIds" | "requiredCriterionIds" | "recoveryReason">
  >;

  type MappedOutcome = ReturnType<typeof mapDecisionToOutcome>;

  /** Drive controller.decide → sink mapDecisionToOutcome. */
  async function decideAndMap(
    candidateOverrides: Partial<TaskEndCandidate>,
    contextOverrides: DecideContextOverrides
  ): Promise<{ readonly decision: TaskCompletionDecision; readonly outcome: MappedOutcome }> {
    const ctrl = new TaskCompletionController();
    const decision: TaskCompletionDecision = await ctrl.decide(
      baseCandidate(candidateOverrides),
      {
        route: "task_verified",
        ...contextOverrides,
      }
    );
    return { decision, outcome: mapDecisionToOutcome(decision, "msg-1") };
  }

  function decisionReasonCode(decision: TaskCompletionDecision): string {
    if (decision.type === "finish") return decision.reasonCode;
    if (decision.type === "wait") return decision.reason;
    return "";
  }

  it("controller finish decisions map to vocabulary codes (verified/incomplete/blocked/cancelled)", async () => {
    // verified_complete → completed outcome; the controller's reasonCode is
    // CRITERIA_SATISFIED (the runner's finalize mapping emits the same code
    // statically for completed outcomes — covered in the finalize suite).
    const verified = await decideAndMap(
      { content: "Saved 100 contacts." },
      {
        passedCriterionIds: ["rec-1"],
        requiredCriterionIds: ["rec-1"],
      }
    );
    expect(verified.outcome.kind).toBe("completed");
    expect(verified.decision.type).toBe("finish");
    expect(decisionReasonCode(verified.decision)).toBe("CRITERIA_SATISFIED");
    // plain incomplete → NO_PROGRESS (vocabulary)
    const incomplete = await decideAndMap(
      { content: "Partial" },
      { requiredCriterionIds: ["rec-1"] }
    );
    expect(incomplete.outcome.kind).toBe("incomplete");
    if (incomplete.outcome.kind === "incomplete") {
      expect(incomplete.outcome.reasonCode).toBe("NO_PROGRESS");
    }
    // content_filter finishReason → blocked CONTENT_RESTRICTED
    const blocked = await decideAndMap(
      { finishReason: "content_filter", safetyRestriction: false },
      { requiredCriterionIds: ["rec-1"] }
    );
    expect(blocked.outcome.kind).toBe("blocked");
    if (blocked.outcome.kind === "blocked") {
      expect(blocked.outcome.reason).toBe("CONTENT_RESTRICTED");
    }
    // The drift guard itself: every writer-emitted code must be in the
    // vocabulary or the §17 histogram + i18n display silently rot.
    for (const code of [
      decisionReasonCode(verified.decision),
      decisionReasonCode(incomplete.decision),
      decisionReasonCode(blocked.decision),
    ]) {
      expect(TASK_EXECUTION_REASON_CODES).toContain(code);
    }
  });

  it("T21b distinct codes (AUTH_FAILURE/QUOTA_EXHAUSTED/NON_RECOVERABLE/PROVIDER_ERROR/OUTPUT_TRUNCATED) are all in the vocabulary", async () => {
    const mapped = [
      await decideAndMap({ finishReason: "stop" }, { recoveryReason: "auth" }),
      await decideAndMap({ finishReason: "stop" }, { recoveryReason: "quota" }),
      await decideAndMap({ finishReason: "stop" }, { recoveryReason: "non_recoverable" }),
      await decideAndMap({ finishReason: "error" }, {}),
      await decideAndMap({ finishReason: "length" }, {}),
    ];
    const codes = mapped.map(({ decision }) => decisionReasonCode(decision));
    for (const code of codes) {
      expect(TASK_EXECUTION_REASON_CODES).toContain(code);
    }
    expect(codes).toEqual([
      "AUTH_FAILURE",
      "QUOTA_EXHAUSTED",
      "NON_RECOVERABLE",
      "PROVIDER_ERROR",
      "OUTPUT_TRUNCATED",
    ]);
    // Every mapped outcome carries the code the finalize path will write
    // (incomplete → reasonCode passthrough into the durable column).
    for (const { outcome } of mapped) {
      expect(outcome.kind).toBe("incomplete");
      if (outcome.kind === "incomplete") {
        expect(TASK_EXECUTION_REASON_CODES).toContain(outcome.reasonCode);
      }
    }
  });
});
