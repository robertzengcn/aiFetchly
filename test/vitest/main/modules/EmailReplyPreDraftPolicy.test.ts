import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
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
 *
 * DB isolation: an isolated temp DB (resetInstance) avoids the
 * SQLITE_BUSY_SNAPSHOT race that occurs when sibling test files share the
 * fallback aifetchly-test singleton under vitest's thread pool. Modules are
 * constructed AFTER resetInstance so their eager repository capture (BaseDb
 * constructor) binds to the isolated DataSource.
 */
describe("P0.3 — pre-draft policy gate (FR-005)", () => {
  let dbpath: string;
  let messageModule: EmailReceivedMessageModule;
  let orchestrator: EmailReplyPolicyOrchestrator;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-predraft-policy-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    // Construct after resetInstance: EmailReplyPolicyOrchestrator eagerly
    // builds 5 modules whose BaseDb constructors capture the singleton.
    messageModule = new EmailReceivedMessageModule();
    orchestrator = new EmailReplyPolicyOrchestrator();
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity>
  ): Promise<number> {
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
    const id = await seedMessage({
      fromAddress: "no-reply@mailer.example.com",
    });
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
    // fs/path are imported at the top of this file.
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../src/service/emailReply/EmailReplyDraftGenerationService.ts"
      ),
      "utf8"
    );
    const gateIdx = src.indexOf('stage: "pre_draft"');
    const retrievalIdx = src.indexOf("retrieveReplyKnowledge(");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(retrievalIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(retrievalIdx);
  });
});
