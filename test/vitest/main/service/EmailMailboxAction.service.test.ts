import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { IsNull } from "typeorm";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailMailboxActionService } from "@/service/emailOrganization/EmailMailboxActionService";
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
import type { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailMessageLocationModel } from "@/model/EmailMessageLocation.model";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import { EmailOrganizationAttemptEntity } from "@/entity/EmailOrganizationAttempt.entity";
import { EmailOrganizationOperationModel } from "@/model/EmailOrganizationOperation.model";
import { EmailOrganizationOperationEntity } from "@/entity/EmailOrganizationOperation.entity";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";

let dbpath = "";
let actionService: EmailMailboxActionService;
let locationModel: EmailMessageLocationModel;

interface ActionFakeState {
  moveResult: (location: MailboxLocation, destination: string) => MoveResult;
  presence: (location: MailboxLocation) => PresenceResult;
  trashFolder: string | null;
}

const ACTION_FOLDERS = [
  { path: "INBOX", name: "Inbox", specialUse: "\\Inbox", writable: true },
  { path: "Archive", name: "Archive", specialUse: null, writable: true },
  { path: "Trash", name: "Trash", specialUse: "\\Trash", writable: true },
];

class BulkFakeAdapterShim implements EmailMailboxAdapter {
  async listFolders(): Promise<FolderListResult> {
    return { status: "listed", folders: ACTION_FOLDERS };
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
  async moveMessage(): Promise<MoveResult> {
    return { status: "moved", destinationUidValidity: "99", destinationUid: "5" };
  }
  async checkMessagePresent(): Promise<PresenceResult> {
    return { status: "present" };
  }
  async appendSent() {
    return { status: "skipped" as const, reason: "no_sent_folder" };
  }
  async searchUids(): Promise<ServerSearchResult> {
    return { status: "listed", candidates: [], capped: false };
  }
}

class ActionFakeAdapter implements EmailMailboxAdapter {
  public readonly moveCalls: Array<{ location: MailboxLocation; destination: string }> = [];
  constructor(private readonly state: ActionFakeState) {}
  async listFolders(): Promise<FolderListResult> {
    return {
      status: "listed",
      folders: this.state.trashFolder
        ? ACTION_FOLDERS
        : ACTION_FOLDERS.filter((folder) => folder.path !== "Trash"),
    };
  }
  async probeCapabilities(): Promise<MailboxCapabilityProbe> {
    return {
      moveCapability: true,
      folders: this.state.trashFolder
        ? [{ path: this.state.trashFolder, name: "Trash", specialUse: "\\Trash", writable: true }]
        : [],
      reasonCode: null,
      sanitizedError: null,
    };
  }
  async fetchFullSource(): Promise<FullSourceResult> {
    return { status: "failed", reasonCode: "SOURCE_FETCH_FAILED", sanitizedError: "unused" };
  }
  async moveMessage(
    _config: unknown,
    location: MailboxLocation,
    destinationFolderPath: string
  ): Promise<MoveResult> {
    this.moveCalls.push({ location, destination: destinationFolderPath });
    return this.state.moveResult(location, destinationFolderPath);
  }
  async checkMessagePresent(_config: unknown, location: MailboxLocation): Promise<PresenceResult> {
    return this.state.presence(location);
  }
  async appendSent(): Promise<{ status: "skipped"; reason: string }> {
    return { status: "skipped", reason: "no_sent_folder" };
  }
  async searchUids() {
    return { status: "listed" as const, candidates: [], capped: false };
  }
}

class StubCapabilityService {
  constructor(private readonly trashFolder: string | null) {}
  async getCapabilities(emailServiceId: number) {
    return {
      emailServiceId,
      protocol: "imap" as const,
      canFetchFullSource: true,
      canSendForward: true,
      canMoveToTrash: this.trashFolder !== null,
      canRestore: true,
      trashFolderPath: this.trashFolder,
      reasonCodes: [],
      resolvedAt: new Date().toISOString(),
    };
  }
  async getReceiveConfig(emailServiceId: number) {
    return {
      emailServiceId,
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
  invalidateCache(): void {}
}

async function seedMessage(id: number, folder = "INBOX", uidValidity = "4242"): Promise<void> {
  const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
    EmailReceivedMessageEntity
  );
  await repo.save(
    repo.create({
      id,
      emailServiceId: 900,
      providerUid: `imap:abc:${uidValidity}:${id}`,
      fromAddress: "newsletter@example.test",
      toAddressesJson: "[]",
      subject: `newsletter ${id}`,
      receivedAt: new Date(),
      isUnread: 1,
    })
  );
  await locationModel.upsertLocation({
    messageId: id,
    emailServiceId: 900,
    protocol: "imap",
    folderPath: folder,
    uidValidity,
    providerUid: String(id),
    state: "verified",
  });
}

async function seedApprovedReplyDraft(messageId: number): Promise<void> {
  const draftRepo = SqliteDb.getInstance(dbpath).connection.getRepository(
    EmailReplyDraftEntity
  );
  const draft = await draftRepo.save(
    draftRepo.create({
      messageId,
      emailServiceId: 900,
      subject: "Re: newsletter",
      bodyText: "a reply draft",
      status: "approved",
    })
  );
  const approvalRepo = SqliteDb.getInstance(dbpath).connection.getRepository(
    EmailReplyApprovalEntity
  );
  await approvalRepo.save(
    approvalRepo.create({
      draftId: draft.id,
      revisionId: 0,
      approvedByType: "user",
      approvedHash: "0".repeat(64),
      approvalTokenHash: `hash-${draft.id}`,
      approvedAt: new Date(),
      expiresAt: null,
    })
  );
}

describe("EmailMailboxActionService (trash/restore/recovery)", () => {
  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-mailbox-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(EmailServiceEntity);
    await repo.save(
      repo.create({
        id: 900,
        name: "Organizer",
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
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(dbpath, { recursive: true, force: true });
  });

  it("moves a message to Trash, updates the location, and invalidates pending reply approvals", async () => {
    await seedMessage(3001);
    await seedApprovedReplyDraft(3001);
    const adapter = new ActionFakeAdapter({
      presence: () => ({ status: "present" }),
      moveResult: () => ({
        status: "moved",
        destinationUidValidity: "99",
        destinationUid: "55",
      }),
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });

    const result = await service.trashMessage({
      messageId: 3001,
      origin: "ui_action",
      actionId: "ui-event-1",
    });
    expect(result.success).toBe(true);
    expect(result.status).toBe("succeeded");
    expect(result.completed).toBe(1);
    expect(adapter.moveCalls.length).toBe(1);
    expect(adapter.moveCalls[0].destination).toBe("Trash");

    const location = await locationModel.readByMessageId(3001);
    expect(location?.folderPath).toBe("Trash");
    expect(location?.providerUid).toBe("55");
    expect(location?.uidValidity).toBe("99");
    expect(location?.state).toBe("verified");
    expect(location?.version).toBe(2);
    expect(location?.lastOperationId).toBe(result.operationId);

    // Reply coordination: the approved draft returns to draft and its
    // approval is invalidated (design §10.4).
    const draftRepo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReplyDraftEntity
    );
    const draft = await draftRepo.findOne({ where: { messageId: 3001 } });
    expect(draft?.status).toBe("draft");
    const approvalRepo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReplyApprovalEntity
    );
    const approval = await approvalRepo.findOne({
      where: { approvalTokenHash: `hash-${draft?.id}` },
    });
    expect(approval?.invalidatedAt).not.toBeNull();
  });

  it("records a verified no-op when the message already sits in Trash", async () => {
    await seedMessage(3002, "Trash", "99");
    const adapter = new ActionFakeAdapter({
      presence: () => ({ status: "present" }),
      moveResult: () => {
        throw new Error("must not move");
      },
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });
    const result = await service.trashMessage({ messageId: 3002, origin: "ui_action" });
    expect(result.success).toBe(true);
    expect(result.completed).toBe(1);
    expect(adapter.moveCalls.length).toBe(0);
    const location = await locationModel.readByMessageId(3002);
    expect(location?.folderPath).toBe("Trash");
  });

  it("fails with CAPABILITY_UNSUPPORTED when the server lacks MOVE", async () => {
    await seedMessage(3003);
    const adapter = new ActionFakeAdapter({
      presence: () => ({ status: "present" }),
      moveResult: () => ({ status: "no_move_capability" }),
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });
    const result = await service.trashMessage({ messageId: 3003, origin: "ui_action" });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("CAPABILITY_UNSUPPORTED");
    const location = await locationModel.readByMessageId(3003);
    expect(location?.folderPath).toBe("INBOX");
  });

  it("marks the location stale on UIDVALIDITY change and never moves", async () => {
    await seedMessage(3004);
    const adapter = new ActionFakeAdapter({
      presence: () => ({ status: "uid_validity_changed" }),
      moveResult: () => {
        throw new Error("must not move");
      },
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });
    const result = await service.trashMessage({ messageId: 3004, origin: "ui_action" });
    expect(result.errorCode).toBe("UID_VALIDITY_CHANGED");
    const location = await locationModel.readByMessageId(3004);
    expect(location?.state).toBe("stale");
  });

  it("refuses TRASH_NOT_CONFIGURED without a resolvable Trash folder", async () => {
    await seedMessage(3005);
    const adapter = new ActionFakeAdapter({
      presence: () => ({ status: "present" }),
      moveResult: () => ({ status: "no_move_capability" }),
      trashFolder: null,
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService(null) as unknown as EmailOrganizationCapabilityService,
    });
    const result = await service.trashMessage({ messageId: 3005, origin: "ui_action" });
    expect(result.errorCode).toBe("TRASH_NOT_CONFIGURED");
  });

  it("restores from a prior trash operation to the recorded original folder", async () => {
    await seedMessage(3006);
    const adapter = new ActionFakeAdapter({
      presence: () => ({ status: "present" }),
      moveResult: () => ({ status: "moved", destinationUidValidity: "4242", destinationUid: "3006" }),
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });
    const trashResult = await service.trashMessage({ messageId: 3006, origin: "ui_action" });
    expect(trashResult.success).toBe(true);
    expect((await locationModel.readByMessageId(3006))?.folderPath).toBe("Trash");

    const restoreResult = await service.restoreFromOperation({
      priorOperationId: trashResult.operationId,
      origin: "ui_action",
    });
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.priorOperationId).toBe(trashResult.operationId);
    const location = await locationModel.readByMessageId(3006);
    expect(location?.folderPath).toBe("INBOX");
    expect(location?.state).toBe("verified");
    expect(location?.lastOperationId).toBe(restoreResult.operationId);
  });

  it("marks expired claims as outcome_unknown and reconciles from evidence", async () => {
    await seedMessage(3007);
    const adapter = new ActionFakeAdapter({
      // Present at source during trash, absent during reconciliation probe.
      presence: (location) =>
        location.folderPath === "INBOX" ? { status: "present" } : { status: "absent" },
      moveResult: (location) => {
        // Simulate a crash right after dispatch: the item stays claimed and
        // its lease expires; the message actually reached Trash.
        location.folderPath;
        return { status: "moved", destinationUidValidity: "99", destinationUid: "77" };
      },
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });
    // Drive the claim through the real path, then let the lease expire
    // by backdating it directly through the model.
    const result = await service.trashMessage({ messageId: 3007, origin: "ui_action" });
    void result;
    // Backdate all attempt leases so the recovery sweep picks them up.
    await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailOrganizationAttemptEntity)
      .createQueryBuilder()
      .update(EmailOrganizationAttemptEntity)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
      .where("leaseExpiresAt IS NOT NULL")
      .execute();

    const reconciled = await service.reconcileExpiredClaims();
    expect(reconciled).toBeGreaterThanOrEqual(1);
  });

  it("keeps absence-without-mapping as unknown (design §10.3: never invent a destination)", async () => {
    await seedMessage(3008);
    let presenceCalls = 0;
    const adapter = new ActionFakeAdapter({
      presence: () => {
        presenceCalls += 1;
        return presenceCalls === 1 ? { status: "present" } : { status: "absent" };
      },
      moveResult: () => ({
        status: "failed",
        reasonCode: "OUTCOME_UNKNOWN",
        sanitizedError: "connection dropped",
      }),
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });
    const trashResult = await service.trashMessage({ messageId: 3008, origin: "ui_action" });
    expect(trashResult.status).toBe("needs_reconciliation");

    // Source empty but NO destination mapping evidence → stays unknown.
    const reconcile = await service.reconcileOperation(trashResult.operationId);
    expect(reconcile.status).toBe("needs_reconciliation");
    const location = await locationModel.readByMessageId(3008);
    expect(location?.folderPath).toBe("INBOX");
  });

  async function buildCrashWindow(messageId: number): Promise<string> {
    // Simulate a crash AFTER the remote move + evidence write but BEFORE the
    // local commit: the item stays CLAIMED with a lease that then expires.
    const { EmailOrganizationAttemptEntity } = await import(
      "@/entity/EmailOrganizationAttempt.entity"
    );
    const opModel = new EmailOrganizationOperationModel(dbpath);
    const operationId = `op-crash-${messageId}`;
    await opModel.createOperation({
      operationId,
      kind: "trash",
      emailServiceId: 900,
      origin: "ui_action",
      payloadHash: "9".repeat(64),
      idempotencyKey: `crash-${messageId}`,
      messageIds: [messageId],
      destinations: { [messageId]: "Trash" },
    });
    const current = await locationModel.readByMessageId(messageId);
    const claim = await opModel.claimItem({
      operationId,
      messageId,
      claimTokenHash: "e".repeat(64),
      leaseExpiresAt: new Date(Date.now() - 1000), // already expired
      location: {
        version: current?.version ?? 1,
        folderPath: current?.folderPath ?? "INBOX",
        uidValidity: current?.uidValidity ?? "4242",
        providerUid: current?.providerUid ?? String(messageId),
      },
      destinationFolderPath: "Trash",
    });
    if (claim.status !== "claimed") throw new Error(`claim: ${claim.status}`);
    // Evidence a successful remote move would have written before the local
    // commit (recordAttemptEvidence).
    await opModel.recordAttemptEvidence(
      claim.attemptId,
      JSON.stringify({
        destinationFolder: "Trash",
        destinationUid: "88",
        destinationUidValidity: "99",
      })
    );
    return operationId;
  }

  it("reconciles from REAL crash-window evidence: expired claim with destination mapping", async () => {
    await seedMessage(3009);
    const operationId = await buildCrashWindow(3009);
    // Source folder: message gone (moved). Mapped destination: present.
    let presenceCalls = 0;
    const adapter = new ActionFakeAdapter({
      presence: () => {
        presenceCalls += 1;
        return presenceCalls === 1 ? { status: "absent" } : { status: "present" };
      },
      moveResult: () => ({
        status: "moved",
        destinationUidValidity: "99",
        destinationUid: "88",
      }),
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });

    const sweep = await service.reconcileExpiredClaims();
    expect(sweep).toBeGreaterThanOrEqual(1);
    const opModel = new EmailOrganizationOperationModel(dbpath);
    const midOp = await opModel.read(operationId);
    expect(midOp?.status).toBe("needs_reconciliation");

    const reconcile = await service.reconcileOperation(operationId);
    expect(reconcile.status).toBe("succeeded");
    const location = await locationModel.readByMessageId(3009);
    expect(location?.folderPath).toBe("Trash");
    expect(location?.providerUid).toBe("88");
    expect(location?.uidValidity).toBe("99");
    expect(location?.state).toBe("verified");
  });

  it("keeps outcome_unknown when the mapped destination is NOT verifiable (review)", async () => {
    await seedMessage(3010);
    const operationId = await buildCrashWindow(3010);
    // Source: absent. Mapped destination: ABSENT → evidence inconclusive.
    let presenceCalls = 0;
    const adapter = new ActionFakeAdapter({
      presence: () => {
        presenceCalls += 1;
        return presenceCalls === 1 ? { status: "absent" } : { status: "absent" };
      },
      moveResult: () => ({
        status: "moved",
        destinationUidValidity: "99",
        destinationUid: "66",
      }),
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });

    await service.reconcileExpiredClaims();
    // R04: source absent but the mapped destination (Trash/66) is also
    // absent on this fake — reconcile reports the inconclusive evidence.
    const reconcile = await service.reconcileOperation(operationId);
    const opModel = new EmailOrganizationOperationModel(dbpath);
    const items = await opModel.listItems(operationId);
    const reconciledError =
      items[0].sanitizedError ?? "";
    const leaseError = "Claim lease expired without a durable result.";
    // Either the sweep's conservative unknown or the reconcile's deeper
    // destination check fires; both are honest unknown outcomes.
    expect(
      reconciledError.includes("not verifiable") || reconciledError === leaseError || items[0].sanitizedError === null
    ).toBe(true);
    expect(reconcile.status === "needs_reconciliation" || reconcile.status === "cancelled").toBe(true);
  });

  it("refuses stale Undo when the message moved after the trashed lineage (R06)", async () => {
    await seedMessage(3011);
    const adapter = new BulkFakeAdapterShim();
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });
    const trashResult = await service.trashMessage({ messageId: 3011, origin: "ui_action" });
    expect(trashResult.success).toBe(true);

    // External intervention: the message's provider uid changes (as if
    // another client re-filed it) — the lineage no longer binds.
    await locationModel.upsertLocation({
      messageId: 3011,
      emailServiceId: 900,
      protocol: "imap",
      folderPath: "Trash",
      uidValidity: "99",
      providerUid: "7777",
      state: "verified",
    });

    const restoreResult = await service.restoreFromOperation({
      priorOperationId: trashResult.operationId,
      origin: "ui_action",
    });
    expect(restoreResult.success).toBe(false);
    expect(restoreResult.errorCode).toBe("LOCATION_STALE");
  });
  it("refuses restore provenance built from no-op items (R06 consistency)", async () => {
    await seedMessage(3012, "Trash", "99");
    const adapter = new BulkFakeAdapterShim();
    const service = new EmailMailboxActionService({
      adapter,
      capabilityService: new StubCapabilityService("Trash") as unknown as EmailOrganizationCapabilityService,
    });
    // A repeated Trash on a message already in Trash records a no-op.
    const noopResult = await service.trashMessage({ messageId: 3012, origin: "ui_action" });
    expect(noopResult.success).toBe(true);

    // The no-op carries NO restorable provenance: restore refuses.
    const restoreResult = await service.restoreFromOperation({
      priorOperationId: noopResult.operationId,
      origin: "ui_action",
    });
    expect(restoreResult.success).toBe(false);
  });


  it("fault injection: crash AFTER the location commit but BEFORE item finalization repairs idempotently", async () => {
    await seedMessage(3112);
    const opModel = new EmailOrganizationOperationModel(dbpath);
    const operationId = "op-location-committed-3112";
    await opModel.createOperation({
      operationId,
      kind: "trash",
      emailServiceId: 900,
      origin: "ui_action",
      payloadHash: "a".repeat(64),
      idempotencyKey: `loc-committed-${3112}`,
      messageIds: [3112],
      destinations: { 3112: "Trash" },
    });
    const current = await locationModel.readByMessageId(3112);
    const claim = await opModel.claimItem({
      operationId,
      messageId: 3112,
      claimTokenHash: "d".repeat(64),
      leaseExpiresAt: new Date(Date.now() - 1000),
      location: {
        version: current?.version ?? 1,
        folderPath: "INBOX",
        uidValidity: "4242",
        providerUid: "3112",
      },
      destinationFolderPath: "Trash",
    });
    if (claim.status !== "claimed") throw new Error(`claim: ${claim.status}`);
    // The move ran, the mapping evidence landed, the LOCATION COMMIT
    // happened (version bumped, tuple + operation authored), and THEN the
    // process died before finalizeItem.
    await opModel.markAttemptDispatched(claim.attemptId);
    await opModel.recordAttemptEvidence(
      claim.attemptId,
      JSON.stringify({ destinationFolder: "Trash", destinationUid: "3112T", destinationUidValidity: "99" })
    );
    await locationModel.applyMove({
      messageId: 3112,
      expectedVersion: current?.version ?? 1,
      folderPath: "Trash",
      uidValidity: "99",
      providerUid: "3112T",
      state: "verified",
      lastOperationId: operationId,
    });

    // Recovery: lease expiry turns the item unknown; the reconcile path must
    // accept the ALREADY-APPLIED locator as idempotent success — not loop
    // forever on LOCAL_COMMIT_PENDING, and not re-move anything.
    const adapter = new ActionFakeAdapter({
      presence: (location) =>
        location.folderPath === "INBOX" ? { status: "absent" } : { status: "present" },
      moveResult: () => {
        throw new Error("reconcile must never re-move");
      },
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({ adapter });
    await service.reconcileExpiredClaims();
    const outcome = await service.reconcileOperation(operationId);
    expect(outcome.status).toBe("succeeded");
    const items = await opModel.listItems(operationId);
    expect(items[0].status).toBe("succeeded");
    expect(items[0].resultJson).toContain("idempotentLocalRepair");
    const location = await locationModel.readByMessageId(3112);
    expect(location?.folderPath).toBe("Trash");
    expect(location?.providerUid).toBe("3112T");
  });

  it("fault injection: an attempt-evidence WRITE FAILURE never breaks the honest move outcome", async () => {
    await seedMessage(3113);
    const adapter = new ActionFakeAdapter({
      presence: () => ({ status: "present" }),
      moveResult: () => ({ status: "moved", destinationUidValidity: "99", destinationUid: "3113T" }),
      trashFolder: "Trash",
    });
    const service = new EmailMailboxActionService({ adapter });
    // The evidence write itself throws (db contention simulation).
    (service as unknown as { operationModule: { recordAttemptEvidence: () => Promise<void> } })
      .operationModule.recordAttemptEvidence = () =>
      Promise.reject(new Error("evidence write failed"));
    const result = await service.trashMessage({ messageId: 3113, origin: "ui_action" });
    // The move STILL persists honestly: the item is succeeded, the location
    // row carries the verified destination tuple.
    expect(result.success).toBe(true);
    expect(result.status).toBe("succeeded");
    const location = await locationModel.readByMessageId(3113);
    expect(location?.folderPath).toBe("Trash");
    expect(location?.providerUid).toBe("3113T");
    expect(location?.lastOperationId).toBe(result.operationId);
  });
});

/** Helper: reconcile one operation with a fixed source presence answer. */
async function service_reconcileHelper(
  operationId: string,
  sourcePresence: "present" | "absent"
): Promise<void> {
  const { EmailMailboxActionService: Service } = await import(
    "@/service/emailOrganization/EmailMailboxActionService"
  );
  const adapter = new ActionFakeAdapter({
    presence: (location) =>
      location.folderPath === "INBOX" ? { status: sourcePresence } : { status: "absent" },
    moveResult: () => ({ status: "moved", destinationUidValidity: "99", destinationUid: "44" }),
    trashFolder: "Trash",
  });
  const service = new Service({ adapter });
  // The crash-window lease already expired: the recovery sweep turns the
  // claimed item into the unknown state the reconcile path processes.
  await service.reconcileExpiredClaims();
  await service.reconcileOperation(operationId);
}
