import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailMailboxActionService } from "@/service/emailOrganization/EmailMailboxActionService";
import { EmailOrganizationSearchService } from "@/service/emailOrganization/EmailOrganizationSearchService";
import { EmailOrganizationOperationModel } from "@/model/EmailOrganizationOperation.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailMessageLocationModel } from "@/model/EmailMessageLocation.model";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import type { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import type {
  EmailMailboxAdapter,
  FolderListResult,
  FullSourceResult,
  MailboxCapabilityProbe,
  MailboxLocation,
  MoveResult,
  PresenceResult,
  ServerSearchResult,
} from "@/service/emailOrganization/EmailMailboxAdapter";

/**
 * PRD timing targets, measured on the deterministic local stack
 * (production SQLite + services; the network leg is a stub adapter so the
 * measured budget covers the app's own work, which is what the PRD bounds).
 *
 *  - §5 acknowledgement: a single Trash action acknowledges (operation id
 *    returned) within 1 s.
 *  - §7: local search pagination answers a page in < 500 ms p95 over a
 *    populated mailbox.
 *  - §11/FR-20: a durable cancel request stops the bulk loop before the
 *    next item claims (cancel-before-next-item).
 */

const ACCOUNT_ID = 770;
const MESSAGE_COUNT = 1200;

class NoNetworkAdapter implements EmailMailboxAdapter {
  public moveDelayMs = 0;
  public moveCalls = 0;
  async listFolders(): Promise<FolderListResult> {
    return {
      status: "listed",
      folders: [
        { path: "INBOX", name: "Inbox", specialUse: "\\Inbox", writable: true },
        { path: "Trash", name: "Trash", specialUse: "\\Trash", writable: true },
      ],
    };
  }
  async probeCapabilities(): Promise<MailboxCapabilityProbe> {
    return {
      moveCapability: true,
      folders: [
        { path: "INBOX", name: "Inbox", specialUse: "\\Inbox", writable: true },
        { path: "Trash", name: "Trash", specialUse: "\\Trash", writable: true },
      ],
      reasonCode: null,
      sanitizedError: null,
    };
  }
  async fetchFullSource(): Promise<FullSourceResult> {
    return { status: "failed", reasonCode: "SOURCE_FETCH_FAILED", sanitizedError: "unused" };
  }
  async moveMessage(): Promise<MoveResult> {
    if (this.moveDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.moveDelayMs));
    }
    this.moveCalls += 1;
    return { status: "moved", destinationUidValidity: "99", destinationUid: `d${this.moveCalls}` };
  }
  async checkMessagePresent(): Promise<PresenceResult> {
    return { status: "present" };
  }
  async searchUids(): Promise<ServerSearchResult> {
    return { status: "listed", candidates: [], capped: false };
  }
  async appendSent(): Promise<{ status: "skipped"; reason: string }> {
    return { status: "skipped", reason: "no_sent_folder" };
  }
}

/** Capability stub with the SAME envelope as the real service (fast path). */
function capabilityStub(): EmailOrganizationCapabilityService {
  const receiveConfig = {
    emailServiceId: ACCOUNT_ID,
    protocol: "imap" as const,
    host: "imap.example.test",
    port: 993,
    ssl: true,
    username: "ops@example.test",
    password: "pw",
    folder: "INBOX",
  };
  const dto = {
    emailServiceId: ACCOUNT_ID,
    protocol: "imap" as const,
    canFetchFullSource: true,
    canSendForward: true,
    canMoveToTrash: true,
    canRestore: true,
    trashFolderPath: "Trash",
    reasonCodes: [],
    resolvedAt: new Date().toISOString(),
  };
  return {
    getCapabilities: async () => dto,
    getReceiveConfig: async () => receiveConfig,
  } as unknown as EmailOrganizationCapabilityService;
}

describe("Email organization PRD timing targets (deterministic local stack)", () => {
  let dbpath = "";
  let adapter: NoNetworkAdapter;
  let actionService: EmailMailboxActionService;
  let searchService: EmailOrganizationSearchService;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-org-perf-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();

    const serviceRepo = SqliteDb.getInstance(dbpath).connection.getRepository(EmailServiceEntity);
    await serviceRepo.save(
      serviceRepo.create({
        id: ACCOUNT_ID,
        name: "Perf Mailbox",
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

    // A populated mailbox: 1200 verified messages spread across two folders.
    const messageRepo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    const locationModel = new EmailMessageLocationModel(dbpath);
    const batchSize = 200;
    for (let batchStart = 0; batchStart < MESSAGE_COUNT; batchStart += batchSize) {
      const rows = [];
      for (let i = batchStart; i < Math.min(batchStart + batchSize, MESSAGE_COUNT); i += 1) {
        rows.push(
          messageRepo.create({
            id: 8000 + i,
            emailServiceId: ACCOUNT_ID,
            providerUid: `imap:perf:7777:${i}`,
            fromAddress: i % 3 === 0 ? "newsletter@example.test" : "bulk@example.test",
            toAddressesJson: "[]",
            subject: i % 2 === 0 ? "perf subject needle" : `perf subject ${i}`,
            receivedAt: new Date(Date.UTC(2026, 8, 1) - i * 60_000),
            isUnread: i % 2,
          })
        );
      }
      await messageRepo.save(rows);
      for (let i = batchStart; i < Math.min(batchStart + batchSize, MESSAGE_COUNT); i += 1) {
        await locationModel.upsertLocation({
          messageId: 8000 + i,
          emailServiceId: ACCOUNT_ID,
          protocol: "imap",
          folderPath: i % 5 === 0 ? "Archive" : "INBOX",
          uidValidity: "7777",
          providerUid: String(i),
          state: "verified",
        });
      }
    }

    adapter = new NoNetworkAdapter();
    actionService = new EmailMailboxActionService({ adapter, capabilityService: capabilityStub() });
    searchService = new EmailOrganizationSearchService({ adapter, capabilityService: capabilityStub() });
  }, 120_000);

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(dbpath, { recursive: true, force: true });
  });

  it("a single Trash action acknowledges within the 1 s target (PRD §5)", async () => {
    const started = Date.now();
    const result = await actionService.trashMessage({
      messageId: 8000 + MESSAGE_COUNT - 1,
      origin: "ui_action",
    });
    const elapsed = Date.now() - started;
    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it("local search pagination answers each page well under the 500 ms target (PRD §7)", async () => {
    const pageTimes: number[] = [];
    let cursor: string | undefined = undefined;
    let pages = 0;
    for (;;) {
      const started = Date.now();
      const result = await searchService.search({
        emailServiceId: ACCOUNT_ID,
        source: "local",
        subject: "perf subject",
        pageSize: 50,
        folderPaths: ["INBOX", "Archive"],
        cursor,
      });
      pageTimes.push(Date.now() - started);
      pages += 1;
      expect(result.rows.length).toBeGreaterThan(0);
      if (result.nextCursor === null || pages >= 30) break;
      cursor = result.nextCursor ?? undefined;
    }
    expect(pages).toBeGreaterThanOrEqual(5);
    pageTimes.sort((a, b) => a - b);
    const p95 = pageTimes[Math.min(pageTimes.length - 1, Math.floor(pageTimes.length * 0.95))];
    expect(p95).toBeLessThan(500);
  }, 60_000);

  it("a durable cancel stops the bulk loop before the next item claims (FR-20, PRD §11)", async () => {
    const operationModel = new EmailOrganizationOperationModel(dbpath);
    const messageIds = [8900, 8901, 8902, 8903];
    const locationModel = new EmailMessageLocationModel(dbpath);
    // Freeze location versions for the selection contract (R4-10 shape).
    const versions: Record<string, number> = {};
    for (const messageId of messageIds) {
      const location = await locationModel.readByMessageId(messageId);
      versions[String(messageId)] = location?.version ?? 1;
    }
    const { EmailOrganizationSelectionModel } = await import(
      "@/model/EmailOrganizationSelection.model"
    );
    const selectionModel = new EmailOrganizationSelectionModel(dbpath);
    await selectionModel.create({
      selectionId: "selperfcancel01",
      emailServiceId: ACCOUNT_ID,
      kind: "trash",
      messageIdsJson: JSON.stringify(messageIds),
      locationVersionsJson: JSON.stringify(versions),
      destinationsJson: JSON.stringify(Object.fromEntries(messageIds.map((id) => [id, "Trash"]))),
      payloadHash: "2".repeat(64),
      filtersSummaryJson: null,
      ownerContext: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Each move takes 120 ms: the cancel must land during item 1's move and
    // stop the remaining items from ever claiming.
    adapter.moveDelayMs = 120;
    const beforeMoves = adapter.moveCalls;
    // The prompt-start path returns the REAL durable operation id (R12) —
    // exactly what the UI cancels.
    const started = await actionService.startTrashSelection({
      selectionId: "selperfcancel01",
      origin: "ui_action",
    });
    if (!("operationId" in started)) throw new Error("bulk start refused");
    const operationId = started.operationId;
    // Request the durable cancel while the loop is inside item 1's move.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const cancelStarted = Date.now();
    await operationModel.cancelPending(operationId);
    const cancelLatency = Date.now() - cancelStarted;
    // Cancel-before-next-item: the durable flag persisted promptly.
    expect(cancelLatency).toBeLessThan(500);
    // Wait for the detached loop to settle, then assert the honest outcome.
    let operation = await operationModel.read(operationId);
    for (let i = 0; i < 100 && operation !== null && operation.status === "running"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      operation = await operationModel.read(operationId);
    }
    expect(operation?.status).toBe("cancelled");
    expect(operation?.cancelledCount).toBeGreaterThanOrEqual(1);
    // At most 2 items ever moved after the cancel request (one in flight);
    // the remaining items never claimed.
    expect(adapter.moveCalls - beforeMoves).toBeLessThanOrEqual(2);
    adapter.moveDelayMs = 0;
  }, 30_000);
});
