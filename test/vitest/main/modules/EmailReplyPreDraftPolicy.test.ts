import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplyPolicyOrchestrator } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import type { EmailReplySendAttemptStatus } from "@/entityTypes/emailReplyReliabilityTypes";
import type {
  EmailMessageClassification,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";

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
    msg.replyToAddress = over.replyToAddress ?? null;
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
    expect(decision.code).toBe("automated_sender");
    expect(decision.reason).toContain("no-reply@mailer.example.com");
    expect(decision.reason).toMatch(/configured send address/i);
  });

  it("does not block a human mailbox whose domain contains noreply", async () => {
    const id = await seedMessage({
      fromAddress: "person@noreply.example.com",
      classification: "unknown",
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(true);
  });

  it("drafts when From is no-reply but Reply-To is a person", async () => {
    const id = await seedMessage({
      fromAddress: "no-reply@forms.example.com",
      replyToAddress: "estewaycom@gmail.com",
      classification: "unknown",
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(true);
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

  it("treats a stored deterministic-unknown classification as refinement-pending at pre_draft, not a hard block (FR-007 §10.1)", async () => {
    // Sync persists classifyDeterministic's inconclusive verdict ("unknown",
    // 0.5) for ordinary human emails. The gate must NOT hard-block it at
    // pre_draft: the generation service refines it via the constrained model
    // classifier right after the guard/reuse checks (B01 ordering) and
    // re-gates on the refined value. Hard-blocking here deadlocked drafting
    // for every ordinary inbound email.
    const id = await seedMessage({
      classification: "unknown",
      classificationConfidence: 0.5,
    });
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

/**
 * T02 (FR-029/FR-038): canonical inbound identity. The guard must inspect the
 * FULL canonical cluster — every received row in the same configured email
 * service that shares the normalized RFC Message-ID, plus the drafts and send
 * attempts linked to each of those rows — instead of just the single seed row.
 *
 * Subject, sender alone, and the whole conversation are explicitly NOT the
 * duplicate key. The same RFC Message-ID arriving in two different configured
 * services is NOT a merge — each service has its own cluster. Legacy bare-UID
 * rows whose (folder, UIDVALIDITY) namespace changed surface as a
 * `reply_state_conflict` until reconciled, never silently adopted.
 */
describe("T02 — canonical inbound identity cluster guard", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const attemptModule = new EmailReplySendAttemptModule();
  const orchestrator = new EmailReplyPolicyOrchestrator();

  // Distinct service id so cluster rows don't collide with other describe
  // blocks' fixtures under the Token-fallback shared DB.
  const SERVICE = 4260;
  // Unique per-run suffix: the Token-fallback DB at ${tmpdir}/aifetchly-test is
  // a persistent on-disk file shared across vitest invocations. Without a
  // run-scoped nonce, re-running this file would upsert onto the same rows and
  // accumulate stale drafts/attempts, making the cluster counts nondeterministic.
  const RUN = Math.random().toString(36).slice(2);

  async function seedRow(over: {
    emailServiceId?: number;
    messageId: string;
    providerUid: string;
    replyStatus?: string;
    classification?: string;
  }): Promise<number> {
    // Namespaced UIDs and RFC ids are suffixed with the run nonce so this run's
    // rows are distinct from prior runs' stale rows. The providerUid suffix is
    // what makes the upsert create fresh rows; the messageId suffix is what
    // isolates this run's cluster lookup (keyed on normalizedMessageId) from
    // prior runs' stale rows. Null/empty ids stay null (row:<id> singleton).
    const providerUid = `${over.providerUid}:${RUN}`;
    const rawId = over.messageId;
    const messageId =
      typeof rawId === "string" && rawId.includes("@x")
        ? rawId.replace("@x", `-${RUN}@x`)
        : rawId;
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? SERVICE;
    msg.providerUid = providerUid;
    msg.messageId = messageId;
    msg.threadKey = messageId;
    msg.inReplyTo = null;
    msg.referencesHeader = null;
    msg.fromAddress = "person@example.com";
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
    msg.classification = (over.classification ?? "interested") as
      | EmailMessageClassification
      | null;
    msg.classificationConfidence = 0.95;
    msg.replyStatus = (over.replyStatus ?? "not_started") as EmailReplyStatus;
    msg.processedAt = null;
    const saved = await messageModule.upsertByProviderUid(msg);
    // Populate normalizedMessageId so the (emailServiceId, normalizedMessageId)
    // index is the cluster lookup path (mirrors production sync). Both rows in
    // a cluster must store the identical value; we use the suffixed raw id for
    // both so the cluster query matches them together and stays isolated from
    // prior runs' stale rows.
    await messageModule.updateNormalization(saved.id, {
      normalizedMessageId: messageId,
    });
    return saved.id;
  }

  async function seedDraft(
    messageId: number,
    status: EmailReplyDraftEntity["status"]
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = messageId;
    draft.emailServiceId = SERVICE;
    draft.subject = "Re: Hi";
    draft.bodyText = "Hello back";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    return saved.id;
  }

  async function seedAttempt(
    messageId: number,
    status: EmailReplySendAttemptStatus
  ): Promise<void> {
    const attempt = new EmailReplySendAttemptEntity();
    attempt.idempotencyKey = `t02-${Math.random()}`;
    attempt.draftId = 910000 + Math.floor(Math.random() * 9999);
    attempt.revisionId = attempt.draftId;
    attempt.approvalId = attempt.draftId;
    attempt.messageId = messageId;
    attempt.conversationId = null;
    attempt.emailServiceId = SERVICE;
    attempt.senderAddress = "owner@example.com";
    attempt.recipientAddress = "person@example.com";
    attempt.status = status;
    attempt.claimedAt = new Date();
    attempt.submittedAt = null;
    attempt.completedAt = null;
    attempt.providerMessageId = null;
    attempt.failureCode = null;
    attempt.sanitizedError = null;
    await attemptModule.create(attempt);
  }

  it("same Message-ID in different configured services is NOT a duplicate", async () => {
    // Two rows, same RFC id, different emailServiceId. Each is its own cluster;
    // a sent attempt on service A must not block drafting on service B.
    const idA = await seedRow({
      emailServiceId: SERVICE,
      messageId: "<shared@x>",
      providerUid: "p-a",
    });
    await seedAttempt(idA, "sent");
    const idB = await seedRow({
      emailServiceId: SERVICE + 1,
      messageId: "<shared@x>",
      providerUid: "p-b",
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: idB,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.code).toBe("allowed");
  });

  it("duplicate rows in one service share a cluster: sent attempt on row A blocks drafting on row B", async () => {
    // Two rows in the SAME service with the same normalized Message-ID (a
    // re-delivery in the same folder — same UIDVALIDITY, different UIDs). The
    // guard must inspect the cluster: a sent attempt linked to row A blocks
    // drafting on row B (already_replied).
    const idA = await seedRow({
      messageId: "<dup@x>",
      providerUid: "imap:cafecafecafecafe:777:101",
    });
    await seedAttempt(idA, "sent");
    const idB = await seedRow({
      messageId: "<dup@x>",
      providerUid: "imap:cafecafecafecafe:777:102",
      // B looks clean on its own projection; the cluster carries the truth.
      replyStatus: "not_started",
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: idB,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("already_replied");
  });

  it("cluster catches a live draft on row A when drafting row B (reply_state_conflict)", async () => {
    // A live draft on row A means the cluster already has an in-flight
    // generation; drafting row B would create a second live draft across the
    // cluster → conflict, never silent pick-one.
    const idA = await seedRow({
      messageId: "<multi-live@x>",
      providerUid: "p-ml-a",
    });
    await seedDraft(idA, "draft");
    const idB = await seedRow({
      messageId: "<multi-live@x>",
      providerUid: "p-ml-b",
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: idB,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("reply_state_conflict");
  });

  it("missing RFC id falls back to row singleton — two null-id rows do NOT merge", async () => {
    // Two rows in the same service, both with null/empty messageId. Each is a
    // row:<id> singleton; a sent attempt on row A must not block row B.
    const idA = await seedRow({
      messageId: null as unknown as string,
      providerUid: "p-null-a",
    });
    await seedAttempt(idA, "sent");
    const idB = await seedRow({
      messageId: null as unknown as string,
      providerUid: "p-null-b",
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: idB,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.code).toBe("allowed");
  });

  it("legacy bare UID + namespaced UID for the same RFC id is a reply_state_conflict", async () => {
    // FR-038: a legacy bare-UID row and a new namespaced row sharing the RFC id
    // cannot be safely treated as the same underlying message without a
    // verified header match. Surface for reconciliation.
    const idLegacy = await seedRow({
      messageId: "<ns@x>",
      providerUid: "12345", // legacy bare UID
    });
    const idNamespaced = await seedRow({
      messageId: "<ns@x>",
      providerUid: "imap:deadbeefdeadbeef:999:12345", // namespaced, same uid
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: idNamespaced,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("reply_state_conflict");
    // Symmetric: seeding from the legacy side also conflicts.
    const decision2 = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: idLegacy,
    });
    expect(decision2.allowed).toBe(false);
    expect(decision2.code).toBe("reply_state_conflict");
  });

  it("changed UIDVALIDITY for the same folder is a reply_state_conflict", async () => {
    // Two namespaced rows, same folder hash, different UIDVALIDITY → the
    // folder's UID namespace was reset; the rows cannot be assumed the same.
    const idA = await seedRow({
      messageId: "<uv@x>",
      providerUid: "imap:deadbeefdeadbeef:111:42",
    });
    const idB = await seedRow({
      messageId: "<uv@x>",
      providerUid: "imap:deadbeefdeadbeef:222:42",
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: idB,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("reply_state_conflict");
    expect(idA).toBeGreaterThan(0);
  });

  it("new inbound message in an already-answered cluster is blocked (already_replied)", async () => {
    // A new inbound arrives in a conversation that was already answered. The
    // guard inspects the cluster; a sent attempt on any equivalent row blocks.
    const idAnswered = await seedRow({
      messageId: "<answered-thread@x>",
      providerUid: "imap:cafecafecafecafe:888:201",
    });
    await seedAttempt(idAnswered, "sent");
    const idNew = await seedRow({
      messageId: "<answered-thread@x>",
      providerUid: "imap:cafecafecafecafe:888:202",
      replyStatus: "not_started",
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: idNew,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("already_replied");
  });

  it("two namespaced rows in the same folder/UIDVALIDITY with one live draft do NOT conflict (reuse)", async () => {
    // Two rows, same namespace, same RFC id, exactly one live draft on row A.
    // This is the legitimate re-delivery case: the cluster has one live draft,
    // so the guard falls through to allow (the generation service reuses row A's
    // draft). NOT a conflict.
    const idA = await seedRow({
      messageId: "<reuse@x>",
      providerUid: "imap:cafecafecafecafe:555:1",
    });
    await seedDraft(idA, "draft");
    const idB = await seedRow({
      messageId: "<reuse@x>",
      providerUid: "imap:cafecafecafecafe:555:2",
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: idB,
    });
    expect(decision.allowed).toBe(true);
  });
});

/**
 * B08 [P2]: a definitely-`failed` draft (SMTP server rejected the submission;
 * no email was delivered) is REUSABLE by its existing ID — the user can
 * re-approve and retry without regenerating. This must hold consistently
 * regardless of the message `replyStatus` projection. An ambiguous
 * `delivery_unknown` draft is NEVER reusable: it might have delivered, and
 * reuse would risk a duplicate send.
 */
describe("B08 — definitely-failed drafts are reusable, delivery_unknown is not", () => {
  const messageModule = new EmailReceivedMessageModule();
  const draftModule = new EmailReplyDraftModule();
  const orchestrator = new EmailReplyPolicyOrchestrator();
  const pickReusableDraftModule = () => import("@/service/emailReply/EmailReplyPolicyOrchestrator");

  async function seedMessage(
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<number> {
    const msg = new EmailReceivedMessageEntity();
    msg.emailServiceId = over.emailServiceId ?? 4280;
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
    emailServiceId = 4280
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

  it("a definitely-failed draft with replyStatus=failed is allowed (reusable, not reply_state_unknown)", async () => {
    const id = await seedMessage({ replyStatus: "failed" });
    const failedId = await seedDraft(id, "failed");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.code).toBe("allowed");
    expect(failedId).toBeGreaterThan(0);
  });

  it("a definitely-failed draft with stale projection (replyStatus=draft_created) is allowed consistently", async () => {
    // The projection can lag the authoritative draft state (a mid-flip crash
    // left replyStatus at draft_created while the draft went failed). The guard
    // must behave consistently: a reusable failed draft is allowed regardless
    // of the projection.
    const id = await seedMessage({ replyStatus: "draft_created" });
    const failedId = await seedDraft(id, "failed");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.code).toBe("allowed");
    expect(failedId).toBeGreaterThan(0);
  });

  it("a delivery_unknown draft is NOT reusable even when replyStatus=failed", async () => {
    // An ambiguous failure must never become reusable merely because it is
    // labeled failed. The delivery_unknown draft blocks at precedence-2.
    const id = await seedMessage({ replyStatus: "failed" });
    await seedDraft(id, "delivery_unknown");
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("delivery_unknown");
  });

  it("reply_state_unknown still fires when replyStatus=failed and no reusable draft exists", async () => {
    // The failed draft row was deleted (orphan state); there is nothing to
    // reuse. Surface for human triage rather than silently regenerating.
    const id = await seedMessage({ replyStatus: "failed" });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("reply_state_unknown");
  });

  it("pickReusableDraft returns the failed draft when no live draft exists", async () => {
    const { pickReusableDraft } = await pickReusableDraftModule();
    const failed = { id: 1, status: "failed" } as EmailReplyDraftEntity;
    expect(pickReusableDraft([failed])).toBe(failed);
    expect(pickReusableDraft([])).toBe(null);
  });

  it("pickReusableDraft prefers a live draft over a failed sibling (newest live wins)", async () => {
    // listByMessage orders by id DESC. When a live draft and a failed sibling
    // both exist, the newer live work wins — a failed sibling is a dead end.
    const { pickReusableDraft } = await pickReusableDraftModule();
    const failed = { id: 10, status: "failed" } as EmailReplyDraftEntity;
    const liveNewer = { id: 20, status: "draft" } as EmailReplyDraftEntity;
    expect(pickReusableDraft([liveNewer, failed])).toBe(liveNewer);
    // Even when the failed draft is newer, the live draft is preferred.
    const failedNewer = { id: 30, status: "failed" } as EmailReplyDraftEntity;
    const liveOlder = { id: 20, status: "approved" } as EmailReplyDraftEntity;
    expect(pickReusableDraft([failedNewer, liveOlder])).toBe(liveOlder);
  });

  it("pickReusableDraft never returns a delivery_unknown draft", async () => {
    const { pickReusableDraft } = await pickReusableDraftModule();
    const unknown = { id: 5, status: "delivery_unknown" } as EmailReplyDraftEntity;
    expect(pickReusableDraft([unknown])).toBe(null);
  });
});
