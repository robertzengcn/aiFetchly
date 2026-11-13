import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { escapeLikePattern } from "@/model/EmailReceivedMessage.model";
import { EmailReceivedMessageModel } from "@/model/EmailReceivedMessage.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";

let dbpath = "";
let model: EmailReceivedMessageModel;

async function seed(
  id: number,
  overrides?: Partial<EmailReceivedMessageEntity>
): Promise<void> {
  const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
    EmailReceivedMessageEntity
  );
  await repo.save(
    repo.create({
      id,
      emailServiceId: 1,
      providerUid: `imap:abc:1:${id}`,
      fromAddress: "sender@example.test",
      toAddressesJson: "[]",
      subject: `subject ${id}`,
      receivedAt: new Date(),
      isUnread: 1,
      ...overrides,
    })
  );
}

describe("received-message search semantics (BUG-02/BUG-03)", () => {
  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-search-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    model = new EmailReceivedMessageModel(dbpath);
    await seed(601, { subject: "Q3 report: 100% complete" });
    await seed(602, { subject: "invoice_1 attached" });
    await seed(603, { subject: "completely unrelated" });
    await seed(604, { subject: "Q3 REPORT: 100% COMPLETE", isUnread: 0 });
    await seed(605, { subject: "quarterly number_2", isUnread: 0 });
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(dbpath, { recursive: true, force: true });
  });

  it("escapeLikePattern escapes %, _ and the escape character", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("invoice_1")).toBe("invoice\\_1");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("plain")).toBe("plain");
  });

  it("matches literal % instead of treating it as a wildcard (list)", async () => {
    const rows = await model.listByEmailService({
      emailServiceId: 1,
      page: 0,
      size: 20,
      where: "100%",
    });
    expect(rows.map((row) => row.id).sort()).toEqual([601, 604]);
  });

  it("matches literal _ instead of a single-char wildcard (list)", async () => {
    const rows = await model.listByEmailService({
      emailServiceId: 1,
      page: 0,
      size: 20,
      where: "invoice_1",
    });
    expect(rows.map((row) => row.id)).toEqual([602]);
  });

  it("keeps list and count in agreement with literal semantics", async () => {
    const rows = await model.listByEmailService({
      emailServiceId: 1,
      page: 0,
      size: 20,
      where: "_2",
    });
    const count = await model.countByEmailService({
      emailServiceId: 1,
      where: "_2",
    });
    expect(rows.map((row) => row.id)).toEqual([605]);
    expect(count).toBe(1);
  });

  it("stays case-insensitive for literal matches", async () => {
    const rows = await model.listByEmailService({
      emailServiceId: 1,
      page: 0,
      size: 20,
      where: "q3 report",
    });
    expect(rows.map((row) => row.id).sort()).toEqual([601, 604]);
  });

  it("readByIds preserves the requested order and skips unknown ids (review)", async () => {
    const rows = await model.readByIds([603, 999999, 601]);
    expect(rows.map((row) => row.id)).toEqual([603, 601]);
    expect(await model.readByIds([])).toEqual([]);
  });

  it("searchForOrganization honors date bounds, unread and attachment filters (review)", async () => {
    // receivedFrom is inclusive; receivedTo is exclusive. Seeds use now().
    const now = Date.now();
    const inclusive = await model.searchForOrganization({
      emailServiceId: 1,
      receivedFrom: new Date(now - 60 * 60 * 1000),
      receivedTo: new Date(now + 60 * 60 * 1000),
      limit: 50,
    });
    expect(inclusive.totalMatched).toBe(5);
    const exclusive = await model.searchForOrganization({
      emailServiceId: 1,
      receivedTo: new Date(now - 60 * 60 * 1000),
      limit: 50,
    });
    expect(exclusive.totalMatched).toBe(0);
    const unread = await model.searchForOrganization({
      emailServiceId: 1,
      unreadOnly: true,
      limit: 50,
    });
    expect(unread.totalMatched).toBe(3);
    const withAttachments = await model.searchForOrganization({
      emailServiceId: 1,
      hasAttachments: true,
      limit: 50,
    });
    expect(withAttachments.totalMatched).toBe(0);
    const fromSender = await model.searchForOrganization({
      emailServiceId: 1,
      fromAddress: "sender@example.test",
      limit: 50,
    });
    expect(fromSender.totalMatched).toBe(5);
  });

  it("never returns a broader set for wildcard-only input", async () => {
    // A bare "_" under wildcard semantics would match EVERY row; literal
    // semantics match only the two subjects containing a real underscore.
    const underscore = await model.listByEmailService({
      emailServiceId: 1,
      page: 0,
      size: 20,
      where: "_",
    });
    expect(underscore.map((row) => row.id).sort()).toEqual([602, 605]);
    const underscoreCount = await model.countByEmailService({
      emailServiceId: 1,
      where: "_",
    });
    expect(underscoreCount).toBe(2);
    // "%" matches only subjects containing a literal percent sign.
    const percent = await model.listByEmailService({
      emailServiceId: 1,
      page: 0,
      size: 20,
      where: "%",
    });
    expect(percent.map((row) => row.id).sort()).toEqual([601, 604]);
  });
});
