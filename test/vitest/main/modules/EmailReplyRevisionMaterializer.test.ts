import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReplyDraftRevisionModel } from "@/model/EmailReplyDraftRevision.model";
import { EmailReplyApprovalModel } from "@/model/EmailReplyApproval.model";
import { materializeRevision1 } from "@/service/emailReply/EmailReplyRevisionMaterializer";
import { hashApprovalEnvelope } from "@/service/emailReply/EmailReplyRevisionHasher";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";

/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * materializeRevision1 is the shared core of the v2 generate and edit wiring.
 * Proving it here (model-level, real SQLite) covers both IPC paths' essential
 * behavior without standing up the LLM-generation stack.
 */
describe("materializeRevision1 — v2 generate/edit wiring core", () => {
  let dbpath: string;
  let draftModel: EmailReplyDraftModel;
  let revisionModel: EmailReplyDraftRevisionModel;
  let approvalModel: EmailReplyApprovalModel;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-materialize-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    draftModel = new EmailReplyDraftModel(dbpath);
    revisionModel = new EmailReplyDraftRevisionModel(dbpath);
    approvalModel = new EmailReplyApprovalModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  async function seedDraft(): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = 200;
    draft.emailServiceId = 7;
    draft.subject = "Re: Pricing";
    draft.bodyText = "Original AI body.";
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    const saved = await draftModel.create(draft);
    return saved.id;
  }

  it("creates revision 1 + materializes the canonical hash for a generated draft", async () => {
    const draftId = await seedDraft();
    const result = await materializeRevision1(draftModel, {
      draftId,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: "Original AI body.",
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId: 7,
      originalMessageId: 200,
    });

    expect(result.revisionNumber).toBe(1);
    expect(result.contentHash).toHaveLength(64);

    const draft = await draftModel.readAggregate(draftId);
    expect(draft?.currentRevisionId).toBe(result.revisionId);
    expect(draft?.contentHash).toBe(result.contentHash);
    expect(draft?.senderAddress).toBe("owner@svc.com");
    expect(draft?.recipientAddress).toBe("prospect@example.com");

    const revision = await revisionModel.read(result.revisionId);
    expect(revision?.contentHash).toBe(result.contentHash);

    // The materialized hash matches an independently computed envelope hash.
    const expected = hashApprovalEnvelope({
      draftId,
      revisionId: result.revisionId,
      emailServiceId: 7,
      originalMessageId: 200,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      subject: "Re: Pricing",
      bodyText: "Original AI body.",
      bodyHtml: null,
      policyVersion: "reply-policy-v2-1",
      validationVersion: "reply-validator-v2-1",
    });
    expect(result.contentHash).toBe(expected);
  });

  it("an edit appends revision 2, invalidates the active approval, and recomputes the hash", async () => {
    const draftId = await seedDraft();
    const first = await materializeRevision1(draftModel, {
      draftId,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: "Original AI body.",
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId: 7,
      originalMessageId: 200,
    });

    // Approve revision 1 (mint an active approval bound to its hash).
    const token = "test-token-" + draftId;
    const approval = await approvalModel.create({
      draftId,
      revisionId: first.revisionId,
      approvedByType: "user",
      approvedById: null,
      approvedHash: first.contentHash,
      approvalTokenHash: require("node:crypto")
        .createHash("sha256")
        .update(token)
        .digest("hex"),
      approvedAt: new Date(),
      expiresAt: null,
      invalidatedAt: null,
      invalidationReason: null,
    } as never);
    const activeBefore = await approvalModel.findActiveByDraft(
      draftId,
      first.revisionId
    );
    expect(activeBefore?.id).toBe(approval.id);

    // Edit: new content → revision 2.
    const second = await materializeRevision1(draftModel, {
      draftId,
      actor: "user",
      subject: "Re: Pricing — edited",
      bodyText: "Edited body with different content.",
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId: 7,
      originalMessageId: 200,
    });

    expect(second.revisionNumber).toBe(2);
    expect(second.revisionId).not.toBe(first.revisionId);
    expect(second.contentHash).not.toBe(first.contentHash);

    const draft = await draftModel.readAggregate(draftId);
    expect(draft?.status).toBe("draft"); // approval invalidated → back to draft
    expect(draft?.subject).toBe("Re: Pricing — edited");
    expect(draft?.currentRevisionId).toBe(second.revisionId);

    // The prior approval is no longer active.
    const activeAfter = await approvalModel.findActiveByDraft(
      draftId,
      first.revisionId
    );
    expect(activeAfter).toBeNull();
    const consumed = await approvalModel.read(approval.id);
    expect(consumed?.invalidatedAt).toBeTruthy();
  });
});

/* eslint-enable @typescript-eslint/no-var-requires */