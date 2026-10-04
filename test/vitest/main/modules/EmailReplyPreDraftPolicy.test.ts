import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyPolicyOrchestrator } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";

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
