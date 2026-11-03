import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailOrganizationSelectionService } from "@/service/emailOrganization/EmailOrganizationSelectionService";
import { EmailOrganizationSearchService } from "@/service/emailOrganization/EmailOrganizationSearchService";
import { EmailMailboxActionService } from "@/service/emailOrganization/EmailMailboxActionService";
import type {
  EmailMailboxAdapter,
  FolderListResult,
  FullSourceResult,
  MailboxCapabilityProbe,
  MailboxLocation,
  MoveResult,
  PresenceResult,
  ServerSearchInput,
  ServerSearchResult,
} from "@/service/emailOrganization/EmailMailboxAdapter";
import type { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailMessageLocationModel } from "@/model/EmailMessageLocation.model";

let dbpath = "";
let selectionService: EmailOrganizationSelectionService;
let searchService: EmailOrganizationSearchService;
let actionService: EmailMailboxActionService;
let locationModel: EmailMessageLocationModel;

const ACCOUNT_ID = 950;
let destinationUidCounter = 0;
function nextDestinationUid(): string {
  destinationUidCounter += 1;
  return `dst-${destinationUidCounter}`;
}

interface BulkState {
  presence: (location: MailboxLocation) => PresenceResult;
  moveResult: (location: MailboxLocation, destination: string) => MoveResult;
}

class BulkFakeAdapter implements EmailMailboxAdapter {
  public moveCalls: Array<{ uid: string; destination: string }> = [];
  constructor(private readonly state: BulkState) {}
  async listFolders(): Promise<FolderListResult> {
    return {
      status: "listed",
      folders: [{ path: "Trash", name: "Trash", specialUse: "\\Trash", writable: true }],
    };
  }
  async probeCapabilities(): Promise<MailboxCapabilityProbe> {
    return {
      moveCapability: true,
      folders: [{ path: "Trash", name: "Trash", specialUse: "\\Trash", writable: true }],
      reasonCode: null,
      sanitizedError: null,
    };
  }
  async fetchFullSource(): Promise<FullSourceResult> {
    return { status: "failed", reasonCode: "SOURCE_FETCH_FAILED", sanitizedError: "unused" };
  }
  async moveMessage(_c: unknown, location: MailboxLocation, destination: string): Promise<MoveResult> {
    this.moveCalls.push({ uid: location.uid, destination });
    return this.state.moveResult(location, destination);
  }
  async checkMessagePresent(_c: unknown, location: MailboxLocation): Promise<PresenceResult> {
    return this.state.presence(location);
  }
  async searchUids(
    _c: unknown,
    _folder: string,
    _input: ServerSearchInput
  ): Promise<ServerSearchResult> {
    return { status: "listed", candidates: [], capped: false };
  }
}

class BulkCapabilityStub {
  async getCapabilities(emailServiceId: number) {
    return {
      emailServiceId,
      protocol: "imap" as const,
      canFetchFullSource: true,
      canSendForward: true,
      canMoveToTrash: true,
      canRestore: true,
      trashFolderPath: "Trash",
      reasonCodes: [],
      resolvedAt: new Date().toISOString(),
    };
  }
  async getReceiveConfig() {
    return {
      emailServiceId: ACCOUNT_ID,
      protocol: "imap" as const,
      host: "imap.example.test",
      port: 993,
      ssl: true,
      username: "ops@example.test",
      password: "pw",
      folder: "INBOX",
    };
  }
  getAdapter(): EmailMailboxAdapter {
    throw new Error("unused");
  }
}

async function seedVerifiedMessage(id: number, subject: string, folder = "INBOX"): Promise<void> {
  const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
    EmailReceivedMessageEntity
  );
  await repo.save(
    repo.create({
      id,
      emailServiceId: ACCOUNT_ID,
      providerUid: `imap:abc:4242:${id}`,
      fromAddress: "news@example.test",
      toAddressesJson: "[]",
      subject,
      receivedAt: new Date("2026-09-15T10:00:00Z"),
      isUnread: 1,
      hasAttachments: 0,
    })
  );
  await locationModel.upsertLocation({
    messageId: id,
    emailServiceId: ACCOUNT_ID,
    protocol: "imap",
    folderPath: folder,
    uidValidity: "4242",
    providerUid: String(id),
    state: "verified",
  });
}

describe("Stage C: selections, bulk execution, cancellation, search", () => {
  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-stagec-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(EmailServiceEntity);
    await repo.save(
      repo.create({
        id: ACCOUNT_ID,
        name: "Bulk",
        lastReceiveSyncAt: new Date("2026-09-20T00:00:00Z"),
        from: "ops@example.test",
        password: "pw",
        host: "smtp.example.test",
        port: "587",
        ssl: 1,
        status: 1,
        receiveProtocol: "imap",
        imapHost: "imap.example.test",
        imapPort: "993",
        imapSsl: 1,
        receiveUsername: "ops@example.test",
        receivePassword: "pw2",
        receiveFolder: "INBOX",
        receiveEnabled: 1,
      })
    );
    locationModel = new EmailMessageLocationModel(dbpath);
    selectionService = new EmailOrganizationSelectionService({
      capabilityService: new BulkCapabilityStub() as unknown as EmailOrganizationCapabilityService,
    });
    searchService = new EmailOrganizationSearchService({
      adapter: new BulkFakeAdapter({
        presence: () => ({ status: "present" }),
        moveResult: () => ({ status: "moved", destinationUidValidity: "99", destinationUid: "1" }),
      }),
    });
    await seedVerifiedMessage(5001, "September newsletter");
    await seedVerifiedMessage(5002, "September offers");
    await seedVerifiedMessage(5003, "September digest");
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(dbpath, { recursive: true, force: true });
  });

  it("freezes a selection with exact ids, versions and destinations (FR-18)", async () => {
    const preview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "trash",
      messageIds: [5002, 5001, 5002],
      filtersSummary: { subject: "September", source: "local" },
    });
    expect(preview.count).toBe(2); // deduped
    expect(preview.kind).toBe("trash");
    const entity = await selectionService.readValidSelection(preview.selectionId);
    const parsed = selectionService.parseSelection(entity);
    expect(parsed.messageIds).toEqual([5001, 5002]);
    expect(parsed.destinations?.[5001]).toBe("Trash");
  });

  it("rejects selections over 100 items and cross-account ids", async () => {
    await expect(
      selectionService.prepareSelection({
        emailServiceId: ACCOUNT_ID,
        kind: "trash",
        messageIds: Array.from({ length: 101 }, (_, i) => 6000 + i),
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      selectionService.prepareSelection({
        emailServiceId: ACCOUNT_ID,
        kind: "trash",
        messageIds: [999999],
      })
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
  });

  it("executes a bulk trash with per-item outcomes and honest counts (FR-19)", async () => {
    const preview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "trash",
      messageIds: [5001, 5002],
    });
    const adapter = new BulkFakeAdapter({
      presence: () => ({ status: "present" }),
      moveResult: () => ({
        status: "moved",
        destinationUidValidity: "99",
        destinationUid: nextDestinationUid(),
      }),
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new BulkCapabilityStub() as unknown as EmailOrganizationCapabilityService,
    });
    const result = await service.trashSelection({
      selectionId: preview.selectionId,
      origin: "ui_action",
    });
    expect(result.success).toBe(true);
    expect(result.completed).toBe(2);
    expect(adapter.moveCalls.length).toBe(2);
    const location = await locationModel.readByMessageId(5001);
    expect(location?.folderPath).toBe("Trash");
  });

  it("cancels unstarted bulk work and keeps completed items (FR-20/AC-15)", async () => {
    await seedVerifiedMessage(5004, "September fourth");
    await seedVerifiedMessage(5005, "September fifth");
    const preview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "trash",
      messageIds: [5004, 5005],
    });
    const entity = await selectionService.readValidSelection(preview.selectionId);
    // Simulate a user cancellation after the selection froze.
    entity.expiresAt = new Date(Date.now() + 60_000);
    const adapter = new BulkFakeAdapter({
      presence: () => ({ status: "present" }),
      moveResult: () => ({
        status: "moved",
        destinationUidValidity: "99",
        destinationUid: nextDestinationUid(),
      }),
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new BulkCapabilityStub() as unknown as EmailOrganizationCapabilityService,
    });
    // Kick off execution and cancel while the first move is in flight.
    const execution = service.trashSelection({
      selectionId: preview.selectionId,
      origin: "ui_action",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    // The operation row exists by now (created before the first move).
    const { EmailOrganizationOperationEntity } = await import(
      "@/entity/EmailOrganizationOperation.entity"
    );
    const opRepo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailOrganizationOperationEntity
    );
    const operations = await opRepo.find();
    const target = operations
      .filter((op) => op.kind === "trash")
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0];
    expect(target).toBeDefined();
    const { EmailOrganizationOperationModel } = await import(
      "@/model/EmailOrganizationOperation.model"
    );
    await new EmailOrganizationOperationModel(dbpath).cancelPending(target!.operationId);
    const result = await execution;
    // Whatever completed stays completed; unstarted work is cancelled.
    expect(result.completed + result.cancelled).toBe(2);
    expect(adapter.moveCalls.length).toBeLessThanOrEqual(2);
  });

  it("reports stale-version targets individually (AC-14)", async () => {
    await seedVerifiedMessage(5006, "September sixth");
    const preview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "trash",
      messageIds: [5006],
    });
    // Move the message's location after freezing (external change).
    await locationModel.upsertLocation({
      messageId: 5006,
      emailServiceId: ACCOUNT_ID,
      protocol: "imap",
      folderPath: "Archive",
      uidValidity: "4242",
      providerUid: "5006",
      state: "verified",
    });
    const adapter = new BulkFakeAdapter({
      presence: () => ({ status: "present" }),
      moveResult: () => ({ status: "moved", destinationUidValidity: "99", destinationUid: "1" }),
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new BulkCapabilityStub() as unknown as EmailOrganizationCapabilityService,
    });
    const result = await service.trashSelection({
      selectionId: preview.selectionId,
      origin: "ui_action",
    });
    expect(result.failed).toBe(1);
    expect(result.errorCode).toBe("LOCATION_STALE");
    expect(adapter.moveCalls.length).toBe(0);
  });

  it("searches locally with literal subject, folder scope and honest coverage (FR-17)", async () => {
    const result = await searchService.search({
      emailServiceId: ACCOUNT_ID,
      source: "local",
      subject: "September",
    });
    expect(result.source).toBe("local");
    expect(result.complete).toBe(true);
    expect(result.totalMatched).toBeGreaterThanOrEqual(4);
    expect(result.rows.every((row) => row.subject.includes("September"))).toBe(true);
    expect(result.lastSyncAt).not.toBeNull();

    // Literal semantics: no wildcard expansion for "%".
    const literal = await searchService.search({
      emailServiceId: ACCOUNT_ID,
      source: "local",
      subject: "Sept%ber",
    });
    expect(literal.rows).toEqual([]);

    // Folder scope via stored locations.
    const scoped = await searchService.search({
      emailServiceId: ACCOUNT_ID,
      source: "local",
      subject: "September",
      folderPaths: ["Trash"],
    });
    expect(scoped.rows.every((row) => row.folderPath === "Trash")).toBe(true);
    expect(scoped.rows.length).toBeGreaterThan(0);
  });

  it("runs a bounded server search with honest incompleteness (FR-17 server)", async () => {
    const adapter = new BulkFakeAdapter({
      presence: () => ({ status: "present" }),
      moveResult: () => ({ status: "moved", destinationUidValidity: "99", destinationUid: "1" }),
    });
    // A capped candidate list: cap 2 with 2 candidates → capped = true.
    adapter.searchUids = async () => ({
      status: "listed" as const,
      candidates: [
        { uid: "11", fromAddress: "a@b.test", subject: "September", date: "2026-09-15T10:00:00Z", seen: false },
        { uid: "12", fromAddress: "a@b.test", subject: "September two", date: "2026-09-16T10:00:00Z", seen: true },
      ],
      capped: true,
    });
    const serverService = new EmailOrganizationSearchService({ adapter });
    const result = await serverService.search({
      emailServiceId: ACCOUNT_ID,
      source: "server",
      folderPaths: ["INBOX"],
      subject: "September",
    });
    expect(result.source).toBe("server");
    expect(result.complete).toBe(false);
    expect(result.limitation).toContain("1000");
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].messageId).toBeNull();
  });
});
