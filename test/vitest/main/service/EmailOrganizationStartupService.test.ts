import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import {
  EmailOrganizationStartupService,
  deriveProtocolFromProviderUid,
} from "@/service/emailOrganization/EmailOrganizationStartupService";
import { EmailMessageLocationModel } from "@/model/EmailMessageLocation.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";

let dbpath = "";
let locationModel: EmailMessageLocationModel;

async function seedMessage(
  id: number,
  providerUid: string,
  providerFolder: string | null,
  providerUidValidity: string | null
): Promise<void> {
  const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
    EmailReceivedMessageEntity
  );
  await repo.save(
    repo.create({
      id,
      emailServiceId: 810,
      providerUid,
      providerFolder,
      providerUidValidity,
      fromAddress: "legacy@example.test",
      toAddressesJson: "[]",
      subject: `legacy ${id}`,
      receivedAt: new Date(),
      isUnread: 1,
    })
  );
}

describe("EmailOrganizationStartupService.ensureLocationBackfill", () => {
  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-backfill-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    locationModel = new EmailMessageLocationModel(dbpath);
    // Mixed legacy population: pre-namespace bare uid, POP3 uidl hash, and a
    // namespaced uid (post-FR-030 row that lost its location somehow).
    await seedMessage(4001, "17", "INBOX", "4242");
    await seedMessage(4002, "pop3:9f2c1a", null, null);
    await seedMessage(4003, "imap:abc123def45678:4242:99", "INBOX", "4242");
    await seedMessage(4004, "18", "INBOX", "4242");
    // This message already has a location row — the backfill must skip it.
    await seedMessage(4005, "19", "INBOX", "4242");
    await locationModel.upsertLocation({
      messageId: 4005,
      emailServiceId: 810,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "4242",
      providerUid: "19",
      state: "verified",
    });
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(dbpath, { recursive: true, force: true });
  });

  it("backfills missing locations as legacy_unverified with the right identity form", async () => {
    const service = new EmailOrganizationStartupService();
    const inserted = await service.ensureLocationBackfill();
    expect(inserted).toBe(4);

    const bare = await locationModel.readByMessageId(4001);
    expect(bare?.state).toBe("legacy_unverified");
    expect(bare?.protocol).toBe("imap");
    expect(bare?.providerUid).toBe("17");

    const pop3 = await locationModel.readByMessageId(4002);
    expect(pop3?.protocol).toBe("pop3");
    expect(pop3?.providerUid).toBe("pop3:9f2c1a");

    // Namespaced rows are normalized to the bare uid (the same form the live
    // sync writes) so the tuple index sees one consistent identity form.
    const namespaced = await locationModel.readByMessageId(4003);
    expect(namespaced?.providerUid).toBe("99");
    expect(namespaced?.uidValidity).toBe("4242");
    expect(namespaced?.state).toBe("legacy_unverified");

    // Existing rows are untouched.
    const existing = await locationModel.readByMessageId(4005);
    expect(existing?.state).toBe("verified");
    expect(existing?.version).toBe(1);
  });

  it("is a no-op on the second call (idempotent)", async () => {
    const service = new EmailOrganizationStartupService();
    expect(await service.ensureLocationBackfill()).toBe(0);
    expect(await service.ensureLocationBackfill()).toBe(0);
  });

  it("derives the protocol from the provider uid prefix", () => {
    expect(deriveProtocolFromProviderUid("pop3:abc")).toBe("pop3");
    expect(deriveProtocolFromProviderUid("imap:abc:1:2")).toBe("imap");
    expect(deriveProtocolFromProviderUid("17")).toBe("imap");
  });
});
