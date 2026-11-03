import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailOrganizationCapabilityService } from "@/service/emailOrganization/EmailOrganizationCapabilityService";
import type {
  EmailMailboxAdapter,
  FolderListResult,
  FullSourceResult,
  MailboxCapabilityProbe,
  MailboxFolderInfo,
  MailboxLocation,
  MoveResult,
  PresenceResult,
} from "@/service/emailOrganization/EmailMailboxAdapter";
import { EmailServiceEntity } from "@/entity/EmailService.entity";

let dbpath = "";
let probeCount = 0;

class CountingFakeAdapter implements EmailMailboxAdapter {
  public moveCapability = true;
  public folders: MailboxFolderInfo[] = [
    { path: "INBOX", name: "INBOX", specialUse: null, writable: true },
    { path: "Trash", name: "Trash", specialUse: "\\Trash", writable: true },
  ];
  public probeFail = false;

  async listFolders(): Promise<FolderListResult> {
    return { status: "listed", folders: this.folders };
  }
  async probeCapabilities(): Promise<MailboxCapabilityProbe> {
    probeCount += 1;
    if (this.probeFail) {
      return {
        moveCapability: false,
        folders: [],
        reasonCode: "ACCOUNT_NOT_AVAILABLE",
        sanitizedError: "connection refused",
      };
    }
    return {
      moveCapability: this.moveCapability,
      folders: this.folders,
      reasonCode: null,
      sanitizedError: null,
    };
  }
  async fetchFullSource(): Promise<FullSourceResult> {
    return { status: "failed", reasonCode: "SOURCE_FETCH_FAILED", sanitizedError: "unused" };
  }
  async moveMessage(): Promise<MoveResult> {
    return { status: "failed", reasonCode: "PROVIDER_REJECTED", sanitizedError: "unused" };
  }
  async checkMessagePresent(): Promise<PresenceResult> {
    return { status: "present" };
  }
  async searchUids() {
    return { status: "listed" as const, candidates: [], capped: false };
  }
}

async function seedService(
  id: number,
  overrides?: Partial<EmailServiceEntity>
): Promise<void> {
  const repo = SqliteDb.getInstance(dbpath).connection.getRepository(EmailServiceEntity);
  await repo.save(
    repo.create({
      id,
      name: `Account ${id}`,
      from: `ops${id}@example.test`,
      password: "pw",
      host: "smtp.example.test",
      port: "587",
      ssl: 1,
      status: 1,
      receiveProtocol: "imap",
      imapHost: "imap.example.test",
      imapPort: "993",
      imapSsl: 1,
      receiveUsername: `ops${id}@example.test`,
      receivePassword: "pw2",
      receiveFolder: "INBOX",
      receiveEnabled: 1,
      ...overrides,
    })
  );
}

describe("EmailOrganizationCapabilityService (decision matrix)", () => {
  let service: EmailOrganizationCapabilityService;
  let adapter: CountingFakeAdapter;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-cap-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    adapter = new CountingFakeAdapter();
    service = new EmailOrganizationCapabilityService({ adapter });
    await seedService(7001);
    await seedService(7002, {
      receiveProtocol: "pop3",
      imapHost: null,
      pop3Host: "pop3.example.test",
      pop3Port: "995",
    });
    await seedService(7003, { host: "", port: "" });
    await seedService(7004, { receiveEnabled: 0 });
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(dbpath, { recursive: true, force: true });
  });

  it("grants full capabilities for an IMAP account with MOVE and Trash", async () => {
    probeCount = 0;
    const dto = await service.getCapabilities(7001, { forceRefresh: true });
    expect(dto.protocol).toBe("imap");
    expect(dto.canFetchFullSource).toBe(true);
    expect(dto.canSendForward).toBe(true);
    expect(dto.canMoveToTrash).toBe(true);
    expect(dto.canRestore).toBe(true);
    expect(dto.trashFolderPath).toBe("Trash");
    expect(dto.reasonCodes).toEqual([]);
  });

  it("treats POP3 accounts as read-only with a reason code (PRD §12)", async () => {
    const dto = await service.getCapabilities(7002, { forceRefresh: true });
    expect(dto.protocol).toBe("pop3");
    expect(dto.canFetchFullSource).toBe(false);
    expect(dto.canSendForward).toBe(false);
    expect(dto.canMoveToTrash).toBe(false);
    expect(dto.canRestore).toBe(false);
    expect(dto.reasonCodes).toContain("CAPABILITY_UNSUPPORTED_POP3");
  });

  it("reports SMTP_NOT_CONFIGURED and withholds forwarding without SMTP", async () => {
    const dto = await service.getCapabilities(7003, { forceRefresh: true });
    expect(dto.canSendForward).toBe(false);
    expect(dto.reasonCodes).toContain("SMTP_NOT_CONFIGURED");
  });

  it("reports RECEIVE_NOT_ENABLED and withholds forwarding without receive config", async () => {
    const dto = await service.getCapabilities(7004, { forceRefresh: true });
    expect(dto.canSendForward).toBe(false);
    expect(dto.canMoveToTrash).toBe(false);
    expect(dto.reasonCodes).toContain("RECEIVE_NOT_ENABLED");
  });

  it("returns an all-false DTO for an unknown account", async () => {
    const dto = await service.getCapabilities(999999, { forceRefresh: true });
    expect(dto.canFetchFullSource).toBe(false);
    expect(dto.canSendForward).toBe(false);
    expect(dto.canMoveToTrash).toBe(false);
    expect(dto.canRestore).toBe(false);
    expect(dto.reasonCodes).toEqual(["ACCOUNT_NOT_AVAILABLE"]);
  });

  it("caches within the TTL and re-probes only on forceRefresh", async () => {
    probeCount = 0;
    await service.getCapabilities(7001);
    const afterFirst = probeCount;
    await service.getCapabilities(7001);
    expect(probeCount).toBe(afterFirst);
    await service.getCapabilities(7001, { forceRefresh: true });
    expect(probeCount).toBe(afterFirst + 1);
  });

  it("propagates probe failures as reason codes with move disabled", async () => {
    adapter.probeFail = true;
    try {
      const dto = await service.getCapabilities(7001, { forceRefresh: true });
      expect(dto.canMoveToTrash).toBe(false);
      expect(dto.reasonCodes).toContain("ACCOUNT_NOT_AVAILABLE");
    } finally {
      adapter.probeFail = false;
    }
  });

  it("withholds move capability when the server lacks MOVE", async () => {
    adapter.moveCapability = false;
    try {
      const dto = await service.getCapabilities(7001, { forceRefresh: true });
      expect(dto.canMoveToTrash).toBe(false);
      expect(dto.canRestore).toBe(false);
      expect(dto.reasonCodes).toContain("MOVE_CAPABILITY_MISSING");
    } finally {
      adapter.moveCapability = true;
    }
  });
});

