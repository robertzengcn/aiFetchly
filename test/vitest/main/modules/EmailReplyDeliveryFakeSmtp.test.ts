import { describe, it, expect } from "vitest";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import { EmailReplyDeliveryService } from "@/service/emailReply/EmailReplyDeliveryService";
import { materializeRevision1 } from "@/service/emailReply/EmailReplyRevisionMaterializer";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import type { EmailSendResult } from "@/entityTypes/emailmarketingType";

/**
 * P0.6: drive the delivery state machine through a fake SMTP transport to prove
 * the submitted/sent/failed/delivery_unknown transitions and at-most-once
 * submission. The mailbox + SMTP sender are injected, so no live/encrypted
 * EmailService row is needed; the rest of the aggregate is seeded through the
 * same Token-fallback DB the service reads from.
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
};

async function seedValidApproval(): Promise<{ draftId: number; token: string }> {
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

  await materializeRevision1(draftModule, {
    draftId: savedDraft.id,
    actor: "ai",
    subject: "Re: Pricing",
    bodyText: CLEAN_BODY,
    bodyHtml: null,
    senderAddress: "owner@svc.com",
    recipientAddress: "prospect@example.com",
    emailServiceId: FAKE_MAILBOX.id,
    originalMessageId: savedMsg.id,
  });

  const approval = await new EmailReplyApprovalService().approveDraft({
    draftId: savedDraft.id,
    approvedByType: "user",
  });
  return { draftId: savedDraft.id, token: approval.token };
}

type Behavior = "accept" | "reject" | "disconnect";

function buildDelivery(behavior: Behavior): EmailReplyDeliveryService {
  let calls = 0;
  const senderFactory = () => ({
    sendReplyEmail: async (): Promise<EmailSendResult> => {
      calls += 1;
      if (behavior === "accept") {
        return {
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: `<prov-${calls}@x>`,
        };
      }
      if (behavior === "reject") {
        return {
          receiver: "prospect@example.com",
          status: false,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: "Recipient address rejected: User unknown",
        };
      }
      throw new Error("socket disconnected after possible acceptance");
    },
  });
  return new EmailReplyDeliveryService({
    senderFactory: senderFactory as never,
    serviceLoader: async () => FAKE_MAILBOX,
  });
}

describe("P0.6 — delivery state machine via fake SMTP", () => {
  it("accepted -> sent (with provider message id)", async () => {
    const { draftId, token } = await seedValidApproval();
    const outcome = await buildDelivery("accept").sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(outcome.status).toBe("sent");
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("sent");
  });

  it("definite rejection -> failed", async () => {
    const { draftId, token } = await seedValidApproval();
    const outcome = await buildDelivery("reject").sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(outcome.status).toBe("failed");
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("failed");
  });

  it("disconnect after possible acceptance -> delivery_unknown (terminal)", async () => {
    const { draftId, token } = await seedValidApproval();
    const outcome = await buildDelivery("disconnect").sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(outcome.status).toBe("delivery_unknown");
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("delivery_unknown");
  });

  it("two concurrent deliveries for the same approval invoke SMTP at most once", async () => {
    const { draftId, token } = await seedValidApproval();
    let calls = 0;
    const delivery = new EmailReplyDeliveryService({
      senderFactory: (() => ({
        sendReplyEmail: async () => {
          calls += 1;
          return {
            receiver: "prospect@example.com",
            status: true,
            title: "Re: Pricing",
            content: CLEAN_BODY,
            info: `<prov-${calls}@x>`,
          };
        },
      })) as never,
      serviceLoader: async () => FAKE_MAILBOX,
    });
    const [a, b] = await Promise.all([
      delivery.sendApprovedReply({ draftId, approvalToken: token }),
      delivery.sendApprovedReply({ draftId, approvalToken: token }),
    ]);
    const sent = [a, b].filter((o) => o.status === "sent").length;
    const already = [a, b].filter((o) => o.status === "already_processed").length;
    expect(sent + already).toBe(2);
    expect(calls).toBeLessThanOrEqual(1);
  });
});
