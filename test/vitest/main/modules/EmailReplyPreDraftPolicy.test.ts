import { describe, it, expect } from "vitest";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyPolicyOrchestrator } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";

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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
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
