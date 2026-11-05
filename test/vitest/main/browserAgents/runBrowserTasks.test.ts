import { describe, expect, it } from "vitest";
import {
  abortTask,
  abortBatch,
  runBrowserTasks,
  runWithConcurrency,
  type BrowserBatchTaskResult,
} from "@/service/agentTools/runBrowserTasksTool";
import { AgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";

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
    expect(control.get(control.registered[1]!)?.state).toBe("failed");
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
