import { describe, expect, it, vi } from "vitest";
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
import { setBrowserBatchEventSink } from "@/service/agentTools/runBrowserTasksTool";

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
    const { results } = await runBrowserTasks(
      [{ goal: "no-renderer run" }],
      1,
      "conv-headless",
      new AbortController().signal,
      { runAgent: fakeRunAgent }
    );
    expect(results[0]?.status).toBe("completed");
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
