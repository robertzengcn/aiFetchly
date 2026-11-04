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
import { EmailOrganizationOperationModel } from "@/model/EmailOrganizationOperation.model";
import { EmailOrganizationOperationEntity } from "@/entity/EmailOrganizationOperation.entity";

let dbpath = "";
let selectionService: EmailOrganizationSelectionService;
let searchService: EmailOrganizationSearchService;
let locationModel: EmailMessageLocationModel;
let opModel: EmailOrganizationOperationModel;
let destinationUidCounter = 0;

const ACCOUNT_ID = 950;

function nextDestinationUid(): string {
  destinationUidCounter += 1;
  return `dst-${destinationUidCounter}`;
}

class BulkFakeAdapter implements EmailMailboxAdapter {
  public moveCalls: Array<{ uid: string; destination: string }> = [];
  public onMove?: (uid: string) => void;
  public state: BulkState = {
    presence: () => ({ status: "present" }),
    moveResult: () => ({ status: "moved", destinationUidValidity: "99", destinationUid: nextDestinationUid() }),
  };

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
    this.onMove?.(location.uid);
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

interface BulkState {
  presence: (location: MailboxLocation) => PresenceResult;
  moveResult: (location: MailboxLocation, destination: string) => MoveResult;
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

function makeActionService(adapter: BulkFakeAdapter): EmailMailboxActionService {
  return new EmailMailboxActionService({
    adapter,
    capabilityService: new BulkCapabilityStub() as unknown as EmailOrganizationCapabilityService,
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
    opModel = new EmailOrganizationOperationModel(dbpath);
    selectionService = new EmailOrganizationSelectionService({
      capabilityService: new BulkCapabilityStub() as unknown as EmailOrganizationCapabilityService,
    });
    searchService = new EmailOrganizationSearchService({
      adapter: new BulkFakeAdapter(),
      capabilityService: new BulkCapabilityStub() as unknown as EmailOrganizationCapabilityService,
    });
    // All fixtures seeded in beforeAll for test isolation (review finding).
    await seedVerifiedMessage(5001, "September newsletter");
    await seedVerifiedMessage(5002, "September offers");
    await seedVerifiedMessage(5003, "September digest");
    await seedVerifiedMessage(5004, "September fourth");
    await seedVerifiedMessage(5005, "September fifth");
    await seedVerifiedMessage(5006, "September sixth");
    await seedVerifiedMessage(5007, "Unrelated topic");
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

  it("refuses an expired selection (review: expiry is the security property)", async () => {
    const preview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "trash",
      messageIds: [5003],
    });
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      (await import("@/entity/EmailOrganizationSelection.entity"))
        .EmailOrganizationSelectionEntity
    );
    await repo.update(
      { selectionId: preview.selectionId },
      { expiresAt: new Date(Date.now() - 1000) }
    );
    await expect(
      selectionService.readValidSelection(preview.selectionId)
    ).rejects.toMatchObject({ code: "APPROVAL_EXPIRED" });
  });

  it("executes a bulk trash with per-item outcomes and honest counts (FR-19)", async () => {
    const preview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "trash",
      messageIds: [5001, 5002],
    });
    const adapter = new BulkFakeAdapter();
    const service = makeActionService(adapter);
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

  it("refuses to execute a selection under the wrong action kind (review: consent integrity)", async () => {
    const trashPreview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "trash",
      messageIds: [5003],
    });
    const adapter = new BulkFakeAdapter();
    const service = makeActionService(adapter);
    // A trash selection executed via the restore path must be refused.
    const restoreResult = await service.restoreSelection({
      selectionId: trashPreview.selectionId,
      origin: "ui_action",
    });
    expect(restoreResult.success).toBe(false);
    expect(restoreResult.errorCode).toBe("VALIDATION_FAILED");
    expect(adapter.moveCalls.length).toBe(0);

    // A restore selection executed via the trash path must be refused too.
    const trashOp = await service.trashMessage({ messageId: 5004, origin: "ui_action" });
    expect(trashOp.success).toBe(true);
    const restorePreview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "restore",
      messageIds: [5004],
    });
    const trashResult = await service.trashSelection({
      selectionId: restorePreview.selectionId,
      origin: "ui_action",
    });
    expect(trashResult.success).toBe(false);
    expect(trashResult.errorCode).toBe("VALIDATION_FAILED");
  });

  it("freezes restore destinations from trash provenance and executes them (review S4)", async () => {
    // 5004 was trashed in the previous test — its recorded original folder is INBOX.
    const preview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "restore",
      messageIds: [5004],
    });
    const entity = await selectionService.readValidSelection(preview.selectionId);
    const parsed = selectionService.parseSelection(entity);
    expect(parsed.destinations?.[5004]).toBe("INBOX");

    const adapter = new BulkFakeAdapter();
    const service = makeActionService(adapter);
    const result = await service.restoreSelection({
      selectionId: preview.selectionId,
      origin: "ui_action",
    });
    expect(result.success).toBe(true);
    expect(result.completed).toBe(1);
    const location = await locationModel.readByMessageId(5004);
    expect(location?.folderPath).toBe("INBOX");
  });

  it("refuses a restore selection when a message has no trash provenance", async () => {
    await expect(
      selectionService.prepareSelection({
        emailServiceId: ACCOUNT_ID,
        kind: "restore",
        messageIds: [5007], // never trashed
      })
    ).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
  });

  it("cancels unstarted bulk work deterministically and keeps completed items (FR-20/AC-15)", async () => {
    const preview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "trash",
      messageIds: [5005, 5006],
    });
    const adapter = new BulkFakeAdapter();
    const service = makeActionService(adapter);
    // The FIRST move stamps the durable cancel flag, so the pre-claim check
    // for the second item observes it (review: the old test held under every
    // interleaving; this one fails if the cancel check is removed).
    adapter.onMove = () => {
      void (async () => {
        const operations = await SqliteDb.getInstance(dbpath)
          .connection.getRepository(EmailOrganizationOperationEntity)
          .find();
        const running = operations
          .filter((op) => op.kind === "trash" && op.status === "running")
          .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0];
        if (running) await opModel.cancelPending(running.operationId);
      })();
    };
    const result = await service.trashSelection({
      selectionId: preview.selectionId,
      origin: "ui_action",
    });
    expect(result.completed).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(adapter.moveCalls.length).toBe(1);
  });

  it("reports stale-version targets individually (AC-14)", async () => {
    const preview = await selectionService.prepareSelection({
      emailServiceId: ACCOUNT_ID,
      kind: "trash",
      messageIds: [5007],
    });
    // External move after freezing: the frozen version no longer matches.
    await locationModel.upsertLocation({
      messageId: 5007,
      emailServiceId: ACCOUNT_ID,
      protocol: "imap",
      folderPath: "Archive",
      uidValidity: "4242",
      providerUid: "5007",
      state: "verified",
    });
    const adapter = new BulkFakeAdapter();
    const service = makeActionService(adapter);
    const result = await service.trashSelection({
      selectionId: preview.selectionId,
      origin: "ui_action",
    });
    expect(result.failed).toBe(1);
    expect(result.errorCode).toBe("LOCATION_STALE");
    expect(adapter.moveCalls.length).toBe(0);
  });

  it("searches locally with literal subject, verified folder scope and honest coverage (FR-17)", async () => {
    // Unscoped: Trash-moved messages (5001, 5002) are excluded per PRD §7.
    const result = await searchService.search({
      emailServiceId: ACCOUNT_ID,
      source: "local",
      subject: "September",
    });
    expect(result.source).toBe("local");
    expect(result.complete).toBe(true);
    expect(result.rows.every((row) => row.subject.includes("September"))).toBe(true);
    expect(result.rows.every((row) => row.folderPath !== "Trash")).toBe(true);
    expect(result.limitation).toContain("excluded");

    // Literal semantics: no wildcard expansion.
    const literal = await searchService.search({
      emailServiceId: ACCOUNT_ID,
      source: "local",
      subject: "Sept%ber",
    });
    expect(literal.rows).toEqual([]);

    // Explicit Trash scope searches the moved messages (5001+5002 bulk,
    // 5005 from the cancel test's completed item).
    const scoped = await searchService.search({
      emailServiceId: ACCOUNT_ID,
      source: "local",
      subject: "September",
      folderPaths: ["Trash"],
    });
    expect(scoped.rows.map((row) => row.messageId).sort()).toEqual([5001, 5002, 5005]);
    expect(scoped.rows.every((row) => row.folderPath === "Trash")).toBe(true);

    // Empty folderPaths is rejected rather than silently broadening (review).
    await expect(
      searchService.search({
        emailServiceId: ACCOUNT_ID,
        source: "local",
        subject: "September",
        folderPaths: [],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("runs a bounded server search with honest incompleteness and failure accounting (FR-17)", async () => {
    const adapter = new BulkFakeAdapter();
    adapter.searchUids = async (_c, _folder, input) => ({
      status: "listed" as const,
      candidates: [
        {
          uid: "11",
          fromAddress: "a@b.test",
          subject: "September",
          date: "2026-09-15T10:00:00Z",
          seen: false,
        },
      ],
      // The adapter reports it hit its bound (incomplete scan).
      capped: true,
    });
    const serverService = new EmailOrganizationSearchService({
      adapter,
      capabilityService: new BulkCapabilityStub() as unknown as EmailOrganizationCapabilityService,
    });
    const result = await serverService.search({
      emailServiceId: ACCOUNT_ID,
      source: "server",
      folderPaths: ["INBOX"],
      subject: "September",
    });
    expect(result.source).toBe("server");
    expect(result.complete).toBe(false);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].messageId).toBeNull();
    expect(result.limitation).toContain("1000");
    // Envelope fetches are bounded to the page, not the candidate cap.
    expect(result.limitation).not.toContain("could not be searched");
  });

  it("never reports a failed server folder as complete with zero rows (review CRITICAL)", async () => {
    const adapter = new BulkFakeAdapter();
    adapter.searchUids = async () => ({
      status: "failed" as const,
      reasonCode: "ACCOUNT_NOT_AVAILABLE",
      sanitizedError: "connection refused",
    });
    const serverService = new EmailOrganizationSearchService({
      adapter,
      capabilityService: new BulkCapabilityStub() as unknown as EmailOrganizationCapabilityService,
    });
    const result = await serverService.search({
      emailServiceId: ACCOUNT_ID,
      source: "server",
      folderPaths: ["INBOX"],
    });
    expect(result.rows).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.failedFolders).toEqual([
      { folderPath: "INBOX", reasonCode: "ACCOUNT_NOT_AVAILABLE" },
    ]);
    expect(result.limitation).toContain("could not be searched");
  });
});
