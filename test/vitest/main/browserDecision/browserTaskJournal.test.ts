import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * B01 (M-FR-07, D-FR-07–10): the durable task journal keys the unique
 * EXECUTION id for every write — admission, cursor, mutation intent,
 * outcome and terminal — against REAL SQLite. The adopted CONTROL id
 * (batch lane) never receives another execution's journal, and a user
 * stop between sequential executions is never resurrected.
 */

const tmpDir = path.join(
  os.tmpdir(),
  `browser-task-journal-test-${process.pid}-${Date.now()}`
);

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
    setValue(): void {}
  },
}));

import { SqliteDb } from "@/config/SqliteDb";
import { BrowserTaskModule } from "@/modules/BrowserTaskModule";
import { AgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

beforeAll(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
});

beforeEach(() => {
  resetDbSingleton();
});

function admit(module: BrowserTaskModule, taskId: string): Promise<void> {
  return module.recordAdmission({
    taskId,
    sessionId: `mb_${taskId.slice(-10)}`,
    conversationId: "conv-b01",
    agentTaskId: "lane_b01:0",
    providerMode: "chat",
    providerConfigKey: "provider-config:v1",
    toolCallId: "call_b01",
    jobId: null,
  });
}

describe("BrowserTaskModule execution-id journal (B01, real SQLite)", () => {
  it("persists ONE row through admission, intent, outcome, cursor and terminal", async () => {
    const module = new BrowserTaskModule();
    const executionId = "exec_b01one0001";
    await admit(module, executionId);
    await module.recordCursor({
      taskId: executionId,
      phase: "executing",
      leafSteps: 2,
      decisionRequests: 3,
    });
    await module.recordActionIntent({ taskId: executionId, actionType: "click" });
    await module.recordActionOutcome({ taskId: executionId, outcome: "confirmed" });
    await module.recordCursor({ taskId: executionId, phase: "verifying" });
    await module.recordTerminal({
      taskId: executionId,
      phase: "completed",
      reason: "verified",
    });
    // Exactly one row, keyed by the execution id.
    const row = await module.getCursor(executionId);
    expect(row).not.toBeNull();
    expect(row?.phase).toBe("completed");
    expect(row?.terminalReason).toBe("verified");
    expect(row?.pendingActionIntent).toBe("click");
    expect(row?.pendingActionOutcome).toBe("confirmed");
    // F07: omitted counters kept their persisted values through the
    // later phase-only cursor write.
    expect(row?.leafSteps).toBe(2);
    expect(row?.decisionRequests).toBe(3);
    // The ADOPTED control id has NO journal row of its own.
    expect(await module.getCursor("lane_b01:0")).toBeNull();
    // Terminal rows are never swept by the startup interrupted mark.
    expect(await module.markUnfinishedInterrupted()).toBe(0);
  });

  it("keeps two sequential executions on one lane in separate rows", async () => {
    const module = new BrowserTaskModule();
    const first = "exec_b01two0001";
    const second = "exec_b01two0002";
    // Execution 1 completes with a confirmed intent.
    await admit(module, first);
    await module.recordActionIntent({ taskId: first, actionType: "click" });
    await module.recordActionOutcome({ taskId: first, outcome: "confirmed" });
    await module.recordTerminal({
      taskId: first,
      phase: "completed",
      reason: "verified",
    });
    // Execution 2 (same adopted lane id, new execution) is interrupted
    // mid-dispatch: its intent has NO outcome.
    await admit(module, second);
    await module.recordActionIntent({ taskId: second, actionType: "fill" });
    // Per-execution isolation: the second execution's pending journal
    // never contaminates the first, and vice versa.
    const firstRow = await module.getCursor(first);
    const secondRow = await module.getCursor(second);
    expect(firstRow?.pendingActionIntent).toBe("click");
    expect(firstRow?.pendingActionOutcome).toBe("confirmed");
    expect(firstRow?.phase).toBe("completed");
    expect(secondRow?.pendingActionIntent).toBe("fill");
    expect(secondRow?.pendingActionOutcome).toBeNull();
    expect(secondRow?.phase).toBe("admitting");
    // Startup sweep marks ONLY the unfinished execution interrupted —
    // no mutation is ever replayed.
    expect(await module.markUnfinishedInterrupted()).toBe(1);
    const swept = await module.getCursor(second);
    expect(swept?.phase).toBe("interrupted");
  });

  it("refuses an intent for an execution that was never admitted", async () => {
    const module = new BrowserTaskModule();
    await expect(
      module.recordActionIntent({ taskId: "exec_b01ghost01", actionType: "click" })
    ).rejects.toThrow("task_cursor_missing_for_intent");
    await expect(
      module.recordActionOutcome({
        taskId: "exec_b01ghost01",
        outcome: "confirmed",
      })
    ).rejects.toThrow("task_cursor_missing_for_outcome");
    await expect(
      module.recordCursor({ taskId: "exec_b01ghost01", phase: "executing" })
    ).rejects.toThrow("task_cursor_missing_for_update");
    // Nothing was written.
    expect(await module.getCursor("exec_b01ghost01")).toBeNull();
  });
});

describe("lane ownership across sequential executions (B01, control layer)", () => {
  it("keeps the lane open between nested calls and refuses to resurrect a stop", async () => {
    const control = new AgentTaskControlService();
    // The OUTER owner (batch collector) registers and owns the lane.
    control.register("lane_b01own", "conv-b01");
    // A runner terminalizing its OWN record reopens for a sequential
    // execution — the R04 retry flow.
    const owned = new AgentTaskControlService();
    owned.register("task_owned01", "conv-b01");
    owned.setState("task_owned01", "completed", "verified");
    expect(owned.reopenForExecution("task_owned01")).toBe(true);
    expect(owned.getState("task_owned01")).toBe("running");
    // A USER stop between calls is NEVER resurrected.
    control.cancel("lane_b01own", "user_stop");
    expect(control.reopenForExecution("lane_b01own")).toBe(false);
    expect(control.getState("lane_b01own")).toBe("cancelled");
    // The gate stays closed for the next execution.
    const gate = control.getGate("lane_b01own");
    await expect(
      gate.waitUntilOpen(new AbortController().signal)
    ).rejects.toThrow("task_cancelled");
    // A startup-swept (interrupted) record is never resurrected either.
    control.setState("lane_b01own", "interrupted", "startup_sweep");
    expect(control.reopenForExecution("lane_b01own")).toBe(false);
  });
});
