import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyApprovalService } from "@/service/emailReply/EmailReplyApprovalService";
import { materializeRevision1 } from "@/service/emailReply/EmailReplyRevisionMaterializer";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";

/**
 * P0.4: a revision whose content trips a block/review finding must not reach
 * `approved`. The approval service recomputes validation from the trusted
 * revision body and throws before writing an approval or transitioning state.
 *
 * DB isolation: this file stands up its own temp DB (unique dir + resetInstance)
 * rather than sharing `os.tmpdir()/aifetchly-test`. Under vitest's default
 * thread pool many test files init the shared DataSource concurrently, and the
 * schema-sync `DROP INDEX` raced with a sibling writer → `SQLITE_BUSY_SNAPSHOT`.
 * Mirrors the EmailReplyRevisionMaterializer.test.ts beforeAll/afterAll shape.
 */
describe("P0.4 — approval blocked by validation findings", () => {
  let dbpath: string;
  let draftModule: EmailReplyDraftModule;
  let approvalService: EmailReplyApprovalService;

  beforeAll(async () => {
    dbpath = path.join(
      os.tmpdir(),
      `aifetchly-approval-validation-${Date.now()}`
    );
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    // Construct modules AFTER resetInstance so their eager repository capture
    // (BaseDb resolves this.sqliteDb.connection.getRepository(...) in the
    // constructor) binds to the isolated DataSource, not the stale pre-reset
    // singleton. EmailReplyDraftModule (extends BaseModule) reads USERSDBPATH
    // from Token (empty in tests); getInstance returns the authoritative
    // singleton (our dbpath) regardless of the path arg.
    draftModule = new EmailReplyDraftModule();
    approvalService = new EmailReplyApprovalService();
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  async function seedDraftWithBody(bodyText: string): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = 999999; // never reached: validation throws before message load
    draft.emailServiceId = 7;
    draft.subject = "Re: Pricing";
    draft.bodyText = bodyText;
    draft.bodyHtml = null;
    draft.status = "draft";
    draft.generationSource = "ai";
    const saved = await draftModule.create(draft);
    await materializeRevision1(draftModule, {
      draftId: saved.id,
      actor: "ai",
      subject: "Re: Pricing",
      bodyText,
      bodyHtml: null,
      senderAddress: "owner@svc.com",
      recipientAddress: "prospect@example.com",
      emailServiceId: 7,
      originalMessageId: 999999,
    });
    return saved.id;
  }

  it("refuses approval when the body leaks AI self-disclosure (block)", async () => {
    const draftId = await seedDraftWithBody(
      "As an AI language model, here is the answer."
    );
    await expect(
      approvalService.approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/validation findings/);
    // The draft must remain unapproved.
    const draft = await draftModule.readAggregate(draftId);
    expect(draft?.status).toBe("draft");
  });

  it("refuses approval when the body offers a refund (review)", async () => {
    const draftId = await seedDraftWithBody(
      "We can issue a full refund right away if you'd like."
    );
    await expect(
      approvalService.approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/validation findings/);
  });

  it("refuses approval when the body introduces a new URL (review)", async () => {
    const draftId = await seedDraftWithBody(
      "Please complete payment at https://pay.example.com/x"
    );
    await expect(
      approvalService.approveDraft({
        draftId,
        approvedByType: "user",
      })
    ).rejects.toThrow(/validation findings/);
  });
});
