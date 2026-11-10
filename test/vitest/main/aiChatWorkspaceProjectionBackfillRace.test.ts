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

async function seedUserMessage(
  messageModel: AIChatMessageModel,
  conversationId: string,
  content: string
): Promise<void> {
  const entity = new AIChatMessageEntity();
  entity.messageId = `${conversationId}-msg-1`;
  entity.conversationId = conversationId;
  entity.role = "user";
  entity.content = content;
  entity.timestamp = new Date();
  entity.messageType = MessageType.MESSAGE;
  entity.metadata = JSON.stringify({ source: "chat-v2" });
  await messageModel.saveMessage(entity);
}

/**
 * Audit R7-04 (recorded in the 2026-10-22 fix round): projection rows now
 * materialize from the live queue path, so the boot-time backfill can race a
 * concurrent materialization — `getByConversationId` legitimately returns
 * null one instant before the writer inserts the row, and the backfill's
 * `createProjection` then hits the unique `conversationId` index. The backfill
 * must tolerate that per row instead of failing the whole pass.
 */
describe("backfillProjections under concurrent materialization (audit R7-04)", () => {
  it("skips a row a concurrent writer materialized during the pass", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    await seedUserMessage(messageModel, "v2-race-1", "raced conversation");
    await seedUserMessage(messageModel, "v2-race-2", "later conversation");

    const module = new AIChatConversationModule();
    const realModel = new AIChatConversationModel(tmpDir);
    // Simulate the interleaving: the backfill's existence check runs BEFORE
    // the concurrent `recordMessagePersisted` commits, so when the backfill
    // finally reaches insert the row already exists and the unique index
    // rejects the insert — exactly what a real SQLite violation surfaces as.
    const injected = {
      getByConversationId: realModel.getByConversationId.bind(realModel),
      createProjection: realModel.createProjection.bind(realModel),
    };
    const fakeModel = Object.assign(Object.create(realModel), {
      getByConversationId: (conversationId: string) =>
        injected.getByConversationId(conversationId),
      createProjection: async (
        input: Parameters<AIChatConversationModel["createProjection"]>[0]
      ) => {
        // "Concurrent writer" commits first.
        await realModel.recordMessagePersisted({
          conversationId: input.conversationId,
          isResult: false,
          previewText: "materialized concurrently",
          timestamp: new Date(),
        });
        // The backfill's own insert then races the unique index.
        throw new Error(
          "UNIQUE constraint failed: ai_chat_conversations.conversationId"
        );
      },
    });
    (
      module as unknown as { convModel: () => AIChatConversationModel }
    ).convModel = () => fakeModel as AIChatConversationModel;

    const changed = await module.backfillProjections();

    // Rows materialized by the concurrent writer must not break the pass and
    // must survive untouched.
    expect(changed).toBe(0);
    const raced = await realModel.getByConversationId("v2-race-1");
    expect(raced).not.toBeNull();
    expect(raced?.preview).toBe("materialized concurrently");
    // Same creation semantics as the coordinator couplings: a row born from
    // registerMessagePersisted starts at count 0 and only later records bump it.
    expect(raced?.messageCount).toBe(0);
    const later = await realModel.getByConversationId("v2-race-2");
    expect(later?.preview).toBe("materialized concurrently");
  });

  it("stays idempotent over rows the live couplings already created", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    await seedUserMessage(messageModel, "v2-live-1", "live coupled turn");
    const module = new AIChatConversationModule();
    await module.recordMessagePersisted({
      conversationId: "v2-live-1",
      isResult: false,
      previewText: "live coupled turn",
      generatedTitle: "live coupled turn",
      timestamp: new Date(),
    });

    const changed = await module.backfillProjections();

    expect(changed).toBe(0);
    const projection = await module.getConversationProjection("v2-live-1");
    expect(projection?.title).toBe("live coupled turn");
    // Row creation semantics: the registering message does not count itself.
    expect(projection?.messageCount).toBe(0);
  });
});
