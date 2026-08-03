import { describe, expect, it } from "vitest";
import {
  GoalVerificationService,
  computeFailureFingerprint,
  type GoalVerificationEvidence,
} from "@/service/aiChatGoal/GoalVerificationService";
import type {
  AIChatGoalCriterion,
  GoalCriterionResult,
} from "@/entityTypes/aiChatGoalTypes";

const v = new GoalVerificationService();

const cmdCriterion = (criterionId: string): AIChatGoalCriterion => ({
  criterionId,
  description: "scraper returns results",
  required: true,
  verification: { kind: "command", command: "yarn test", expectedExitCode: 0 },
});

const llmCriterion = (criterionId: string): AIChatGoalCriterion => ({
  criterionId,
  description: "behavior is acceptable",
  required: true,
  verification: { kind: "llm" },
});

const manualCriterion = (criterionId: string): AIChatGoalCriterion => ({
  criterionId,
  description: "user agrees it works",
  required: true,
  verification: { kind: "manual" },
});

const ev = (
  criterionId: string,
  state: GoalVerificationEvidence["state"],
  sourceRevision?: string,
  reason?: string
): GoalVerificationEvidence => ({
  criterionId,
  state,
  sourceRevision,
  timestamp: "2026-01-01T00:00:00.000Z",
  reason,
});

describe("GoalVerificationService.verify", () => {
  it("a maker 'goal complete' claim is not evidence — missing evidence is not_satisfied", async () => {
    const result = await v.verify(
      { objective: "build scraper", criteria: [cmdCriterion("c1")] },
      [], // no evidence at all
      { currentSourceRevision: "rev-1" }
    );
    expect(result.verdict).toBe("not_satisfied");
    expect(result.criteria[0]?.passed).toBe(false);
  });

  it("stale evidence (older source revision) does not complete the goal", async () => {
    const result = await v.verify(
      { objective: "x", criteria: [cmdCriterion("c1")] },
      [ev("c1", "pass", "rev-0")], // passed, but against an OLD revision
      { currentSourceRevision: "rev-1" }
    );
    expect(result.verdict).toBe("not_satisfied");
    expect(result.criteria[0]?.reason).toContain("stale");
  });

  it("a required command failing keeps the goal incomplete even if an LLM says satisfied", async () => {
    // Two required criteria: a deterministic command (failing) and an llm one.
    const llmSaysSatisfied: GoalCriterionResult[] = [
      {
        criterionId: "c-llm",
        passed: true,
        evidenceRefs: ["e-llm"],
        reason: "looks fine",
      },
    ];
    const result = await v.verify(
      {
        objective: "x",
        criteria: [cmdCriterion("c-cmd"), llmCriterion("c-llm")],
      },
      [ev("c-cmd", "fail", "rev-1", "exit code 1")],
      {
        currentSourceRevision: "rev-1",
        llmVerifier: async () => llmSaysSatisfied,
      }
    );
    expect(result.verdict).toBe("not_satisfied");
    expect(
      result.criteria.find((c) => c.criterionId === "c-cmd")?.passed
    ).toBe(false);
  });

  it("rejects an LLM satisfied verdict that cites no evidence references", async () => {
    const result = await v.verify(
      { objective: "x", criteria: [llmCriterion("c-llm")] },
      [],
      {
        llmVerifier: async () => [
          {
            criterionId: "c-llm",
            passed: true,
            evidenceRefs: [],
            reason: "trust me",
          },
        ],
      }
    );
    expect(result.verdict).toBe("not_satisfied");
    expect(result.criteria[0]?.reason).toContain("no evidence references");
  });

  it("drops LLM results for unknown criterion ids", async () => {
    const result = await v.verify(
      { objective: "x", criteria: [llmCriterion("c-llm")] },
      [],
      {
        llmVerifier: async () => [
          { criterionId: "unknown-id", passed: true, evidenceRefs: ["e"], reason: "x" },
        ],
      }
    );
    // The unknown result is dropped; c-llm has no LLM result -> not satisfied.
    expect(result.verdict).toBe("not_satisfied");
    expect(result.criteria.find((c) => c.criterionId === "unknown-id")).toBeUndefined();
  });

  it("classifies a goal as blocked when a repeated failure fingerprint hits the threshold", async () => {
    const criterion = cmdCriterion("c1");
    const failing = ev("c1", "fail", "rev-1", "exit code 1");
    const fp = computeFailureFingerprint(criterion, failing, "rev-1");
    const result = await v.verify(
      { objective: "x", criteria: [criterion] },
      [failing],
      {
        currentSourceRevision: "rev-1",
        repeatedFailureThreshold: 3,
        failureCounts: new Map([[fp, 3]]),
      }
    );
    expect(result.verdict).toBe("blocked");
  });

  it("a new source revision changes the fingerprint (resets the repeated count)", async () => {
    const criterion = cmdCriterion("c1");
    const fpOld = computeFailureFingerprint(criterion, ev("c1", "fail", "rev-1"), "rev-1");
    const fpNew = computeFailureFingerprint(criterion, ev("c1", "fail", "rev-2"), "rev-2");
    expect(fpOld).not.toBe(fpNew);
  });

  it("pending Plan Mode approval yields needs_user_input", async () => {
    const result = await v.verify(
      { objective: "x", criteria: [cmdCriterion("c1")] },
      [ev("c1", "pass", "rev-1")],
      { currentSourceRevision: "rev-1", pendingPlanApproval: true }
    );
    expect(result.verdict).toBe("needs_user_input");
  });

  it("pending permission/question also yields needs_user_input", async () => {
    const a = await v.verify(
      { objective: "x", criteria: [cmdCriterion("c1")] },
      [ev("c1", "pass", "rev-1")],
      { currentSourceRevision: "rev-1", pendingPermission: true }
    );
    const b = await v.verify(
      { objective: "x", criteria: [cmdCriterion("c1")] },
      [ev("c1", "pass", "rev-1")],
      { currentSourceRevision: "rev-1", pendingQuestion: true }
    );
    expect(a.verdict).toBe("needs_user_input");
    expect(b.verdict).toBe("needs_user_input");
  });

  it("manual criterion passes only on explicit user confirmation", async () => {
    const without = await v.verify(
      { objective: "x", criteria: [manualCriterion("c1")] },
      [],
      {}
    );
    expect(without.verdict).toBe("not_satisfied");
    const withConfirm = await v.verify(
      { objective: "x", criteria: [manualCriterion("c1")] },
      [ev("c1", "pass")],
      {}
    );
    expect(withConfirm.verdict).toBe("satisfied");
  });

  it("satisfied when every required criterion has fresh passing evidence", async () => {
    const result = await v.verify(
      { objective: "x", criteria: [cmdCriterion("c1"), cmdCriterion("c2")] },
      [ev("c1", "pass", "rev-1"), ev("c2", "pass", "rev-1")],
      { currentSourceRevision: "rev-1" }
    );
    expect(result.verdict).toBe("satisfied");
  });

  it("an optional criterion failing does not block satisfaction", async () => {
    const optionalCmd: AIChatGoalCriterion = {
      criterionId: "c-opt",
      description: "optional",
      required: false,
      verification: { kind: "command", command: "lint", expectedExitCode: 0 },
    };
    const result = await v.verify(
      { objective: "x", criteria: [cmdCriterion("c1"), optionalCmd] },
      [ev("c1", "pass", "rev-1"), ev("c-opt", "fail", "rev-1", "lint err")],
      { currentSourceRevision: "rev-1" }
    );
    expect(result.verdict).toBe("satisfied");
  });

  it("LLM criterion satisfied WITH evidence references is honored", async () => {
    const result = await v.verify(
      { objective: "x", criteria: [llmCriterion("c-llm")] },
      [ev("c-llm", "pass", "rev-1")],
      {
        currentSourceRevision: "rev-1",
        llmVerifier: async () => [
          { criterionId: "c-llm", passed: true, evidenceRefs: ["c-llm"], reason: "evidence supports it" },
        ],
      }
    );
    expect(result.verdict).toBe("satisfied");
  });
});
