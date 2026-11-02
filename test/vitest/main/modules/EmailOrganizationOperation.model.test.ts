import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailOrganizationOperationModel } from "@/model/EmailOrganizationOperation.model";
import { EmailOrganizationAuthorizationModel } from "@/model/EmailOrganizationAuthorization.model";
import { EmailMessageLocationModel } from "@/model/EmailMessageLocation.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";

let dbpath = "";
let operations: EmailOrganizationOperationModel;
let authorizations: EmailOrganizationAuthorizationModel;

async function seedMessage(id: number): Promise<void> {
  const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
    EmailReceivedMessageEntity
  );
  await repo.save(
    repo.create({
      id,
      emailServiceId: 1,
      providerUid: `imap:abc:1:${id}`,
      fromAddress: "sender@example.com",
      toAddressesJson: "[]",
      subject: `seed ${id}`,
      receivedAt: new Date(),
      isUnread: 1,
    })
  );
}

function createInput(operationId: string, messageIds: number[]) {
  return {
    operationId,
    kind: "trash" as const,
    emailServiceId: 1,
    origin: "ui_action" as const,
    payloadHash: "a".repeat(64),
    idempotencyKey: `trash:acct1:${operationId}`,
    messageIds,
  };
}

describe("EmailOrganizationOperationModel + AuthorizationModel", () => {
  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-orgop-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    operations = new EmailOrganizationOperationModel(dbpath);
    authorizations = new EmailOrganizationAuthorizationModel(dbpath);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(dbpath, { recursive: true, force: true });
  });

  it("creates an operation with pending items and resolves duplicates by idempotency key", async () => {
    await seedMessage(201);
    await seedMessage(202);
    const created = await operations.createOperation(createInput("op-201-aaaa", [201, 202]));
    expect(created.status).toBe("created");
    if (created.status !== "created") throw new Error("unreachable");
    expect(created.items.length).toBe(2);

    const duplicate = await operations.createOperation(createInput("op-201-aaaa", [201, 202]));
    expect(duplicate.status).toBe("existing");
    if (duplicate.status === "existing") {
      expect(duplicate.operation.operationId).toBe("op-201-aaaa");
    }
  });

  it("claims an item exactly once and records the attempt before dispatch", async () => {
    await seedMessage(203);
    await operations.createOperation(createInput("op-203-aaaa", [203]));
    const locationModel = new EmailMessageLocationModel(dbpath);
    await locationModel.upsertLocation({
      messageId: 203,
      emailServiceId: 1,
      protocol: "imap",
      folderPath: "INBOX",
      uidValidity: "42",
      providerUid: "7",
      state: "verified",
    });
    const location = await locationModel.readByMessageId(203);
    expect(location?.version).toBe(1);

    const claimInput = {
      operationId: "op-203-aaaa",
      messageId: 203,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      location: {
        version: location?.version ?? null,
        folderPath: location?.folderPath ?? null,
        uidValidity: location?.uidValidity ?? null,
        providerUid: location?.providerUid ?? null,
      },
      destinationFolderPath: "Trash",
    };
    const claim = await operations.claimItem({
      ...claimInput,
      claimTokenHash: "b".repeat(64),
    });
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("unreachable");
    expect(claim.itemId).toBeGreaterThan(0);
    expect(claim.attemptId).toBeGreaterThan(0);

    const op = await operations.read("op-203-aaaa");
    expect(op?.status).toBe("running");
    expect(op?.startedAt).not.toBeNull();

    const second = await operations.claimItem({
      ...claimInput,
      claimTokenHash: "c".repeat(64),
    });
    expect(second.status).toBe("item_not_pending");
  });

  it("finalizes a claimed item and derives the terminal aggregate", async () => {
    await seedMessage(204);
    await operations.createOperation(createInput("op-204-aaaa", [204]));
    await operations.claimItem({
      operationId: "op-204-aaaa",
      messageId: 204,
      claimTokenHash: "d".repeat(64),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      location: { version: 1, folderPath: "INBOX", uidValidity: "42", providerUid: "8" },
      destinationFolderPath: "Trash",
    });
    const items = await operations.listItems("op-204-aaaa");
    expect(items.length).toBe(1);

    await operations.finalizeItem({
      itemId: items[0].id,
      operationId: "op-204-aaaa",
      status: "succeeded",
      attemptId: null,
    });

    const op = await operations.read("op-204-aaaa");
    expect(op?.status).toBe("succeeded");
    expect(op?.completedCount).toBe(1);
    expect(op?.completedAt).not.toBeNull();
  });

  it("marks outcome_unknown items as needs_reconciliation", async () => {
    await seedMessage(205);
    await operations.createOperation(createInput("op-205-aaaa", [205]));
    await operations.claimItem({
      operationId: "op-205-aaaa",
      messageId: 205,
      claimTokenHash: "e".repeat(64),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      location: { version: 1, folderPath: "INBOX", uidValidity: "42", providerUid: "9" },
      destinationFolderPath: "Trash",
    });
    const items = await operations.listItems("op-205-aaaa");
    await operations.finalizeItem({
      itemId: items[0].id,
      operationId: "op-205-aaaa",
      status: "outcome_unknown",
      errorCode: "OUTCOME_UNKNOWN",
      attemptId: null,
    });
    const op = await operations.read("op-205-aaaa");
    expect(op?.status).toBe("needs_reconciliation");
    expect(op?.unknownCount).toBe(1);
  });

  it("never downgrades a terminal item on duplicate finalize", async () => {
    await seedMessage(206);
    await operations.createOperation(createInput("op-206-aaaa", [206]));
    await operations.claimItem({
      operationId: "op-206-aaaa",
      messageId: 206,
      claimTokenHash: "f".repeat(64),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      location: { version: 1, folderPath: "INBOX", uidValidity: "42", providerUid: "10" },
      destinationFolderPath: "Trash",
    });
    const items = await operations.listItems("op-206-aaaa");
    await operations.finalizeItem({
      itemId: items[0].id,
      operationId: "op-206-aaaa",
      status: "succeeded",
      attemptId: null,
    });
    // Late duplicate reports unknown — must not overwrite success.
    await operations.finalizeItem({
      itemId: items[0].id,
      operationId: "op-206-aaaa",
      status: "outcome_unknown",
      attemptId: null,
    });
    const refreshed = await operations.listItems("op-206-aaaa");
    expect(refreshed[0].status).toBe("succeeded");
  });

  it("cancels pending items while preserving completed ones", async () => {
    await seedMessage(207);
    await seedMessage(208);
    await operations.createOperation(createInput("op-207-aaaa", [207, 208]));
    await operations.claimItem({
      operationId: "op-207-aaaa",
      messageId: 207,
      claimTokenHash: "0".repeat(64),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      location: { version: 1, folderPath: "INBOX", uidValidity: "42", providerUid: "11" },
      destinationFolderPath: "Trash",
    });
    const items = await operations.listItems("op-207-aaaa");
    const claimedItem = items.find((item) => item.messageId === 207);
    if (!claimedItem) throw new Error("claimed item missing");
    await operations.finalizeItem({
      itemId: claimedItem.id,
      operationId: "op-207-aaaa",
      status: "succeeded",
      attemptId: null,
    });

    await operations.cancelPending("op-207-aaaa");
    const after = await operations.listItems("op-207-aaaa");
    const states = new Map(after.map((item) => [item.messageId, item.status]));
    expect(states.get(207)).toBe("succeeded");
    expect(states.get(208)).toBe("cancelled");
    const op = await operations.read("op-207-aaaa");
    expect(op?.status).toBe("cancelled");
    expect(op?.cancelRequestedAt).not.toBeNull();
  });

  it("refuses claims once the operation is cancelled", async () => {
    await seedMessage(209);
    await operations.createOperation(createInput("op-209-aaaa", [209]));
    await operations.cancelPending("op-209-aaaa");
    const claim = await operations.claimItem({
      operationId: "op-209-aaaa",
      messageId: 209,
      claimTokenHash: "1".repeat(64),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      location: { version: 1, folderPath: "INBOX", uidValidity: "42", providerUid: "12" },
      destinationFolderPath: "Trash",
    });
    expect(claim.status).toBe("operation_cancelled");
  });

  it("finds expired claims for reconciliation", async () => {
    await seedMessage(210);
    await operations.createOperation(createInput("op-210-aaaa", [210]));
    await operations.claimItem({
      operationId: "op-210-aaaa",
      messageId: 210,
      claimTokenHash: "2".repeat(64),
      leaseExpiresAt: new Date(Date.now() - 1000),
      location: { version: 1, folderPath: "INBOX", uidValidity: "42", providerUid: "13" },
      destinationFolderPath: "Trash",
    });
    const expired = await operations.findExpiredClaims(new Date());
    const target = expired.find((pair) => pair.item.messageId === 210);
    expect(target).toBeDefined();
  });

  it("issues, consumes exactly once, and refuses re-consumption", async () => {
    const now = new Date();
    const issued = await authorizations.issue({
      payloadHash: "a".repeat(64),
      origin: "ui_action",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(await authorizations.consume(issued.id, new Date())).toBe(true);
    expect(await authorizations.consume(issued.id, new Date())).toBe(false);
  });

  it("refuses an expired authorization", async () => {
    const now = new Date();
    const issued = await authorizations.issue({
      payloadHash: "b".repeat(64),
      origin: "direct_request",
      expiresAt: new Date(now.getTime() - 1000),
    });
    expect(await authorizations.consume(issued.id, new Date())).toBe(false);
  });

  it("revokes unconsumed authorizations and reports spendability", async () => {
    const now = new Date();
    const issued = await authorizations.issue({
      draftId: 55,
      revisionId: 3,
      payloadHash: "c".repeat(64),
      origin: "ui_review",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(authorizations.isSpendable(issued, new Date())).toBe(true);
    expect(await authorizations.revoke(issued.id, "payload changed", new Date())).toBe(true);
    const after = await authorizations.read(issued.id);
    expect(after?.revokedAt).not.toBeNull();
    expect(after && authorizations.isSpendable(after, new Date())).toBe(false);
  });

  it("revokes all unconsumed authorizations for a draft", async () => {
    const now = new Date();
    await authorizations.issue({
      draftId: 77,
      revisionId: 1,
      payloadHash: "d".repeat(64),
      origin: "ui_review",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const consumed = await authorizations.issue({
      draftId: 77,
      revisionId: 1,
      payloadHash: "d".repeat(64),
      origin: "ui_review",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await authorizations.consume(consumed.id, new Date());

    const revoked = await authorizations.revokeAllForDraft(77, "draft edited", new Date());
    expect(revoked).toBe(1);
  });
});
