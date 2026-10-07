import { describe, expect, it } from "vitest";
import {
  TaskProgressTracker,
  isDiscoveryToolCall,
  buildToolRoundFingerprint,
  buildToolRequestKey,
  buildAssistantTextFingerprint,
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

describe("T20b request keys (per-(toolName,args) comparison)", () => {
  it("same toolName + arguments → same request key (result-independent)", () => {
    const k1 = buildToolRequestKey({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
    });
    const k2 = buildToolRequestKey({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
    });
    expect(k1).toBe(k2);
    // The key is stable even when the RESULT changes — the key identifies
    // the request, the fingerprint identifies the (request, result) pair.
    const k3 = buildToolRequestKey({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      // @ts-expect-error extra property on the narrowed input is ignored by
      // the canonical form (result is not part of the request key)
      resultPayload: { changed: true },
    });
    expect(k3).toBe(k1);
  });

  it("different toolName or arguments → different request key", () => {
    const base = buildToolRequestKey({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
    });
    expect(
      buildToolRequestKey({
        toolName: "scrape_website",
        arguments: { query: "berlin" },
      })
    ).not.toBe(base);
    expect(
      buildToolRequestKey({
        toolName: "search_contacts",
        arguments: { query: "munich" },
      })
    ).not.toBe(base);
  });

  it("strips timestamp/ID noise from arguments in the request key", () => {
    const k1 = buildToolRequestKey({
      toolName: "search_contacts",
      arguments: { query: "berlin", requestId: "req-1", timestamp: "t1" },
    });
    const k2 = buildToolRequestKey({
      toolName: "search_contacts",
      arguments: { query: "berlin", requestId: "req-2", timestamp: "t2" },
    });
    expect(k1).toBe(k2);
  });
});

describe("T20b assistant text fingerprint (repeated text detection)", () => {
  it("identical text → identical fingerprint", () => {
    expect(buildAssistantTextFingerprint("Now at 54 records. Continuing.")).toBe(
      buildAssistantTextFingerprint("Now at 54 records. Continuing.")
    );
  });

  it("changed text → different fingerprint", () => {
    expect(
      buildAssistantTextFingerprint("Now at 54 records. Continuing.")
    ).not.toBe(buildAssistantTextFingerprint("Now at 61 records. Continuing."));
  });

  it("whitespace-only differences still count as changed text (conservative)", () => {
    expect(buildAssistantTextFingerprint("Working")).not.toBe(
      buildAssistantTextFingerprint(" Working ")
    );
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

describe("TaskProgressTracker T20b: alternating work (A/B/A/B)", () => {
  function makeBudget(): TaskRunBudget {
    return new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
  }

  it("A/B/A/B unchanged-results alternation → streak grows (not falsely reset)", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    const roundA = {
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    };
    const roundB = {
      toolName: "scrape_website",
      arguments: { url: "https://example.com" },
      resultPayload: { success: true, rows: [] },
    };
    // A B A B A — each repeat of a seen request with an unchanged result is
    // a stall signal, even though no two CONSECUTIVE rounds are identical.
    tracker.recordToolRound(roundA); // new request → seed, streak 0
    tracker.recordToolRound(roundB); // new request → seed, streak 0
    tracker.recordToolRound(roundA); // repeat A, unchanged → streak 1
    tracker.recordToolRound(roundB); // repeat B, unchanged → streak 2
    tracker.recordToolRound(roundA); // repeat A, unchanged → streak 3
    expect(budget.getConsumed().noProgressStreak).toBe(3);
  });

  it("A/B alternation with one changed result resets and re-accumulates", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    const roundA = {
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    };
    const roundB = {
      toolName: "scrape_website",
      arguments: { url: "https://example.com" },
      resultPayload: { success: true, rows: [] },
    };
    tracker.recordToolRound(roundA);
    tracker.recordToolRound(roundB);
    tracker.recordToolRound(roundA); // streak 1
    // B now returns NEW rows — relevant new evidence resets the streak.
    tracker.recordToolRound({
      ...roundB,
      resultPayload: { success: true, rows: [{ id: "fresh" }] },
    });
    expect(budget.getConsumed().noProgressStreak).toBe(0);
    // Streak re-accumulates from zero on subsequent repeats.
    tracker.recordToolRound(roundA); // repeat A, unchanged → streak 1
    expect(budget.getConsumed().noProgressStreak).toBe(1);
  });

  it("A/B/A/B with interleaved discovery still stalls (discovery skipped entirely)", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    const roundA = {
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    };
    const roundB = {
      toolName: "scrape_website",
      arguments: { url: "https://example.com" },
      resultPayload: { success: true, rows: [] },
    };
    tracker.recordToolRound(roundA); // seed
    tracker.recordToolRound(roundB); // seed
    tracker.recordToolRound({
      toolName: "tool_catalog_search",
      arguments: { query: "tools" },
      resultPayload: { success: true, tools: [] },
    }); // discovery — skipped
    tracker.recordToolRound(roundA); // repeat → streak 1
    expect(budget.getConsumed().noProgressStreak).toBe(1);
  });

  it("new (toolName, arguments) request first sighting → reset (relevant new evidence)", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    const roundA = {
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    };
    tracker.recordToolRound(roundA);
    tracker.recordToolRound(roundA); // streak 1
    tracker.recordToolRound(roundA); // streak 2
    // A genuinely new request (different query) is relevant new evidence.
    tracker.recordToolRound({
      ...roundA,
      arguments: { query: "munich" },
      resultPayload: { success: true, rows: [] },
    });
    expect(budget.getConsumed().noProgressStreak).toBe(0);
  });

  it("A/B/A/B at the streak bound trips the controller finish(incomplete, NO_PROGRESS)", async () => {
    const budget = new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
    const tracker = new TaskProgressTracker({ budget });
    const roundA = {
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    };
    const roundB = {
      toolName: "scrape_website",
      arguments: { url: "https://example.com" },
      resultPayload: { success: true, rows: [] },
    };
    tracker.recordToolRound(roundA);
    tracker.recordToolRound(roundB);
    tracker.recordToolRound(roundA); // 1
    tracker.recordToolRound(roundB); // 2
    tracker.recordToolRound(roundA); // 3 = maxNoProgressStreak

    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({ content: "Alternating without progress..." }),
      {
        route: "task_verified",
        contract: {
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
        } as unknown as TaskCompletionContract,
        requiredCriterionIds: ["rec-1"],
        passedCriterionIds: [],
        budget,
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("NO_PROGRESS");
    }
  });
});

describe("TaskProgressTracker T20b: text-only rounds (goalTextStop path)", () => {
  function makeBudget(): TaskRunBudget {
    return new TaskRunBudget(MANUAL_BUDGET_DEFAULTS);
  }

  it("first text round seeds (no streak)", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    tracker.recordAssistantTextRound("Now at 54 records. Let me continue...");
    expect(budget.getConsumed().noProgressStreak).toBe(0);
  });

  it("repeated identical text-only rounds → streak grows (repeated promise is a stall)", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    const promise = "Now at 54 records. Let me continue building volume...";
    tracker.recordAssistantTextRound(promise);
    tracker.recordAssistantTextRound(promise);
    expect(budget.getConsumed().noProgressStreak).toBe(1);
    tracker.recordAssistantTextRound(promise);
    expect(budget.getConsumed().noProgressStreak).toBe(2);
  });

  it("changed text → reset (genuinely new signal)", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    const promise = "Now at 54 records. Let me continue building volume...";
    tracker.recordAssistantTextRound(promise);
    tracker.recordAssistantTextRound(promise); // streak 1
    tracker.recordAssistantTextRound("Now at 61 records. Almost there.");
    expect(budget.getConsumed().noProgressStreak).toBe(0);
  });

  it("text repeat counts even when tool rounds sit in between (separate state)", () => {
    const budget = makeBudget();
    const tracker = new TaskProgressTracker({ budget });
    const promise = "Still collecting, hang tight...";
    tracker.recordAssistantTextRound(promise); // seed text state
    tracker.recordToolRound({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    }); // seeds TOOL state + resets streak
    expect(budget.getConsumed().noProgressStreak).toBe(0);
    tracker.recordAssistantTextRound(promise); // repeat of the text → streak 1
    expect(budget.getConsumed().noProgressStreak).toBe(1);
  });

  it("no binding budget → text rounds are a no-op (flag-off byte-identical)", () => {
    const tracker = new TaskProgressTracker({ budget: undefined });
    expect(() =>
      tracker.recordAssistantTextRound("Working on it.")
    ).not.toThrow();
  });
});

describe("TaskProgressTracker T20b: streak persistence through resumes", () => {
  // T20 audit regression: "persist it through resumes" + AC-06/27/29. The
  // streak COUNTER persists in the ledger row; the resurrected budget
  // carries it forward so a post-resume consult that lands BEFORE any fresh
  // round is still gated by the pre-pause streak. The fingerprint MAP is
  // detection state — it restarts empty (the ledger has no request-key
  // history), so a repeat of a pre-pause request with the same result is a
  // first sighting from the new tracker's view and resets the streak. That
  // is the intended conservative semantics: the persisted counter is what
  // survives, and it gates the consult at the resume boundary.

  function resurrectedBudget(streak: number): TaskRunBudget {
    return TaskRunBudget.resurrectFromLedger({
      policy_limits_json: JSON.stringify({
        maxContinuations: 3,
        maxProviderAttempts: 60,
        maxCheckerAttempts: 6,
        maxToolExecutions: 50,
        maxTokens: 128000,
        maxActiveRuntimeMs: 600000,
        maxWaitMs: 3600000,
        maxNoProgressStreak: 3,
      }),
      consumed_continuations: 1,
      consumed_provider_attempts: 4,
      consumed_checker_attempts: 0,
      consumed_tool_executions: 5,
      consumed_tokens: 9000,
      consumed_active_ms: 120000,
      consumed_wait_ms: 0,
      no_progress_streak: streak,
    });
  }

  it("resurrectFromLedger restores the persisted streak counter", () => {
    const budget = resurrectedBudget(2);
    expect(budget.getConsumed().noProgressStreak).toBe(2);
    // The restored streak is below the bound, so a consult that lands at
    // the resume boundary (before any fresh round) is NOT exhausted.
    expect(budget.isNoProgressStreakExhausted()).toBe(false);
    // ...and at the bound it IS exhausted, gating the consult.
    const atBound = resurrectedBudget(3);
    expect(atBound.isNoProgressStreakExhausted()).toBe(true);
  });

  it("restored streak gates the immediate post-resume consult (controller honors persisted streak)", async () => {
    // A run paused at streak 3 (the bound) resumes. Before any fresh round
    // lands, the loop consults at the resume boundary. The controller's
    // streak gate sees the RESTORED streak and finishes incomplete/NO_PROGRESS
    // rather than authorizing another continuation.
    const budget = resurrectedBudget(3);
    const ctrl = new TaskCompletionController();
    const decision = await ctrl.decide(
      baseCandidate({ content: "Resuming after pause..." }),
      {
        route: "task_verified",
        contract: {
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
        } as unknown as TaskCompletionContract,
        requiredCriterionIds: ["rec-1"],
        passedCriterionIds: [],
        budget,
      }
    );
    expect(decision.type).toBe("finish");
    if (decision.type === "finish") {
      expect(decision.outcome).toBe("incomplete");
      expect(decision.reasonCode).toBe("NO_PROGRESS");
    }
  });

  it("first post-resume round is a fresh sighting → reset (detection state restarts, counter persists)", () => {
    // The fingerprint MAP is empty after resume (ledger has no request-key
    // history), so the first round observed is a first sighting — relevant
    // new evidence resets the streak. The persisted counter's role is to
    // gate consults BEFORE that round lands (above), not to fossilize the
    // streak against genuinely observed work.
    const budget = resurrectedBudget(2);
    const tracker = new TaskProgressTracker({ budget });
    tracker.recordToolRound({
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    });
    expect(budget.getConsumed().noProgressStreak).toBe(0);
  });

  it("post-resume repeats re-accumulate: A then A again → streak grows from the reset baseline", () => {
    const budget = resurrectedBudget(2);
    const tracker = new TaskProgressTracker({ budget });
    const round = {
      toolName: "search_contacts",
      arguments: { query: "berlin" },
      resultPayload: { success: true, rows: [] },
    };
    tracker.recordToolRound(round); // first sighting → reset to 0
    tracker.recordToolRound(round); // repeat, unchanged → streak 1
    expect(budget.getConsumed().noProgressStreak).toBe(1);
    tracker.recordToolRound(round); // → streak 2
    tracker.recordToolRound(round); // → streak 3 = exhausted
    expect(budget.getConsumed().noProgressStreak).toBe(3);
    expect(budget.isNoProgressStreakExhausted()).toBe(true);
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
