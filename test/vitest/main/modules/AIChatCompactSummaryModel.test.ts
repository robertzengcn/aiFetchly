import { describe, expect, it, beforeEach } from "vitest";
import { AIChatCompactSummaryModel } from "@/model/AIChatCompactSummary.model";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-compact-sum-model");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  // Delete any on-disk sqlite files left from prior runs (test isolation).
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  // Reset the in-memory singleton.
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("AIChatCompactSummaryModel", () => {
  it("saves and fetches active summary", async () => {
    const m = new AIChatCompactSummaryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await m.saveFullCompact({
      compactId: "compact-1",
      conversationId: "v2-c1",
      summary: "# Compact Summary\n## Primary Request\nship",
      fromMessageId: "msg-1",
      throughMessageId: "msg-5",
      throughTimestamp: new Date(5),
      sourceMessageCount: 5,
      inputTokenEstimate: 100,
      outputTokenEstimate: 50,
      model: "test-model",
      status: "active",
    });
    const active = await m.getActiveSummary("v2-c1");
    expect(active?.compactId).toBe("compact-1");
    expect(active?.status).toBe("active");
  });

  it("marks prior active as superseded when a new active is saved", async () => {
    const m = new AIChatCompactSummaryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await m.saveFullCompact({
      compactId: "compact-1",
      conversationId: "v2-c2",
      summary: "v1",
      throughMessageId: "msg-3",
      throughTimestamp: new Date(3),
      sourceMessageCount: 3,
      status: "active",
    });
    await m.saveFullCompact({
      compactId: "compact-2",
      conversationId: "v2-c2",
      summary: "v2",
      throughMessageId: "msg-6",
      throughTimestamp: new Date(6),
      sourceMessageCount: 6,
      status: "active",
    });
    const active = await m.getActiveSummary("v2-c2");
    expect(active?.compactId).toBe("compact-2");
    const all = await m.listByConversation("v2-c2");
    expect(all.length).toBe(2);
    expect(all.find((s) => s.compactId === "compact-1")?.status).toBe(
      "superseded"
    );
  });

  it("deletes by conversation and deleteAllV2", async () => {
    const m = new AIChatCompactSummaryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await m.saveFullCompact({
      compactId: "compact-3",
      conversationId: "v2-c3",
      summary: "x",
      throughMessageId: "m",
      throughTimestamp: new Date(1),
      sourceMessageCount: 1,
      status: "active",
    });
    expect(await m.deleteByConversation("v2-c3")).toBe(1);
    expect(await m.getActiveSummary("v2-c3")).toBeNull();
  });
});
