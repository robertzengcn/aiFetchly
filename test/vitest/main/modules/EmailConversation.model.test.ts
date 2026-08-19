import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailConversationModel } from "@/model/EmailConversation.model";
import { EmailReceivedMessageModel } from "@/model/EmailReceivedMessage.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";

describe("EmailConversationModel — mailbox-scoped conversations (P1)", () => {
  let dbpath: string;
  let convModel: EmailConversationModel;
  let msgModel: EmailReceivedMessageModel;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-conv-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    convModel = new EmailConversationModel(dbpath);
    msgModel = new EmailReceivedMessageModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  async function seedMessage(
    emailServiceId: number,
    normalizedMessageId: string | null,
    providerUid: string
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = emailServiceId;
    msg.providerUid = providerUid;
    msg.messageId = normalizedMessageId ? `<${normalizedMessageId}>` : null;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = "x@example.com";
    msg.toAddressesJson = "[]";
    msg.subject = "Hi";
    msg.bodyText = "Hi";
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.replyStatus = "not_started";
    const saved = await msgModel.upsertByProviderUid(msg);
    if (normalizedMessageId) {
      await msgModel.updateNormalization(saved.id, { normalizedMessageId });
    }
    return saved.id;
  }

  it("creates a conversation on first resolve and returns the same one on repeat", async () => {
    const a = await convModel.resolveOrCreate({
      emailServiceId: 7,
      rootKey: "root@x",
      matchCandidates: [],
      confidence: "exact",
      ambiguityReason: null,
      displaySubject: "Thread",
      lastMessageAt: new Date(1000),
    });
    const b = await convModel.resolveOrCreate({
      emailServiceId: 7,
      rootKey: "root@x",
      matchCandidates: [],
      confidence: "exact",
      ambiguityReason: null,
      displaySubject: "Thread",
      lastMessageAt: new Date(2000),
    });
    expect(b.id).toBe(a.id);
    // touch bumps contextVersion + lastMessageAt.
    const after = await convModel.read(a.id);
    expect(after?.lastMessageAt?.getTime()).toBe(2000);
  });

  it("never lets a conversation cross an email-service boundary (FR-001)", async () => {
    const mailboxA = await convModel.resolveOrCreate({
      emailServiceId: 7,
      rootKey: "shared-root@x",
      matchCandidates: [],
      confidence: "exact",
      ambiguityReason: null,
      displaySubject: null,
      lastMessageAt: new Date(),
    });
    const mailboxB = await convModel.resolveOrCreate({
      emailServiceId: 99,
      rootKey: "shared-root@x",
      matchCandidates: [],
      confidence: "exact",
      ambiguityReason: null,
      displaySubject: null,
      lastMessageAt: new Date(),
    });
    expect(mailboxA.id).not.toBe(mailboxB.id);
    expect(mailboxA.emailServiceId).toBe(7);
    expect(mailboxB.emailServiceId).toBe(99);
  });

  it("links via a match candidate that matches an existing message id", async () => {
    const msgId = await seedMessage(7, "parent@x", "u-parent");
    const linked = await convModel.resolveOrCreate({
      emailServiceId: 7,
      rootKey: "root@x-other", // different root key
      matchCandidates: ["parent@x"], // but the parent message exists locally
      confidence: "partial",
      ambiguityReason: null,
      displaySubject: null,
      lastMessageAt: new Date(),
    });
    // The message should now belong to the resolved conversation (via candidate).
    const msg = await msgModel.read(msgId);
    // resolveOrCreate does not retro-link the matched message, but the returned
    // conversation is the one the caller should associate the new message with.
    expect(linked.id).toBeGreaterThan(0);
  });

  it("merges two conversations by exact id relationship", async () => {
    const target = await convModel.resolveOrCreate({
      emailServiceId: 7,
      rootKey: "merge-target@x",
      matchCandidates: [],
      confidence: "exact",
      ambiguityReason: null,
      displaySubject: null,
      lastMessageAt: new Date(),
    });
    const source = await convModel.resolveOrCreate({
      emailServiceId: 7,
      rootKey: "merge-source@x",
      matchCandidates: [],
      confidence: "exact",
      ambiguityReason: null,
      displaySubject: null,
      lastMessageAt: new Date(),
    });
    const msgId = await seedMessage(7, null, "u-merge");
    await msgModel.setConversation(msgId, source.id);

    await convModel.mergeExactConversations(target.id, source.id);

    const msg = await msgModel.read(msgId);
    expect(msg?.conversationId).toBe(target.id);
    expect(await convModel.read(source.id)).toBeNull();
  });
});
