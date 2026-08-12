import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReplyDraftRevisionModel } from "@/model/EmailReplyDraftRevision.model";
import { EmailReplyApprovalModel } from "@/model/EmailReplyApproval.model";
import { hashApprovalEnvelope } from "@/service/emailReply/EmailReplyRevisionHasher";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";

/**
 * The backfill migration's guarantees live in the model transaction methods.
 * The EmailReplyDraftBackfillService is a thin orchestrator over them, so we
 * prove the guarantees here directly against a real SQLite DB.
 */
describe("Legacy draft backfill (model layer) — PRD §19", () => {
  let dbpath: string;
  let draftModel: EmailReplyDraftModel;
  let revisionModel: EmailReplyDraftRevisionModel;
  let approvalModel: EmailReplyApprovalModel;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-reply-backfill-${Date.now()}`);
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

  async function seedLegacyDraft(
    status: EmailReplyDraftEntity["status"],
    emailServiceId = 7
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = 100;
    draft.emailServiceId = emailServiceId;
    draft.subject = "Re: Pricing";
    draft.bodyText = "Body";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    // No currentRevisionId / contentHash — a pre-Milestone-1 legacy row.
    const saved = await draftModel.create(draft);
    return saved.id;
  }

  function hashFor(draftId: number, sender: string, recipient: string): string {
    return hashApprovalEnvelope({
      draftId,
      revisionId: 0,
      emailServiceId: 7,
      originalMessageId: 100,
      senderAddress: sender,
      recipientAddress: recipient,
      subject: "Re: Pricing",
      bodyText: "Body",
      bodyHtml: null,
      policyVersion: "reply-policy-v2-1",
      validationVersion: "reply-validator-v2-1",
    });
  }

  it("listLegacyDrafts finds drafts without a currentRevisionId", async () => {
    const id = await seedLegacyDraft("draft");
    const legacy = await draftModel.listLegacyDrafts();
    expect(legacy.some((d) => d.id === id)).toBe(true);
  });

  it("materializes revision 1 and demotes legacy 'approved' to 'draft'", async () => {
    const draftId = await seedLegacyDraft("approved");
    const contentHash = hashFor(
      draftId,
      "owner@svc.com",
      "prospect@example.com"
    );

    const result = await draftModel.materializeRevision1ForLegacyDraft({
      draftId,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: "Body",
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      contentHash,
      emailServiceId: 7,
    });
    expect(result?.status).toBe("draft");

    const draft = await draftModel.readAggregate(draftId);
    expect(draft?.status).toBe("draft");
    expect(draft?.currentRevisionId).toBe(result?.revisionId);
    expect(draft?.revisionNumber).toBe(1);
    expect(draft?.contentHash).toBe(contentHash);

    const revision = await revisionModel.readCurrent(draftId);
    expect(revision?.revisionNumber).toBe(1);
    expect(revision?.contentHash).toBe(contentHash);
  });

  it("keeps terminal 'sent' drafts terminal after materialization", async () => {
    const draftId = await seedLegacyDraft("sent");
    const contentHash = hashFor(
      draftId,
      "owner@svc.com",
      "prospect@example.com"
    );

    const result = await draftModel.materializeRevision1ForLegacyDraft({
      draftId,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: "Body",
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      contentHash,
      emailServiceId: 7,
    });
    expect(result?.status).toBe("sent");

    const draft = await draftModel.readAggregate(draftId);
    expect(draft?.status).toBe("sent");
    expect(draft?.currentRevisionId).toBeTruthy();
  });

  it("never synthesizes an approval record during migration", async () => {
    const draftId = await seedLegacyDraft("draft");
    const contentHash = hashFor(
      draftId,
      "owner@svc.com",
      "prospect@example.com"
    );
    const result = await draftModel.materializeRevision1ForLegacyDraft({
      draftId,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: "Body",
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      contentHash,
      emailServiceId: 7,
    });
    const approval = await approvalModel.findActiveByDraft(
      draftId,
      result!.revisionId
    );
    expect(approval).toBeNull();
  });

  it("is idempotent: a second call is a no-op that preserves the revision", async () => {
    const draftId = await seedLegacyDraft("draft");
    const contentHash = hashFor(
      draftId,
      "owner@svc.com",
      "prospect@example.com"
    );

    const first = await draftModel.materializeRevision1ForLegacyDraft({
      draftId,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: "Body",
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      contentHash,
      emailServiceId: 7,
    });
    const second = await draftModel.materializeRevision1ForLegacyDraft({
      draftId,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: "Body",
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      contentHash,
      emailServiceId: 7,
    });
    expect(second?.revisionId).toBe(first?.revisionId);

    // listLegacyDrafts no longer includes it.
    const legacy = await draftModel.listLegacyDrafts();
    expect(legacy.some((d) => d.id === draftId)).toBe(false);
  });

  it("backfill two-step stores a hash that matches the real approval envelope (P0.5)", async () => {
    // Regression: backfill previously hashed with revisionId:0, so the stored
    // hash could never match an approval computed with the real revision id.
    const draftId = await seedLegacyDraft("draft");
    const sender = "owner@svc.com";
    const recipient = "prospect@example.com";

    // Step 1: insert with placeholder (as the BackfillService now does).
    const inserted = await draftModel.materializeRevision1ForLegacyDraft({
      draftId,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: "Body",
      bodyHtml: null,
      senderAddress: sender,
      recipientAddress: recipient,
      contentHash: "pending-backfill",
      emailServiceId: 7,
    });
    expect(inserted).not.toBeNull();

    // Step 2: recompute with the REAL revision id and persist via applyContentHash.
    const realHash = hashApprovalEnvelope({
      draftId,
      revisionId: inserted!.revisionId,
      emailServiceId: 7,
      originalMessageId: 100,
      senderAddress: sender,
      recipientAddress: recipient,
      subject: "Re: Pricing",
      bodyText: "Body",
      bodyHtml: null,
      policyVersion: "reply-policy-v2-1",
      validationVersion: "reply-validator-v2-1",
    });
    await draftModel.applyContentHash(draftId, inserted!.revisionId, realHash);

    // The persisted revision + draft hashes match what a fresh approval would
    // compute, so a later approveDraft() will accept the revision as-is.
    const revision = await revisionModel.read(inserted!.revisionId);
    expect(revision?.contentHash).toBe(realHash);
    const draft = await draftModel.readAggregate(draftId);
    expect(draft?.contentHash).toBe(realHash);
    expect(realHash).not.toBe(
      hashApprovalEnvelope({
        draftId,
        revisionId: 0,
        emailServiceId: 7,
        originalMessageId: 100,
        senderAddress: sender,
        recipientAddress: recipient,
        subject: "Re: Pricing",
        bodyText: "Body",
        bodyHtml: null,
        policyVersion: "reply-policy-v2-1",
        validationVersion: "reply-validator-v2-1",
      })
    );
  });
});
