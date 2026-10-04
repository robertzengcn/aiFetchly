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
