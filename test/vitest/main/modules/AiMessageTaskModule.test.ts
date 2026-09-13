import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";

const tmpDir = path.join(os.tmpdir(), "aifetchly-ai-message-task-module");

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
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
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

describe("AiMessageTaskModule.createTask", () => {
  it("binds a new schedule-page task to a v2 conversation Chat V2 history can list", async () => {
    const mod = new AiMessageTaskModule();
    await SqliteDb.ensureInitialized();
    const taskId = await mod.createTask({
      name: "Nightly recap",
      message: "Summarize inbox",
    });
    const task = await mod.getTask(taskId);
    expect(task).not.toBeNull();
    expect(task?.conversation_id?.startsWith("v2-")).toBe(true);
    expect(task?.source_type).toBe("schedule_ui");
  });

  it("reuses an existing v2 conversation id when the caller supplies one", async () => {
    const mod = new AiMessageTaskModule();
    await SqliteDb.ensureInitialized();
    const taskId = await mod.createTask({
      name: "Bound recap",
      message: "Summarize inbox",
      conversationId: "v2-existing-conv",
    });
    const task = await mod.getTask(taskId);
    expect(task?.conversation_id).toBe("v2-existing-conv");
  });
});
