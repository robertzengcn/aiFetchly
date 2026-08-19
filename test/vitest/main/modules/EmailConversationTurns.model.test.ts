import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailConversationModel } from "@/model/EmailConversation.model";
import { EmailReceivedMessageModel } from "@/model/EmailReceivedMessage.model";
import { EmailReplySendAttemptModel } from "@/model/EmailReplySendAttempt.model";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";

/**
 * P1.3: ordered inbound + outbound history. Outbound turns come ONLY from
 * confirmed `sent` attempts; non-sent attempts (failed/unknown) never appear as
 * conversation turns (FR-002).
 */
describe("EmailConversationModel.listOrderedTurns — ordered history (P1.3)", () => {
  let dbpath: string;
  let convModel: EmailConversationModel;
  let msgModel: EmailReceivedMessageModel;
  let attemptModel: EmailReplySendAttemptModel;
  let draftModel: EmailReplyDraftModel;
  let conversationId: number;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-turns-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    convModel = new EmailConversationModel(dbpath);
    msgModel = new EmailReceivedMessageModel(dbpath);
    attemptModel = new EmailReplySendAttemptModel(dbpath);
    draftModel = new EmailReplyDraftModel(dbpath);

    const conv = await convModel.resolveOrCreate({
      emailServiceId: 7,
      rootKey: `turns-root-${Date.now()}@x`,
      matchCandidates: [],
      confidence: "exact",
      ambiguityReason: null,
      displaySubject: "Thread",
      lastMessageAt: new Date(),
    });
    conversationId = conv.id;

    // Inbound turns (interleaved timestamps).
    await seedMessage("in-early", new Date(1000));
    await seedMessage("in-late", new Date(4000));
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  async function seedMessage(uid: string, at: Date): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = 7;
    msg.providerUid = uid;
    msg.messageId = `<${uid}@x>`;
    msg.threadKey = msg.messageId;
    msg.fromAddress = "p@x.com";
    msg.toAddressesJson = JSON.stringify(["me@x.com"]);
    msg.subject = "Hi";
    msg.bodyText = `body-${uid}`;
    msg.receivedAt = at;
    msg.isUnread = 1;
    msg.replyStatus = "not_started";
    const saved = await msgModel.upsertByProviderUid(msg);
    await msgModel.setConversation(saved.id, conversationId);
    return saved.id;
  }

  async function seedAttempt(
    uid: string,
    at: Date,
    status: "sent" | "failed" | "delivery_unknown"
  ): Promise<number> {
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `turns-${uid}-${status}`;
    attempt.draftId = 1;
    attempt.revisionId = 1;
    attempt.approvalId = 1;
    attempt.messageId = 1;
    attempt.conversationId = conversationId;
    attempt.emailServiceId = 7;
    attempt.senderAddress = "me@x.com";
    attempt.recipientAddress = "p@x.com";
    attempt.status = status;
    attempt.claimedAt = at;
    attempt.providerMessageId = status === "sent" ? `<out-${uid}@x>` : null;
    const saved = await attemptModel.create(attempt);
    return saved.id;
  }

  it("merges inbound and sent outbound turns chronologically", async () => {
    await seedAttempt("mid", new Date(2000), "sent");
    await seedAttempt("failed", new Date(3000), "failed");
    await seedAttempt("unknown", new Date(3500), "delivery_unknown");

    const turns = await convModel.listOrderedTurns(7, conversationId);

    // Only the SENT attempt appears as an outbound turn; failed/unknown do not.
    const outbound = turns.filter((t) => t.direction === "outbound");
    expect(outbound).toHaveLength(1);
    expect(outbound[0].providerMessageId).toBe("<out-mid@x>");

    // Chronological order with deterministic fallback.
    const times = turns.map((t) => t.timestamp.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));

    // All turns belong to this conversation's members.
    expect(turns.map((t) => t.direction)).toEqual([
      "inbound",
      "outbound",
      "inbound",
    ]);
  });

  it("is scoped to one emailServiceId — another mailbox sees nothing", async () => {
    const other = await convModel.listOrderedTurns(99, conversationId);
    expect(other).toHaveLength(0);
  });

  it("is scoped to one conversation — other conversations see nothing", async () => {
    const otherConv = await convModel.resolveOrCreate({
      emailServiceId: 7,
      rootKey: `other-${Date.now()}@x`,
      matchCandidates: [],
      confidence: "exact",
      ambiguityReason: null,
      displaySubject: null,
      lastMessageAt: new Date(),
    });
    const turns = await convModel.listOrderedTurns(7, otherConv.id);
    expect(turns).toHaveLength(0);
  });
});
