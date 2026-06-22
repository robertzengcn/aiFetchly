import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { AIMemoryConsolidationRunModule } from "@/modules/AIMemoryConsolidationRunModule";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-mem-run-module");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

describe("AIMemoryConsolidationRunModule", () => {
  it("starts a run and detects it as running", async () => {
    const mod = new AIMemoryConsolidationRunModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.startRun({ reviewedSince: null });
    expect(view.status).toBe("running");
    const running = await mod.getRunningRun();
    expect(running?.runId).toBe(view.runId);
  });

  it("completes a run with counts", async () => {
    const mod = new AIMemoryConsolidationRunModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.startRun({ reviewedSince: null });
    await mod.completeRun({
      runId: view.runId,
      chatConversationsReviewed: 3,
      agentTasksReviewed: 1,
      memoriesCreated: 2,
      memoriesUpdated: 1,
      memoriesArchived: 0,
      model: "test-model",
    });
    const latest = await mod.getLatestSuccessfulRun();
    expect(latest?.status).toBe("completed");
    expect(latest?.memoriesCreated).toBe(2);
    expect(latest?.model).toBe("test-model");
  });

  it("fails a run with an error message", async () => {
    const mod = new AIMemoryConsolidationRunModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.startRun({ reviewedSince: null });
    await mod.failRun(view.runId, "model timeout");
    const running = await mod.getRunningRun();
    expect(running).toBeNull();
    const failed = await mod.getByRunId(view.runId);
    expect(failed?.status).toBe("failed");
    expect(failed?.errorMessage).toBe("model timeout");
  });

  it("marks stale running runs as failed", async () => {
    const mod = new AIMemoryConsolidationRunModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.startRun({ reviewedSince: null });
    const afterStart = new Date(Date.now() + 1000);
    const count = await mod.recoverStaleRunningRuns(afterStart);
    expect(count).toBe(1);
    expect(await mod.getRunningRun()).toBeNull();
    expect(view.runId).toBeTruthy();
  });
});
