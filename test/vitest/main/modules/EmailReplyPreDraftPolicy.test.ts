import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplyPolicyOrchestrator } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import type { EmailReplySendAttemptStatus } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * P0.3: the pre-draft policy gate must block hard-blocked messages (bounce,
 * unsubscribe, automated sender) BEFORE knowledge retrieval or the LLM. The
 * decision is driven by the authoritative orchestrator over the live message
 * row, so we prove it against a real seeded message (the same row createDraft
 * loads). Modules resolve the same Token-fallback DB, so seed + read are
 * consistent.
 */
describe("P0.3 — pre-draft policy gate (FR-005)", () => {
  const messageModule = new EmailReceivedMessageModule();
  const orchestrator = new EmailReplyPolicyOrchestrator();

  async function seedMessage(over: Partial<EmailReceivedMessageEntity>): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4242;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = null;
    msg.classificationConfidence = null;
    msg.replyStatus = "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    if (over.classification) {
      await messageModule.updateClassification(
        saved.id,
        over.classification,
        over.classificationConfidence ?? 0.99
      );
    }
    return saved.id;
  }

  it("blocks a bounce-classified message at pre_draft", async () => {
    const id = await seedMessage({ classification: "bounce" });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("bounce");
  });

  it("blocks an unsubscribe-classified message at pre_draft", async () => {
    const id = await seedMessage({ classification: "unsubscribe" });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
  });

  it("blocks an automated/no-reply sender at pre_draft even without classification", async () => {
    const id = await seedMessage({ fromAddress: "no-reply@mailer.example.com" });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
  });

  it("allows a normal interested message to proceed to drafting", async () => {
    const id = await seedMessage({ classification: "interested" });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.code).toBe("allowed");
  });

  it("createDraft wires the gate before retrieval/LLM (structural guard)", () => {
    // Ensures the pre_draft evaluate call appears BEFORE retrieveReplyKnowledge
    // in the source, so a blocked message never reaches knowledge/LLM.
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../../src/service/emailReply/EmailReplyDraftGenerationService.ts"),
      "utf8"
    );
    const gateIdx = src.indexOf('stage: "pre_draft"');
    const retrievalIdx = src.indexOf("retrieveReplyKnowledge(");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(retrievalIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(retrievalIdx);
  });
});

/**
 * FR-029 (Phase-1 local-only slice): message-level duplicate guard. The
 * orchestrator refuses drafting/sending when the inbound message already has a
 * reply, an in-flight attempt, an unresolved delivery, or contradictory
 * sibling records. Refusals carry the stable codes added in Step 1 and produce
 * zero LLM/SMTP side effects (the guard runs before the legacy checks and
 * before any generation/delivery work).
 */
describe("FR-029 — message-level duplicate guard", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const orchestrator = new EmailReplyPolicyOrchestrator();

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4243;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = over.classificationConfidence ?? 0.95;
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"],
    emailServiceId = 4243
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = emailServiceId;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  it("refuses already_replied when replyStatus is sent", async () => {
    const id = await seedMessage({ replyStatus: "sent" });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("already_replied");
  });

  it("refuses already_replied when a sent draft exists (even if replyStatus lags)", async () => {
    // The send path flips replyStatus to sent in the same transaction as the
    // attempt, but a crash mid-flip can leave replyStatus stale. A sent draft
    // alone must still trigger already_replied.
    const id = await seedMessage({ replyStatus: "not_started" });
    await seedDraft(id, "sent");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("already_replied");
  });

  it("refuses reply_in_progress when a sending draft exists", async () => {
    const id = await seedMessage();
    await seedDraft(id, "sending");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("reply_in_progress");
  });

  it("refuses delivery_unknown when an ambiguous-outcome draft exists", async () => {
    const id = await seedMessage();
    await seedDraft(id, "delivery_unknown");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("delivery_unknown");
  });

  it("refuses reply_state_conflict when multiple live drafts exist", async () => {
    const id = await seedMessage();
    await seedDraft(id, "draft");
    await seedDraft(id, "draft");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("reply_state_conflict");
  });

  it("refuses reply_state_unknown when a prior generation failed with no live draft", async () => {
    const id = await seedMessage({ replyStatus: "failed" });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("reply_state_unknown");
  });

  it("allows a clean message (no drafts, replyStatus not_started)", async () => {
    const id = await seedMessage({ replyStatus: "not_started" });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.code).toBe("allowed");
  });

  it("allows a message with ONE eligible draft for reuse (no refusal)", async () => {
    // A single live draft is the reuse path, not a conflict. The guard falls
    // through to the legacy checks, which allow an interested message.
    const id = await seedMessage({ replyStatus: "draft_created" });
    await seedDraft(id, "draft");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(true);
  });

  it("guard runs at pre_send too (refuses already_replied before the per-draft claim)", async () => {
    const id = await seedMessage({ replyStatus: "sent" });
    // pre_send requires a draftId; the guard refuses before it is consulted.
    const decision = await orchestrator.evaluate({
      stage: "pre_send",
      messageId: id,
      draftId: 999999,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("already_replied");
  });
});

/**
 * B02 [P1]: the message-level guard must inspect the authoritative send-attempt
 * ledger, not just draft/message projections. An attempt that is `sent`,
 * `delivery_unknown`, `claimed`, or `submitted` must deny a duplicate draft or
 * send — even when the linked draft row is missing/stale and the message
 * `replyStatus` projection still looks unanswered. The attempt ledger is
 * append-only and survives projection drift (orphan attempts, stale replyStatus
 * after a mid-flip crash, a deleted draft, etc.).
 *
 * Each case seeds an authoritative attempt state with a stale, clean-looking
 * message/draft projection (replyStatus = not_started, no drafts) and asserts
 * the guard still denies at BOTH the draft and send stages before any AI/SMTP
 * work. Acceptance: independently seed each authoritative attempt state; both
 * draft and send stages must deny before AI/SMTP work, including missing-draft
 * and equivalent-duplicate-row cases.
 */
describe("B02 — guard inspects authoritative send-attempt evidence", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const attemptModule = new EmailReplySendAttemptModule();
  const orchestrator = new EmailReplyPolicyOrchestrator();

  async function seedCleanMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4250;
    msg.providerUid = `p-${Math.random()}`;
    msg.messageId = `<m-${Math.random()}@x>`;
    msg.threadKey = msg.messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = over.fromAddress ?? "person@example.com";
    msg.fromName = "Person";
    msg.replyToAddress = null;
    msg.toAddressesJson = "[]";
    msg.ccAddressesJson = null;
    msg.subject = "Hi";
    msg.bodyText = "Hello";
    msg.bodyHtmlSanitized = null;
    msg.snippet = null;
    msg.receivedAt = new Date();
    msg.isUnread = 1;
    msg.classification = over.classification ?? "interested";
    msg.classificationConfidence = over.classificationConfidence ?? 0.95;
    // Stale projection: looks completely unanswered. The attempt ledger below
    // is the authoritative evidence that must override this.
    msg.replyStatus = over.replyStatus ?? "not_started";
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    return saved.id;
  }

  async function seedAttempt(
    messageId: number,
    status: EmailReplySendAttemptStatus,
    emailServiceId = 4250
  ): Promise<number> {
    // Orphan-friendly: the attempt ledger is authoritative even without a live
    // draft row. Use a sentinel draftId/revisionId/approvalId so the attempt
    // stands alone (simulates a deleted/stale draft, or a crash before the
    // draft projection caught up).
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `key-${Math.random()}`;
    attempt.draftId = 900000 + Math.floor(Math.random() * 9999);
    attempt.revisionId = attempt.draftId;
    attempt.approvalId = attempt.draftId;
    attempt.messageId = messageId;
    attempt.conversationId = null;
    attempt.emailServiceId = emailServiceId;
    attempt.senderAddress = "owner@example.com";
    attempt.recipientAddress = "person@example.com";
    attempt.status = status;
    attempt.claimedAt = new Date();
    attempt.submittedAt = null;
    attempt.completedAt = null;
    attempt.providerMessageId = null;
    attempt.failureCode = null;
    attempt.sanitizedError = null;
    const saved = await attemptModule.create(attempt);
    return saved.id;
  }

  it("refuses already_replied at pre_draft when a sent attempt exists with no draft and stale replyStatus", async () => {
    const id = await seedCleanMessage({ replyStatus: "not_started" });
    await seedAttempt(id, "sent");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("already_replied");
  });

  it("refuses already_replied at pre_send when a sent attempt exists with no draft", async () => {
    const id = await seedCleanMessage({ replyStatus: "not_started" });
    await seedAttempt(id, "sent");
    const decision = await orchestrator.evaluate({
      stage: "pre_send",
      messageId: id,
      // The guard runs before the per-draft claim, so a sentinel draftId still
      // yields the attempt-led denial.
      draftId: 999999,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("already_replied");
  });

  it("refuses delivery_unknown at pre_draft when an ambiguous attempt exists with no draft", async () => {
    const id = await seedCleanMessage({ replyStatus: "not_started" });
    await seedAttempt(id, "delivery_unknown");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("delivery_unknown");
  });

  it("refuses reply_in_progress at pre_draft when a claimed attempt exists with no draft", async () => {
    const id = await seedCleanMessage({ replyStatus: "not_started" });
    await seedAttempt(id, "claimed");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("reply_in_progress");
  });

  it("refuses reply_in_progress at pre_draft when a submitted attempt exists with no draft", async () => {
    const id = await seedCleanMessage({ replyStatus: "not_started" });
    await seedAttempt(id, "submitted");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("reply_in_progress");
  });

  it("refuses reply_in_progress at pre_send when a claimed attempt exists", async () => {
    const id = await seedCleanMessage({ replyStatus: "not_started" });
    await seedAttempt(id, "claimed");
    const decision = await orchestrator.evaluate({
      stage: "pre_send",
      messageId: id,
      draftId: 999999,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("reply_in_progress");
  });

  it("attempt ledger is authoritative over a stale live draft (sent attempt + live draft → already_replied, not reuse)", async () => {
    // A sent attempt plus a leftover live draft: the sent attempt wins. The
    // guard must NOT fall through to the reuse path.
    const id = await seedCleanMessage({ replyStatus: "not_started" });
    const draft = new EmailReplyDraftEntity();
    draft.messageId = id;
    draft.emailServiceId = 4250;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    await draftModule.create(draft);
    await seedAttempt(id, "sent");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("already_replied");
  });

  it("a definitely-failed attempt alone does NOT block drafting (failed != unknown)", async () => {
    // A definitely-rejected SMTP attempt is terminal but not ambiguous; the
    // message may be re-drafted/re-sent. (B08 covers reusing the failed draft;
    // here we only assert the guard does not treat `failed` as a block.)
    const id = await seedCleanMessage({ replyStatus: "not_started" });
    await seedAttempt(id, "failed");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.code).toBe("allowed");
  });

  it("clean message with no drafts and no attempts is allowed (regression)", async () => {
    const id = await seedCleanMessage({ replyStatus: "not_started" });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.code).toBe("allowed");
  });
});
