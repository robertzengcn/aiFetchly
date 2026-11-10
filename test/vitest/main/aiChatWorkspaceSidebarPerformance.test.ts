import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { AIChatConversationModel } from "@/model/AIChatConversation.model";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";

const tmpDir = path.join(os.tmpdir(), "aifetchly-ws-sidebar-perf");

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

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
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
});

/**
 * Sidebar + history performance fixtures (PRD §34.5): 100 workspaces /
 * 1,000 conversation summaries and a 1,000-message history. Budgets are
 * generous ceilings that catch order-of-magnitude regressions; p95 targets
 * for the packaged app are validated in the E2E phase.
 */
describe("workspace sidebar + history performance fixtures", () => {
  it("projects a 100-workspace / 1,000-conversation sidebar within budget", async () => {
    await SqliteDb.ensureInitialized();
    const convModel = new AIChatConversationModel(tmpDir);
    const WORKSPACES = 100;
    const PER_WORKSPACE = 10; // → 1,000 summaries
    for (let w = 0; w < WORKSPACES; w += 1) {
      const key = `ws-key-${w}`;
      for (let i = 0; i < PER_WORKSPACE; i += 1) {
        await convModel.createProjection({
          conversationId: `v2-perf-${w}-${i}`,
          workspaceKey: key,
          title: `Conversation ${w}/${i}`,
          preview: "preview text",
          createdAt: new Date(),
        });
      }
    }

    const module = new AIChatConversationModule();
    const start = performance.now();
    const sidebar = await module.getWorkspaceSidebar(() => null, null);
    const elapsed = performance.now() - start;

    expect(sidebar.workspaces).toHaveLength(WORKSPACES);
    expect(
      sidebar.workspaces.reduce((acc, g) => acc + g.conversations.length, 0)
    ).toBe(WORKSPACES * PER_WORKSPACE);
    // Generous ceiling: the bounded projection must not degrade per row.
    expect(elapsed).toBeLessThan(5000);
  });

  it("cursor-pages a 1,000-message history without offset drift", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const conversationId = "v2-perf-history";
    const TOTAL = 1_000;
    const base = Date.now() - TOTAL * 1000;
    for (let i = 0; i < TOTAL; i += 1) {
      const entity = new AIChatMessageEntity();
      entity.messageId = `m-${String(i).padStart(5, "0")}`;
      entity.conversationId = conversationId;
      entity.role = i % 2 === 0 ? "user" : "assistant";
      entity.content = `message ${i}`;
      entity.timestamp = new Date(base + i * 1000);
      entity.messageType = MessageType.MESSAGE;
      entity.metadata = JSON.stringify({ source: "chat-v2" });
      await messageModel.saveMessage(entity);
    }

    // Walk the newest 300 messages in pages of 50 while new rows arrive —
    // the cursor must stay stable (design §12.1).
    const insertLate = async (): Promise<void> => {
      const entity = new AIChatMessageEntity();
      entity.messageId = `late-${Date.now()}`;
      entity.conversationId = conversationId;
      entity.role = "user";
      entity.content = "arrived during paging";
      entity.timestamp = new Date();
      entity.messageType = MessageType.MESSAGE;
      entity.metadata = JSON.stringify({ source: "chat-v2" });
      await messageModel.saveMessage(entity);
    };

    const start = performance.now();
    let cursor: { timestamp: Date; messageId: string } | undefined;
    const pages: number[][] = [];
    for (let page = 0; page < 6; page += 1) {
      const result = await messageModel.getConversationPageDescending(
        conversationId,
        50,
        cursor
      );
      pages.push(result.rows.map((r) => Number(r.messageId.slice(2))));
      cursor = result.rows[0]
        ? {
            timestamp: result.rows[0].timestamp, // Date for the model query
            messageId: result.rows[0].messageId,
          }
        : undefined;
      if (page === 0) await insertLate(); // new row mid-pagination
    }
    const elapsed = performance.now() - start;

    // No overlap, no gaps, and no drift from the late insert: each page is
    // internally chronological (ascending ids) and consecutive pages step
    // back by exactly the page size (newest-first walk, design §12.1).
    expect(pages).toHaveLength(6);
    for (const page of pages) {
      expect(page).toHaveLength(50);
      for (let i = 1; i < page.length; i += 1) {
        expect(page[i]).toBe(page[i - 1] + 1);
      }
    }
    for (let p = 1; p < pages.length; p += 1) {
      expect(pages[p - 1][0] - pages[p][pages[p].length - 1]).toBe(1);
    }
    expect(pages[0][pages[0].length - 1]).toBe(999); // newest is m-00999
    expect(elapsed).toBeLessThan(5000);
  });
});
