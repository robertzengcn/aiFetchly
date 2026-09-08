/**
 * Unit tests for OutboundEmailSendLogModule — the aggregator that merges the
 * legacy bulk-task send log (emailmarketing_send_log) with the authorized
 * outbound delivery outcomes (outbound_email_delivery_outcome) into one
 * timeline of UnifiedSendLogEntry rows.
 *
 * These tests seed BOTH halves via the real models (legacy send-log rows +
 * authorized outcomes joined to real draft revisions) so the full merge path
 * — including the draft-revision title join — is exercised truthfully.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity";
import {
  EmailMarketingSendLogModel,
  SendStatus,
} from "@/model/emailMarketingSendLog.model";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailDraftModel } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import { OutboundEmailDraftRevisionEntity } from "@/entity/OutboundEmailDraftRevision.entity";
import { OutboundEmailDeliveryOutcomeEntity } from "@/entity/OutboundEmailDeliveryOutcome.entity";
import type { SortBy } from "@/entityTypes/commonType";

const tmpDir = path.join(os.tmpdir(), "aifetchly-unified-sendlog-module");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));
vi.mock("@/config/usersetting", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/config/usersetting")
  >();
  return {
    ...original,
    Token: class {
      getValue(name: string) {
        return name === "user_dbpath" ? tmpDir : "";
      }
    },
  };
});

import { OutboundEmailSendLogModule } from "@/modules/OutboundEmailSendLogModule";

const HASH = "a".repeat(64);

/** Seed a legacy send-log row (emailmarketing_send_log). Returns its id. */
async function seedLegacyRow(
  taskId: number,
  status: SendStatus,
  receiver: string,
  title: string
): Promise<number> {
  const model = new EmailMarketingSendLogModel(tmpDir);
  const entity = new EmailMarketingSendLogEntity();
  entity.task_id = taskId;
  entity.status = status;
  entity.receiver = receiver;
  entity.title = title;
  entity.content = "";
  entity.log = "";
  entity.record_time = new Date().toISOString();
  return await model.create(entity);
}

/**
 * Seed an authorized delivery outcome, fully wired to a draft batch + draft +
 * revision so the aggregator's title-join resolves a real subject. Returns the
 * ids the detail tests need to address the row and its revisions.
 */
async function seedAuthorizedOutcome(
  recipient: string,
  subject: string,
  status:
    | "pending"
    | "submitted"
    | "sent"
    | "suppressed"
    | "failed"
    | "delivery_unknown",
  completedAt: Date | null
): Promise<{ outcomeId: number; draftId: number; revisionId: number }> {
  const draftModel = new OutboundEmailDraftModel(tmpDir);
  const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);

  const batch = new OutboundEmailDraftBatchEntity();
  batch.conversationId = "conv-test";
  batch.sourceUserMessageId = "msg-test";
  batch.intentDecisionId = 1;
  batch.status = "draft_ready";
  batch.recipientSourceType = "direct";
  batch.recipientSourceId = null;
  batch.recipientCount = 1;
  batch.validRecipientCount = 1;
  batch.emailServiceIdsJson = "[1]";
  batch.batchHash = HASH;
  batch.policyVersion = null;
  batch.validationVersion = null;
  batch.authorizationId = null;
  batch.legacyTaskId = null;
  batch.sendAttemptId = null;
  batch.lastErrorCode = null;
  batch.authorizedAt = null;
  batch.queuedAt = null;
  batch.completedAt = null;
  const savedBatch = await draftModel.createBatch(batch);

  const draft = new OutboundEmailDraftEntity();
  draft.batchId = savedBatch.id;
  draft.recipientAddress = recipient;
  draft.recipientDisplayName = null;
  draft.recipientSourceRef = null;
  draft.status = "draft";
  draft.currentRevisionId = null;
  draft.revisionNumber = 1;
  draft.contentHash = HASH;
  draft.lastErrorCode = null;
  const savedDraft = await draftModel.createDraft(draft);

  const revision = new OutboundEmailDraftRevisionEntity();
  revision.draftId = savedDraft.id;
  revision.revisionNumber = 1;
  revision.actor = "ai";
  revision.emailServiceId = 1;
  revision.senderAddress = "sender@example.com";
  revision.recipientAddress = recipient;
  revision.subject = subject;
  revision.bodyText = "body";
  revision.bodyHtml = null;
  revision.contentHash = HASH;
  revision.personalizationEvidenceJson = null;
  revision.knowledgeSourcesJson = null;
  revision.generationMetadataJson = null;
  revision.validationFindingsJson = null;
  const savedRevision = await draftModel.createRevision(revision);

  const outcome = new OutboundEmailDeliveryOutcomeEntity();
  outcome.sendAttemptId = 1;
  outcome.batchId = savedBatch.id;
  outcome.draftId = savedDraft.id;
  outcome.revisionId = savedRevision.id;
  outcome.envelopeHash = HASH;
  outcome.recipientAddress = recipient;
  outcome.status = status;
  outcome.providerMessageId = null;
  outcome.errorCode = null;
  outcome.submittedAt = null;
  outcome.completedAt = completedAt;
  const savedOutcome = await deliveryModel.createOutcome(outcome);
  return {
    outcomeId: savedOutcome.id,
    draftId: savedDraft.id,
    revisionId: savedRevision.id,
  };
}

describe("OutboundEmailSendLogModule.getUnifiedSendLog", () => {
  it("merges legacy + authorized rows into one timeline", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    await seedLegacyRow(
      5001,
      SendStatus.Success,
      "legacy@x.com",
      "Legacy Send"
    );
    await seedAuthorizedOutcome(
      "auth@x.com",
      "Authorized Send",
      "sent",
      new Date()
    );

    const module = new OutboundEmailSendLogModule();
    const { records, total } = await module.getUnifiedSendLog(0, 100);

    expect(total).toBe(2);
    expect(records).toHaveLength(2);

    const legacy = records.find((r) => r.source === "legacy");
    expect(legacy?.receiver).toBe("legacy@x.com");
    expect(legacy?.title).toBe("Legacy Send");
    expect(legacy?.status).toBe("Success");
    expect(legacy?.taskId).toBe(5001);

    const auth = records.find((r) => r.source === "authorized");
    expect(auth?.receiver).toBe("auth@x.com");
    // The joined draft revision subject surfaces as the title.
    expect(auth?.title).toBe("Authorized Send");
    expect(auth?.status).toBe("Success");
    expect(auth?.batchId).toBeTypeOf("number");
    expect(auth?.draftId).toBeTypeOf("number");
  });

  it("applies the recipient where-filter across both halves", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    await seedLegacyRow(1, SendStatus.Success, "alice@x.com", "Legacy Alice");
    await seedAuthorizedOutcome(
      "bob@x.com",
      "Authorized Bob",
      "sent",
      new Date()
    );
    await seedLegacyRow(1, SendStatus.Failure, "carol@x.com", "Legacy Carol");

    const module = new OutboundEmailSendLogModule();
    const { records, total } = await module.getUnifiedSendLog(0, 100, "alice");

    expect(total).toBe(1);
    expect(records[0].receiver).toBe("alice@x.com");
  });

  it("sorts by record_time ascending", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const early = new Date("2026-01-01T00:00:00.000Z");
    const late = new Date("2026-06-01T00:00:00.000Z");
    await seedAuthorizedOutcome("late@x.com", "Late", "sent", late);
    await seedAuthorizedOutcome("early@x.com", "Early", "sent", early);

    const sort: SortBy = { key: "record_time", order: "asc" };
    const module = new OutboundEmailSendLogModule();
    const { records } = await module.getUnifiedSendLog(0, 100, undefined, sort);

    expect(records[0].receiver).toBe("early@x.com");
    expect(records[1].receiver).toBe("late@x.com");
  });

  it("sorts by source (alphabetical: authorized before legacy asc)", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    await seedAuthorizedOutcome("auth@x.com", "Auth", "sent", new Date());
    await seedLegacyRow(1, SendStatus.Success, "legacy@x.com", "Legacy");

    const sort: SortBy = { key: "source", order: "asc" };
    const module = new OutboundEmailSendLogModule();
    const { records } = await module.getUnifiedSendLog(0, 100, undefined, sort);

    // Ascending alphabetical: "authorized" < "legacy".
    expect(records[0].source).toBe("authorized");
    expect(records[1].source).toBe("legacy");
  });

  it("rejects disallowed sort keys", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedLegacyRow(1, SendStatus.Success, "a@x.com", "T");

    const module = new OutboundEmailSendLogModule();
    const bad: SortBy = { key: "receiver", order: "asc" };
    await expect(
      module.getUnifiedSendLog(0, 100, undefined, bad)
    ).rejects.toThrow("not allow sort key");
  });

  it("paginates the merged result", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    for (let i = 0; i < 4; i++) {
      await seedLegacyRow(i, SendStatus.Success, `legacy${i}@x.com`, `T${i}`);
    }
    await seedAuthorizedOutcome("auth@x.com", "Auth", "sent", new Date());

    const module = new OutboundEmailSendLogModule();
    const { records, total } = await module.getUnifiedSendLog(0, 2);
    expect(total).toBe(5);
    expect(records).toHaveLength(2);
  });

  it("returns empty when no rows exist", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const module = new OutboundEmailSendLogModule();
    const { records, total } = await module.getUnifiedSendLog(0, 100);
    expect(total).toBe(0);
    expect(records).toHaveLength(0);
  });

  it("maps authorized outcome statuses to consistent labels", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    await seedAuthorizedOutcome("failed@x.com", "F", "failed", new Date());
    await seedAuthorizedOutcome("pending@x.com", "P", "pending", null);

    const module = new OutboundEmailSendLogModule();
    const { records } = await module.getUnifiedSendLog(0, 100);
    const failed = records.find((r) => r.receiver === "failed@x.com");
    const pending = records.find((r) => r.receiver === "pending@x.com");
    expect(failed?.status).toBe("Failure");
    expect(pending?.status).toBe("Pending");
  });
});

describe("OutboundEmailSendLogModule.getUnifiedSendLogDetail", () => {
  it("returns the full legacy row (content, log, taskId, status label)", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    // Seed with distinct content/log values to prove the detail carries them.
    const model = new EmailMarketingSendLogModel(tmpDir);
    const entity = new EmailMarketingSendLogEntity();
    entity.task_id = 77;
    entity.status = SendStatus.Success;
    entity.receiver = "legacy@x.com";
    entity.title = "Legacy Detail";
    entity.content = "full legacy body";
    entity.log = "smtp transcript";
    entity.record_time = "2026-01-01T00:00:00.000Z";
    const legacyId = await model.create(entity);

    const module = new OutboundEmailSendLogModule();
    const detail = await module.getUnifiedSendLogDetail("legacy", legacyId);

    expect(detail.id).toBe(legacyId);
    expect(detail.source).toBe("legacy");
    expect(detail.status).toBe("Success");
    expect(detail.receiver).toBe("legacy@x.com");
    expect(detail.title).toBe("Legacy Detail");
    expect(detail.record_time).toBe("2026-01-01T00:00:00.000Z");
    expect(detail.content).toBe("full legacy body");
    expect(detail.log).toBe("smtp transcript");
    expect(detail.taskId).toBe(77);
    // Authorized-half fields must stay unset on a legacy row.
    expect(detail.bodyText).toBeUndefined();
    expect(detail.sender).toBeUndefined();
  });

  it("returns the authorized outcome joined to the pinned revision", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const completedAt = new Date("2026-02-03T04:05:06.000Z");
    const seeded = await seedAuthorizedOutcome(
      "auth@x.com",
      "Authorized Detail",
      "sent",
      completedAt
    );

    const module = new OutboundEmailSendLogModule();
    const detail = await module.getUnifiedSendLogDetail(
      "authorized",
      seeded.outcomeId
    );

    expect(detail.id).toBe(seeded.outcomeId);
    expect(detail.source).toBe("authorized");
    expect(detail.status).toBe("Success");
    expect(detail.receiver).toBe("auth@x.com");
    expect(detail.title).toBe("Authorized Detail");
    expect(detail.sender).toBe("sender@example.com");
    expect(detail.actor).toBe("ai");
    expect(detail.bodyText).toBe("body");
    expect(detail.completedAt).toBe("2026-02-03T04:05:06.000Z");
    expect(detail.batchId).toBeTypeOf("number");
    expect(detail.draftId).toBe(seeded.draftId);
    expect(detail.revisionId).toBe(seeded.revisionId);
    expect(detail.attemptId).toBeTypeOf("number");
    // Legacy-half fields must stay unset on an authorized row.
    expect(detail.content).toBeUndefined();
    expect(detail.log).toBeUndefined();
  });

  it("throws for an unknown legacy id", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedLegacyRow(1, SendStatus.Success, "a@x.com", "T");

    const module = new OutboundEmailSendLogModule();
    await expect(
      module.getUnifiedSendLogDetail("legacy", 999999)
    ).rejects.toThrow("send log record not found");
  });

  it("throws for an unknown authorized id", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedAuthorizedOutcome("a@x.com", "T", "sent", new Date());

    const module = new OutboundEmailSendLogModule();
    await expect(
      module.getUnifiedSendLogDetail("authorized", 999999)
    ).rejects.toThrow("send log record not found");
  });

  it("joins the revision pinned by revisionId even when the draft has moved on", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const draftModel = new OutboundEmailDraftModel(tmpDir);
    const deliveryModel = new OutboundEmailDeliveryModel(tmpDir);

    // Draft with revision 1 (the one actually sent).
    const batch = new OutboundEmailDraftBatchEntity();
    batch.conversationId = "conv-pin";
    batch.sourceUserMessageId = "msg-pin";
    batch.intentDecisionId = 1;
    batch.status = "sent";
    batch.recipientSourceType = "direct";
    batch.recipientSourceId = null;
    batch.recipientCount = 1;
    batch.validRecipientCount = 1;
    batch.emailServiceIdsJson = "[1]";
    batch.batchHash = HASH;
    batch.policyVersion = null;
    batch.validationVersion = null;
    batch.authorizationId = null;
    batch.legacyTaskId = null;
    batch.sendAttemptId = null;
    batch.lastErrorCode = null;
    batch.authorizedAt = null;
    batch.queuedAt = null;
    batch.completedAt = null;
    const savedBatch = await draftModel.createBatch(batch);

    const draft = new OutboundEmailDraftEntity();
    draft.batchId = savedBatch.id;
    draft.recipientAddress = "pin@x.com";
    draft.recipientDisplayName = null;
    draft.recipientSourceRef = null;
    draft.status = "sent";
    draft.currentRevisionId = null;
    draft.revisionNumber = 2;
    draft.contentHash = HASH;
    draft.lastErrorCode = null;
    const savedDraft = await draftModel.createDraft(draft);

    // Revision 1 — the one the outcome pins (what was actually sent).
    const rev1 = new OutboundEmailDraftRevisionEntity();
    rev1.draftId = savedDraft.id;
    rev1.revisionNumber = 1;
    rev1.actor = "ai";
    rev1.emailServiceId = 1;
    rev1.senderAddress = "pin-sender@x.com";
    rev1.recipientAddress = "pin@x.com";
    rev1.subject = "Sent Revision";
    rev1.bodyText = "sent body";
    rev1.bodyHtml = null;
    rev1.contentHash = HASH;
    rev1.personalizationEvidenceJson = null;
    rev1.knowledgeSourcesJson = null;
    rev1.generationMetadataJson = null;
    rev1.validationFindingsJson = null;
    const savedRev1 = await draftModel.createRevision(rev1);

    // Revision 2 — a LATER edit; the current revision, NOT what was sent.
    const rev2 = new OutboundEmailDraftRevisionEntity();
    rev2.draftId = savedDraft.id;
    rev2.revisionNumber = 2;
    rev2.actor = "user";
    rev2.emailServiceId = 1;
    rev2.senderAddress = "pin-sender@x.com";
    rev2.recipientAddress = "pin@x.com";
    rev2.subject = "Edited Later";
    rev2.bodyText = "edited body";
    rev2.bodyHtml = null;
    rev2.contentHash = "b".repeat(64);
    rev2.personalizationEvidenceJson = null;
    rev2.knowledgeSourcesJson = null;
    rev2.generationMetadataJson = null;
    rev2.validationFindingsJson = null;
    const savedRev2 = await draftModel.createRevision(rev2);

    const outcome = new OutboundEmailDeliveryOutcomeEntity();
    outcome.sendAttemptId = 1;
    outcome.batchId = savedBatch.id;
    outcome.draftId = savedDraft.id;
    outcome.revisionId = savedRev1.id; // pins revision 1
    outcome.envelopeHash = HASH;
    outcome.recipientAddress = "pin@x.com";
    outcome.status = "sent";
    outcome.providerMessageId = null;
    outcome.errorCode = null;
    outcome.submittedAt = null;
    outcome.completedAt = new Date();
    const savedOutcome = await deliveryModel.createOutcome(outcome);

    const module = new OutboundEmailSendLogModule();
    const detail = await module.getUnifiedSendLogDetail(
      "authorized",
      savedOutcome.id
    );

    // The pinned revision's content is shown — not the draft's current edit.
    expect(detail.title).toBe("Sent Revision");
    expect(detail.bodyText).toBe("sent body");
    expect(detail.revisionId).toBe(savedRev1.id);
    expect(detail.revisionId).not.toBe(savedRev2.id);
  });
});
