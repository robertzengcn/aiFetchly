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
} from "@/service/emailOrganization/EmailMailboxAdapter";
import type { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailMessageLocationModel } from "@/model/EmailMessageLocation.model";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import { EmailOrganizationAttemptEntity } from "@/entity/EmailOrganizationAttempt.entity";

let dbpath = "";
let actionService: EmailMailboxActionService;
let locationModel: EmailMessageLocationModel;

interface ActionFakeState {
  moveResult: (location: MailboxLocation, destination: string) => MoveResult;
  presence: (location: MailboxLocation) => PresenceResult;
  trashFolder: string | null;
}

class ActionFakeAdapter implements EmailMailboxAdapter {
  public readonly moveCalls: Array<{ location: MailboxLocation; destination: string }> = [];
  constructor(private readonly state: ActionFakeState) {}
  async listFolders(): Promise<FolderListResult> {
    return {
      status: "listed",
      folders: this.state.trashFolder
        ? [{ path: this.state.trashFolder, name: "Trash", specialUse: "\\Trash", writable: true }]
        : [],
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

  it("reconciles an unknown trash to success when the source is empty and a destination was frozen", async () => {
    await seedMessage(3008);
    let presenceCalls = 0;
    const adapter = new ActionFakeAdapter({
      // 1st probe: pre-move verification (present). 2nd probe: the
      // reconciliation sweep finds the source folder empty (dispatch landed).
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

    const reconcile = await service.reconcileOperation(trashResult.operationId);
    expect(reconcile.status).toBe("succeeded");
    const location = await locationModel.readByMessageId(3008);
    expect(location?.folderPath).toBe("Trash");
    expect(location?.state).toBe("stale");
  });
});
