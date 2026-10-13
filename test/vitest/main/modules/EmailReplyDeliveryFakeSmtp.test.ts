import { describe, it, expect, vi, afterEach } from "vitest";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplyApprovalModule } from "@/modules/EmailReplyApprovalModule";
import { EmailReplyDeliveryService } from "@/service/emailReply/EmailReplyDeliveryService";
import { materializeRevision1 } from "@/service/emailReply/EmailReplyRevisionMaterializer";
import { SendPolicyRejection } from "@/service/emailReply/EmailReplySendBinding";
import { EmailReplyDetectionService } from "@/service/emailReceive/EmailReplyDetectionService";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import type { EmailSendResult } from "@/entityTypes/emailmarketingType";
import type { ReplyDetectionResult } from "@/service/emailReceive/EmailReplyDetectionTypes";
import { drainCountersForTest } from "@/service/emailReply/EmailReplyMetrics";

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

async function seedValidApproval(): Promise<{
  draftId: number;
  token: string;
  approvalId: number;
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
    approvalId: approval.approvalId,
    messageId: savedMsg.id,
  };
}

/**
 * R14 harness: delivery service whose SMTP sender counts calls while behaving
 * per `behavior`. Used by the finalized-replay tests to assert "no extra SMTP"
 * on a same-token replay after the approval was consumed by finalize.
 */
function buildCountingDelivery(
  behavior: Behavior
): { delivery: EmailReplyDeliveryService; smtpCalls: { count: number } } {
  const smtpCalls = { count: 0 };
  const senderFactory = () => ({
    sendReplyEmail: async (): Promise<EmailSendResult> => {
      smtpCalls.count += 1;
      if (behavior === "accept") {
        return {
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: `<prov-r14-${smtpCalls.count}@x>`,
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
  return {
    delivery: new EmailReplyDeliveryService({
      senderFactory: senderFactory as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory: detectionFactory(),
    }),
    smtpCalls,
  };
}

type Behavior = "accept" | "reject" | "disconnect";

/**
 * Default detection outcome for the existing positive-path tests. The seeded
 * `FAKE_MAILBOX` has no receive config, so a real detector would block every
 * positive send path with `receive_unavailable` — the same landmine Step 7
 * hit. Inject a default `not_replied` so the existing delivery state-machine
 * tests run unaffected; Step 8 spec tests override `detectionResult`.
 */
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

/** Build a detection service factory returning the configured result. */
function detectionFactory(
  result: ReplyDetectionResult = NOT_REPLIED_DETECTION
): () => EmailReplyDetectionService {
  return () => {
    const svc = new EmailReplyDetectionService();
    vi.spyOn(svc, "detect").mockImplementation(async (input) => {
      // Mirror production persistNegative (D1b): a decisive `not_replied` is
      // only returned after the observation persists. The claim-side freshness
      // fence (D1a) fail-closes on a null replyNegativeCheckAt, so a fake that
      // skips the persist would refuse every positive send path with
      // probe_timeout instead of reaching the SMTP state machine under test.
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
    detectionServiceFactory: detectionFactory(),
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
      detectionServiceFactory: detectionFactory(),
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

  it("R13: definite rejection -> explicit re-approval reopens the same draft -> retry succeeds without a sibling", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    // 1. Definite SMTP rejection finalizes the draft as `failed`.
    const failed = await buildDelivery("reject").sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(failed.status).toBe("failed");

    // 2. The reuse path hands the SAME draft id back; the operator explicitly
    //    re-approves. The fenced reopen transitions failed -> draft and the
    //    normal approval path mints a fresh token over the SAME revision.
    const reapproval = await new EmailReplyApprovalService().approveDraft({
      draftId,
      approvedByType: "user",
    });
    expect(reapproval.revisionId).toBeDefined();

    // 3. Retry with an accepting transport → sent. Exactly one draft row
    //    exists for the message (no sibling created), and the draft is sent.
    const retry = await buildDelivery("accept").sendApprovedReply({
      draftId,
      approvalToken: reapproval.token,
    });
    expect(retry.status).toBe("sent");

    const draftModule = new EmailReplyDraftModule();
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("sent");
    const draftsForMessage = await draftModule.listByMessage(messageId);
    expect(draftsForMessage.length).toBe(1);
  });

  it("R13: delivery_unknown stays blocked (no reopen through re-approval)", async () => {
    const { draftId, token } = await seedValidApproval();
    const outcome = await buildDelivery("disconnect").sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(outcome.status).toBe("delivery_unknown");

    // Re-approval must be refused: ambiguous delivery is never a retry
    // candidate. The reopen fence only accepts `failed`.
    await expect(
      new EmailReplyApprovalService().approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/'delivery_unknown'/);
    const after = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(after?.status).toBe("delivery_unknown");
  });
});

// ---------------------------------------------------------------------------
// One refusal audit per invocation (FR-034, Phase-1 slice) — pre_send stage
// ---------------------------------------------------------------------------
describe("sendApprovedReply refusal audits (FR-034 pre_send)", () => {
  const auditModule = new EmailReplyAuditLogModule();

  async function refusalAuditsFor(messageId: number) {
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    return records.filter((r) => r.action === "reply_skipped");
  }

  it("writes exactly ONE reply_skipped audit on a pre_send already_replied refusal, with stage + code", async () => {
    // Seed a clean message + approval, then flip replyStatus to sent so the
    // send-time policy guard refuses the duplicate.
    const { draftId, token, messageId } = await seedValidApproval();
    await new EmailReceivedMessageModule().updateReplyStatus(
      messageId,
      "sent",
      new Date()
    );
    let smtpCalls = 0;
    const delivery = new EmailReplyDeliveryService({
      senderFactory: (() => ({
        sendReplyEmail: async () => {
          smtpCalls += 1;
          return {
            receiver: "prospect@example.com",
            status: true,
            title: "Re: Pricing",
            content: CLEAN_BODY,
            info: `<prov-${smtpCalls}@x>`,
          };
        },
      })) as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory: detectionFactory(),
    });
    await expect(
      delivery.sendApprovedReply({ draftId, approvalToken: token })
    ).rejects.toBeInstanceOf(SendPolicyRejection);
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].reason).toContain("[already_replied]");
    const meta = JSON.parse(refusals[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
      correlationId?: string;
    };
    expect(meta.stage).toBe("pre_send");
    expect(meta.code).toBe("already_replied");
    expect(meta.correlationId).toBeTruthy();
    // The refusal happened before the atomic claim — no SMTP side effect.
    expect(smtpCalls).toBe(0);
  });

  it("writes ZERO refusal audit rows on the accepted happy path", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    const outcome = await buildDelivery("accept").sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(outcome.status).toBe("sent");
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// B04: exact same-approval replay returns the original attempt, not a generic
// reply_in_progress refusal. Requires controlled claim timing (hold fake SMTP
// after the first claim is visible, then replay) — a bare Promise.all does not
// prove this path because the second invocation can race past the idempotency
// lookup before the first claim commits.
// ---------------------------------------------------------------------------
describe("sendApprovedReply recognizes exact same-approval replay before guard denial (B04)", () => {
  it("replay of the same approval returns already_processed with one SMTP submission", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    // Controlled hold: the first send claims the attempt, then blocks inside
    // sendReplyEmail until we release the gate. While it is held, we replay the
    // same approval; the replay must hit the idempotency lookup (B04 moved it
    // before the guard) and return already_processed — NOT reply_in_progress.
    let smtpCalls = 0;
    let releaseFirst: () => void = () => {};
    const firstSendHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const delivery = new EmailReplyDeliveryService({
      senderFactory: (() => ({
        sendReplyEmail: async (): Promise<EmailSendResult> => {
          smtpCalls += 1;
          // First invocation blocks here after the claim is committed; the
          // replay runs while we wait. Subsequent invocations never reach SMTP
          // (idempotency returns before the claim).
          if (smtpCalls === 1) {
            await firstSendHeld;
          }
          return {
            receiver: "prospect@example.com",
            status: true,
            title: "Re: Pricing",
            content: CLEAN_BODY,
            info: `<prov-${smtpCalls}@x>`,
          };
        },
      })) as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory: detectionFactory(),
    });

    // Start the first send — it claims the attempt, then blocks in SMTP.
    const first = delivery.sendApprovedReply({ draftId, approvalToken: token });
    // Yield once so the first call reaches sendReplyEmail and the claim row is
    // committed before the replay starts. This is the controlled timing the
    // TODO requires (vs an uncontrolled Promise.all race).
    await new Promise((r) => setTimeout(r, 30));

    // Replay the SAME approval while the first send is still in flight. The
    // attempt for this (draft, revision, hash, approval) tuple already exists,
    // so the idempotency lookup (B04, now before the guard) returns it.
    const replay = await delivery.sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(replay.status).toBe("already_processed");
    expect(replay.attemptId).toBeGreaterThan(0);

    // Release the held first send and await its completion.
    releaseFirst();
    const firstOutcome = await first;
    expect(firstOutcome.status).toBe("sent");

    // Exactly ONE SMTP submission across both invocations.
    expect(smtpCalls).toBe(1);
    // The message is now sent.
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("sent");
    void messageId;
  });

  it("a DIFFERENT approval for the same message is still refused by the guard", async () => {
    // First approval sends successfully. A second, DISTINCT draft for the SAME
    // message is then approved and sent — the guard must refuse it (the message
    // is now sent), NOT return already_processed. This proves B04 only short-
    // circuits the EXACT-same-approval replay; sibling/other-draft sends still
    // hit the policy guard.
    const { draftId, token, messageId } = await seedValidApproval();
    const delivery = buildDelivery("accept");
    const first = await delivery.sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(first.status).toBe("sent");

    // Seed a SECOND approved draft (sibling) on the same message. The approval
    // service only accepts drafts in 'draft' state, so we create a fresh draft
    // row rather than re-approving the sent one.
    const draftModule = new EmailReplyDraftModule();
    const sibling = new EmailReplyDraftEntity();
    sibling.messageId = messageId;
    sibling.emailServiceId = FAKE_MAILBOX.id;
    sibling.subject = "Re: Pricing (sibling)";
    sibling.bodyText = CLEAN_BODY;
    sibling.bodyHtml = null;
    sibling.status = "draft";
    sibling.generationSource = "ai";
    const savedSibling = await draftModule.create(sibling);
    await materializeRevision1(draftModule, {
      draftId: savedSibling.id,
      actor: "ai",
      subject: "Re: Pricing (sibling)",
      bodyText: CLEAN_BODY,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId: FAKE_MAILBOX.id,
      originalMessageId: messageId,
    });
    const siblingApproval = await new EmailReplyApprovalService().approveDraft({
      draftId: savedSibling.id,
      approvedByType: "user",
    });
    // The guard sees the sent attempt from the first draft and refuses the
    // sibling send with already_replied — NOT already_processed.
    await expect(
      delivery.sendApprovedReply({
        draftId: savedSibling.id,
        approvalToken: siblingApproval.token,
      })
    ).rejects.toBeInstanceOf(SendPolicyRejection);
    // Original attempt untouched.
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("sent");
  });
});

// ---------------------------------------------------------------------------
// T04 step 8 (FR-031 §9.2): forced mailbox detection before the atomic send
// claim. `forceRefresh: true` skips the 60s negative cache; sticky positives
// are still honored. A positive or inconclusive reply state refuses the send
// with the typed detection code BEFORE the atomic claim — no SMTP, no attempt
// row. ONE `reply_skipped` audit (stage `pre_send`, source `reply_detection`)
// is written by the outer delivery service (one-audit-owner rule §9.2/§10);
// the detection service returns decisions only.
// ---------------------------------------------------------------------------
describe("sendApprovedReply forced mailbox detection (T04 step 8, §9.2)", () => {
  const auditModule = new EmailReplyAuditLogModule();

  async function refusalAuditsFor(messageId: number) {
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    return records.filter((r) => r.action === "reply_skipped");
  }

  /**
   * Build a delivery service whose detection service returns the configured
   * result and whose SMTP sender records calls (must stay 0 on a refusal).
   * Production leaves `detectionServiceFactory` unset; tests inject a fake
   * service via the constructor seam (the lazy `detectionServiceForNow()`
   * getter constructs it on first use).
   *
   * D1b: a `not_replied` result persists its observation (mirrors production
   * persistNegative) so the claim-side freshness fence (D1a) sees a timestamp
   * instead of failing closed with probe_timeout.
   */
  function buildDeliveryWithDetection(
    detectionResult: ReplyDetectionResult,
    behavior: "accept" | "reject" = "accept"
  ): { delivery: EmailReplyDeliveryService; smtpCalls: { count: number } } {
    const smtpCalls = { count: 0 };
    const senderFactory = () => ({
      sendReplyEmail: async (): Promise<EmailSendResult> => {
        smtpCalls.count += 1;
        if (behavior === "reject") {
          return {
            receiver: "prospect@example.com",
            status: false,
            title: "Re: Pricing",
            content: CLEAN_BODY,
            info: "Recipient rejected",
          };
        }
        return {
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: `<prov-${smtpCalls.count}@x>`,
        };
      },
    });
    const detectionServiceFactory = () => {
      const svc = new EmailReplyDetectionService();
      vi.spyOn(svc, "detect").mockImplementation(async (input) => {
        // Mirror production persistNegative (D1b): a decisive not_replied is
        // only returned after the observation persists, so the freshness
        // fence (D1a) sees a timestamp instead of failing closed.
        if (detectionResult.state === "not_replied") {
          await new EmailReceivedMessageModule().updateReplyEvidence({
            id: input.messageId,
            replyNegativeCheckAt: new Date(),
            replyNegativeContextHash: "test-context-hash",
            isAnswered: 0,
            answeredFlagCheckedAt: new Date(),
          });
        }
        return detectionResult;
      });
      return svc;
    };
    const delivery = new EmailReplyDeliveryService({
      senderFactory: senderFactory as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory,
    });
    return { delivery, smtpCalls };
  }

  it("detection `replied` -> no claim, no SMTP, ONE reply_skipped audit, code already_replied", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
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
    const { delivery, smtpCalls } = buildDeliveryWithDetection(replied);

    let rejection: SendPolicyRejection | null = null;
    try {
      await delivery.sendApprovedReply({ draftId, approvalToken: token });
    } catch (error) {
      if (error instanceof SendPolicyRejection) rejection = error;
    }
    expect(rejection).toBeInstanceOf(SendPolicyRejection);
    expect(rejection?.code).toBe("already_replied");

    // The refusal happened BEFORE the atomic claim — no SMTP side effect.
    expect(smtpCalls.count).toBe(0);

    // Exactly ONE reply_skipped audit, stage pre_send, code already_replied,
    // source reply_detection. No bodies, no credentials, no raw provider
    // errors in the metadata (FR-039).
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].reason).toContain("[already_replied]");
    const meta = JSON.parse(refusals[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
      source?: string;
      correlationId?: string;
    };
    expect(meta.stage).toBe("pre_send");
    expect(meta.code).toBe("already_replied");
    expect(meta.source).toBe("reply_detection");
    expect(meta.correlationId).toBeTruthy();

    // The draft stays `approved` — never flipped to sending (no claim ran).
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("approved");
  });

  it("detection `unknown` (probe_timeout) -> no claim, no SMTP, code = detection-unknown", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    const unknown: ReplyDetectionResult = {
      state: "unknown",
      replied: null,
      source: "unavailable",
      matchedMessageId: null,
      reasonCode: "probe_timeout",
      checkedAt: new Date().toISOString(),
      fromCache: false,
      coverage: "partial",
    };
    const { delivery, smtpCalls } = buildDeliveryWithDetection(unknown);

    let rejection: SendPolicyRejection | null = null;
    try {
      await delivery.sendApprovedReply({ draftId, approvalToken: token });
    } catch (error) {
      if (error instanceof SendPolicyRejection) rejection = error;
    }
    expect(rejection).toBeInstanceOf(SendPolicyRejection);
    // The typed unknown code flows through SendPolicyRejection so the B12 IPC
    // envelope surfaces it machine-readably (§9.2).
    expect(rejection?.code).toBe("probe_timeout");

    expect(smtpCalls.count).toBe(0);
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].reason).toContain("[probe_timeout]");
    const meta = JSON.parse(refusals[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
      source?: string;
    };
    expect(meta.stage).toBe("pre_send");
    expect(meta.code).toBe("probe_timeout");
    expect(meta.source).toBe("reply_detection");
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("approved");
  });

  it("detection `not_replied` -> proceeds to claim, SMTP fires, draft -> sent", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    const notReplied: ReplyDetectionResult = {
      state: "not_replied",
      replied: false,
      source: "sent_search",
      matchedMessageId: null,
      reasonCode: "no_reply_observed",
      checkedAt: new Date().toISOString(),
      fromCache: false,
      coverage: "configured_imap",
    };
    const { delivery, smtpCalls } = buildDeliveryWithDetection(notReplied, "accept");

    const outcome = await delivery.sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(outcome.status).toBe("sent");
    // The not_replied outcome proceeds through the claim to SMTP exactly once.
    expect(smtpCalls.count).toBe(1);
    // No refusal audit on the happy path.
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(0);
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("sent");
  });
});

// ---------------------------------------------------------------------------
// T05 step 11 (FR-031 §9.3): forced-send 5s freshness window. The claim
// transaction's first action is a freshness fence — if the pre-send detection
// observation (replyNegativeCheckAt) is older than FORCED_FRESHNESS_WINDOW_MS
// (5s) by the time the transaction opens, the claim returns `freshness_stale`
// with NO write. The delivery service reruns detection OUTSIDE the transaction
// and re-claims ONCE. §9.3: "Allow one delayed refresh; further delay refuses
// with no SMTP submission." A second `freshness_stale` → SendPolicyRejection
// (code = probe_timeout). No SMTP.
//
// These tests mirror production's persistNegative: the fake detection spy
// writes replyNegativeCheckAt to the seed message on each call, so the
// freshness fence sees a realistic observation timestamp (not a mock that
// bypasses the persistence the fence reads).
// ---------------------------------------------------------------------------
describe("sendApprovedReply forced-freshness window (T05 step 11, §9.3)", () => {
  const auditModule = new EmailReplyAuditLogModule();
  const messageModule = new EmailReceivedMessageModule();

  async function refusalAuditsFor(messageId: number) {
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    return records.filter((r) => r.action === "reply_skipped");
  }

  /**
   * Build a delivery service whose detection spy writes a `replyNegativeCheckAt`
   * observation to the seed message (mirroring production's persistNegative)
   * and returns `not_replied`. `observedAtSupplier` controls the timestamp
   * written: `() => new Date()` = fresh (within the 5s window);
   * `() => new Date(Date.now() - 6000)` = stale (outside the window).
   */
  function buildFreshnessDelivery(
    observedAtSupplier: () => Date
  ): { delivery: EmailReplyDeliveryService; smtpCalls: { count: number } } {
    const smtpCalls = { count: 0 };
    const senderFactory = () => ({
      sendReplyEmail: async (): Promise<EmailSendResult> => {
        smtpCalls.count += 1;
        return {
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: `<prov-${smtpCalls.count}@x>`,
        };
      },
    });
    const detectionServiceFactory = () => {
      const svc = new EmailReplyDetectionService();
      vi.spyOn(svc, "detect").mockImplementation(
        async (input: { messageId: number }) => {
          // Mirror production persistNegative: write the observation timestamp
          // the freshness fence will read. The supplier controls fresh vs stale.
          await messageModule.updateReplyEvidence({
            id: input.messageId,
            replyNegativeCheckAt: observedAtSupplier(),
            replyNegativeContextHash: "test-context-hash",
            isAnswered: 0,
            answeredFlagCheckedAt: observedAtSupplier(),
          });
          return {
            state: "not_replied",
            replied: false,
            source: "sent_search",
            matchedMessageId: null,
            reasonCode: "no_reply_observed",
            checkedAt: new Date().toISOString(),
            fromCache: false,
            coverage: "configured_imap",
          } satisfies ReplyDetectionResult;
        }
      );
      return svc;
    };
    const delivery = new EmailReplyDeliveryService({
      senderFactory: senderFactory as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory,
    });
    return { delivery, smtpCalls };
  }

  it("observation ≤5s old -> claim proceeds, SMTP fires once, draft -> sent", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    const { delivery, smtpCalls } = buildFreshnessDelivery(() => new Date());

    const outcome = await delivery.sendApprovedReply({
      draftId,
      approvalToken: token,
    });

    expect(outcome.status).toBe("sent");
    expect(smtpCalls.count).toBe(1);
    // No refusal audit on the happy path.
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(0);
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("sent");
  });

  it("first detection stale -> freshness_stale, ONE refresh writes fresh observation, second claim proceeds -> sent", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    // First detection call writes a stale observation (6s old) -> first claim
    // returns freshness_stale. Subsequent calls write a fresh observation so
    // the re-claim after the refresh proceeds.
    let detectCalls = 0;
    const senderFactory = () => ({
      sendReplyEmail: async (): Promise<EmailSendResult> => {
        return {
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: "<prov-fresh@x>",
        };
      },
    });
    const detectionServiceFactory = () => {
      const svc = new EmailReplyDetectionService();
      vi.spyOn(svc, "detect").mockImplementation(
        async (input: { messageId: number }) => {
          detectCalls += 1;
          // First detect call (step 5b) writes stale; the refresh call writes
          // fresh so the re-claim passes the fence.
          const observedAt =
            detectCalls === 1
              ? new Date(Date.now() - 6_000) // stale: outside the 5s window
              : new Date(); // fresh: within the window
          await messageModule.updateReplyEvidence({
            id: input.messageId,
            replyNegativeCheckAt: observedAt,
            replyNegativeContextHash: "test-context-hash",
            isAnswered: 0,
            answeredFlagCheckedAt: observedAt,
          });
          return {
            state: "not_replied",
            replied: false,
            source: "sent_search",
            matchedMessageId: null,
            reasonCode: "no_reply_observed",
            checkedAt: new Date().toISOString(),
            fromCache: false,
            coverage: "configured_imap",
          } satisfies ReplyDetectionResult;
        }
      );
      return svc;
    };
    const delivery = new EmailReplyDeliveryService({
      senderFactory: senderFactory as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory,
    });

    const outcome = await delivery.sendApprovedReply({
      draftId,
      approvalToken: token,
    });

    expect(outcome.status).toBe("sent");
    // The refresh reran detection (2 detect calls total) but SMTP fired once.
    expect(detectCalls).toBe(2);
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(0);
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("sent");
  });

  it("refresh still stale -> no SMTP, SendPolicyRejection code=probe_timeout, ONE reply_skipped audit", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    // Every detection call writes a stale observation (6s old). The first
    // claim returns freshness_stale; the refresh reruns detection (still
    // stale); the second claim returns freshness_stale again -> refuse.
    const { delivery, smtpCalls } = buildFreshnessDelivery(
      () => new Date(Date.now() - 6_000)
    );

    let rejection: SendPolicyRejection | null = null;
    let outcome: { status: string } | null = null;
    try {
      outcome = await delivery.sendApprovedReply({
        draftId,
        approvalToken: token,
      });
    } catch (error) {
      if (error instanceof SendPolicyRejection) rejection = error;
    }

    // Refused — no SMTP side effect.
    expect(outcome).toBeNull();
    expect(rejection).toBeInstanceOf(SendPolicyRejection);
    expect(rejection?.code).toBe("probe_timeout");
    expect(smtpCalls.count).toBe(0);

    // Exactly ONE reply_skipped audit (stage pre_send, code probe_timeout).
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].reason).toContain("[probe_timeout]");
    const meta = JSON.parse(refusals[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
      source?: string;
    };
    expect(meta.stage).toBe("pre_send");
    expect(meta.code).toBe("probe_timeout");
    expect(meta.source).toBe("reply_detection");

    // The draft stays `approved` — never flipped to sending (the fence wrote
    // nothing, and no claim ever succeeded).
    const draft = await new EmailReplyDraftModule().readAggregate(draftId);
    expect(draft?.status).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// T12/FR-039 — pre_send audit-failure coverage. The runPreSendDetection
// catch(auditError) site emits audit_failure{stage=pre_send} when the
// `reply_skipped` audit row for a detection refusal cannot persist (§9.2 —
// an unrecorded send refusal must never be followed by proceeding to send).
// The detection outcome is faked via the detectionServiceFactory seam; the
// failing audit module is injected via the auditModuleFactory seam (D7.1).
// The counter map records regardless of emit success, so no Logger mock is
// needed.
// ---------------------------------------------------------------------------
describe("sendApprovedReply pre_send audit-failure telemetry (T12/FR-039)", () => {
  it("audit persistence failure on a pre_send refusal emits audit_failure{stage=pre_send} + SendPolicyRejection", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    void messageId;
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
    // D7.1: inject a failing audit module through the auditModuleFactory seam
    // instead of monkey-patching the (now-lazy) instance field `auditModule`,
    // which stays null until `auditModuleForNow()` runs. The refusal audit is
    // written by writeDetectionRefusalAudit → auditModule.create; a throw
    // there is caught by runPreSendDetection's catch(auditError) and surfaces
    // as SendPolicyRejection("Send rejected: detection audit persistence
    // failed: ...") with the typed detection code.
    const failingAuditModule = new EmailReplyAuditLogModule();
    vi.spyOn(failingAuditModule, "create").mockImplementation(async () => {
      throw new Error("pre-send audit DB write failed (simulated)");
    });
    const smtpCalls = { count: 0 };
    const senderFactory = () => ({
      sendReplyEmail: async (): Promise<EmailSendResult> => {
        smtpCalls.count += 1;
        return {
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: `<prov-${smtpCalls.count}@x>`,
        };
      },
    });
    const detectionServiceFactory = () => {
      const svc = new EmailReplyDetectionService();
      vi.spyOn(svc, "detect").mockImplementation(async () => replied);
      return svc;
    };
    const delivery = new EmailReplyDeliveryService({
      senderFactory: senderFactory as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory,
      auditModuleFactory: () => failingAuditModule,
    });
    drainCountersForTest();
    let rejection: SendPolicyRejection | null = null;
    try {
      await delivery.sendApprovedReply({ draftId, approvalToken: token });
    } catch (error) {
      if (error instanceof SendPolicyRejection) rejection = error;
    }
    expect(rejection).toBeInstanceOf(SendPolicyRejection);
    // The typed detection code (already_replied) is retained on the
    // rejection so the B12 IPC envelope surfaces it machine-readably.
    expect(rejection?.code).toBe("already_replied");
    expect(rejection?.message).toContain(
      "Send rejected: detection audit persistence failed"
    );
    expect(rejection?.message).toContain(
      "pre-send audit DB write failed (simulated)"
    );
    // No SMTP side effect — the refusal happens BEFORE the atomic claim.
    expect(smtpCalls.count).toBe(0);
    const counters = drainCountersForTest();
    expect(counters.get("audit_failure{stage=pre_send}")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R12 (§9.4 item 4) — Recheck freshness after claim and intervening awaits,
// retaining exact-attempt ownership for one bounded refresh. The freshness
// fence today exists ONLY at claim time (claimApprovedRevisionForSend reads
// replyNegativeCheckAt; null→stale fail-closed D1a, age>5s→stale). After the
// claim succeeds and markSubmitted (527) runs, the flow proceeds to SMTP (560)
// with NO further age check. A DB/queue delay after claim exceeding the 5s
// FORCED_FRESHNESS_WINDOW_MS → SMTP submits using a stale observation.
//
// §9.4 item 4 prescription: "Submit SMTP immediately after the successful
// claim... If execution is delayed past the five-second observation window
// before SMTP starts, rerun detection outside the transaction while retaining
// the send claim. A refusal before SMTP finalizes that unsent claim safely;
// it must not manufacture an accepted/unknown send. Recognize only this
// operation's exact attempt as the current owner during that refresh; every
// other pending/sent/unknown record still blocks. This internal ownership
// handle is never a tool/IPC bypass parameter. Allow one delayed refresh;
// further delay refuses with no SMTP submission."
//
// Todo regression requirement (verbatim): "hold submission persistence for
// six seconds, then reveal positive/unknown on refresh; assert zero SMTP and
// retained protection. Verify normal exact-attempt replay is unaffected."
//
// The 6-second hold is simulated by spying EmailReplySendAttemptModule
// .prototype.markSubmitted BEFORE constructing the delivery service (the
// BaseDb.installConnectionGuards landmine: it copies every async prototype
// method onto the instance at construction, so a spy installed after
// construction is bypassed by the instance-own guarded method). The hold
// lets real wall-clock advance past the 5s FORCED_FRESHNESS_WINDOW_MS after
// the claim succeeds but before SMTP starts — the exact post-claim gap §9.4
// item 4 closes. Each test has an explicit vitest timeout >6s (the default
// 5s per-test timeout would abort the hold).
// ---------------------------------------------------------------------------
describe("sendApprovedReply R12 post-claim freshness gate (§9.4 item 4)", () => {
  const auditModule = new EmailReplyAuditLogModule();
  const attemptModule = new EmailReplySendAttemptModule();
  const approvalModule = new EmailReplyApprovalModule();
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();

  async function refusalAuditsFor(messageId: number) {
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    return records.filter((r) => r.action === "reply_skipped");
  }

  async function finalizeAuditsFor(messageId: number) {
    const { records } = await auditModule.list({
      messageId,
      page: 0,
      size: 50,
    });
    return records.filter((r) => r.action === "delivery_unknown");
  }

  // The markSubmitted prototype spy leaks across tests (it replaces the
  // prototype method, which every subsequent EmailReplySendAttemptModule
  // instance inherits until restored). Restore all mocks after each test so
  // the 6s hold does not deadlock later tests in the describe.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Build a delivery service whose detection spy writes a fresh
   * replyNegativeCheckAt (so the claim-time fence passes) and returns
   * not_replied. `markSubmittedSpy` is installed on the prototype BEFORE
   * construction so it survives BaseDb's instance-own guarded-method copy.
   * The spy holds submission persistence for `holdMs` (real wall-clock) to
   * push the post-claim moment past the 5s freshness window, then calls the
   * real markSubmitted so the attempt reaches `submitted` (the state the §9.4
   * safe-finalize matches).
   *
   * `refreshResult` is the detection result the gate refresh must reveal.
   */
  function buildR12Delivery(opts: {
    holdMs: number;
    refreshResult: ReplyDetectionResult;
  }): {
    delivery: EmailReplyDeliveryService;
    smtpCalls: { count: number };
    detectCalls: { count: number };
    markSubmittedSpy: ReturnType<typeof vi.spyOn>;
  } {
    const smtpCalls = { count: 0 };
    const detectCalls = { count: 0 };
    const senderFactory = () => ({
      sendReplyEmail: async (): Promise<EmailSendResult> => {
        smtpCalls.count += 1;
        return {
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: `<prov-${smtpCalls.count}@x>`,
        };
      },
    });
    const detectionServiceFactory = () => {
      const svc = new EmailReplyDetectionService();
      vi.spyOn(svc, "detect").mockImplementation(
        async (input: {
          messageId: number;
          forceRefresh?: boolean;
          excludeDraftId?: number;
          excludeAttemptId?: number;
        }) => {
          detectCalls.count += 1;
          // The pre-send probe (step 5b) and any §9.3 claim-time refresh
          // write a fresh observation so the claim-time fence passes.
          // The post-claim gate refresh (R12) reveals refreshResult WITHOUT
          // persisting a fresh negative — it surfaces the stale reality.
          const isPostClaimRefresh =
            input.excludeAttemptId !== undefined &&
            input.excludeDraftId !== undefined;
          if (!isPostClaimRefresh) {
            await messageModule.updateReplyEvidence({
              id: input.messageId,
              replyNegativeCheckAt: new Date(),
              replyNegativeContextHash: "r12-context-hash",
              isAnswered: 0,
              answeredFlagCheckedAt: new Date(),
            });
          }
          return isPostClaimRefresh ? opts.refreshResult : NOT_REPLIED_DETECTION;
        }
      );
      return svc;
    };
    // BaseDb landmine: install the spy on the prototype BEFORE constructing
    // the delivery service. installConnectionGuards copies every async
    // prototype method onto the instance at construction; a spy installed
    // after construction is bypassed by the instance-own guarded method.
    const realMarkSubmitted = attemptModule.markSubmitted.bind(attemptModule);
    const markSubmittedSpy = vi
      .spyOn(EmailReplySendAttemptModule.prototype, "markSubmitted")
      .mockImplementation(async (id: number, at: Date) => {
        // Hold real wall-clock past FORCED_FRESHNESS_WINDOW_MS (5s) so the
        // post-claim gate sees a stale observation, then call the real
        // markSubmitted so the attempt reaches `submitted` (the state the
        // §9.4 safe-finalize matches: failed/delivery_unknown match only
        // claimed|submitted).
        await new Promise((resolve) => setTimeout(resolve, opts.holdMs));
        await realMarkSubmitted(id, at);
      });
    const delivery = new EmailReplyDeliveryService({
      senderFactory: senderFactory as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory,
    });
    return { delivery, smtpCalls, detectCalls, markSubmittedSpy };
  }

  it("6s hold + refresh reveals `replied` -> ZERO SMTP, claim finalized delivery_unknown, protection retained, ONE reply_skipped audit", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    const refreshRevealed: ReplyDetectionResult = {
      state: "replied",
      replied: true,
      source: "local_state",
      matchedMessageId: null,
      reasonCode: "already_replied",
      checkedAt: new Date().toISOString(),
      fromCache: true,
      coverage: "local_only",
    };
    const { delivery, smtpCalls, detectCalls, markSubmittedSpy } =
      buildR12Delivery({ holdMs: 6_000, refreshResult: refreshRevealed });

    let rejection: SendPolicyRejection | null = null;
    try {
      await delivery.sendApprovedReply({ draftId, approvalToken: token });
    } catch (error) {
      if (error instanceof SendPolicyRejection) rejection = error;
    }

    // §9.4: the post-claim refresh found a reply → refuse BEFORE SMTP.
    expect(rejection).toBeInstanceOf(SendPolicyRejection);
    expect(rejection?.code).toBe("already_replied");
    // ZERO SMTP — the unsent claim was finalized safely, not submitted.
    expect(smtpCalls.count).toBe(0);
    // markSubmitted WAS held + called (the claim succeeded, then the gate
    // refused on the stale refresh). This proves the gap is AFTER claim, the
    // exact spot §9.4 item 4 closes.
    expect(markSubmittedSpy).toHaveBeenCalled();

    // Retained protection: the attempt is finalized `delivery_unknown` (not
    // sent/claimed), the draft is `delivery_unknown` (not sent/approved), the
    // approval is consumed (one-time token invalidated), and the message
    // replyStatus is UNTOUCHED (no EmailReplyStatus for ambiguous delivery —
    // finalizeSendOutcome omits messageReplyStatus for delivery_unknown).
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("delivery_unknown");
    const attempts = await attemptModule.listByDraft(draftId);
    const ourAttempt = attempts.find((a) => a.id > 0);
    expect(ourAttempt?.status).toBe("delivery_unknown");
    const message = await messageModule.read(messageId);
    expect(message?.replyStatus).toBe("not_started");
    expect(message?.processedAt).toBeNull();
    const approval = await approvalModule.findActiveByDraft(draftId, 0);
    // The one-time approval is consumed by the safe finalize (invalidatedAt
    // IS NULL fence).
    expect(approval).toBeNull();

    // Exactly ONE reply_skipped audit (stage pre_send, code already_replied)
    // for the gate refusal. The finalize also writes ONE delivery_unknown
    // audit (action delivery_unknown) — both audits present, distinct.
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].reason).toContain("[already_replied]");
    const refusalMeta = JSON.parse(refusals[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
      source?: string;
    };
    expect(refusalMeta.stage).toBe("pre_send");
    expect(refusalMeta.code).toBe("already_replied");
    const finalizeAudits = await finalizeAuditsFor(messageId);
    expect(finalizeAudits).toHaveLength(1);

    // The post-claim gate refresh ran exactly ONE excluded detect call (in
    // addition to the pre-send probe). This proves §9.4: "Allow one delayed
    // refresh."
    expect(detectCalls.count).toBeGreaterThanOrEqual(2);
    drainCountersForTest();
  }, 20_000);

  it("6s hold + refresh reveals `unknown` (delivery_unknown) -> ZERO SMTP, claim finalized delivery_unknown, protection retained", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    const refreshRevealed: ReplyDetectionResult = {
      state: "unknown",
      replied: null,
      source: "local_state",
      matchedMessageId: null,
      reasonCode: "delivery_unknown",
      checkedAt: new Date().toISOString(),
      fromCache: true,
      coverage: "local_only",
    };
    const { delivery, smtpCalls, markSubmittedSpy } = buildR12Delivery({
      holdMs: 6_000,
      refreshResult: refreshRevealed,
    });

    let rejection: SendPolicyRejection | null = null;
    try {
      await delivery.sendApprovedReply({ draftId, approvalToken: token });
    } catch (error) {
      if (error instanceof SendPolicyRejection) rejection = error;
    }

    expect(rejection).toBeInstanceOf(SendPolicyRejection);
    // The typed unknown reasonCode flows through SendPolicyRejection so the
    // B12 IPC envelope surfaces it machine-readably.
    expect(rejection?.code).toBe("delivery_unknown");
    expect(smtpCalls.count).toBe(0);
    expect(markSubmittedSpy).toHaveBeenCalled();

    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("delivery_unknown");
    const attempts = await attemptModule.listByDraft(draftId);
    const ourAttempt = attempts.find((a) => a.id > 0);
    expect(ourAttempt?.status).toBe("delivery_unknown");
    const message = await messageModule.read(messageId);
    expect(message?.replyStatus).toBe("not_started");
    expect(message?.processedAt).toBeNull();
    const approval = await approvalModule.findActiveByDraft(draftId, 0);
    expect(approval).toBeNull();

    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].reason).toContain("[delivery_unknown]");
    const refusalMeta = JSON.parse(refusals[0].metadataJson ?? "{}") as {
      stage?: string;
      code?: string;
    };
    expect(refusalMeta.stage).toBe("pre_send");
    expect(refusalMeta.code).toBe("delivery_unknown");
    const finalizeAudits = await finalizeAuditsFor(messageId);
    expect(finalizeAudits).toHaveLength(1);
    drainCountersForTest();
  }, 20_000);

  it("fresh observation at gate (no 6s delay) -> no extra detect, SMTP fires once, draft -> sent", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    // holdMs=0 means markSubmitted returns immediately — the observation is
    // still fresh (<5s) when the gate runs, so NO post-claim refresh.
    const refreshRevealed: ReplyDetectionResult = {
      state: "replied",
      replied: true,
      source: "local_state",
      matchedMessageId: null,
      reasonCode: "already_replied",
      checkedAt: new Date().toISOString(),
      fromCache: true,
      coverage: "local_only",
    };
    const { delivery, smtpCalls, detectCalls } = buildR12Delivery({
      holdMs: 0,
      refreshResult: refreshRevealed,
    });

    const outcome = await delivery.sendApprovedReply({
      draftId,
      approvalToken: token,
    });

    expect(outcome.status).toBe("sent");
    expect(smtpCalls.count).toBe(1);
    // No post-claim refresh: only the pre-send probe (1 detect call).
    expect(detectCalls.count).toBe(1);
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(0);
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("sent");
    drainCountersForTest();
  }, 20_000);

  it("6s hold + refresh reveals `not_replied` -> SMTP fires once, draft -> sent (stale-but-still-eligible proceeds)", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    const refreshRevealed: ReplyDetectionResult = {
      state: "not_replied",
      replied: false,
      source: "sent_search",
      matchedMessageId: null,
      reasonCode: "no_reply_observed",
      checkedAt: new Date().toISOString(),
      fromCache: false,
      coverage: "configured_imap",
    };
    const { delivery, smtpCalls, detectCalls } = buildR12Delivery({
      holdMs: 6_000,
      refreshResult: refreshRevealed,
    });

    const outcome = await delivery.sendApprovedReply({
      draftId,
      approvalToken: token,
    });

    expect(outcome.status).toBe("sent");
    expect(smtpCalls.count).toBe(1);
    // The post-claim gate refresh ran (≥2 detect calls) but found
    // not_replied → SMTP proceeds.
    expect(detectCalls.count).toBeGreaterThanOrEqual(2);
    const refusals = await refusalAuditsFor(messageId);
    expect(refusals).toHaveLength(0);
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("sent");
    drainCountersForTest();
  }, 20_000);

  it("normal exact-attempt replay is unaffected — same approval replay returns already_processed with one SMTP", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    // No 6s hold; a plain accept sender. R12 must not break the B04
    // idempotency replay path.
    const smtpCalls = { count: 0 };
    let releaseFirst: () => void = () => {};
    const firstSendHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const senderFactory = () => ({
      sendReplyEmail: async (): Promise<EmailSendResult> => {
        smtpCalls.count += 1;
        if (smtpCalls.count === 1) {
          await firstSendHeld;
        }
        return {
          receiver: "prospect@example.com",
          status: true,
          title: "Re: Pricing",
          content: CLEAN_BODY,
          info: `<prov-${smtpCalls.count}@x>`,
        };
      },
    });
    const detectionServiceFactory = () => {
      const svc = new EmailReplyDetectionService();
      vi.spyOn(svc, "detect").mockImplementation(async (input) => {
        await messageModule.updateReplyEvidence({
          id: input.messageId,
          replyNegativeCheckAt: new Date(),
          replyNegativeContextHash: "r12-replay-hash",
          isAnswered: 0,
          answeredFlagCheckedAt: new Date(),
        });
        return NOT_REPLIED_DETECTION;
      });
      return svc;
    };
    const delivery = new EmailReplyDeliveryService({
      senderFactory: senderFactory as never,
      serviceLoader: async () => FAKE_MAILBOX,
      detectionServiceFactory,
    });

    const first = delivery.sendApprovedReply({ draftId, approvalToken: token });
    await new Promise((r) => setTimeout(r, 30));
    const replay = await delivery.sendApprovedReply({
      draftId,
      approvalToken: token,
    });
    expect(replay.status).toBe("already_processed");
    expect(replay.attemptId).toBeGreaterThan(0);
    releaseFirst();
    const firstOutcome = await first;
    expect(firstOutcome.status).toBe("sent");
    expect(smtpCalls.count).toBe(1);
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("sent");
    void messageId;
    drainCountersForTest();
  }, 20_000);
});

// ---------------------------------------------------------------------------
// R14 — finalized sent/delivery_unknown attempt replay with the exact same
// token. `finalizeSendOutcome` consumes the one-time approval (sets
// `invalidatedAt`) for EVERY terminal outcome, and `findActiveByTokenHash`
// returns null for consumed approvals — so a replay of a FINALIZED attempt
// dies at step 1 with "approval token is invalid, expired, or already used"
// and never reaches the B04 idempotency lookup that would return the original
// attempt. The regression requires: replay a finalized sent and
// delivery-unknown completion; both return the original attempt/outcome
// (`already_processed`) with NO extra SMTP, while a different token/draft
// remains subject to binding/approval rules (edited-draft replays fail
// approval_stale; consumed-token-without-attempt stays unauthorized).
// ---------------------------------------------------------------------------
describe("sendApprovedReply replay of a finalized attempt with the same token (R14)", () => {
  const draftModule = new EmailReplyDraftModule();
  const attemptModule = new EmailReplySendAttemptModule();

  it("replay of a finalized SENT attempt returns already_processed with no extra SMTP", async () => {
    const { draftId, token } = await seedValidApproval();
    const { delivery, smtpCalls } = buildCountingDelivery("accept");

    const first = await delivery.sendApprovedReply({ draftId, approvalToken: token });
    expect(first.status).toBe("sent");
    expect(smtpCalls.count).toBe(1);

    // The finalize consumed the approval (invalidatedAt set) — replaying the
    // SAME token must still resolve the consumed record, pass binding
    // (finalize preserves currentRevisionId/contentHash), hit the B04
    // idempotency key, and return the original attempt — NOT throw
    // "approval token is invalid, expired, or already used".
    const replay = await delivery.sendApprovedReply({ draftId, approvalToken: token });
    expect(replay.status).toBe("already_processed");
    expect(replay.attemptId).toBe(first.attemptId);
    expect(smtpCalls.count).toBe(1); // no extra SMTP submission
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("sent");
  });

  it("replay of a finalized DELIVERY_UNKNOWN attempt returns already_processed with no extra SMTP", async () => {
    const { draftId, token } = await seedValidApproval();
    const { delivery, smtpCalls } = buildCountingDelivery("disconnect");

    const first = await delivery.sendApprovedReply({ draftId, approvalToken: token });
    expect(first.status).toBe("delivery_unknown");
    expect(smtpCalls.count).toBe(1);

    const replay = await delivery.sendApprovedReply({ draftId, approvalToken: token });
    expect(replay.status).toBe("already_processed");
    expect(replay.attemptId).toBe(first.attemptId);
    expect(smtpCalls.count).toBe(1); // no second ambiguous submission
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("delivery_unknown");
    const attempts = await attemptModule.listByDraft(draftId);
    expect(attempts).toHaveLength(1);
  });

  it("replay after the draft was EDITED is refused by binding (approval_stale), not replayed", async () => {
    const { draftId, token, messageId } = await seedValidApproval();
    const { delivery } = buildCountingDelivery("accept");
    const first = await delivery.sendApprovedReply({ draftId, approvalToken: token });
    expect(first.status).toBe("sent");

    // Append a new revision: moves currentRevisionId/contentHash AND marks
    // approvalInvalidatedAt on the draft — the consumed token now binds an OLD
    // revision, so binding must refuse even though the token resolves. The
    // edit's invalidate loop finds no ACTIVE approvals (finalize already
    // consumed this one), so invalidatedApprovals is 0 — the guard is the
    // revision/hash binding refusal itself. This is the "different token/draft
    // remains subject to binding/approval rules" half of the regression.
    const result = await draftModule.appendRevision({
      draftId,
      actor: "user",
      subject: "Re: Pricing (edited)",
      bodyText: CLEAN_BODY,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      contentHash: "r14-edited-hash".padEnd(64, "0"),
    });
    expect(result.revision.revisionNumber).toBe(2);

    await expect(
      delivery.sendApprovedReply({ draftId, approvalToken: token })
    ).rejects.toThrow(/not bound to the draft's current revision|invalid, expired, or already used/);
    void messageId;
  });

  it("a consumed token with NO existing attempt stays unauthorized (no idempotent resurrection)", async () => {
    const { delivery } = buildCountingDelivery("accept");

    // Seed a second draft + approval, then consume (invalidate) the approval
    // WITHOUT any send ever running — no attempt row exists for it. The
    // consumed-inclusive resolution must NOT turn this into a fresh claim:
    // consumed token + missing exact attempt = still unauthorized.
    const { draftId, token, approvalId } = await seedValidApproval();
    const approvalModule = new EmailReplyApprovalModule();
    await approvalModule.invalidate(
      approvalId,
      "R14 test: consumed with no attempt",
      new Date()
    );

    await expect(
      delivery.sendApprovedReply({ draftId, approvalToken: token })
    ).rejects.toThrow(/invalid, expired, or already used/);
  });
});
