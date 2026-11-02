import { describe, expect, it } from "vitest";
import {
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
