import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";

/**
 * G3 / FR-008: changing a mailbox's knowledge scope (or identity profile) must
 * invalidate every not-yet-sent draft — approved drafts return to 'draft' and
 * their approvals are consumed; terminal states are untouched.
 */
describe("invalidateUnsentDraftsForMailbox (FR-008/FR-013)", () => {
  let dbpath: string;
  let draftModel: EmailReplyDraftModel;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-scope-inval-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    draftModel = new EmailReplyDraftModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  async function seed(
    status: EmailReplyDraftEntity["status"],
    emailServiceId = 7
  ): Promise<number> {
    const draft = new EmailReplyDraftEntity();
    draft.messageId = 500;
    draft.emailServiceId = emailServiceId;
    draft.subject = "Re: x";
    draft.bodyText = "body";
    draft.bodyHtml = null;
    draft.status = status;
    draft.generationSource = "ai";
    const saved = await draftModel.create(draft);
    return saved.id;
  }

  it("returns approved drafts to draft and stamps approvalInvalidatedAt", async () => {
    const approvedId = await seed("approved");
    const plainId = await seed("draft");
    const sentId = await seed("sent");

    const invalidated = await draftModel.invalidateUnsentDraftsForMailbox(
      7,
      "Knowledge scope changed (v2)"
    );
    expect(invalidated).toBeGreaterThanOrEqual(1);

    const approved = await draftModel.readAggregate(approvedId);
    expect(approved?.status).toBe("draft");
    expect(approved?.approvalInvalidatedAt).toBeTruthy();

    const plain = await draftModel.readAggregate(plainId);
    expect(plain?.approvalInvalidatedAt).toBeTruthy();

    // Terminal states are untouched.
    const sent = await draftModel.readAggregate(sentId);
    expect(sent?.status).toBe("sent");
  });

  it("only affects the target mailbox", async () => {
    const otherId = await seed("approved", 99);
    await draftModel.invalidateUnsentDraftsForMailbox(7, "test");
    const other = await draftModel.readAggregate(otherId);
    expect(other?.status).toBe("approved");
  });
});
