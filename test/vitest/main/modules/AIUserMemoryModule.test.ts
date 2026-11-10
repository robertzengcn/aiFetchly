import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { AIUserMemoryModule } from "@/modules/AIUserMemoryModule";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-user-mem-module");
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

describe("AIUserMemoryModule", () => {
  it("creates a memory and returns a view with a memoryId", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.createMemory({
      type: "preference",
      title: "Concise replies",
      content: "User prefers concise answers.",
    });
    expect(view.memoryId).toMatch(/^mem-/);
    expect(view.type).toBe("preference");
    expect(view.status).toBe("active");
  });

  it("rejects an invalid type", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.createMemory({
        type: "garbage" as never,
        title: "x",
        content: "y",
      })
    ).rejects.toThrow(/type/);
  });

  it("rejects empty title or content", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.createMemory({ type: "fact", title: "   ", content: "x" })
    ).rejects.toThrow(/title/);
    await expect(
      mod.createMemory({ type: "fact", title: "x", content: "" })
    ).rejects.toThrow(/content/);
  });

  it("clamps confidence into 0..100", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory({
      type: "fact",
      title: "x",
      content: "y",
      confidence: 250,
    });
    expect(v.confidence).toBe(100);
  });

  it("lists active memories by default and archives by id", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const a = await mod.createMemory({
      type: "fact",
      title: "a",
      content: "aa",
    });
    await mod.createMemory({
      type: "fact",
      title: "b",
      content: "bb",
      sourceKind: "chat_v2",
    });
    const active = await mod.listMemories({});
    expect(active.length).toBe(2);
    await mod.archiveMemory(a.memoryId);
    const after = await mod.listMemories({});
    expect(after.length).toBe(1);
  });

  it("lists all statuses when status is 'all'", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const a = await mod.createMemory({
      type: "fact",
      title: "a",
      content: "aa",
    });
    await mod.createMemory({
      type: "fact",
      title: "b",
      content: "bb",
    });
    await mod.archiveMemory(a.memoryId);
    const all = await mod.listMemories({ status: "all" });
    expect(all.length).toBe(2);
    expect(all.some((m) => m.status === "archived")).toBe(true);
    const archived = await mod.listMemories({ status: "archived" });
    expect(archived.length).toBe(1);
    expect(archived[0].status).toBe("archived");
  });

  it("updates memory fields", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory({
      type: "fact",
      title: "t",
      content: "c",
    });
    const u = await mod.updateMemory({
      memoryId: v.memoryId,
      content: "c2",
    });
    expect(u.content).toBe("c2");
  });

  it("deletes memory by memoryId", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory({
      type: "fact",
      title: "t",
      content: "c",
    });
    expect(await mod.deleteMemory(v.memoryId)).toBe(1);
    expect(await mod.getMemory(v.memoryId)).toBeNull();
  });

  it("marks memories used by memoryId", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory({
      type: "fact",
      title: "t",
      content: "c",
    });
    const at = new Date("2026-01-01T00:00:00Z");
    await mod.markMemoriesUsed([v.memoryId], at);
    const fetched = await mod.getMemory(v.memoryId);
    expect(fetched?.lastUsedAt).toBe(at.toISOString());
  });

  it("applyPlanAndCompleteRun rejects secret-like create content and rolls back", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    // First seed a legitimate memory the run could otherwise archive/update.
    const existing = await mod.createMemory({
      type: "fact",
      title: "legit",
      content: "a real preference",
    });
    const before = await mod.listMemories({});
    const beforeCount = before.length;

    await expect(
      mod.applyPlanAndCompleteRun({
        runId: "run-secret-test",
        plan: {
          ok: true,
          create: [
            {
              type: "preference",
              title: "my api key",
              content: "sk-1234567890abcdef1234567890abcdef",
              confidence: 80,
              sourceKind: "chat_v2",
              sourceId: "v2-1",
              reason: "r",
            },
          ],
          update: [],
          archive: [],
        },
        chatConversationsReviewed: 1,
        agentTasksReviewed: 0,
        model: "small",
      })
    ).rejects.toThrow(/secret filter/);

    // Nothing was created or mutated — the transaction rolled back.
    const after = await mod.listMemories({});
    expect(after.length).toBe(beforeCount);
    // The pre-existing memory is untouched.
    expect(await mod.getMemory(existing.memoryId)).toMatchObject({
      title: "legit",
    });
  });

  it("applyPlanAndCompleteRun rejects secret-like update content and rolls back", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const existing = await mod.createMemory({
      type: "fact",
      title: "legit",
      content: "a real preference",
    });

    await expect(
      mod.applyPlanAndCompleteRun({
        runId: "run-secret-update",
        plan: {
          ok: true,
          create: [],
          update: [
            {
              memoryId: existing.memoryId,
              content:
                "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
              reason: "r",
            },
          ],
          archive: [],
        },
        chatConversationsReviewed: 0,
        agentTasksReviewed: 0,
        model: "small",
      })
    ).rejects.toThrow(/secret filter/);

    // The update did not apply.
    expect(await mod.getMemory(existing.memoryId)).toMatchObject({
      content: "a real preference",
    });
  });
});
