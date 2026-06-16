import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { AIChatSessionMemoryModel } from "@/model/AIChatSessionMemory.model";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-compact-mem-model");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  // fresh singleton per test file process
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("AIChatSessionMemoryModel", () => {
  it("upserts by conversationId (insert then update)", async () => {
    const model = new AIChatSessionMemoryModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const created = await model.upsertMemory({
      conversationId: "v2-conv-1",
      summary: "# Session Memory\n## Current Goal\nship it",
      coveredThroughMessageId: "msg-1",
      coveredThroughTimestamp: new Date(1),
      sourceMessageCount: 1,
      tokenEstimate: 10,
      model: "test-model",
      status: "active",
    });
    expect(created.conversationId).toBe("v2-conv-1");
    expect(created.failureCount).toBe(0);

    const updated = await model.upsertMemory({
      conversationId: "v2-conv-1",
      summary: "# Session Memory\n## Current Goal\nship it v2",
      coveredThroughMessageId: "msg-2",
      coveredThroughTimestamp: new Date(2),
      sourceMessageCount: 2,
      tokenEstimate: 20,
      model: "test-model",
      status: "active",
    });
    expect(updated.sourceMessageCount).toBe(2);

    const all = await model.listAll();
    expect(all.length).toBe(1);
  });

  it("getByConversation returns null when absent", async () => {
    const model = new AIChatSessionMemoryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    expect(await model.getByConversation("v2-missing")).toBeNull();
  });

  it("records failure count and lastError", async () => {
    const model = new AIChatSessionMemoryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.upsertMemory({
      conversationId: "v2-fail",
      summary: "",
      sourceMessageCount: 0,
      status: "active",
    });
    const after = await model.recordFailure("v2-fail", "boom");
    expect(after.failureCount).toBe(1);
    expect(after.lastError).toBe("boom");
  });

  it("deletes by conversation", async () => {
    const model = new AIChatSessionMemoryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.upsertMemory({
      conversationId: "v2-del",
      summary: "x",
      sourceMessageCount: 0,
      status: "active",
    });
    const affected = await model.deleteByConversation("v2-del");
    expect(affected).toBe(1);
    expect(await model.getByConversation("v2-del")).toBeNull();
  });
});
