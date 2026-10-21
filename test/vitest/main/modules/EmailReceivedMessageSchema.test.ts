import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { SqliteDb } from "@/config/SqliteDb";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReceivedMessageWriteSchema } from "@/schemas/entity/emailReceivedMessage";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";

/**
 * T03/FR-030 Step 1 — the 9 mailbox-reply-evidence columns (technical design
 * §5.1) must be declared in the write schema or `parseAndStrip` silently drops
 * them before persistence. Proves the schema accepts all fields, that
 * `parseAndStrip` preserves them, and the defaults when omitted.
 */
describe("emailReceivedMessageWriteSchema mailbox evidence fields (T03)", () => {
  const BASE = {
    emailServiceId: 1,
    providerUid: "imap:abc:42:7",
    fromAddress: "prospect@example.com",
    toAddressesJson: '["me@x.com"]',
    subject: "Pricing?",
    receivedAt: new Date("2026-10-05T10:00:00Z"),
  };

  it("accepts all 9 evidence fields", () => {
    const parsed = emailReceivedMessageWriteSchema().parse({
      ...BASE,
      isAnswered: 1,
      answeredFlagCheckedAt: new Date("2026-10-05T10:01:00Z"),
      replyDetectedAt: new Date("2026-10-05T10:02:00Z"),
      replyDetectionSource: "mailbox_flag",
      replyMatchedMessageId: "<reply-1@example.com>",
      replyNegativeCheckAt: null,
      replyNegativeContextHash: null,
      providerFolder: "INBOX",
      providerUidValidity: "42",
    });
    expect(parsed.isAnswered).toBe(1);
    expect(parsed.replyDetectionSource).toBe("mailbox_flag");
    expect(parsed.replyMatchedMessageId).toBe("<reply-1@example.com>");
    expect(parsed.providerFolder).toBe("INBOX");
    expect(parsed.providerUidValidity).toBe("42");
  });

  it("defaults to null/undefined when evidence fields are omitted", () => {
    const parsed = emailReceivedMessageWriteSchema().parse(BASE);
    expect(parsed.isAnswered).toBeUndefined();
    expect(parsed.answeredFlagCheckedAt).toBeUndefined();
    expect(parsed.replyDetectedAt).toBeUndefined();
    expect(parsed.replyDetectionSource).toBeUndefined();
    expect(parsed.replyMatchedMessageId).toBeUndefined();
    expect(parsed.replyNegativeCheckAt).toBeUndefined();
    expect(parsed.replyNegativeContextHash).toBeUndefined();
    expect(parsed.providerFolder).toBeUndefined();
    expect(parsed.providerUidValidity).toBeUndefined();
  });

  it("parseAndStrip preserves evidence fields into the entity shape", () => {
    const entity = parseAndStrip(
      {
        ...BASE,
        isAnswered: 1,
        answeredFlagCheckedAt: new Date("2026-10-05T10:01:00Z"),
        replyDetectedAt: new Date("2026-10-05T10:02:00Z"),
        replyDetectionSource: "sent_search",
        replyMatchedMessageId: "<sent-1@example.com>",
        replyNegativeCheckAt: new Date("2026-10-05T10:00:00Z"),
        replyNegativeContextHash: "hash123",
        providerFolder: "[Gmail]/Sent Mail",
        providerUidValidity: "99",
      },
      emailReceivedMessageWriteSchema()
    );
    expect(entity.isAnswered).toBe(1);
    expect(entity.replyDetectionSource).toBe("sent_search");
    expect(entity.replyMatchedMessageId).toBe("<sent-1@example.com>");
    expect(entity.replyNegativeCheckAt).toBeInstanceOf(Date);
    expect(entity.replyNegativeContextHash).toBe("hash123");
    expect(entity.providerFolder).toBe("[Gmail]/Sent Mail");
    expect(entity.providerUidValidity).toBe("99");
  });

  it("parseAndStrip drops unknown keys and leaves evidence at schema defaults", () => {
    const entity = parseAndStrip(
      { ...BASE, unknownJunkKey: "x" },
      emailReceivedMessageWriteSchema()
    );
    expect(
      (entity as unknown as Record<string, unknown>).unknownJunkKey
    ).toBeUndefined();
    expect(entity.isAnswered).toBeUndefined();
    expect(entity.replyDetectedAt).toBeUndefined();
    expect(entity.replyNegativeCheckAt).toBeUndefined();
    expect(entity.providerFolder).toBeUndefined();
  });

  it("round-trips a real entity through SQLite with evidence columns", async () => {
    const dbpath = path.join(os.tmpdir(), `aifetchly-msg-schema-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    try {
      await SqliteDb.resetInstance(dbpath);
      await SqliteDb.ensureInitialized();
      const entity = new EmailReceivedMessageEntity();
      entity.emailServiceId = 1;
      entity.providerUid = "imap:abc:42:7";
      entity.fromAddress = "prospect@example.com";
      entity.toAddressesJson = '["me@x.com"]';
      entity.subject = "Pricing?";
      entity.receivedAt = new Date();
      entity.isAnswered = 1;
      entity.answeredFlagCheckedAt = new Date();
      entity.replyDetectedAt = new Date();
      entity.replyDetectionSource = "mailbox_flag";
      entity.replyMatchedMessageId = "<reply-1@example.com>";
      entity.replyNegativeCheckAt = null;
      entity.replyNegativeContextHash = null;
      entity.providerFolder = "INBOX";
      entity.providerUidValidity = null;
      const saved = await SqliteDb.getInstance(dbpath).connection
        .getRepository(EmailReceivedMessageEntity)
        .save(entity);
      const reloaded = await SqliteDb.getInstance(dbpath).connection
        .getRepository(EmailReceivedMessageEntity)
        .findOneByOrFail({ id: saved.id });
      expect(reloaded.isAnswered).toBe(1);
      expect(reloaded.replyDetectionSource).toBe("mailbox_flag");
      expect(reloaded.replyDetectedAt).toBeInstanceOf(Date);
      expect(reloaded.replyNegativeCheckAt).toBeNull();
      expect(reloaded.providerFolder).toBe("INBOX");
      expect(reloaded.providerUidValidity).toBeNull();
    } finally {
      await SqliteDb.destroyInstance();
      try {
        fs.rmSync(dbpath, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  });
});
