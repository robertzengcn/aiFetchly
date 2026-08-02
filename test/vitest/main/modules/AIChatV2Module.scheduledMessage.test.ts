import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { AIChatV2Module } from "@/modules/AIChatV2Module";

const tmpDir = path.join(os.tmpdir(), "aifetchly-scheduled-msg");

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

describe("AIChatV2Module.saveUserMessageIfAbsent (scheduled idempotency)", () => {
  it("inserts on first call and reuses the row unchanged on retry", async () => {
    const mod = new AIChatV2Module();
    await SqliteDb.ensureInitialized();
    const first = await mod.saveUserMessageIfAbsent({
      conversationId: "v2-idem",
      content: "check deployment",
      messageId: "scheduled-user-1-1",
      metadata: { source: "scheduled-loop" },
    });
    const second = await mod.saveUserMessageIfAbsent({
      conversationId: "v2-idem",
      content: "check deployment",
      messageId: "scheduled-user-1-1",
      metadata: { source: "scheduled-loop" },
    });
    expect(second.id).toBe(first.id);
    expect(second.content).toBe(first.content);
    // Exactly one message row exists.
    const msgs = await mod.getConversationMessages("v2-idem");
    expect(msgs.filter((m) => m.messageId === "scheduled-user-1-1")).toHaveLength(1);
  });

  it("throws on a conversation/role mismatch (stable-id collision)", async () => {
    const mod = new AIChatV2Module();
    await SqliteDb.ensureInitialized();
    await mod.saveUserMessageIfAbsent({
      conversationId: "v2-a",
      content: "x",
      messageId: "scheduled-user-collide-1",
      metadata: { source: "scheduled-loop" },
    });
    await expect(
      mod.saveUserMessageIfAbsent({
        conversationId: "v2-b",
        content: "x",
        messageId: "scheduled-user-collide-1",
        metadata: { source: "scheduled-loop" },
      })
    ).rejects.toThrow("CONVERSATION_MISMATCH");
  });
});
