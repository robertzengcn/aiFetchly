import { describe, expect, it } from "vitest";
import {
  TaskProgressTracker,
  isDiscoveryToolCall,
  buildToolRoundFingerprint,
} from "@/service/aiTaskExecution/TaskProgressTracker";
import {
  TaskRunBudget,
  MANUAL_BUDGET_DEFAULTS,
} from "@/service/aiTaskExecution/TaskRunBudget";
import { TaskCompletionController } from "@/service/aiTaskExecution/TaskCompletionController";
import type {
  TaskEndCandidate,
  TaskCompletionContract,
} from "@/entityTypes/aiTaskExecutionTypes";

function baseCandidate(
  overrides: Partial<TaskEndCandidate>
): TaskEndCandidate {
  return {
    candidateId: "cand-exec-1:round_cap",
    executionId: "exec-1",
    content: "Working on it.",
    finishReason: "stop",
    provenance: "provider",
    streamTerminalSeen: true,
    boundary: "round_cap",
    pendingPermission: false,
    pendingQuestion: false,
    pendingPlanApproval: false,
    safetyRestriction: false,
    ...overrides,
  };
}

describe("TaskProgressTracker fingerprints (FR-09, §7.2 step 7)", () => {
  it("same normalized request + same result → identical fingerprint", () => {
    const fp1 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "dentists in berlin" },
      resultPayload: { success: true, rows: [{ id: "a", name: "Alpha" }] },
    });
    const fp2 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "dentists in berlin" },
      resultPayload: { success: true, rows: [{ id: "a", name: "Alpha" }] },
    });
    expect(fp1).toBe(fp2);
  });

  it("changed result → different fingerprint", () => {
    const fp1 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "dentists in berlin" },
      resultPayload: { success: true, rows: [{ id: "a" }] },
    });
    const fp2 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "dentists in berlin" },
      resultPayload: { success: true, rows: [{ id: "a" }, { id: "b" }] },
    });
    expect(fp1).not.toBe(fp2);
  });

  it("excludes executionTimeMs / timestamps / random IDs from the result", () => {
    const fp1 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: {
        success: true,
        executionTimeMs: 123,
        timestamp: "2026-10-07T01:02:03.456Z",
        requestId: "req-abc-1",
        rows: [{ id: "a" }],
      },
    });
    const fp2 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: {
        success: true,
        executionTimeMs: 987,
        timestamp: "2026-10-07T09:08:07.654Z",
        requestId: "req-xyz-9",
        rows: [{ id: "a" }],
      },
    });
    expect(fp1).toBe(fp2);
  });

  it("changed arguments → different fingerprint", () => {
    const fp1 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "dentists" },
      resultPayload: { success: true },
    });
    const fp2 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "dentists berlin" },
      resultPayload: { success: true },
    });
    expect(fp1).not.toBe(fp2);
  });

  it("changed error message → different fingerprint (changed error is new signal)", () => {
    const fp1 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: false, error: "ECONNRESET at node-1" },
    });
    const fp2 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: false, error: "HTTP 429 rate limited" },
    });
    expect(fp1).not.toBe(fp2);
  });

  it("normalizes argument key order and nested structure", () => {
    const fp1 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { a: 1, b: { x: "1", y: [3, 2] } },
      resultPayload: { success: true },
    });
    const fp2 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { b: { y: [3, 2], x: "1" }, a: 1 },
      resultPayload: { success: true },
    });
    expect(fp1).toBe(fp2);
  });

  it("same repeated text with different fingerprint still differs (repeated text is not progress by itself)", () => {
    const fp1 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, message: "no new results" },
    });
    const fp2 = buildToolRoundFingerprint({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, message: "no new results", page: 2 },
    });
    expect(fp1).not.toBe(fp2);
  });
});

describe("isDiscoveryToolCall (FR-09 discovery-traffic exclusion)", () => {
  it("tool_catalog_search is discovery traffic", () => {
    expect(isDiscoveryToolCall("tool_catalog_search")).toBe(true);
  });

  it("ordinary work tools are not discovery traffic", () => {
    expect(isDiscoveryToolCall("search_contacts")).toBe(false);
    expect(isDiscoveryToolCall("start_email_send_task")).toBe(false);
    expect(isDiscoveryToolCall("")).toBe(false);
  });
});

describe("TaskProgressTracker.recordToolRound (FR-09, §7.2 step 7)", () => {
  function makeBudget(): TaskRunBudget {
    return new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
  }

  it("no binding budget → no-op (flag-off/shadow byte-identical)", () => {
    const tracker = new TaskProgressTracker({ budget: undefined });
    expect(() =>
      tracker.recordToolRound({
        toolName: "search_contacts",
        arguments: { query: "berlin" },
        resultPayload: { success: true, rows: [] },
      })
    ).not.toThrow();
    // A later bound tracker starts from zero streak.
    const budget = makeBudget();
    const bound = new TaskProgressTracker({ budget });
    expect(budget.getConsumed().noProgressStreak).toBe(0);
  });

  it("first recorded round seeds the fingerprint (no streak)", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    tracker.recordToolRound({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [{ id: "a" }] },
    });
    expect(budget.getConsumed().noProgressStreak).toBe(0);
  });

  it("identical fingerprint on consecutive rounds → recordNoProgress", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    const round = {
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    };
    tracker.recordToolRound(round);
    tracker.recordToolRound(round);
    expect(budget.getConsumed().noProgressStreak).toBe(1);
    tracker.recordToolRound(round);
    expect(budget.getConsumed().noProgressStreak).toBe(2);
  });

  it("discovery traffic never seeds a fingerprint and never counts as progress or stall", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    const discovery = {
      toolName: "tool_catalog_search",
      arguments: { query: "email tools" },
      resultPayload: { success: true, tools: ["send_email"] },
    };
    tracker.recordToolRound(discovery);
    tracker.recordToolRound(discovery);
    tracker.recordToolRound(discovery);
    // No fingerprint seeded → no comparison → streak stays 0.
    expect(budget.getConsumed().noProgressStreak).toBe(0);
  });

  it("changed result resets the streak", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    tracker.recordToolRound({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    });
    tracker.recordToolRound({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    });
    expect(budget.getConsumed().noProgressStreak).toBe(1);
    tracker.recordToolRound({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [{ id: "new" }] },
    });
    expect(budget.getConsumed().noProgressStreak).toBe(0);
  });

  it("interleaved discovery between identical work rounds still stalls", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    const workRound = {
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    };
    tracker.recordToolRound(workRound);
    tracker.recordToolRound({
      toolName: "tool_catalog_search",
      arguments: { query: "more tools" },
      resultPayload: { success: true, tools: [] },
    });
    tracker.recordToolRound(workRound);
    expect(budget.getConsumed().noProgressStreak).toBe(1);
  });

  it("changed error resets the streak but does not replenish continuation allowance", () => {
    const budget = makeBudget();
    const before = budget.getRemaining().continuations;
    const tracker = new TaskProgressTracker({ budget });
    tracker.recordToolRound({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: false, error: "ECONNRESET at node-1" },
    });
    tracker.recordToolRound({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: false, error: "ECONNRESET at node-1" },
    });
    expect(budget.getConsumed().noProgressStreak).toBe(1);
    // Changed error (FR-09: justifies another allowed action)
    tracker.recordToolRound({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: false, error: "HTTP 429 rate limited" },
    });
    expect(budget.getConsumed().noProgressStreak).toBe(0);
    // ...but the continuation allowance is NOT replenished.
    expect(budget.getRemaining().continuations).toBe(before);
  });

  it("different tool with same request shape → different fingerprint (no false stall)", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    tracker.recordToolRound({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    });
    tracker.recordToolRound({
      toolName: "scrape_website",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    });
    expect(budget.getConsumed().noProgressStreak).toBe(0);
  });
});

describe("controller continue gate on no-progress streak (FR-09, §7.2 step 9)", () => {
  const contract = {
    schemaVersion: 1,
    contractId: "contract-1",
    objective: "Collect contacts",
    taskRoute: "task_verified",
    requiredCriteria: [
      {
        criterionId: "rec-1",
        adapter: "record_count",
        required: true,
        description: "at least 10 contacts",
        threshold: { min: 10 },
      },
    ],
  } as unknown as TaskCompletionContract;

  /**
   * Live context with one required criterion unmet — the preconditions the
   * §7.2 step 10 continue branch requires (unmet.length > 0) so the streak
   * gate is what actually decides continue vs finish.
   */
  function liveContext(budget: TaskRunBudget): {
    route: "task_verified";
    contract: TaskCompletionContract;
    requiredCriterionIds: string[];
    passedCriterionIds: string[];
    budget: TaskRunBudget;
  } {
    return {
      route: "task_verified",
      contract,
      requiredCriterionIds: ["rec-1"],
      passedCriterionIds: [],
      budget,
    };
  }

  it("streak below bound → controller still authorizes continue", async () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const tracker = new TaskProgressTracker({ budget });
    const round = {
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    };
    tracker.recordToolRound(round);
    tracker.recordToolRound(round);
    tracker.recordToolRound(round); // streak = 2 < maxNoProgressStreak(3)

    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({ content: "Still searching..." }),
      liveContext(budget)
    );
    expect(decision.type).toBe("continue");
  });

  it("streak at bound → controller returns finish(incomplete, NO_PROGRESS), not continue", async () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const tracker = new TaskProgressTracker({ budget });
    const round = {
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    };
    tracker.recordToolRound(round);
    tracker.recordToolRound(round);
    tracker.recordToolRound(round);
    tracker.recordToolRound(round); // streak = 3 = maxNoProgressStreak

    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({ content: "Still searching..." }),
      liveContext(budget)
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      // FR-09: the streak (not the round cap) is why the run ends —
      // NO_PROGRESS, not the boundary-derived CONTINUATION_LIMIT.
      expect(decision.reasonCode).toBe("NO_PROGRESS");
      expect(decision.remainingWork).toEqual(["rec-1"]);
    }
  });

  it("no budget injected (shadow mode) → no streak gate, byte-identical finish(incomplete)", async () => {
    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({ content: "Still searching...", boundary: "response_end" }),
      {
        route: "task_verified",
        contract,
        requiredCriterionIds: ["rec-1"],
        passedCriterionIds: [],
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("NO_PROGRESS");
    }
  });

});
