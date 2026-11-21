import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortTask,
  abortBatch,
  runBrowserTasks,
  runWithConcurrency,
  type BrowserBatchTaskInput,
  type BrowserBatchTaskResult,
} from "@/service/agentTools/runBrowserTasksTool";
import { AgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";
import {
  getDefaultManagedBrowserLeaseService,
  accountLeaseKey,
  setDefaultManagedBrowserLeaseServiceForTest,
  ManagedBrowserLeaseService,
} from "@/service/ManagedBrowserLeaseService";
import {
  getBatchConfirmWaitRegistry,
  setBrowserBatchEventSink,
} from "@/service/agentTools/runBrowserTasksTool";

/**
 * R01/M-FR-04: the test harness wires a confirmation sink that
 * auto-confirms — product runs require the sink, so tests exercise the
 * confirmed path through it instead of the old fail-open.
 */
function autoConfirmSink(): void {
  getBatchConfirmWaitRegistry().setSink((request) => {
    const entry = getBatchConfirmWaitRegistry().consume({
      requestId: request.requestId,
      conversationId: request.conversationId,
    });
    entry?.resolve({ confirmed: true, cancelled: false });
  });
}

/** W09/B01: cleanup observability — task-scoped stop + owner lookups. */
const stopAllForConversationMock = vi.fn(async (): Promise<void> => undefined);
const stopAllForAgentTaskMock = vi.fn(async (): Promise<number> => 1);
const stopMock = vi.fn(async (): Promise<void> => undefined);
const ownerBySession = new Map<string, string | null>();
vi.mock("@/modules/ManagedBrowserModule", () => ({
  getDefaultManagedBrowserModule: () => ({
    stopAllForConversation: stopAllForConversationMock,
    stopAllForAgentTask: stopAllForAgentTaskMock,
    stop: stopMock,
    getSessionOwnerAgentTaskId: (sessionId: string) =>
      ownerBySession.get(sessionId) ?? null,
    // R04: the batch row events resolve the LIVE session id through the
    // module's owner mapping.
    findSessionIdForAgentTask: (agentTaskId: string) => {
      for (const [sid, owner] of ownerBySession) {
        if (owner === agentTaskId) {
          return sid;
        }
      }
      return null;
    },
    // N02: the keep-open transfer is mocked as an ownership reassignment.
    transferSessionToConversation: async (
      sessionId: string,
      parentConversationId: string
    ) => {
      ownerBySession.set(sessionId, null);
      transferCalls.push({ sessionId, parentConversationId });
      return { sessionId, ownerConversationId: parentConversationId };
    },
  }),
}));
const transferCalls: Array<{ sessionId: string; parentConversationId: string }> = [];

/**
 * B03: the fast-runner adapter drives the REAL service contract — the
 * mock records the start/execute calls so the tests assert the start
 * contract (session id, proxy, signal) and the result mapping.
 */
const fastServiceCalls = vi.hoisted(() => ({
  startArgs: [] as Array<{ args: Record<string, unknown>; context: Record<string, unknown> }>,
  execArgs: [] as Array<{ args: Record<string, unknown>; context: Record<string, unknown> }>,
  startImpl: null as null | ((args: Record<string, unknown>, context: Record<string, unknown>) => Promise<Record<string, unknown>>),
  execImpl: null as null | ((args: Record<string, unknown>, context: Record<string, unknown>) => Promise<Record<string, unknown>>),
}));
vi.mock("@/service/ManagedBrowserAiToolService", () => ({
  ManagedBrowserAiToolService: class {},
  getDefaultManagedBrowserAiToolService: () => ({
    startSession: async (args: Record<string, unknown>, context: Record<string, unknown>) => {
      fastServiceCalls.startArgs.push({ args, context });
      if (fastServiceCalls.startImpl) {
        return await fastServiceCalls.startImpl(args, context);
      }
      return { sessionId: "mb_fast_default", notice: null };
    },
    executeTask: async (args: Record<string, unknown>, context: Record<string, unknown>) => {
      fastServiceCalls.execArgs.push({ args, context });
      if (fastServiceCalls.execImpl) {
        return await fastServiceCalls.execImpl(args, context);
      }
      return {
        taskId: "task_x",
        sessionId: args.session_id,
        status: "completed",
        reason: "verified",
        evidence: [],
        extracted: [],
        finalObservation: null,
        counts: { leafSteps: 0, decisionRequests: 0, recoveryCalls: 0 },
        userInterventions: [],
      };
    },
  }),
}));

/** PRD M-FR-03/05/09: bounded parallelism, isolation, strict results. */

describe("runWithConcurrency", () => {
  it("runs items with bounded parallelism preserving order", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("runBrowserTasks (M-FR-03/05/09)", () => {
  beforeEach(() => {
    autoConfirmSink();
  });
  afterAll(() => {
    getBatchConfirmWaitRegistry().setSink(null);
  });
  it("runs tasks with a pluggable executor and returns strict results", async () => {
    const control = new AgentTaskControlService();
    const fakeRunAgent = () => ({
      runSync: async () => ({
        status: "completed",
        agentTaskId: "agt-1",
        agentId: "agent-browser-operator",
        agentVersion: 1,
        toolCallsCount: 2,
        sourceUrls: [],
        output: {
          status: "completed",
          summary: "Found 3 supplier prices",
          extracted: [{ price: 10 }],
          final_url: "https://example.test/results",
          evidence: ["row 2"],
          needs_user: null,
          user_interventions: [],
        },
      }),
    }) as never;
    const { batchId, results } = await runBrowserTasks(
      [{ goal: "Find supplier prices" }],
      1,
      "conv-1",
      new AbortController().signal,
      {
        runAgent: fakeRunAgent as never,
        control,
      }
    );
    expect(batchId).toMatch(/^batch_/);
    const first = results[0] as BrowserBatchTaskResult;
    expect(first.status).toBe("completed");
    expect(first.summary).toBe("Found 3 supplier prices");
    expect(first.extracted).toEqual([{ price: 10 }]);
    expect(first.user_interventions).toEqual([]);
  });

  it("isolates a crashing task: others still complete (M-AC-01)", async () => {
    const control = new AgentTaskControlService();
    const fakeRunAgent = () => ({
      runSync: async (request: { prompt: string }) => {
        if (request.prompt.includes("crash")) {
          throw new Error("worker exit");
        }
        return {
          status: "completed",
          agentTaskId: "agt-x",
          agentId: "agent-browser-operator",
          agentVersion: 1,
          toolCallsCount: 1,
          sourceUrls: [],
          output: {
            status: "completed",
            summary: "ok",
            extracted: [],
            final_url: null,
            evidence: [],
            needs_user: null,
            user_interventions: [],
          },
        };
      },
    }) as never;
    const { results } = await runBrowserTasks(
      [
        { goal: "task A ok" },
        { goal: "task B crash" },
        { goal: "task C ok" },
      ],
      3,
      "conv-1",
      new AbortController().signal,
      { runAgent: fakeRunAgent as never, control }
    );
    expect(results.map((r) => r.status)).toEqual(["completed", "failed", "completed"]);
    expect(results[1]!.summary).toBe("worker exit");
  });

  it("cancelling the batch marks only unfinished tasks cancelled (M-FR-09)", async () => {
    const control = new AgentTaskControlService();
    const aborter = new AbortController();
    const fakeRunAgent = () => ({
      runSync: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          status: "completed",
          agentTaskId: "agt-x",
          agentId: "agent-browser-operator",
          agentVersion: 1,
          toolCallsCount: 0,
          sourceUrls: [],
          output: {
            status: "completed",
            summary: "slow but fine",
            extracted: [],
            final_url: null,
            evidence: [],
            needs_user: null,
            user_interventions: [],
          },
        };
      },
    }) as never;
    const batchPromise = runBrowserTasks(
      [{ goal: "slow task" }],
      1,
      "conv-1",
      aborter.signal,
      { runAgent: fakeRunAgent as never, control }
    );
    setTimeout(() => aborter.abort(), 10);
    const { results } = await batchPromise;
    expect(results[0]!.status).toBe("cancelled");
  });

  it("surfaces needs_user proposals from sub-agents (M-FR-05)", async () => {
    const control = new AgentTaskControlService();
    const fakeRunAgent = () => ({
      runSync: async () => ({
        status: "completed",
        agentTaskId: "agt-1",
        agentId: "agent-browser-operator",
        agentVersion: 1,
        toolCallsCount: 3,
        sourceUrls: [],
        output: {
          status: "needs_user",
          summary: "Found the publish button",
          extracted: [],
          final_url: "https://example.test/editor",
          evidence: ["button visible"],
          needs_user: { type: "approval", proposed_action: "click Publish" },
          user_interventions: [],
        },
      }),
    }) as never;
    const { results } = await runBrowserTasks(
      [{ goal: "draft post" }],
      1,
      "conv-1",
      new AbortController().signal,
      { runAgent: fakeRunAgent as never, control }
    );
    expect(results[0]!.needs_user).toEqual({
      type: "approval",
      proposed_action: "click Publish",
    });
  });
});

// ---------------------------------------------------------------------------
// F17: per-child Stop, Return-now semantics, control-state honesty
// ---------------------------------------------------------------------------

/** Control double that records every child task registration. */
class CapturingControl extends AgentTaskControlService {
  public registered: string[] = [];
  public override register(taskId: string, conversationId: string) {
    this.registered.push(taskId);
    return super.register(taskId, conversationId);
  }
}

function okOutput(summary: string) {
  return {
    status: "completed",
    agentTaskId: "agt-x",
    agentId: "agent-browser-operator",
    agentVersion: 1,
    toolCallsCount: 1,
    sourceUrls: [],
    output: {
      status: "completed",
      summary,
      extracted: [],
      final_url: null,
      evidence: [],
      needs_user: null,
      user_interventions: [],
    },
  };
}

describe("runBrowserTasks F17 semantics", () => {
  beforeEach(() => {
    autoConfirmSink();
  });
  it("stopping ONE batch child cancels only that child", async () => {
    const control = new CapturingControl();
    const fakeRunAgent = () => ({
      runSync: async (request: { prompt: string }) => {
        if (request.prompt.includes("task 1/")) {
          // The user pressed Stop on THIS child only.
          const ownTaskId = control.registered[0]!;
          expect(abortTask(ownTaskId)).toBe(1);
          throw new Error("stopped by user");
        }
        return okOutput("sibling done");
      },
    }) as never;
    const { results } = await runBrowserTasks(
      [{ goal: "stop me (task 1/2)" }, { goal: "keep going (task 2/2)" }],
      2,
      "conv-1",
      new AbortController().signal,
      { runAgent: fakeRunAgent as never, control }
    );
    expect(results[0]!.status).toBe("cancelled");
    // The sibling was NOT dragged down by the child Stop.
    expect(results[1]!.status).toBe("completed");
    // Cancellation is a cancelled CONTROL record, not a failure.
    expect(control.get(control.registered[0]!)?.state).toBe("cancelled");
    expect(control.get(control.registered[1]!)?.state).toBe("completed");
  });

  it("Return-now reports unfinished tasks as partial with evidence", async () => {
    const control = new CapturingControl();
    const fakeRunAgent = () => ({
      runSync: async (request: { prompt: string }) => {
        if (request.prompt.includes("task 2/")) {
          // BROWSER_BATCH_RETURN_NOW: cancel the batch's control records
          // and abort the live batch tree while THIS task is in flight.
          const batchId = control.registered[1]!.split(":")[0]!;
          control.cancelBatch(batchId);
          expect(abortBatch(batchId)).toBe(1);
          throw new Error("aborted mid-flight");
        }
        return okOutput("first done");
      },
    }) as never;
    const { results } = await runBrowserTasks(
      [{ goal: "task 1/2" }, { goal: "task 2/2" }],
      1,
      "conv-1",
      new AbortController().signal,
      { runAgent: fakeRunAgent as never, control }
    );
    // The finished task keeps its real output...
    expect(results[0]!.status).toBe("completed");
    // ...the unfinished one is PARTIAL (not cancelled) with evidence.
    expect(results[1]!.status).toBe("partial");
    expect(results[1]!.evidence).toContain("return_now:error");
    // W02: a Return-now crash is interrupted (= partial results, the same
    // convention as return_now_partial) — never failed.
    expect(control.get(control.registered[1]!)?.state).toBe("interrupted");
  });

  it("Return-now keeps a child's usable output when the work already finished", async () => {
    const control = new CapturingControl();
    const fakeRunAgent = () => ({
      runSync: async () => {
        // Return-now fires AFTER the agent produced its output.
        const batchId = control.registered[0]!.split(":")[0]!;
        control.cancelBatch(batchId);
        abortBatch(batchId);
        return okOutput("actually finished");
      },
    }) as never;
    const { results } = await runBrowserTasks(
      [{ goal: "fast task" }],
      1,
      "conv-1",
      new AbortController().signal,
      { runAgent: fakeRunAgent as never, control }
    );
    expect(results[0]!.status).toBe("completed");
    expect(results[0]!.summary).toBe("actually finished");
    expect(control.get(control.registered[0]!)?.state).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// F20: provider-aware + feature-switch admission on the batch entry
// ---------------------------------------------------------------------------

const settingsState = { browserEnabled: true, parallelAgentsEnabled: true };

vi.mock("@/service/browserDecision/BrowserAiAvailabilityService", () => ({
  BrowserAiAvailabilityService: class {
    public isAvailable(): boolean {
      return aiAvailable;
    }
  },
}));

vi.mock("@/modules/ManagedBrowserSettingsModule", () => ({
  ManagedBrowserSettingsModule: class {
    public async getEffectiveSettings() {
      return {
        browserEnabled: settingsState.browserEnabled,
        disabledReasonCode: null,
        parallelAgentsEnabled: settingsState.parallelAgentsEnabled,
      };
    }
  },
}));

let aiAvailable = true;

describe("runBrowserTasksForTool F20 admission", () => {
  it("refuses when browser AI is unavailable (provider-aware, before any work)", async () => {
    aiAvailable = false;
    const { runBrowserTasksForTool } = await import(
      "@/service/agentTools/runBrowserTasksTool"
    );
    await expect(
      runBrowserTasksForTool(
        [{ goal: "g" }],
        1,
        "conv-f20",
        new AbortController().signal
      )
    ).rejects.toThrow("ai_disabled");
    aiAvailable = true;
  });

  it("refuses when parallelAgentsEnabled is off", async () => {
    settingsState.parallelAgentsEnabled = false;
    const { runBrowserTasksForTool } = await import(
      "@/service/agentTools/runBrowserTasksTool"
    );
    await expect(
      runBrowserTasksForTool(
        [{ goal: "g" }],
        1,
        "conv-f20",
        new AbortController().signal
      )
    ).rejects.toThrow("parallel_agents_disabled");
    settingsState.parallelAgentsEnabled = true;
  });

  it("admits the batch when all gates pass", async () => {
    const { runBrowserTasksForTool } = await import(
      "@/service/agentTools/runBrowserTasksTool"
    );
    const { batchId, results } = await runBrowserTasksForTool(
      [{ goal: "one task" }],
      1,
      "conv-f20-ok",
      new AbortController().signal,
      {
        runAgent: (() => ({
          runSync: async () => ({
            status: "completed",
            agentTaskId: "agt-f20",
            agentId: "agent-browser-operator",
            agentVersion: 1,
            toolCallsCount: 0,
            sourceUrls: [],
            output: {
              status: "completed",
              summary: "done",
              extracted: [],
              final_url: null,
              evidence: [],
              needs_user: null,
              user_interventions: [],
            },
          }),
        })) as never,
      }
    );
    expect(batchId).toMatch(/^batch_/);
    expect(results[0]!.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// M-FR-06: a busy account is queued once (bounded wait + retry) instead of
// failing account_in_use immediately.
// ---------------------------------------------------------------------------

describe("runBrowserTasks busy-account queueing (M-FR-06)", () => {
  beforeEach(() => {
    autoConfirmSink();
  });
  it("retries once when the first attempt reports account_in_use", async () => {
      let attempts = 0;
      const runtime = {
        runSync: vi.fn(async () => {
          attempts++;
          if (attempts === 1) {
            return {
              status: "completed",
              output: {
                status: "failed",
                reason: "account_in_use",
                summary: "busy",
                extracted: [],
                final_url: null,
                evidence: [],
              },
            };
          }
          return {
            status: "completed",
            output: {
              status: "completed",
              summary: "done after queue",
              extracted: [],
              final_url: "https://www.youtube.com/",
              evidence: [],
              session_id: null,
            },
          };
        }),
      };
      const { results } = await runBrowserTasks(
        [
          {
            goal: "check the feed",
            account_id: 101,
          } as unknown as BrowserBatchTaskInput,
        ],
        1,
        "conv-queue",
        new AbortController().signal,
        { runAgent: () => runtime as never, busyQueueWaitMs: 10 }
      );
      expect(attempts).toBe(2);
      expect(results[0]?.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// W08/M-FR-04: the batch confirmation card. The batch does NOT start until
// the user confirms the listed tasks and sites; the grant is consumed by
// the start and expires with the batch. Without a wired renderer sink the
// gate auto-confirms (headless runs cannot block forever).
// ---------------------------------------------------------------------------
describe("runBrowserTasks batch confirmation gate (W08/M-FR-04)", () => {
  it("a refused confirmation starts no lanes and reports confirmed false", async () => {
    const { getBatchConfirmWaitRegistry } = await import(
      "@/service/agentTools/runBrowserTasksTool"
    );
    const registry = getBatchConfirmWaitRegistry();
    let runCalls = 0;
    const fakeRunAgent = () => ({
      runSync: async () => {
        runCalls++;
        return { status: "completed", output: {} } as never;
      },
    }) as never;
    const wired: Array<unknown> = [];
    registry.setSink((request) => {
      wired.push(request);
      // The user DENIES the batch.
      request.resolve({ confirmed: false, cancelled: true });
    });
    try {
      const { batchId, results, confirmed } = await runBrowserTasks(
        [{ goal: "scrape site A", start_url: "https://site-a.test/x" }],
        1,
        "conv-deny",
        new AbortController().signal,
        { runAgent: fakeRunAgent }
      );
      expect(confirmed).toBe(false);
      expect(results).toEqual([]);
      expect(runCalls).toBe(0);
      // The preview listed the task with its site.
      expect(wired).toHaveLength(1);
      const preview = wired[0] as { tasks: Array<{ goal: string; site: string | null }> };
      expect(preview.tasks[0].goal).toBe("scrape site A");
      expect(preview.tasks[0].site).toBe("site-a.test");
      expect(batchId).toMatch(/^batch_/);
    } finally {
      registry.setSink(null);
    }
  });

  it("a confirmed confirmation starts the batch", async () => {
    const { getBatchConfirmWaitRegistry } = await import(
      "@/service/agentTools/runBrowserTasksTool"
    );
    const registry = getBatchConfirmWaitRegistry();
    const fakeRunAgent = () => ({
      runSync: async () => ({
        status: "completed",
        agentTaskId: "agt-1",
        agentId: "agent-browser-operator",
        agentVersion: 1,
        toolCallsCount: 1,
        sourceUrls: [],
        output: {
          status: "completed",
          summary: "done",
          extracted: [],
          final_url: null,
          evidence: [],
          needs_user: null,
          user_interventions: [],
        },
      }),
    }) as never;
    registry.setSink((request) => {
      request.resolve({ confirmed: true, cancelled: false });
    });
    try {
      const { results, confirmed } = await runBrowserTasks(
        [{ goal: "check site B", start_url: "https://site-b.test/" }],
        1,
        "conv-confirm",
        new AbortController().signal,
        { runAgent: fakeRunAgent }
      );
      expect(confirmed).toBeUndefined(); // undefined = ran normally
      expect(results[0]?.status).toBe("completed");
    } finally {
      registry.setSink(null);
    }
  });

  it("auto-confirms when no renderer sink is wired (headless run)", async () => {
    const fakeRunAgent = () => ({
      runSync: async () => ({
        status: "completed",
        agentTaskId: "agt-1",
        agentId: "agent-browser-operator",
        agentVersion: 1,
        toolCallsCount: 1,
        sourceUrls: [],
        output: {
          status: "completed",
          summary: "done",
          extracted: [],
          final_url: null,
          evidence: [],
          needs_user: null,
          user_interventions: [],
        },
      }),
    }) as never;
    // R01/M-FR-04: without a confirmation sink the batch REFUSES — the
    // old fail-open started a consequential batch with zero consent.
    const outcome = await runBrowserTasks(
      [{ goal: "no-renderer run" }],
      1,
      "conv-headless",
      new AbortController().signal,
      { runAgent: fakeRunAgent }
    );
    expect(outcome.confirmed).toBe(false);
    expect(outcome.results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R04/M-FR-08: the lane's waiting/paused state reaches the batch card as a
// TRANSITION event (the card labels both, but no producer ever emitted
// them), and the parent job's user-wait flag follows the same signal.
// ---------------------------------------------------------------------------
describe("runBrowserTasks provider concurrency + token budget (R03/M-FR-10)", () => {
  beforeEach(() => {
    autoConfirmSink();
  });
  it("serializes lanes on the shared provider gate (max 2 in flight)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const runtime = {
      runSync: vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 120));
        inFlight--;
        return {
          status: "completed",
          output: {
            status: "completed",
            summary: "done",
            extracted: [],
            final_url: null,
            evidence: [],
          },
        };
      }),
    };
    const outcome = await runBrowserTasks(
      [
        { goal: "t1" } as BrowserBatchTaskInput,
        { goal: "t2" } as BrowserBatchTaskInput,
        { goal: "t3" } as BrowserBatchTaskInput,
        { goal: "t4" } as BrowserBatchTaskInput,
      ],
      4,
      "conv-r03a",
      new AbortController().signal,
      { runAgent: () => runtime as never }
    );
    expect(outcome.results.every((r) => r.status === "completed")).toBe(true);
    // The shared provider gate capped the CONCURRENT provider work even
    // though the batch ran 4 lanes.
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("a batch whose token budget is exceeded stops remaining lanes with a truthful partial (R03)", async () => {
    let calls = 0;
    const runtime = {
      runSync: vi.fn(async () => {
        calls++;
        return {
          status: "completed",
          tokensUsed: 250_000,
          output: {
            status: "completed",
            summary: `lane ${calls}`,
            extracted: [],
            final_url: null,
            evidence: [],
          },
        };
      }),
    };
    const outcome = await runBrowserTasks(
      [
        { goal: "t1" } as BrowserBatchTaskInput,
        { goal: "t2" } as BrowserBatchTaskInput,
        { goal: "t3" } as BrowserBatchTaskInput,
      ],
      1,
      "conv-r03b",
      new AbortController().signal,
      { runAgent: () => runtime as never }
    );
    // Lane 1 charged 250k (under 400k), lane 2 pushed the total over —
    // the batch aborts; lane 3 never ran.
    expect(calls).toBe(2);
    const exceeded = outcome.results.find(
      (r) =>
        r.evidence?.includes("batch_token_budget_exceeded") ||
        r.summary?.includes("token budget")
    );
    expect(exceeded).toBeDefined();
  });
});

describe("runBrowserTasks waiting/paused lane events (R04)", () => {
  beforeEach(() => {
    autoConfirmSink();
  });
  it("emits waiting_for_user on transition and running again afterwards", async () => {
    type WaitEvent = { taskId?: string; state?: string };
    const events: WaitEvent[] = [];
    setBrowserBatchEventSink((event: WaitEvent) => {
      events.push(event);
    });
    // The child flips ITS lane's control state mid-run: it reads the row
    // id from the lane's "running" event (the batch id is generated
    // inside runBrowserTasks).
    let rowTaskId: string | null = null;
    const { getDefaultAgentTaskControlService } = await import(
      "@/service/browserAgents/AgentTaskControlService"
    );
    const control = getDefaultAgentTaskControlService();
    const runtime = {
      runSync: vi.fn(async () => {
        // The row id is only knowable from the lane's live "running"
        // event (the batch id is generated inside runBrowserTasks).
        rowTaskId =
          events.find(
            (event) => event.state === "running" && event.taskId != null
          )?.taskId ?? rowTaskId;
        if (rowTaskId !== null) {
          control.setState(rowTaskId, "waiting_for_user");
        }
        await new Promise((resolve) => setTimeout(resolve, 1300));
        if (rowTaskId !== null) {
          control.setState(rowTaskId, "running");
        }
        await new Promise((resolve) => setTimeout(resolve, 1100));
        return {
          status: "completed",
          output: {
            status: "completed",
            summary: "done after wait",
            extracted: [],
            final_url: null,
            evidence: [],
          },
        };
      }),
    };
    const outcome = await runBrowserTasks(
      [{ goal: "waited task" } as BrowserBatchTaskInput],
      1,
      "conv-r04",
      new AbortController().signal,
      { runAgent: () => runtime as never },
      // R11: the parent job id activates the watchdog that emits the
      // lane transitions.
      "job-r04"
    );
    // Recover the row id from the lane's initial running event.
    rowTaskId =
      events.find((event) => event.state === "running")?.taskId ?? null;
    expect(outcome.results[0]?.status).toBe("completed");
    const rowStates = events
      .filter((event) => event.taskId === rowTaskId)
      .map((event) => event.state);
    expect(rowStates).toContain("waiting_for_user");
    // The transition back to running is emitted too (no infinite spam).
    const waitIndex = rowStates.indexOf("waiting_for_user");
    expect(
      rowStates.slice(waitIndex + 1).some((state) => state === "running")
    ).toBe(true);
    setBrowserBatchEventSink(null);
  });
});

// ---------------------------------------------------------------------------
// W09/M-FR-06/C-FR-09: the busy-account queue. The queued task's card
// state is `queued` (NOT waiting_for_user — no human is involved), the
// wait POLLS the account lease so the retry starts the moment the holder
// finishes, and a crash before session_id releases the lease.
// ---------------------------------------------------------------------------
describe("runBrowserTasks busy-account queue (W09)", () => {
  it("emits queued (not waiting_for_user) and retries once the lease frees", async () => {
    setDefaultManagedBrowserLeaseServiceForTest(new ManagedBrowserLeaseService());
    const leaseService = getDefaultManagedBrowserLeaseService();
    // The account is BUSY: the holder owns the lease...
    const holderLease = leaseService.acquire(accountLeaseKey(202), {
      sessionId: "mb_holder_w09",
      ownerConversationId: "conv-holder",
    });
    if (holderLease.status !== "granted") {
      throw new Error("test lease acquisition failed");
    }
    let attempts = 0;
    const states: Array<string | undefined> = [];
    setBrowserBatchEventSink((event: { state?: string }) => {
      states.push(event.state);
    });
    const runtime = {
      runSync: vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          return {
            status: "completed",
            output: {
              status: "failed",
              reason: "account_in_use",
              summary: "busy",
              extracted: [],
              final_url: null,
              evidence: [],
            },
          };
        }
        return {
          status: "completed",
          output: {
            status: "completed",
            summary: "done after queue",
            extracted: [],
            final_url: null,
            evidence: [],
          },
        };
      }),
    };
    // ...and the holder finishes while the queued task is waiting.
    setTimeout(() => {
      leaseService.release(
        accountLeaseKey(202),
        "mb_holder_w09",
        holderLease.leaseToken
      );
    }, 100);
    const queueOutcome = await runBrowserTasks(
      [{ goal: "queued task", account_id: 202 } as BrowserBatchTaskInput],
      1,
      "conv-w09",
      new AbortController().signal,
      { runAgent: () => runtime as never, busyQueueWaitMs: 5_000 }
    );
    expect(attempts).toBe(2);
    expect(queueOutcome.results[0]?.status).toBe("completed");
    // W09: the card says QUEUED — never the user-wait state.
    expect(states).toContain("queued");
    expect(states).not.toContain("waiting_for_user");
    setBrowserBatchEventSink(null);
    // Cleanup for the next test.
    setDefaultManagedBrowserLeaseServiceForTest(null);
  });

  it("propagates child output receipts and dedupes them ACROSS sibling rows (R07/T15b)", async () => {
    const sharedReceipt = "out_shared_1";
    const runtime = {
      runSync: vi.fn(async (input: { prompt?: string }) => {
        // The batch id is generated inside runBrowserTasks — distinguish
        // the rows by their prompt (built from each task's goal).
        const first = JSON.stringify(input).includes("row a");
        return {
          status: "completed",
          // The child terminal's result carries its externalized receipts
          // (parent access granted in AgentRuntime).
          outputIds: first
            ? [sharedReceipt, "out_a_2", sharedReceipt]
            : [sharedReceipt, "out_b_1"],
          output: {
            status: "completed",
            summary: first ? "row a" : "row b",
            extracted: [],
            final_url: null,
            evidence: [],
          },
        };
      }),
    };
    const outcome = await runBrowserTasks(
      [
        { goal: "row a" } as BrowserBatchTaskInput,
        { goal: "row b" } as BrowserBatchTaskInput,
      ],
      2,
      "conv-r07rec",
      new AbortController().signal,
      { runAgent: () => runtime as never }
    );
    // Within-row dedupe: row a listed the shared receipt twice.
    expect(outcome.results[0]?.output_ids).toEqual([
      sharedReceipt,
      "out_a_2",
    ]);
    // Cross-row dedupe: row b drops the receipt row a already surfaced.
    expect(outcome.results[1]?.output_ids).toEqual(["out_b_1"]);
  });

  it("a child crash with a known agent-task id releases its OWN sessions", async () => {
    stopAllForAgentTaskMock.mockClear();
    stopAllForConversationMock.mockClear();
    const crash = {
      runSync: async () => ({
        // Real AgentRuntime failures are RESULTS (not throws) carrying
        // the authoritative agent task id.
        status: "failed",
        agentTaskId: "agt-crash-w09",
        agentId: "agent-browser-operator",
        agentVersion: 1,
        toolCallsCount: 0,
        sourceUrls: [],
        errorMessage: "worker exit before session_id",
        output: null,
      }),
    };
    const outcome = await runBrowserTasks(
      [{ goal: "crash before session" } as BrowserBatchTaskInput],
      1,
      "conv-crash-w09",
      new AbortController().signal,
      { runAgent: () => crash as never }
    );
    expect(outcome.results[0]?.status).toBe("failed");
    // N02: the ownership key is the CONTROL task id (batch row), known
    // before work begins — cleanup is scoped to it.
    expect(stopAllForAgentTaskMock).toHaveBeenCalledWith(
      expect.stringMatching(/^batch_[0-9a-f-]+:0$/),
      "cancelled"
    );
    // B01: the conversation-wide sweep is NEVER used for child cleanup.
    expect(stopAllForConversationMock).not.toHaveBeenCalled();
  });

  it("a throw with no agent-task id reports the skipped cleanup honestly", async () => {
    stopAllForAgentTaskMock.mockClear();
    stopAllForConversationMock.mockClear();
    const crash = {
      runSync: async () => {
        throw new Error("worker exit before session_id");
      },
    };
    const outcome = await runBrowserTasks(
      [{ goal: "crash before session" } as BrowserBatchTaskInput],
      1,
      "conv-crash-w09",
      new AbortController().signal,
      { runAgent: () => crash as never }
    );
    expect(outcome.results[0]?.status).toBe("failed");
    // N02: ownership is ALWAYS known (the control task id, registered
    // before work begins) — the crash still cleans up its own scope.
    expect(stopAllForAgentTaskMock).toHaveBeenCalledWith(
      expect.stringMatching(/^batch_[0-9a-f-]+:0$/),
      "cancelled"
    );
    expect(stopAllForConversationMock).not.toHaveBeenCalled();
  });

  it("a reported session_id owned by ANOTHER task is neither stopped nor transferred (B01)", async () => {
    stopMock.mockClear();
    ownerBySession.clear();
    // A foreign session owned by a sibling task, plus the parent's own.
    ownerBySession.set("mb_foreign_0000001", "batch_foreign:0");
    ownerBySession.set("mb_parent_0000001", null);
    const foreignRuntime = {
      runSync: vi.fn(
        async (request: { controlTaskId?: string }) => ({
          status: "completed",
          agentTaskId: "agt-child-b01",
          controlTaskId: request.controlTaskId,
          agentId: "agent-browser-operator",
          agentVersion: 1,
          toolCallsCount: 1,
          sourceUrls: [],
          // The child CLAIMS a session owned by a sibling.
          output: {
            status: "completed",
            summary: "claimed a foreign session",
            extracted: [],
            final_url: null,
            evidence: [],
            session_id: "mb_foreign_0000001",
            needs_user: null,
            user_interventions: [],
          },
        })
      ),
    };
    const foreign = await runBrowserTasks(
      [{ goal: "no keep_open" }],
      1,
      "conv-b01",
      new AbortController().signal,
      { runAgent: () => foreignRuntime as never }
    );
    expect(foreign.results[0]?.status).toBe("completed");
    // The foreign session was NEVER stopped, and the result reports the skip.
    expect(stopMock).not.toHaveBeenCalledWith("mb_foreign_0000001", "cancelled");
    expect(foreign.results[0]?.evidence).toContain(
      "cleanup_skipped:session_owner_mismatch"
    );
    // N02: the child's OWN scope was still cleaned (empty here, but the
    // scoped stop ran) — and the conversation sweep never fired.
    expect(stopAllForConversationMock).not.toHaveBeenCalled();
    // The foreign id is never surfaced as the retained session.
    expect(foreign.results[0] && "session_id" in foreign.results[0]).toBe(false);

    // N02: a keep_open task with an OWNED session transfers ownership and
    // surfaces the validated id.
    const ownedRuntime = {
      runSync: vi.fn(
        async (request: { controlTaskId?: string }) => ({
          status: "completed",
          agentTaskId: "agt-owned-b01",
          controlTaskId: request.controlTaskId,
          agentId: "agent-browser-operator",
          agentVersion: 1,
          toolCallsCount: 1,
          sourceUrls: [],
          output: {
            status: "completed",
            summary: "kept my own session",
            extracted: [],
            final_url: null,
            evidence: [],
            session_id: "mb_owned_00000002",
            needs_user: null,
            user_interventions: [],
          },
        })
      ),
    };
    // The session is pre-owned by the batch row the runtime will be given.
    let expectedRowId: string | null = null;
    ownedRuntime.runSync.mockImplementation(
      async (request: { controlTaskId?: string }) => {
        expectedRowId = request.controlTaskId ?? null;
        ownerBySession.set("mb_owned_00000002", expectedRowId);
        return {
          status: "completed",
          agentTaskId: "agt-owned-b01",
          controlTaskId: request.controlTaskId,
          agentId: "agent-browser-operator",
          agentVersion: 1,
          toolCallsCount: 1,
          sourceUrls: [],
          output: {
            status: "completed",
            summary: "kept my own session",
            extracted: [],
            final_url: null,
            evidence: [],
            session_id: "mb_owned_00000002",
            needs_user: null,
            user_interventions: [],
          },
        };
      }
    );
    const owned = await runBrowserTasks(
      [{ goal: "keep open", keep_open: true }],
      1,
      "conv-b01",
      new AbortController().signal,
      { runAgent: () => ownedRuntime as never }
    );
    // The validated, OWNED id surfaces — and ownership TRANSFERRED (the
    // transfer call reassigns it; here the mock records the stop absence).
    expect(owned.results[0]?.session_id).toBe("mb_owned_00000002");
    expect(stopMock).not.toHaveBeenCalledWith("mb_owned_00000002", "cancelled");
    expect(expectedRowId).not.toBeNull();
  });
  it("the collector's control record is addressed by the batch row id during the run", async () => {
    let seenControlId: string | null = null;
    const runtime = {
      runSync: vi.fn(async (request: { controlTaskId?: string }) => {
        seenControlId = request.controlTaskId ?? null;
        return {
          status: "completed",
          agentTaskId: "agt-x",
          agentId: "agent-browser-operator",
          agentVersion: 1,
          toolCallsCount: 0,
          sourceUrls: [],
          output: {
            status: "completed",
            summary: "ok",
            extracted: [],
            final_url: null,
            evidence: [],
            needs_user: null,
            user_interventions: [],
          },
        };
      }),
    };
    await runBrowserTasks(
      [{ goal: "row id check" }],
      1,
      "conv-b02b",
      new AbortController().signal,
      { runAgent: () => runtime as never }
    );
    // The registered row is exactly the id the child was told to use.
    expect(seenControlId).toMatch(/^batch_[0-9a-f-]+:0$/);
  });
});

// ---------------------------------------------------------------------------
// B07/C-FR-09: the confirmation wait is CANCELLATION-AWARE — a parent
// Stop during the card resolves the wait immediately and refuses the
// batch (previously the card stayed outstanding for ten minutes).
// ---------------------------------------------------------------------------
describe("runBrowserTasks confirmation cancellation (B07)", () => {
  it("a Stop during the confirmation wait refuses promptly", async () => {
    const { getBatchConfirmWaitRegistry } = await import(
      "@/service/agentTools/runBrowserTasksTool"
    );
    const registry = getBatchConfirmWaitRegistry();
    let runCalls = 0;
    const fakeRunAgent = () => ({
      runSync: async () => {
        runCalls++;
        return { status: "completed", output: {} } as never;
      },
    }) as never;
    const controller = new AbortController();
    // The card NEVER answers — only the Stop can end the wait.
    registry.setSink(() => undefined);
    try {
      const started = Date.now();
      // Stop the wait after 100ms — registered BEFORE the await.
      setTimeout(() => controller.abort(), 100);
      const outcome = await runBrowserTasks(
        [{ goal: "stopped during confirm" }],
        1,
        "conv-b07",
        controller.signal,
        { runAgent: fakeRunAgent }
      );
      expect(outcome.confirmed).toBe(false);
      expect(outcome.results).toEqual([]);
      expect(runCalls).toBe(0);
      // The wait ended on the abort, not after the 10-minute TTL.
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      registry.setSink(null);
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// R01: strict child output validation — a missing or unrecognized child
// status is a FAILED task, never silently completed; and the queued lane
// rechecks aborts immediately after obtaining the reservation.
// ---------------------------------------------------------------------------
describe("runBrowserTasks strict child output (R01)", () => {
  beforeEach(() => {
    autoConfirmSink();
  });
  it("an unrecognized child output status is FAILED, never completed", async () => {
    const runtime = {
      runSync: vi.fn(async () => ({
        // AgentRuntime "completed" with a LENIENT parse fallback whose
        // output.status is neither of the three schema values.
        status: "completed",
        agentTaskId: "agt-r1",
        agentId: "agent-browser-operator",
        agentVersion: 1,
        toolCallsCount: 1,
        sourceUrls: [],
        output: {
          status: "maybe-done-ish",
          summary: "loosely parsed",
          extracted: [],
          final_url: null,
          evidence: [],
          needs_user: null,
          user_interventions: [],
        },
      })),
    };
    const { results } = await runBrowserTasks(
      [{ goal: "lenient output" }],
      1,
      "conv-r1",
      new AbortController().signal,
      { runAgent: () => runtime as never }
    );
    expect(results[0]?.status).toBe("failed");
    expect(results[0]?.summary).toBe("loosely parsed");
  });

  it("a missing child output status is FAILED", async () => {
    const runtime = {
      runSync: vi.fn(async () => ({
        status: "completed",
        agentTaskId: "agt-r1b",
        agentId: "agent-browser-operator",
        agentVersion: 1,
        toolCallsCount: 0,
        sourceUrls: [],
        output: null,
      })),
    };
    const { results } = await runBrowserTasks(
      [{ goal: "no output" }],
      1,
      "conv-r1b",
      new AbortController().signal,
      { runAgent: () => runtime as never }
    );
    expect(results[0]?.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// A09/M-FR-09: the WHOLE child result is shape-checked at the collector —
// malformed containers never throw or change task ownership.
// ---------------------------------------------------------------------------
describe("runBrowserTasks full output validation (A09)", () => {
  beforeEach(() => {
    autoConfirmSink();
  });
  it("malformed evidence/needs_user/extracted never throw and stay bounded", async () => {
    const runtime = {
      runSync: vi.fn(async () => ({
        status: "completed",
        agentTaskId: "agt-a09",
        agentId: "agent-browser-operator",
        agentVersion: 1,
        toolCallsCount: 1,
        sourceUrls: [],
        output: {
          status: "completed",
          summary: "x".repeat(2000),
          // Malformed containers:
          evidence: "not-an-array",
          extracted: "not-an-array-either",
          needs_user: "not-an-object",
          final_url: "ftp://bad-protocol/x",
          user_interventions: [],
        },
      })),
    };
    const { results } = await runBrowserTasks(
      [{ goal: "malformed output" }],
      1,
      "conv-a09",
      new AbortController().signal,
      { runAgent: () => runtime as never }
    );
    // The malformed fields are bounded/normalized — the task still reports
    // its real status with a bounded summary.
    expect(results[0]?.status).toBe("completed");
    expect((results[0]?.summary ?? "").length).toBeLessThanOrEqual(1000);
    expect(Array.isArray(results[0]?.evidence)).toBe(true);
    expect(Array.isArray(results[0]?.extracted)).toBe(true);
    expect(results[0]?.needs_user).toBeNull();
    expect(results[0]?.final_url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B03/M-FR-02/07/08/09/12: the fast-runner adapter contract — start carries
// the session id, proxy and lane signal; results map onto the collector's
// validated envelope; keep-open surfaces the retained session.
// ---------------------------------------------------------------------------
describe("runBrowserTasks fast_runner executor (B03)", () => {
  beforeEach(() => {
    autoConfirmSink();
    fastServiceCalls.startArgs.length = 0;
    fastServiceCalls.execArgs.length = 0;
    fastServiceCalls.startImpl = null;
    fastServiceCalls.execImpl = null;
    ownerBySession.clear();
    transferCalls.length = 0;
    stopMock.mockClear();
    stopAllForAgentTaskMock.mockClear();
  });
  afterAll(() => {
    getBatchConfirmWaitRegistry().setSink(null);
  });

  it("receives the launched session, passes the requested proxy and the lane signal, and stops when not keep_open", async () => {
    const control = new AgentTaskControlService();
    const { results } = await runBrowserTasks(
      [{ goal: "fast task one", proxy_id: 42 }],
      1,
      "conv-fast1",
      new AbortController().signal,
      { control },
      undefined,
      { executor: "fast_runner" }
    );
    // START contract: the launched session reached executeTask, the
    // requested proxy rode the start, and the lane signal was wired.
    expect(fastServiceCalls.startArgs).toHaveLength(1);
    const startArgs = fastServiceCalls.startArgs[0]!;
    expect(startArgs.args.proxy).toEqual({ proxy_id: 42 });
    expect(startArgs.context.signal).toBeInstanceOf(AbortSignal);
    const execArgs = fastServiceCalls.execArgs[0]!;
    expect(execArgs.args.session_id).toBe("mb_fast_default");
    expect(execArgs.context.signal).toBeInstanceOf(AbortSignal);
    expect(fastServiceCalls.execArgs).toHaveLength(1);
    // Terminal mapping: completed stays completed.
    expect(results[0]!.status).toBe("completed");
    // Not keep_open → the session was stopped by the lane.
    expect(stopMock).toHaveBeenCalledWith("mb_fast_default", "cancelled");
  });

  it("maps a partial ending onto needs_user and keeps the real terminal status in the summary", async () => {
    const control = new AgentTaskControlService();
    fastServiceCalls.execImpl = async () => ({
      taskId: "task_x",
      sessionId: "mb_fast_default",
      status: "partial",
      reason: "verification_failed_budget_exhausted",
      evidence: ["e1"],
      extracted: ["row"],
      finalObservation: { url: "https://example.test/partial" },
      counts: { leafSteps: 2, decisionRequests: 2, recoveryCalls: 0 },
      userInterventions: [],
    });
    const { results } = await runBrowserTasks(
      [{ goal: "fast partial" }],
      1,
      "conv-fast2",
      new AbortController().signal,
      { control },
      undefined,
      { executor: "fast_runner" }
    );
    // partial renders as the collector's terminal-partial envelope.
    expect(results[0]!.status).toBe("partial");
    // The REAL terminal status + reason survive the mapping.
    expect(results[0]!.summary).toContain("partial");
    expect(results[0]!.summary).toContain("verification_failed_budget_exhausted");
    expect(results[0]!.extracted).toEqual(["row"]);
    expect(results[0]!.final_url).toBe("https://example.test/partial");
  });

  it("keep_open transfers the retained session id on a completed result", async () => {
    const control = new AgentTaskControlService();
    fastServiceCalls.startImpl = async () => ({
      sessionId: "mb_fast_keep",
      notice: null,
    });
    fastServiceCalls.execImpl = async (
      _args: Record<string, unknown>,
      context: Record<string, unknown>
    ) => {
      // The session is owned by THIS lane (the service recorded the
      // start ownership under the ownerAgentId).
      ownerBySession.set("mb_fast_keep", String(context.ownerAgentId));
      return {
        taskId: "task_x",
        sessionId: "mb_fast_keep",
        status: "completed",
        reason: "verified",
        evidence: [],
        extracted: [],
        finalObservation: { url: "https://example.test/done" },
        counts: { leafSteps: 1, decisionRequests: 1, recoveryCalls: 0 },
        userInterventions: [],
      };
    };
    const { results } = await runBrowserTasks(
      [{ goal: "fast keep open", keep_open: true }],
      1,
      "conv-fast3",
      new AbortController().signal,
      { control },
      undefined,
      { executor: "fast_runner" }
    );
    // The transfer happened to the PARENT conversation and the row
    // surfaces the retained session id.
    expect(transferCalls).toHaveLength(1);
    expect(transferCalls[0]!.parentConversationId).toBe("conv-fast3");
    expect(results[0]!.session_id).toBe("mb_fast_keep");
    // keep_open → the lane did NOT stop the session.
    expect(stopMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C01/M-FR-06/10/12: the provider gate enforces limits where inference
// actually runs — cancelable acquisition (a Stop while queued grants
// NOTHING and releases nothing), a per-provider scope, and ACTUAL usage
// charged on every run (initial dispatch and queued retry).
// ---------------------------------------------------------------------------
describe("runBrowserTasks provider gate (C01)", () => {
  beforeEach(() => {
    autoConfirmSink();
    fastServiceCalls.startArgs.length = 0;
    fastServiceCalls.execArgs.length = 0;
    fastServiceCalls.startImpl = null;
    fastServiceCalls.execImpl = null;
    ownerBySession.clear();
    transferCalls.length = 0;
    stopMock.mockClear();
    stopAllForAgentTaskMock.mockClear();
  });
  afterAll(() => {
    getBatchConfirmWaitRegistry().setSink(null);
  });

  it("a Stop while queued for a provider slot runs NOTHING and releases no slot (C01)", async () => {
    const control = new AgentTaskControlService();
    const scope = "c01-slot-scope";
    // Hold BOTH slots of the scope with a first batch's slow lanes.
    const resolvers: Array<() => void> = [];
    fastServiceCalls.execImpl = async () => {
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      return {
        status: "completed",
        reason: "verified",
        evidence: [],
        extracted: [],
        finalObservation: null,
      };
    };
    const batchA = runBrowserTasks(
      [{ goal: "slow lane 1" }, { goal: "slow lane 2" }],
      2,
      "conv-c01a",
      new AbortController().signal,
      { control },
      undefined,
      { executor: "fast_runner", providerScope: scope }
    );
    // Both slots are now held; wait until both exec calls started.
    while (fastServiceCalls.execArgs.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // The second batch's lane must QUEUE on the same scope.
    const stopper = new AbortController();
    const batchB = runBrowserTasks(
      [{ goal: "queued lane" }],
      1,
      "conv-c01b",
      stopper.signal,
      { control },
      undefined,
      { executor: "fast_runner", providerScope: scope }
    );
    // Give the queued lane time to reach the (abortable) wait.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const before = fastServiceCalls.execArgs.length;
    stopper.abort();
    const resultsB = (await batchB).results;
    // The queued lane ran NOTHING — cancelled at the gate.
    expect(fastServiceCalls.execArgs.length).toBe(before);
    expect(resultsB[0]!.status).toBe("cancelled");
    expect(resultsB[0]!.evidence).toContain("provider_slot_cancelled");
    // Release the holders; batch A completes.
    for (const resolve of resolvers) {
      resolve();
    }
    const resultsA = (await batchA).results;
    expect(resultsA.map((r) => r.status)).toEqual(["completed", "completed"]);
    // Slots are intact (no negative release): a follow-up batch completes.
    fastServiceCalls.execImpl = async () => ({
      status: "completed",
      reason: "verified",
      evidence: [],
      extracted: [],
      finalObservation: null,
    });
    const batchC = await runBrowserTasks(
      [{ goal: "after stop" }],
      1,
      "conv-c01c",
      new AbortController().signal,
      { control },
      undefined,
      { executor: "fast_runner", providerScope: scope }
    );
    expect(batchC.results[0]!.status).toBe("completed");
  });

  it("charges the lane's actual reported usage against the batch budget (C01)", async () => {
    const control = new AgentTaskControlService();
    fastServiceCalls.execImpl = async () => ({
      status: "completed",
      reason: "verified",
      evidence: [],
      extracted: [],
      finalObservation: null,
      tokensUsed: 500_000,
    });
    const { results } = await runBrowserTasks(
      [{ goal: "token hog" }, { goal: "small task" }],
      1,
      "conv-c01budget",
      new AbortController().signal,
      { control },
      undefined,
      { executor: "fast_runner" }
    );
    // The hog's 500k usage blew the 400k batch budget: the REMAINING lane
    // is refused with the truthful budget evidence (the pre-start gate
    // reports cancelled with the reason; a mid-run lane reports partial).
    expect(results[0]!.status).toBe("completed");
    expect(results[1]!.status).toBe("cancelled");
    expect(results[1]!.evidence).toContain("batch_token_budget_exceeded");
    expect(results[1]!.summary).toContain("budget");
  });
});
