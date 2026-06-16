import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-compact-mem-mod");
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

// Override Token to point at tmpDir so BaseModule resolves the test db.
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

describe("AIChatSessionMemoryModule", () => {
  it("round-trips a memory through upsert + getByConversation", async () => {
    const mod = new AIChatSessionMemoryModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.upsertMemory({
      conversationId: "v2-a",
      summary: "# Session Memory",
      sourceMessageCount: 0,
      status: "active",
    });
    expect(view.conversationId).toBe("v2-a");
    expect(view.failureCount).toBe(0);
    const fetched = await mod.getByConversation("v2-a");
    expect(fetched?.conversationId).toBe("v2-a");
  });

  it("increments failureCount and stores lastError via recordFailure", async () => {
    const mod = new AIChatSessionMemoryModule();
    await SqliteDb.ensureInitialized();
    await mod.upsertMemory({
      conversationId: "v2-b",
      summary: "",
      sourceMessageCount: 0,
      status: "active",
    });
    const v = await mod.recordFailure("v2-b", "timeout");
    expect(v?.failureCount).toBe(1);
    expect(v?.lastError).toBe("timeout");
  });

  it("deletes memory for a conversation", async () => {
    const mod = new AIChatSessionMemoryModule();
    await SqliteDb.ensureInitialized();
    await mod.upsertMemory({
      conversationId: "v2-del",
      summary: "x",
      sourceMessageCount: 0,
      status: "active",
    });
    expect(await mod.deleteByConversation("v2-del")).toBe(1);
    expect(await mod.getByConversation("v2-del")).toBeNull();
  });
});
