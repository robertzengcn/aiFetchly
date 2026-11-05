import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * T19: durable BrowserTask cursor — admission, journal intent/outcome,
 * terminal, and the startup interrupted sweep (no mutation replay).
 */

const tmpDir = path.join(
  os.tmpdir(),
  `browser-task-test-${process.pid}-${Date.now()}`
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

describe("BrowserTaskModule durable cursor (T19)", () => {
  it("persists admission, journal, and terminal phases", async () => {
    const module = new BrowserTaskModule();
    await module.recordAdmission({
      taskId: "task_abc",
      sessionId: "mb_t19",
      conversationId: "conv-1",
      providerMode: "chat",
      providerConfigKey: "provider-config:v1",
    });
    await module.recordActionIntent({ taskId: "task_abc", actionType: "click" });
    await module.recordActionOutcome({ taskId: "task_abc", outcome: "confirmed" });
    await module.recordTerminal({
      taskId: "task_abc",
      phase: "completed",
      reason: "verified",
    });
    // Marking unfinished interrupted must NOT touch terminal tasks.
    const marked = await module.markUnfinishedInterrupted();
    expect(marked).toBe(0);
  });

  it("marks non-terminal tasks interrupted on the startup sweep", async () => {
    const module = new BrowserTaskModule();
    await module.recordAdmission({
      taskId: "task_mid",
      sessionId: "mb_t19b",
      conversationId: "conv-1",
      providerMode: "chat",
      providerConfigKey: "provider-config:v1",
    });
    // A pending mutation intent with no outcome: crashed mid-dispatch.
    await module.recordActionIntent({ taskId: "task_mid", actionType: "fill" });
    const marked = await module.markUnfinishedInterrupted();
    expect(marked).toBe(1);
    // Idempotent: a second sweep finds nothing.
    expect(await module.markUnfinishedInterrupted()).toBe(0);
  });
});

describe("BrowserTaskModule F07 cursor merge", () => {
  it("omitted counters keep their persisted values", async () => {
    const module = new BrowserTaskModule();
    await module.recordAdmission({
      taskId: "task_f07merge",
      sessionId: "mb_merge",
      conversationId: "conv-1",
      providerMode: "chat",
      providerConfigKey: "provider-config:v1",
    });
    // The runner reports the full counter set mid-run.
    await module.recordCursor({
      taskId: "task_f07merge",
      phase: "running",
      leafSteps: 3,
      decisionRequests: 4,
      recoveryCalls: 1,
      activeTimeMs: 12_345,
    });
    // A later phase update carries ONLY the phase (e.g. a journal write).
    await module.recordCursor({ taskId: "task_f07merge", phase: "journal" });
    const cursor = await module.getCursor("task_f07merge");
    expect(cursor).not.toBeNull();
    expect(cursor?.phase).toBe("journal");
    expect(cursor?.leafSteps).toBe(3);
    expect(cursor?.decisionRequests).toBe(4);
    expect(cursor?.recoveryCalls).toBe(1);
    expect(cursor?.activeTimeMs).toBe(12_345);
  });
});
