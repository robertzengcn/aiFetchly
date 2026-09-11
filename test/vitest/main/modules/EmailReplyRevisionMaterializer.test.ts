import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReplyDraftRevisionModel } from "@/model/EmailReplyDraftRevision.model";
import { EmailReplyApprovalModel } from "@/model/EmailReplyApproval.model";
import {
  materializeRevision1,
  materializeRevision2,
} from "@/service/emailReply/EmailReplyRevisionMaterializer";
import {
  hashApprovalEnvelope,
  hashApprovalEnvelopeV2,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailServiceEntity } from "@/entity/EmailService.entity";

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

  // §18.1 — v2 reply revision binds the resolved service identity
  // (smtpUsername + replyToAddress) and hashes via the v2 envelope. Production
  // callers: emailReceive-ipc.ts (create draft) and
  // EmailReplyDraftGenerationService.createDraft.
  describe("materializeRevision2 — identity-bound v2 revision", () => {
    let v2dbpath: string;

    beforeAll(async () => {
      v2dbpath = path.join(
        os.tmpdir(),
        `aifetchly-materialize-v2-${Date.now()}`
      );
      fs.mkdirSync(v2dbpath, { recursive: true });
      await SqliteDb.resetInstance(v2dbpath);
      await SqliteDb.ensureInitialized();

      // Seed a service row whose identity the resolver must freeze.
      const serviceModel = new EmailServiceModel(v2dbpath);
      const service = new EmailServiceEntity();
      service.id = 7;
      service.name = "Primary";
      service.from = "owner@svc.com";
      service.smtpUsername = "api-login@svc.com";
      service.replyTo = "replies@svc.com";
      service.password = "secret";
      service.host = "smtp.svc.com";
      service.port = "465";
      service.ssl = 1;
      service.status = 1;
      await serviceModel.create(service);
    });

    it("freezes the resolved identity onto the revision and hashes the v2 envelope", async () => {
      const draftModel = new EmailReplyDraftModel(v2dbpath);
      const revisionModel = new EmailReplyDraftRevisionModel(v2dbpath);
      const draft = new EmailReplyDraftEntity();
      draft.messageId = 300;
      draft.emailServiceId = 7;
      draft.subject = "Re: Pricing";
      draft.bodyText = "v2 body.";
      draft.bodyHtml = null;
      draft.status = "draft";
      draft.generationSource = "ai";
      const saved = await draftModel.create(draft);

      const result = await materializeRevision2(draftModel, {
        draftId: saved.id,
        actor: "ai",
        subject: "Re: Pricing",
        bodyText: "v2 body.",
        bodyHtml: null,
        senderAddress: "owner@svc.com",
        recipientAddress: "prospect@example.com",
        emailServiceId: 7,
        originalMessageId: 300,
        dbpath: v2dbpath,
      });

      expect(result.revisionNumber).toBe(1);
      expect(result.smtpUsername).toBe("api-login@svc.com");
      expect(result.replyToAddress).toBe("replies@svc.com");
      expect(result.contentHash).toHaveLength(64);

      // The revision row carries the v2 identity columns.
      const revision = await revisionModel.read(result.revisionId);
      expect(revision?.envelopeVersion).toBe(2);
      expect(revision?.smtpUsername).toBe("api-login@svc.com");
      expect(revision?.replyToAddress).toBe("replies@svc.com");

      // The materialized hash matches the v2 envelope hash (identity included).
      const expected = hashApprovalEnvelopeV2({
        version: 2,
        draftId: saved.id,
        revisionId: result.revisionId,
        emailServiceId: 7,
        originalMessageId: 300,
        smtpUsername: "api-login@svc.com",
        senderAddress: "owner@svc.com",
        replyToAddress: "replies@svc.com",
        recipientAddress: "prospect@example.com",
        subject: "Re: Pricing",
        bodyText: "v2 body.",
        bodyHtml: null,
        policyVersion: "reply-policy-v2-1",
        validationVersion: "reply-validator-v2-1",
      });
      expect(result.contentHash).toBe(expected);
    });

    it("applies the smtpUsername ?? from fallback when the service row has a null smtpUsername", async () => {
      const serviceModel = new EmailServiceModel(v2dbpath);
      const patch = new EmailServiceEntity();
      patch.smtpUsername = null;
      await serviceModel.update(7, patch);

      const draftModel = new EmailReplyDraftModel(v2dbpath);
      const draft = new EmailReplyDraftEntity();
      draft.messageId = 301;
      draft.emailServiceId = 7;
      draft.subject = "Re: Fallback";
      draft.bodyText = "Fallback body.";
      draft.bodyHtml = null;
      draft.status = "draft";
      draft.generationSource = "ai";
      const saved = await draftModel.create(draft);

      const result = await materializeRevision2(draftModel, {
        draftId: saved.id,
        actor: "ai",
        subject: "Re: Fallback",
        bodyText: "Fallback body.",
        bodyHtml: null,
        senderAddress: "owner@svc.com",
        recipientAddress: "prospect@example.com",
        emailServiceId: 7,
        originalMessageId: 301,
        dbpath: v2dbpath,
      });

      // Null smtpUsername resolves to the From address (AD-002 fallback).
      expect(result.smtpUsername).toBe("owner@svc.com");
    });

    it("fails closed when the email service identity cannot be resolved", async () => {
      // The resolver is fail-closed: it walks ONLY the explicitly named
      // service ids (preferred first, then candidates) and returns null when
      // none resolve — it does NOT scan all active services. Point the
      // revision at a nonexistent service id (404); with no named candidate
      // resolving, resolveOutboundIdentity returns null.
      const serviceModel = new EmailServiceModel(v2dbpath);
      await serviceModel.updateServiceStatus(7, 0);

      const draftModel = new EmailReplyDraftModel(v2dbpath);
      const draft = new EmailReplyDraftEntity();
      draft.messageId = 302;
      draft.emailServiceId = 404;
      draft.subject = "Re: Missing service";
      draft.bodyText = "Body.";
      draft.bodyHtml = null;
      draft.status = "draft";
      draft.generationSource = "ai";
      const saved = await draftModel.create(draft);

      await expect(
        materializeRevision2(draftModel, {
          draftId: saved.id,
          actor: "ai",
          subject: "Re: Missing service",
          bodyText: "Body.",
          bodyHtml: null,
          senderAddress: "owner@svc.com",
          recipientAddress: "prospect@example.com",
          emailServiceId: 404,
          originalMessageId: 302,
          dbpath: v2dbpath,
        })
      ).rejects.toThrow(/unable to resolve email service identity/);
    });
  });
});
