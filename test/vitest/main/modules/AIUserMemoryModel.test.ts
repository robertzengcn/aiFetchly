import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { AIUserMemoryModel } from "@/model/AIUserMemory.model";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-user-mem-model");
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

describe("AIUserMemoryModel", () => {
  it("creates and fetches a memory by memoryId", async () => {
    const model = new AIUserMemoryModel(
      process.env.AIFETCHLY_TEST_DBPATH as string
    );
    await SqliteDb.ensureInitialized();
    const e = await model.create({
      memoryId: "mem-1",
      type: "preference",
      title: "Concise replies",
      content: "User prefers direct engineering explanations.",
      status: "active",
      confidence: 80,
    });
    expect(e.memoryId).toBe("mem-1");
    const fetched = await model.getByMemoryId("mem-1");
    expect(fetched?.title).toBe("Concise replies");
  });

  it("updates memory fields by memoryId", async () => {
    const model = new AIUserMemoryModel(
      process.env.AIFETCHLY_TEST_DBPATH as string
    );
    await SqliteDb.ensureInitialized();
    await model.create({
      memoryId: "mem-2",
      type: "fact",
      title: "t",
      content: "c",
      status: "active",
      confidence: 50,
    });
    const updated = await model.updateByMemoryId("mem-2", {
      content: "c2",
      confidence: 90,
    });
    expect(updated.content).toBe("c2");
    expect(updated.confidence).toBe(90);
  });

  it("archives memory by memoryId", async () => {
    const model = new AIUserMemoryModel(
      process.env.AIFETCHLY_TEST_DBPATH as string
    );
    await SqliteDb.ensureInitialized();
    await model.create({
      memoryId: "mem-3",
      type: "fact",
      title: "t",
      content: "c",
      status: "active",
      confidence: 50,
    });
    await model.archive("mem-3");
    const fetched = await model.getByMemoryId("mem-3");
    expect(fetched?.status).toBe("archived");
  });

  it("hard deletes by memoryId", async () => {
    const model = new AIUserMemoryModel(
      process.env.AIFETCHLY_TEST_DBPATH as string
    );
    await SqliteDb.ensureInitialized();
    await model.create({
      memoryId: "mem-4",
      type: "fact",
      title: "t",
      content: "c",
      status: "active",
      confidence: 50,
    });
    expect(await model.deleteByMemoryId("mem-4")).toBe(1);
    expect(await model.getByMemoryId("mem-4")).toBeNull();
  });

  it("lists memories filtered by status", async () => {
    const model = new AIUserMemoryModel(
      process.env.AIFETCHLY_TEST_DBPATH as string
    );
    await SqliteDb.ensureInitialized();
    await model.create({
      memoryId: "mem-a",
      type: "preference",
      title: "a",
      content: "alpha",
      status: "active",
      confidence: 50,
    });
    await model.create({
      memoryId: "mem-b",
      type: "fact",
      title: "b",
      content: "beta",
      status: "archived",
      confidence: 50,
    });
    const active = await model.list({ status: "active" });
    expect(active.length).toBe(1);
    expect(active[0].memoryId).toBe("mem-a");
  });

  it("marks lastUsedAt for a set of memoryIds", async () => {
    const model = new AIUserMemoryModel(
      process.env.AIFETCHLY_TEST_DBPATH as string
    );
    await SqliteDb.ensureInitialized();
    await model.create({
      memoryId: "mem-u",
      type: "fact",
      title: "u",
      content: "used",
      status: "active",
      confidence: 50,
    });
    const at = new Date("2026-01-01T00:00:00Z");
    await model.markUsed(["mem-u"], at);
    const fetched = await model.getByMemoryId("mem-u");
    expect(fetched?.lastUsedAt?.toISOString()).toBe(at.toISOString());
  });
});
