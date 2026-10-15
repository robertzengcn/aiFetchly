import { describe, it, expect, vi } from "vitest";
import {
  buildAutoReplyAuditMirrorRow,
} from "@/service/emailReply/EmailReplyAuditMirror";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailAutoReplyAuditLogModule } from "@/modules/EmailAutoReplyAuditLogModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDeliveryService } from "@/service/emailReply/EmailReplyDeliveryService";
import { EmailReplyDetectionService } from "@/service/emailReceive/EmailReplyDetectionService";
import { SendPolicyRejection } from "@/service/emailReply/EmailReplySendBinding";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { materializeRevision1 } from "@/service/emailReply/EmailReplyRevisionMaterializer";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import type { EmailSendResult } from "@/entityTypes/emailmarketingType";
import type { ReplyDetectionResult } from "@/service/emailReceive/EmailReplyDetectionTypes";
import type { EmailReplyAuditAction } from "@/entityTypes/emailReceiveTypes";
import { drainCountersForTest } from "@/service/emailReply/EmailReplyMetrics";

/**
 * G03-1c adversarial regressions: decision-relevant reply-audit events
 * (refusals, send failures, delivery-unknown, sends) MUST land in the
 * auto-reply audit table the UI reads, with the same reason + metadataJson
 * (stage/code intact); lifecycle bookkeeping MUST NOT mirror; mirror
 * persistence failure MUST stop the work with the same fail-stop telemetry.
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

const NOT_REPLIED_DETECTION: ReplyDetectionResult = {
  state: "not_replied",
  replied: false,
  source: "sent_search",
  matchedMessageId: null,
  reasonCode: "no_reply_observed",
  checkedAt: new Date().toISOString(),
  fromCache: false,
  coverage: "configured_imap",
};

function detectionFactory(
  result: ReplyDetectionResult = NOT_REPLIED_DETECTION
): () => EmailReplyDetectionService {
  return () => {
    const svc = new EmailReplyDetectionService();
    vi.spyOn(svc, "detect").mockImplementation(async (input) => {
      if (result.state === "not_replied") {
        await new EmailReceivedMessageModule().updateReplyEvidence({
          id: input.messageId,
          replyNegativeCheckAt: new Date(),
          replyNegativeContextHash: "test-context-hash",
          isAnswered: 0,
          answeredFlagCheckedAt: new Date(),
        });
      }
      return result;
    });
    return svc;
  };
}

async function seedValidApproval(): Promise<{
  draftId: number;
  token: string;
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
  return {
    draftId: savedDraft.id,
    token: approval.token,
    messageId: savedMsg.id,
  };
}

async function autoAuditRowsFor(messageId: number) {
  const module = new EmailAutoReplyAuditLogModule();
  const { records } = await module.list({
    emailServiceId: FAKE_MAILBOX.id,
    page: 0,
    size: 50,
  });
  return records.filter((r) => r.messageId === messageId);
}

function replyAuditRow(action: EmailReplyAuditAction): EmailReplyAuditLogEntity {
  const log = new EmailReplyAuditLogEntity();
  log.emailServiceId = 7;
  log.messageId = 42;
  log.draftId = null;
  log.action = action;
  log.actor = "system";
  log.reason = `[probe_timeout] detection probe timed out`;
  log.metadataJson = JSON.stringify({
    correlationId: "req-1",
    messageCorrelationId: "msg-42",
    stage: "pre_send",
    code: "probe_timeout",
  });
  return log;
}

describe("buildAutoReplyAuditMirrorRow — pure mapping", () => {
  it("maps decision actions to the UI action/decisionStatus pairs", () => {
    const cases: Array<{
      action: EmailReplyAuditAction;
      action2: string;
      status: string;
    }> = [
      { action: "reply_skipped", action2: "auto_reply_skipped", status: "skipped" },
      { action: "auto_reply_blocked", action2: "auto_reply_blocked", status: "blocked" },
      { action: "send_failed", action2: "auto_reply_failed", status: "failed" },
      // N09: ambiguous delivery is NOT a confirmed failure — surfaces as
      // needs-human-review, never failed. A no-op reconciliation must not
      // imply retry eligibility.
      { action: "delivery_unknown", action2: "auto_reply_skipped", status: "needs_human_review" },
      { action: "reconciliation_noted", action2: "auto_reply_skipped", status: "needs_human_review" },
      { action: "reply_sent", action2: "auto_reply_sent", status: "auto_sent" },
    ];
    for (const c of cases) {
      const row = buildAutoReplyAuditMirrorRow({
        ...replyAuditRow(c.action),
      });
      expect(row, `action ${c.action} should mirror`).not.toBeNull();
      expect(row?.action).toBe(c.action2);
      expect(row?.decisionStatus).toBe(c.status);
      expect(row?.emailServiceId).toBe(7);
      expect(row?.messageId).toBe(42);
      expect(row?.requiresUserApproval).toBe(1);
      expect(row?.approvedByUser).toBe(0);
      // Same reason + same metadataJson — the UI's structured stage/code
      // extraction reads the mirror copy, never parsed reason prose.
      expect(row?.reason).toBe(replyAuditRow(c.action).reason);
      expect(row?.metadataJson).toBe(replyAuditRow(c.action).metadataJson);
    }
  });

  it("returns null for lifecycle bookkeeping actions", () => {
    const lifecycle: EmailReplyAuditAction[] = [
      "message_fetched",
      "message_read_by_ai",
      "knowledge_retrieved",
      "classified",
      "draft_created",
      "draft_edited",
      "send_claimed",
      "draft_reopened",
    ];
    for (const action of lifecycle) {
      expect(
        buildAutoReplyAuditMirrorRow({ ...replyAuditRow(action) }),
        `action ${action} must NOT mirror`
      ).toBeNull();
    }
  });

  it("returns null when the reply-audit row has no messageId (no UI identity)", () => {
    const log = replyAuditRow("reply_skipped");
    log.messageId = null;
    expect(buildAutoReplyAuditMirrorRow({ ...log })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: the delivery service's pre_send refusal (production writer via
// writeDetectionRefusalAudit) mirrors into the auto-reply audit table with
// stage + code intact.
// ---------------------------------------------------------------------------
describe("delivery refusal audits mirror into the auto-reply audit UI table (G03-1c)", () => {
  it("a pre_send already_replied refusal lands in the auto-reply table with mapped status + metadata", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    await new EmailReceivedMessageModule().updateReplyStatus(
      messageId,
      "sent",
      new Date()
    );
    const delivery = new EmailReplyDeliveryService({
      senderFactory: (() => ({
        sendReplyEmail: async (): Promise<EmailSendResult> => {
          throw new Error("SMTP must not be reached on a refusal");
        },
      })) as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory: detectionFactory(),
    });
    await expect(
      delivery.sendApprovedReply({ draftId, approvalToken: token })
    ).rejects.toBeInstanceOf(SendPolicyRejection);

    const rows = await autoAuditRowsFor(messageId);
    const refusalRows = rows.filter((r) => r.decisionStatus === "skipped");
    expect(refusalRows).toHaveLength(1);
    expect(refusalRows[0].action).toBe("auto_reply_skipped");
    expect(refusalRows[0].reason).toContain("[already_replied]");
    const meta = JSON.parse(refusalRows[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
    };
    expect(meta.stage).toBe("pre_send");
    expect(meta.code).toBe("already_replied");
    expect(refusalRows[0].requiresUserApproval).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration: send outcomes (finalizeSendOutcome inside runReplyTxn) mirror
// into the auto-reply audit table in the SAME transaction as the pipeline row.
// ---------------------------------------------------------------------------
describe("send outcome audits mirror into the auto-reply audit UI table (G03-1c)", () => {
  it("an accepted send lands auto_reply_sent/auto_sent with the provider message id metadata", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    const delivery = new EmailReplyDeliveryService({
      senderFactory: (() => ({
        sendReplyEmail: async (): Promise<EmailSendResult> => ({
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: "<prov-mirror-1@x>",
        }),
      })) as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory: detectionFactory(),
    });
    const outcome = await delivery.sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(outcome.status).toBe("sent");

    const rows = await autoAuditRowsFor(messageId);
    const sentRows = rows.filter((r) => r.decisionStatus === "auto_sent");
    expect(sentRows).toHaveLength(1);
    expect(sentRows[0].action).toBe("auto_reply_sent");
    expect(sentRows[0].reason).toBe("SMTP accepted reply");
    const meta = JSON.parse(sentRows[0].metadataJson ?? "{}") as {
      providerMessageId?: string;
      attemptId?: number;
    };
    expect(meta.providerMessageId).toBe("<prov-mirror-1@x>");
    expect(meta.attemptId).toBeGreaterThan(0);
  });

  it("a rejected send lands auto_reply_failed/failed with the sanitized error", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    const delivery = new EmailReplyDeliveryService({
      senderFactory: (() => ({
        sendReplyEmail: async (): Promise<EmailSendResult> => ({
          receiver: "prospect@example.com",
          status: false,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: "Recipient address rejected: User unknown",
        }),
      })) as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory: detectionFactory(),
    });
    const outcome = await delivery.sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(outcome.status).toBe("failed");

    const rows = await autoAuditRowsFor(messageId);
    const failedRows = rows.filter((r) => r.decisionStatus === "failed");
    expect(failedRows).toHaveLength(1);
    expect(failedRows[0].action).toBe("auto_reply_failed");
    expect(failedRows[0].reason).toContain("Recipient address rejected");
  });
});

// ---------------------------------------------------------------------------
// Adversarial: mirror persistence failure must STOP the refusal with the same
// fail-stop telemetry (audit_failure{stage=pre_send}) — an unmirrored refusal
// is as unacceptable as an unwritten one (the UI would show nothing while the
// pipeline log claims otherwise).
// ---------------------------------------------------------------------------
describe("mirror persistence failure is fail-stop (G03-1c)", () => {
  it("a failing auto-audit module stops a pre_send detection refusal with audit_failure telemetry", async () => {
    const { draftId, token } = await seedValidApproval();
    void draftId;
    const failingAutoModule = new EmailAutoReplyAuditLogModule();
    vi.spyOn(failingAutoModule, "create").mockImplementation(async () => {
      throw new Error("auto-reply audit mirror DB write failed (simulated)");
    });
    // Detection returns `replied` so the flow reaches writeDetectionRefusalAudit:
    // the PRIMARY reply-audit write succeeds, then the MIRROR write fails. The
    // wrapped catch must surface the persistence failure (fail-stop) with the
    // audit_failure{stage=pre_send} metric — the mirror is not best-effort.
    const replied: ReplyDetectionResult = {
      state: "replied",
      replied: true,
      source: "sent_search",
      matchedMessageId: "<prov-reply@x>",
      reasonCode: "already_replied",
      checkedAt: new Date().toISOString(),
      fromCache: false,
      coverage: "configured_imap",
    };
    const delivery = new EmailReplyDeliveryService({
      senderFactory: (() => ({
        sendReplyEmail: async (): Promise<EmailSendResult> => {
          throw new Error("SMTP must not be reached on a refusal");
        },
      })) as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory: detectionFactory(replied),
      autoAuditModuleFactory: () => failingAutoModule,
    });
    drainCountersForTest();
    await expect(
      delivery.sendApprovedReply({ draftId, approvalToken: token })
    ).rejects.toThrow(/detection audit persistence failed/);
    expect(drainCountersForTest().get("audit_failure{stage=pre_send}")).toBe(1);
  });
});
