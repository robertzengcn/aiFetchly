import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-compact-mod");
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

describe("AIChatCompactModule", () => {
  it("saves a full compact and exposes the active summary", async () => {
    const mod = new AIChatCompactModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.saveFullCompact({
      compactId: "c-1",
      conversationId: "v2-z",
      summary: "# Compact Summary",
      throughMessageId: "m-5",
      throughTimestamp: new Date(5),
      sourceMessageCount: 5,
      status: "active",
    });
    expect(v.compactId).toBe("c-1");
    const active = await mod.getActiveSummary("v2-z");
    expect(active?.compactId).toBe("c-1");
  });

  it("clears by conversation", async () => {
    const mod = new AIChatCompactModule();
    await SqliteDb.ensureInitialized();
    await mod.saveFullCompact({
      compactId: "c-2",
      conversationId: "v2-clear",
      summary: "x",
      throughMessageId: "m",
      throughTimestamp: new Date(1),
      sourceMessageCount: 1,
      status: "active",
    });
    expect(await mod.deleteByConversation("v2-clear")).toBe(1);
    expect(await mod.getActiveSummary("v2-clear")).toBeNull();
  });
});
