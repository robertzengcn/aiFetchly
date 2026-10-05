import { describe, it, expect } from "vitest";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import { EmailReplyDeliveryService } from "@/service/emailReply/EmailReplyDeliveryService";
import { materializeRevision2 } from "@/service/emailReply/EmailReplyRevisionMaterializer";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailServiceModel } from "@/model/EmailService.model";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import type { EmailSendResult } from "@/entityTypes/emailmarketingType";

/**
 * v2 reply-identity coverage for the approval + delivery path (§18.1/§18.2).
 *
 * materializeRevision2 freezes the resolved service identity (smtpUsername +
 * replyToAddress) onto the revision and hashes the v2 envelope. approveDraft
 * re-resolves the CURRENT service identity and hashes with that — so the two
 * agree only when the service row is unchanged between materialization and
 * approval. sendApprovedReply recomputes the hash from the FROZEN revision
 * values and runs the §18.2 identity comparison against the live service.
 *
 * These tests use the no-arg module constructors (shared aifetchly-test DB),
 * matching the EmailReplyDeliveryFakeSmtp pattern. Each test re-seeds service 7
 * idempotently (explicit-id upsert) so it never depends on prior file state.
 */
const CLEAN_BODY =
  "Thanks for reaching out. Could you share a little more detail about what you need?";

const FAKE_MAILBOX = {
  id: 7,
  from: "owner@svc.com",
  status: 1,
  password: "pw",
  host: "smtp.example.com",
  port: "587",
  name: "Owner",
  ssl: 1,
  // No smtpUsername / replyTo: §18.2 falls back to `from` / null, matching the
  // frozen identity of a service seeded with smtpUsername=null, replyTo=null.
};

async function seedService7(): Promise<void> {
  // Explicit id → repository.save upserts, so this is idempotent across tests.
  const model = new EmailServiceModel("");
  const entity = new EmailServiceEntity();
  entity.id = 7;
  entity.name = "Primary";
  entity.from = "owner@svc.com";
  entity.smtpUsername = null;
  entity.replyTo = null;
  entity.password = "pass";
  entity.host = "smtp.svc.com";
  entity.port = "465";
  entity.ssl = 1;
  entity.status = 1;
  await model.create(entity);
}

async function seedMessageAndDraft(): Promise<{
  draftId: number;
  messageId: number;
}> {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();

  const msg = new EmailReceivedMessageEntity();
  msg.emailServiceId = FAKE_MAILBOX.id;
  msg.providerUid = `pu-${Math.random()}`;
  msg.messageId = `<m-${Math.random()}@x>`;
  msg.threadKey = msg.messageId;
  msg.fromAddress = "prospect@example.com";
  msg.fromName = "Prospect";
  msg.replyToAddress = null;
  msg.toAddressesJson = JSON.stringify(["owner@svc.com"]);
  msg.ccAddressesJson = null;
  msg.subject = "Pricing";
  msg.bodyText = "Hi";
  msg.bodyHtmlSanitized = null;
  msg.snippet = null;
  msg.receivedAt = new Date();
  msg.isUnread = 1;
  msg.classification = null;
  msg.classificationConfidence = null;
  msg.replyStatus = "not_started";
  msg.processedAt = null;
  const savedMsg = await messageModule.upsertByProviderUid(msg);

  const draft = new EmailReplyDraftEntity();
  draft.messageId = savedMsg.id;
  draft.emailServiceId = FAKE_MAILBOX.id;
  draft.subject = "Re: Pricing";
  draft.bodyText = CLEAN_BODY;
  draft.bodyHtml = null;
  draft.status = "draft";
  draft.generationSource = "ai";
  const savedDraft = await draftModule.create(draft);

  return { draftId: savedDraft.id, messageId: savedMsg.id };
}

function buildAcceptDelivery(): EmailReplyDeliveryService {
  let calls = 0;
  const senderFactory = () => ({
    sendReplyEmail: async (): Promise<EmailSendResult> => {
      calls += 1;
      return {
        receiver: "prospect@example.com",
        status: true,
        title: "Re: Pricing",
        content: CLEAN_BODY,
        info: `<prov-${calls}@x>`,
      };
    },
  });
  return new EmailReplyDeliveryService({
    senderFactory: senderFactory as never,
    serviceLoader: async () => FAKE_MAILBOX,
  });
}

describe("v2 reply identity — materialize + approve + deliver (hash recompute)", () => {
  it("approves and delivers a v2 revision whose frozen identity matches the live service", async () => {
    // Constructing a no-arg module bootstraps the aifetchly-test singleton
    // (BaseModule resolves the fallback dir). Do not call SqliteDb.getInstance
    // with "" — it throws on empty paths.
    const draftModule = new EmailReplyDraftModule();
    await draftModule.ensureConnection();
    await seedService7();

    const { draftId, messageId } = await seedMessageAndDraft();

    // materializeRevision2 resolves identity from service 7 (smtpUsername=null
    // → from fallback → "owner@svc.com"; replyTo null) and freezes it.
    const materialized = await materializeRevision2(
      new EmailReplyDraftModule(),
      {
        draftId,
        actor: "ai",
        subject: "Re: Pricing",
        bodyText: CLEAN_BODY,
        bodyHtml: null,
        senderAddress: "owner@svc.com",
        recipientAddress: "prospect@example.com",
        emailServiceId: FAKE_MAILBOX.id,
        originalMessageId: messageId,
      }
    );
    expect(materialized.smtpUsername).toBe("owner@svc.com");
    expect(materialized.replyToAddress).toBeNull();

    // approveDraft re-resolves the CURRENT service 7 identity (unchanged → same
    // identity → hash agrees → approval succeeds).
    const approval = await new EmailReplyApprovalService().approveDraft({
      draftId,
      approvedByType: "user",
    });

    // sendApprovedReply recomputes the hash from FROZEN revision values and
    // runs §18.2: FAKE_MAILBOX (no smtpUsername/replyTo → effective
    // from="owner@svc.com", replyTo null) matches the frozen identity → sent.
    const outcome = await buildAcceptDelivery().sendApprovedReply({
      draftId,
      approvalToken: approval.token,
    });
    expect(outcome.status).toBe("sent");
  });
});

describe("v2 reply identity — approveDraft fails closed when the service is deleted after materialization", () => {
  it("rejects approval with unable to resolve email service identity for v2 revision", async () => {
    const draftModule = new EmailReplyDraftModule();
    await draftModule.ensureConnection();
    await seedService7();

    const { draftId, messageId } = await seedMessageAndDraft();

    // materializeRevision2 succeeds because service 7 still exists.
    await materializeRevision2(new EmailReplyDraftModule(), {
      draftId,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText: CLEAN_BODY,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId: FAKE_MAILBOX.id,
      originalMessageId: messageId,
    });

    // Delete service 7 after materialization. readIdentity does NOT check
    // status, so deactivation alone is insufficient — the row must be gone.
    await new EmailServiceModel("").delete(FAKE_MAILBOX.id);

    // approveDraft's v2 branch re-resolves the current service identity; with
    // the row gone, resolveOutboundIdentity returns null and approval throws.
    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(
      /unable to resolve email service identity for v2 revision/
    );

    // Restore service 7 so later tests/files sharing the DB find it.
    await seedService7();
  });
});
