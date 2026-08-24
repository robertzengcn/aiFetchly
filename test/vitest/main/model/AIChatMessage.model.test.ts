import { describe, expect, it, beforeEach } from "vitest";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";

const tmpDir = path.join(os.tmpdir(), "aifetchly-chat-message-model");

function makeEntity(params: {
  messageId: string;
  conversationId: string;
  role?: string;
  metadata?: string;
  messageType?: MessageType;
}): AIChatMessageEntity {
  const message = new AIChatMessageEntity();
  message.messageId = params.messageId;
  message.conversationId = params.conversationId;
  message.role = params.role ?? "assistant";
  message.content = `content-${params.conversationId}-${params.messageId}`;
  message.timestamp = new Date();
  message.metadata = params.metadata;
  message.messageType = params.messageType ?? MessageType.MESSAGE;
  return message;
}

beforeEach(async () => {
  // Fresh sqlite file per test so rows never leak across cases.
  await SqliteDb.destroyInstance();
});

describe("AIChatMessageModel.getMessageByConversationAndMessageId", () => {
  it("returns only the row matching BOTH conversationId and messageId", async () => {
    const model = new AIChatMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await model.saveMessage(
      makeEntity({ conversationId: "c-a", messageId: "m-1" })
    );
    await model.saveMessage(
      makeEntity({ conversationId: "c-b", messageId: "m-1" })
    );

    const match = await model.getMessageByConversationAndMessageId(
      "c-b",
      "m-1"
    );
    expect(match).not.toBeNull();
    expect(match?.conversationId).toBe("c-b");
    expect(match?.messageId).toBe("m-1");
  });

  it("returns null for an unknown conversation with a known messageId", async () => {
    const model = new AIChatMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await model.saveMessage(
      makeEntity({ conversationId: "c-a", messageId: "m-1" })
    );

    expect(
      await model.getMessageByConversationAndMessageId("c-zz", "m-1")
    ).toBeNull();
  });

  it("returns null for a known conversation with an unknown messageId", async () => {
    const model = new AIChatMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await model.saveMessage(
      makeEntity({ conversationId: "c-a", messageId: "m-1" })
    );

    expect(
      await model.getMessageByConversationAndMessageId("c-a", "other")
    ).toBeNull();
  });

  it("resolves each shared-messageId row within its own conversation", async () => {
    const model = new AIChatMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await model.saveMessage(
      makeEntity({
        conversationId: "v2-x",
        messageId: "shared",
        metadata: JSON.stringify({ source: "chat-v2" }),
      })
    );
    await model.saveMessage(
      makeEntity({
        conversationId: "v2-y",
        messageId: "shared",
        role: "user",
        metadata: JSON.stringify({ source: "chat-v2" }),
      })
    );

    const x = await model.getMessageByConversationAndMessageId("v2-x", "shared");
    const y = await model.getMessageByConversationAndMessageId("v2-y", "shared");
    expect(x?.role).toBe("assistant");
    expect(y?.role).toBe("user");
  });
});
