import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { AgentTaskModule } from "@/modules/AgentTaskModule";
import { AgentRuntime } from "@/service/AgentRuntime";

const tmpDir = path.join(os.tmpdir(), "aifetchly-agent-cancel");

vi.mock("electron", () => ({ app: { getPath: () => tmpDir } }));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

/**
 * T5 (audit FR-INT-004): cancelling an agent task must target EXACTLY that
 * task — a live task aborts its own loop; a non-live non-terminal row flips
 * to cancelled; unknown and terminal tasks are refused.
 */
describe("AgentRuntime.cancelTask (T5/D7)", () => {
  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    for (const f of fs.readdirSync(tmpDir)) {
      if (f.startsWith("scraper.db")) {
        try {
          fs.unlinkSync(path.join(tmpDir, f));
        } catch {
          // ignore
        }
      }
    }
    (SqliteDb as unknown as { instance: unknown }).instance = null;
    (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
      null;
    (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
    process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
    SqliteDb.getInstance(tmpDir);
  });

  it("flips a non-live running row to cancelled", async () => {
    await SqliteDb.ensureInitialized();
    const module = new AgentTaskModule();
    await module.createTask({
      agentTaskId: "agt-row-1",
      agentConversationId: "agent-v2-row-1",
      agentId: "analyst",
      agentVersion: 1,
      parentConversationId: "v2-host",
      prompt: "do work",
      taskPacket: { goal: "do work" },
    });
    await module.setStatus("agt-row-1", "running", {});

    const runtime = new AgentRuntime();
    const cancelled = await runtime.cancelTask("agt-row-1");
    expect(cancelled).toBe(true);
    const snapshot = await module.getSnapshot("agt-row-1");
    expect(snapshot?.status).toBe("cancelled");
    expect(snapshot?.finishedAt).toBeTruthy();
  });

  it("refuses unknown and terminal tasks", async () => {
    await SqliteDb.ensureInitialized();
    const runtime = new AgentRuntime();
    expect(await runtime.cancelTask("agt-does-not-exist")).toBe(false);

    const module = new AgentTaskModule();
    await module.createTask({
      agentTaskId: "agt-done-1",
      agentConversationId: "agent-v2-done-1",
      agentId: "analyst",
      agentVersion: 1,
      parentConversationId: "v2-host",
      prompt: "done work",
      taskPacket: { goal: "done work" },
    });
    await module.setStatus("agt-done-1", "completed", {
      finishedAt: new Date(),
    });
    expect(await runtime.cancelTask("agt-done-1")).toBe(false);
    const snapshot = await module.getSnapshot("agt-done-1");
    expect(snapshot?.status).toBe("completed");
  });

  it("aborts a LIVE task's own controller without touching siblings", async () => {
    await SqliteDb.ensureInitialized();
    const runtime = new AgentRuntime();
    // Seed the private live registry directly (the run loop does this at
    // loop start; driving a full agent loop here would need the AI stack).
    const registry = (
      runtime as unknown as {
        liveTaskAborts: Map<string, AbortController>;
      }
    ).liveTaskAborts;
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    registry.set("agt-live-a", controllerA);
    registry.set("agt-live-b", controllerB);

    expect(await runtime.cancelTask("agt-live-a")).toBe(true);
    expect(controllerA.signal.aborted).toBe(true);
    // The sibling is untouched — exactly-one-task semantics.
    expect(controllerB.signal.aborted).toBe(false);
  });
});
