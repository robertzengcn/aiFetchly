import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailMessageLocationModel } from "@/model/EmailMessageLocation.model";
import { EmailMessageLocationEntity } from "@/entity/EmailMessageLocation.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";

let dbpath = "";
let model: EmailMessageLocationModel;

async function seedMessage(id: number, emailServiceId: number): Promise<void> {
  const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
    EmailReceivedMessageEntity
  );
  const entity = repo.create({
    id,
    emailServiceId,
    providerUid: `imap:abc123:4242:${id}`,
    fromAddress: "sender@example.com",
    toAddressesJson: "[]",
    subject: `seed ${id}`,
    receivedAt: new Date(),
    isUnread: 1,
  });
  await repo.save(entity);
}

describe("EmailMessageLocationModel", () => {
  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-loc-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    model = new EmailMessageLocationModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(dbpath, { recursive: true, force: true });
  });

  it("inserts and reads a verified location", async () => {
    await seedMessage(101, 1);
    const result = await model.upsertLocation({
      messageId: 101,
      emailServiceId: 1,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "4242",
      providerUid: "17",
      state: "verified",
    });
    expect(result.status).toBe("ok");
    const read = await model.readByMessageId(101);
    expect(read).not.toBeNull();
    expect(read?.state).toBe("verified");
    expect(read?.folderPath).toBe("INBOX");
    expect(read?.uidValidity).toBe("4242");
    expect(read?.version).toBe(1);
    expect(read?.lastVerifiedAt).not.toBeNull();
  });

  it("keeps the version when identity is unchanged and bumps it on change", async () => {
    await seedMessage(102, 1);
    await model.upsertLocation({
      messageId: 102,
      emailServiceId: 1,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "4242",
      providerUid: "18",
      state: "verified",
    });
    const same = await model.upsertLocation({
      messageId: 102,
      emailServiceId: 1,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "4242",
      providerUid: "18",
      state: "verified",
    });
    expect(same.status).toBe("ok");
    if (same.status === "ok") expect(same.entity.version).toBe(1);

    const moved = await model.upsertLocation({
      messageId: 102,
      emailServiceId: 1,
      protocol: "imap",
      folderPath: "Trash",
      uidValidity: "4242",
      providerUid: "3",
      state: "verified",
    });
    expect(moved.status).toBe("ok");
    if (moved.status === "ok") {
      expect(moved.entity.version).toBe(2);
      expect(moved.entity.folderPath).toBe("Trash");
    }
  });

  it("reports a conflict when the identity tuple belongs to another message", async () => {
    await seedMessage(103, 1);
    await seedMessage(104, 1);
    await model.upsertLocation({
      messageId: 103,
      emailServiceId: 1,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "4242",
      providerUid: "19",
      state: "verified",
    });
    const conflict = await model.upsertLocation({
      messageId: 104,
      emailServiceId: 1,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "4242",
      providerUid: "19",
      state: "verified",
    });
    expect(conflict.status).toBe("conflict");
    // The original row is untouched.
    const owner = await model.readByMessageId(103);
    expect(owner?.messageId).toBe(103);
  });

  it("applies a version-guarded move and rejects a stale expected version", async () => {
    await seedMessage(105, 1);
    await model.upsertLocation({
      messageId: 105,
      emailServiceId: 1,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "4242",
      providerUid: "20",
      state: "verified",
    });
    const before = await model.readByMessageId(105);
    expect(before?.version).toBe(1);

    const applied = await model.applyMove({
      messageId: 105,
      expectedVersion: 1,
      folderPath: "Trash",
      uidValidity: "4242",
      providerUid: "9",
      state: "verified",
      lastOperationId: "op-1",
    });
    expect(applied).toBe(true);
    const after = await model.readByMessageId(105);
    expect(after?.folderPath).toBe("Trash");
    expect(after?.providerUid).toBe("9");
    expect(after?.version).toBe(2);
    expect(after?.lastOperationId).toBe("op-1");

    const staleAttempt = await model.applyMove({
      messageId: 105,
      expectedVersion: 1,
      folderPath: "INBOX",
      uidValidity: "4242",
      providerUid: "20",
      state: "verified",
      lastOperationId: "op-2",
    });
    expect(staleAttempt).toBe(false);
    const untouched = await model.readByMessageId(105);
    expect(untouched?.folderPath).toBe("Trash");
  });

  it("marks locations stale", async () => {
    await seedMessage(106, 1);
    await model.upsertLocation({
      messageId: 106,
      emailServiceId: 1,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "4242",
      providerUid: "21",
      state: "verified",
    });
    expect(await model.markStale(106)).toBe(true);
    const row = await model.readByMessageId(106);
    expect(row?.state).toBe("stale");
    // Second call is a no-op (already stale).
    expect(await model.markStale(106)).toBe(false);
  });

  it("backfills legacy_unverified rows idempotently", async () => {
    await seedMessage(107, 2);
    await seedMessage(108, 2);
    // One message already has a location — backfill must skip it.
    await model.upsertLocation({
      messageId: 107,
      emailServiceId: 2,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "777",
      providerUid: "5",
      state: "verified",
    });

    const inserted = await model.backfillLegacyLocations([
      {
        messageId: 107,
        emailServiceId: 2,
        protocol: "imap",
        folderPath: "INBOX",
        uidValidity: "777",
        providerUid: "5",
      },
      {
        messageId: 108,
        emailServiceId: 2,
        protocol: "pop3",
        folderPath: null,
        uidValidity: null,
        providerUid: "pop3:deadbeef",
      },
    ]);
    expect(inserted).toBe(1);

    const legacy = await model.readByMessageId(108);
    expect(legacy?.state).toBe("legacy_unverified");
    expect(legacy?.protocol).toBe("pop3");
    expect(legacy?.folderPath).toBeNull();

    // Second run inserts nothing.
    const second = await model.backfillLegacyLocations([
      {
        messageId: 108,
        emailServiceId: 2,
        protocol: "pop3",
        folderPath: null,
        uidValidity: null,
        providerUid: "pop3:deadbeef",
      },
    ]);
    expect(second).toBe(0);
  });

  it("finds message ids without a location row", async () => {
    await seedMessage(109, 3);
    const missing = await model.findMessageIdsWithoutLocation([109, 99999]);
    expect(missing).toEqual([109, 99999]);
    await model.upsertLocation({
      messageId: 109,
      emailServiceId: 3,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "1",
      providerUid: "1",
      state: "verified",
    });
    const after = await model.findMessageIdsWithoutLocation([109, 99999]);
    expect(after).toEqual([99999]);
  });

  it("stores uidValidity as a decimal string without bigint serialization issues", async () => {
    await seedMessage(110, 1);
    const bigValidity = "9007199254740993"; // 2^53 + 1 — unsafe as a JS number
    await model.upsertLocation({
      messageId: 110,
      emailServiceId: 1,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: bigValidity,
      providerUid: "1",
      state: "verified",
    });
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailMessageLocationEntity
    );
    const raw = await repo.findOne({ where: { messageId: 110 } });
    expect(raw?.uidValidity).toBe(bigValidity);
  });
});
