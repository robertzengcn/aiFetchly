import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/modules/token", () => ({
  Token: vi.fn(function TokenMock() {
    return {
      getValue: vi.fn((key: string) => {
        if (key === "USERSDBPATH") {
          return resolveTestDbPath();
        }
        return undefined;
      }),
    };
  }),
}));

import { SqliteDb } from "@/config/SqliteDb";
import { resolveTestDbPath } from "@/config/testDbPath";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";
import { AIChatRunModel } from "@/model/AIChatRun.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";

beforeEach(async () => {
  await SqliteDb.destroyInstance();
  const dir = resolveTestDbPath();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith("scraper.db")) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          // ignore
        }
      }
    }
  }
});

describe("AIChatConversationModule repairUnrespondedFailedTurns", () => {
  it("synthesizes and persists an assistant error message when the last message is a user prompt from a failed run", async () => {
    const dbPath = resolveTestDbPath();
    const msgModel = new AIChatMessageModel(dbPath);
    const runModel = new AIChatRunModel(dbPath);
    await SqliteDb.ensureInitialized();

    const conversationId = "v2-repair-test";

    // 1. User message exists
    const userMsg = new AIChatMessageEntity();
    userMsg.messageId = "user-msg-1";
    userMsg.conversationId = conversationId;
    userMsg.role = "user";
    userMsg.content = "Generate a logo";
    userMsg.timestamp = new Date("2026-11-19T06:00:00.000Z");
    userMsg.messageType = MessageType.MESSAGE;
    userMsg.metadata = JSON.stringify({ source: "chat-v2" });
    await msgModel.saveMessage(userMsg);

    // 2. Failed run exists with no assistantMessageId
    const run = await runModel.createRun({
      conversationId,
      owner: "interactive",
      sourceId: "pending-123",
      resourceClass: "general",
    });
    await runModel.transition(run.runId, "failed", ["queued"], {
      errorSummary: "The AI service is busy or had a transient issue. Please try again in a moment.",
    });

    const module = new AIChatConversationModule();

    // 3. getConversationPage is called (as selectConversation does in IPC)
    const page = await module.getConversationPage(conversationId, 50);

    // Expect 2 messages: user message and the repaired assistant error message
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0].role).toBe("user");
    expect(page.rows[0].content).toBe("Generate a logo");

    const assistantRow = page.rows[1];
    expect(assistantRow.role).toBe("assistant");
    expect(assistantRow.content).toBe("");
    const meta = JSON.parse(assistantRow.metadata || "{}");
    expect(meta.finishReason).toBe("error");
    expect(meta.error).toBe("The AI service is busy or had a transient issue. Please try again in a moment.");

    // 4. Calling getConversationPage again is idempotent
    const page2 = await module.getConversationPage(conversationId, 50);
    expect(page2.rows).toHaveLength(2);
  });

  it("does not synthesize an assistant message if the conversation already completed normally", async () => {
    const dbPath = resolveTestDbPath();
    const msgModel = new AIChatMessageModel(dbPath);
    const runModel = new AIChatRunModel(dbPath);
    await SqliteDb.ensureInitialized();

    const conversationId = "v2-normal-test";

    const userMsg = new AIChatMessageEntity();
    userMsg.messageId = "user-msg-ok";
    userMsg.conversationId = conversationId;
    userMsg.role = "user";
    userMsg.content = "Hello AI";
    userMsg.timestamp = new Date("2026-11-19T06:00:00.000Z");
    userMsg.messageType = MessageType.MESSAGE;
    await msgModel.saveMessage(userMsg);

    const asstMsg = new AIChatMessageEntity();
    asstMsg.messageId = "asst-msg-ok";
    asstMsg.conversationId = conversationId;
    asstMsg.role = "assistant";
    asstMsg.content = "Hello there!";
    asstMsg.timestamp = new Date("2026-11-19T06:00:02.000Z");
    asstMsg.messageType = MessageType.MESSAGE;
    await msgModel.saveMessage(asstMsg);

    const completedRun = await runModel.createRun({
      conversationId,
      owner: "interactive",
      sourceId: "pending-ok",
      resourceClass: "general",
    });
    await runModel.transition(completedRun.runId, "completed", ["queued"], {
      assistantMessageId: "asst-msg-ok",
    });

    const module = new AIChatConversationModule();
    const page = await module.getConversationPage(conversationId, 50);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0].role).toBe("user");
    expect(page.rows[1].role).toBe("assistant");
    expect(page.rows[1].content).toBe("Hello there!");
  });
});
