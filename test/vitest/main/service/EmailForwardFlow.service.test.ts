import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailForwardMaterializer } from "@/service/emailOrganization/EmailForwardMaterializer";
import { EmailForwardDraftService } from "@/service/emailOrganization/EmailForwardDraftService";
import { EmailForwardDeliveryService } from "@/service/emailOrganization/EmailForwardDeliveryService";
import type {
  ForwardSender,
  SenderParam,
  ForwardSenderFactory,
} from "@/service/emailOrganization/EmailForwardDeliveryService";
import type {
  EmailMailboxAdapter,
  FolderListResult,
  FullSourceResult,
  MailboxCapabilityProbe,
  MailboxLocation,
  MoveResult,
  PresenceResult,
} from "@/service/emailOrganization/EmailMailboxAdapter";
import type { EmailOrganizationArtifactBackend } from "@/service/emailOrganization/EmailOrganizationArtifactStore";
import { EmailOrganizationActionError } from "@/service/emailOrganization/EmailOrganizationErrors";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailMessageLocationModel } from "@/model/EmailMessageLocation.model";
import { EmailOrganizationAuthorizationModule } from "@/modules/EmailOrganizationAuthorizationModule";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";

let dbpath = "";
let materializer: EmailForwardMaterializer;
let draftService: EmailForwardDraftService;
let deliveryService: EmailForwardDeliveryService;
let authorizationModule: EmailOrganizationAuthorizationModule;
let artifacts: MemoryArtifacts;

const SOURCE_EMAIL_ID = 5001;
const ACCOUNT_ID = 500;

const RFC822_WITH_ATTACHMENT = [
  "From: Sender One <sender@example.test>",
  "To: me@example.test",
  "Subject: Quarterly invoice",
  "Date: Wed, 30 Sep 2026 10:00:00 +0000",
  "Message-ID: <orig-1@example.test>",
  'Content-Type: multipart/mixed; boundary="OUTER"',
  "",
  "--OUTER",
  'Content-Type: multipart/alternative; boundary="INNER"',
  "",
  "--INNER",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Please find the invoice attached.",
  "--INNER",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Please find the invoice attached. <img src="https://cdn.example.test/banner.png" width="600"> <img src="https://tracker.example.test/pixel.gif" width="1"> <img src="cid:logo1" width="40"></p>',
  "--INNER--",
  "--OUTER",
  'Content-Type: image/png; name="logo.png"',
  "Content-Disposition: inline; filename=\"logo.png\"",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <logo1>",
  "",
  "aGVsbG8gaW5saW5l",
  "--OUTER",
  'Content-Type: application/pdf; name="invoice.pdf"',
  "Content-Disposition: attachment; filename=\"invoice.pdf\"",
  "Content-Transfer-Encoding: base64",
  "",
  "JVBERi0xLjQKJcTl8uXrp/Og0MTG",
  "--OUTER--",
  "",
].join("\r\n");

class FakeAdapter implements EmailMailboxAdapter {
  constructor(
    private readonly sourceProvider: (location: MailboxLocation) => FullSourceResult,
    public lastFetchLocation: MailboxLocation | null = null
  ) {}
  async listFolders(): Promise<FolderListResult> {
    return { status: "listed", folders: [] };
  }
  async probeCapabilities(): Promise<MailboxCapabilityProbe> {
    return { moveCapability: true, folders: [], reasonCode: null, sanitizedError: null };
  }
  async fetchFullSource(
    _config: unknown,
    location: MailboxLocation
  ): Promise<FullSourceResult> {
    this.lastFetchLocation = location;
    return this.sourceProvider(location);
  }
  async moveMessage(): Promise<MoveResult> {
    return { status: "failed", reasonCode: "PROVIDER_REJECTED", sanitizedError: "not used" };
  }
  async checkMessagePresent(): Promise<PresenceResult> {
    return { status: "present" };
  }
  async searchUids() {
    return { status: "listed" as const, candidates: [], capped: false };
  }
}

class MemoryArtifacts implements EmailOrganizationArtifactBackend {
  readonly store = new Map<string, Buffer>();
  async put(content: Buffer): Promise<string> {
    const id = `art-${this.store.size + 1}`;
    this.store.set(id, Buffer.from(content));
    return id;
  }
  async get(artifactId: string): Promise<Buffer> {
    const bytes = this.store.get(artifactId);
    if (bytes === undefined) throw new Error("artifact missing");
    return bytes;
  }
  async exists(artifactId: string): Promise<boolean> {
    return this.store.has(artifactId);
  }
  async purge(artifactId: string): Promise<void> {
    this.store.delete(artifactId);
  }
  async purgeOlderThan(): Promise<number> {
    return 0;
  }
}

type SenderBehavior = () => { accepted: string[]; rejected: string[] } | Error;

function makeSenderFactory(
  behavior: SenderBehavior,
  callLog: Array<{ to: unknown; attachmentCount: number; subject: string }>
): ForwardSenderFactory {
  return (_param: SenderParam): ForwardSender => ({
    async sendMail(options) {
      const to = options.to;
      const call = {
        to,
        attachmentCount: Array.isArray(options.attachments) ? options.attachments.length : 0,
        subject: String(options.subject ?? ""),
      };
      callLog.push(call);
      const result = behavior();
      if (result instanceof Error) throw result;
      return { accepted: result.accepted, rejected: result.rejected, messageId: "<provider-1>" };
    },
  });
}

async function seedAccount(): Promise<void> {
  const repo = SqliteDb.getInstance(dbpath).connection.getRepository(EmailServiceEntity);
  await repo.save(
    repo.create({
      id: ACCOUNT_ID,
      name: "Ops Mailbox",
      from: "ops@example.test",
      smtpUsername: "ops@example.test",
      replyTo: null,
      password: "smtp-secret",
      host: "smtp.example.test",
      port: "587",
      ssl: 1,
      status: 1,
      receiveProtocol: "imap",
      imapHost: "imap.example.test",
      imapPort: "993",
      imapSsl: 1,
      pop3Host: null,
      pop3Port: null,
      pop3Ssl: 1,
      receiveUsername: "ops@example.test",
      receivePassword: "imap-secret",
      receiveFolder: "INBOX",
      receiveEnabled: 1,
    })
  );
}

async function seedMessage(id: number, subject: string): Promise<void> {
  const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
    EmailReceivedMessageEntity
  );
  await repo.save(
    repo.create({
      id,
      emailServiceId: ACCOUNT_ID,
      providerUid: `imap:abc123:4242:${id}`,
      fromAddress: "sender@example.test",
      fromName: "Sender One",
      toAddressesJson: JSON.stringify(["ops@example.test"]),
      subject,
      receivedAt: new Date("2026-09-30T10:00:00Z"),
      isUnread: 1,
    })
  );
  const locationModel = new EmailMessageLocationModel(dbpath);
  await locationModel.upsertLocation({
    messageId: id,
    emailServiceId: ACCOUNT_ID,
    protocol: "imap",
    folderPath: "INBOX",
    uidValidity: "4242",
    providerUid: String(id),
    state: "verified",
  });
}

const baseSelection = { mode: "all" } as const;

describe("EmailForwardMaterializer + DraftService + DeliveryService", () => {
  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-fwdf-${Date.now()}-${process.pid}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    artifacts = new MemoryArtifacts();
    const adapter = new FakeAdapter((location) => ({
      status: "fetched",
      source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
      uidValidity: location.uidValidity,
    }));
    materializer = new EmailForwardMaterializer({ adapter, artifactStore: artifacts });
    draftService = new EmailForwardDraftService({ adapter, artifactStore: artifacts });
    deliveryService = new EmailForwardDeliveryService({
      adapter,
      artifactStore: artifacts,
      senderFactory: makeSenderFactory(
        () => ({ accepted: ["finance@example.test"], rejected: [] }),
        []
      ),
    });
    authorizationModule = new EmailOrganizationAuthorizationModule();
    await seedAccount();
    await seedMessage(SOURCE_EMAIL_ID, "Quarterly invoice");
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(dbpath, { recursive: true, force: true });
  });

  it("materializes the full source with a sanitized attachment manifest", async () => {
    const result = await materializer.materialize({
      sourceMessageId: SOURCE_EMAIL_ID,
      location: { folderPath: "INBOX", uidValidity: "4242", uid: String(SOURCE_EMAIL_ID) },
      receiveConfig: {
        emailServiceId: ACCOUNT_ID,
        protocol: "imap",
        host: "imap.example.test",
        port: 993,
        ssl: true,
        username: "ops@example.test",
        password: "x",
        folder: "INBOX",
      },
      note: "See attached.",
      toRecipients: ["finance@example.test"],
      ccRecipients: [],
      bccRecipients: [],
      subject: "Fwd: Quarterly invoice",
      attachmentSelection: baseSelection,
    });
    expect(result.attachments.length).toBe(2);
    const pdf = result.attachments.find((entry) => entry.displayName === "invoice.pdf");
    expect(pdf?.selected).toBe(true);
    expect(pdf?.contentType).toBe("application/pdf");
    // Inline CID asset participates in the manifest and size accounting.
    const inline = result.attachments.find((entry) => entry.disposition === "inline");
    expect(inline?.contentId).toBe("logo1");
    expect(result.bodyText).toContain("---------- Forwarded message ----------");
    expect(result.bodyText).toContain("From: Sender One <sender@example.test>");
    expect(result.bodyText).toContain("Please find the invoice attached.");
    expect(result.validationFindings).toContain("remote_images_removed");
    expect(result.sourceFullSourceHash).toHaveLength(64);
  });

  it("rejects over-limit sources before parsing", async () => {
    const bigAdapter = new FakeAdapter(() => ({
      status: "fetched",
      source: Buffer.alloc(EMAIL_ORGANIZATION_LIMITS.maxSourceBytes + 1, 7),
      uidValidity: "4242",
    }));
    const bigMaterializer = new EmailForwardMaterializer({
      adapter: bigAdapter,
      artifactStore: artifacts,
    });
    await expect(
      bigMaterializer.materialize({
        sourceMessageId: SOURCE_EMAIL_ID,
        location: { folderPath: "INBOX", uidValidity: "4242", uid: "1" },
        receiveConfig: {
          emailServiceId: ACCOUNT_ID,
          protocol: "imap",
          host: "h",
          port: 993,
          ssl: true,
          username: "u",
          password: "p",
          folder: "INBOX",
        },
        note: null,
        toRecipients: ["a@b.test"],
        ccRecipients: [],
        bccRecipients: [],
        subject: "Fwd: big",
        attachmentSelection: baseSelection,
      })
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
  });

  it("rejects encrypted/signed sources instead of degrading silently", async () => {
    const signedSource = [
      "From: a@b.test",
      "To: c@d.test",
      "Subject: signed",
      'Content-Type: multipart/signed; protocol="application/pgp-signature"; boundary="S"',
      "",
      "--S",
      "Content-Type: text/plain",
      "",
      "body",
      "--S",
      "Content-Type: application/pgp-signature",
      "",
      "sig",
      "--S--",
      "",
    ].join("\r\n");
    const signedAdapter = new FakeAdapter(() => ({
      status: "fetched",
      source: Buffer.from(signedSource, "utf8"),
      uidValidity: "4242",
    }));
    const signedMaterializer = new EmailForwardMaterializer({
      adapter: signedAdapter,
      artifactStore: artifacts,
    });
    await expect(
      signedMaterializer.materialize({
        sourceMessageId: SOURCE_EMAIL_ID,
        location: { folderPath: "INBOX", uidValidity: "4242", uid: "1" },
        receiveConfig: {
          emailServiceId: ACCOUNT_ID,
          protocol: "imap",
          host: "h",
          port: 993,
          ssl: true,
          username: "u",
          password: "p",
          folder: "INBOX",
        },
        note: null,
        toRecipients: ["a@b.test"],
        ccRecipients: [],
        bccRecipients: [],
        subject: "Fwd: signed",
        attachmentSelection: baseSelection,
      })
    ).rejects.toMatchObject({ code: "MIME_UNSUPPORTED" });
  });

  it("creates a draft with a Fwd: subject and public manifest (no artifact ids)", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: "FYI",
      attachmentSelection: baseSelection,
      provenance: "user",
      origin: "ui_action",
    });
    expect(preview.subject).toBe("Fwd: Quarterly invoice");
    expect(preview.revisionNumber).toBe(1);
    expect(preview.to).toEqual(["finance@example.test"]);
    expect(preview.attachmentManifest.every((entry) => entry.artifactId === null)).toBe(true);
    expect(preview.selectedAttachmentCount).toBe(2);
    expect(preview.expired).toBe(false);
  });

  it("appends a new revision on edit and revokes prior authorizations", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: baseSelection,
      provenance: "user",
      origin: "ui_action",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: preview.composedHash,
      origin: "ui_review",
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });
    expect(authorizationModule.isSpendable(issued, new Date())).toBe(true);

    const updated = await draftService.updateDraft({
      draftId: preview.draftId,
      expectedRevisionId: preview.revisionId,
      note: "Updated note",
    });
    expect(updated.revisionNumber).toBe(2);
    expect(updated.note).toBe("Updated note");

    const activeAfterEdit = await authorizationModule.findActiveForRevision(
      preview.draftId,
      preview.revisionId
    );
    expect(activeAfterEdit.length).toBe(0);
  });

  it("rejects an edit against a stale revision", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: baseSelection,
      provenance: "user",
      origin: "ui_action",
    });
    await expect(
      draftService.updateDraft({
        draftId: preview.draftId,
        expectedRevisionId: 999999,
        note: "stale edit",
      })
    ).rejects.toMatchObject({ code: "REVISION_CHANGED" });
  });

  it("submits an approved forward and derives per-recipient success", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: preview.composedHash,
      origin: "ui_action",
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });

    const callLog: Array<{ to: unknown; attachmentCount: number; subject: string }> = [];
    const senderCalls = makeSenderFactory(
      () => ({ accepted: ["finance@example.test"], rejected: [] }),
      callLog
    );
    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: senderCalls,
    });
    const outcome = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(outcome.status).toBe("submitted");
    if (outcome.status === "submitted") {
      expect(outcome.accepted).toEqual(["finance@example.test"]);
      expect(outcome.operationId).toBeTruthy();
    }
    expect(callLog.length).toBe(1);
    expect(callLog[0].subject).toBe("Fwd: Quarterly invoice");

    const op = await delivery["operationModule"].findByIdempotencyKey(
      `fwv1:${preview.draftId}:${preview.revisionId}:${preview.composedHash}`
    );
    expect(op?.status).toBe("succeeded");
    const detail = await draftService.readDraftDetail(preview.draftId);
    // Draft status is not directly exposed; revision immutability is intact.
    expect(detail.revisionId).toBe(preview.revisionId);
  });

  it("resolves a duplicate send to the existing operation without resending", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: preview.composedHash,
      origin: "ui_action",
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });
    const calls: Array<{ to: unknown }> = [];
    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: makeSenderFactory(() => {
        calls.push({ to: null });
        return { accepted: ["finance@example.test"], rejected: [] };
      }, []),
    });
    const first = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(first.status).toBe("submitted");
    const second = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(second.status).toBe("already_processed");
    expect(calls.length).toBe(1);
  });

  it("records partial recipient acceptance without resending to accepted recipients", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test", "audit@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: preview.composedHash,
      origin: "ui_action",
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });
    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: makeSenderFactory(
        () => ({ accepted: ["finance@example.test"], rejected: ["audit@example.test"] }),
        []
      ),
    });
    const outcome = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(outcome.status).toBe("submitted");
    if (outcome.status === "submitted") {
      expect(outcome.rejected).toEqual(["audit@example.test"]);
    }
    const op = await delivery["operationModule"].findByIdempotencyKey(
      `fwv1:${preview.draftId}:${preview.revisionId}:${preview.composedHash}`
    );
    expect(op?.status).toBe("partially_succeeded");
    // Display aggregation folds the partially-succeeded item into completed;
    // the rejected recipient breakdown lives on the item record.
    expect(op?.completedCount).toBe(1);
    expect(op?.failedCount).toBe(0);
  });

  it("records an unknown outcome when submission is interrupted after dispatch", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: preview.composedHash,
      origin: "ui_action",
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });
    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: makeSenderFactory(
        () => new Error("connection reset during DATA"),
        []
      ),
    });
    const outcome = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(outcome.status).toBe("outcome_unknown");
    const op = await delivery["operationModule"].findByIdempotencyKey(
      `fwv1:${preview.draftId}:${preview.revisionId}:${preview.composedHash}`
    );
    expect(op?.status).toBe("needs_reconciliation");
  });

  it("refuses to send when the sending identity changed after approval", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: preview.composedHash,
      origin: "ui_action",
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });
    // Mutate the sending identity after approval (AC-12).
    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(EmailServiceEntity);
    await repo.update({ id: ACCOUNT_ID }, { from: "changed@example.test" });

    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: makeSenderFactory(() => {
        throw new Error("SMTP must never be called");
      }, []),
    });
    const outcome = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.code).toBe("REVISION_CHANGED");
    }
    // Restore identity for later tests.
    await repo.update({ id: ACCOUNT_ID }, { from: "ops@example.test" });
  });

  it("refuses a send whose authorization does not match the frozen payload", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: "0".repeat(64),
      origin: "ui_action",
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });
    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: makeSenderFactory(() => {
        throw new Error("SMTP must never be called");
      }, []),
    });
    const outcome = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.code).toBe("REVISION_CHANGED");
    }
  });

  it("never touches reply or processed state on the source message (FR-10)", async () => {
    const before = await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .findOne({ where: { id: SOURCE_EMAIL_ID } });
    expect(before?.replyStatus).toBe("not_started");
    expect(before?.isAnswered).toBe(0);
    expect(before?.processedAt).toBeNull();
  });

  // ---- D4 (review): security-bearing failure paths ----

  function neverSendFactory(): ForwardSenderFactory {
    return makeSenderFactory(() => {
      throw new Error("SMTP must never be called");
    }, []);
  }

  it("refuses a send against a superseded revision (stale currentRevisionId)", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    await draftService.updateDraft({
      draftId: preview.draftId,
      expectedRevisionId: preview.revisionId,
      note: "bumped",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: preview.composedHash,
      origin: "ui_action",
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });
    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: neverSendFactory(),
    });
    const outcome = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("REVISION_CHANGED");
  });

  it("refuses an unknown authorization id", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: neverSendFactory(),
    });
    const outcome = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: 999999999,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("ACTION_NOT_AUTHORIZED");
  });

  it("refuses an expired authorization and never dispatches (APPROVAL_EXPIRED)", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: preview.composedHash,
      origin: "ui_action",
      expiresAt: new Date(Date.now() - 1000),
    });
    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: neverSendFactory(),
    });
    const outcome = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.code).toBe("APPROVAL_EXPIRED");
  });

  it("refuses when the one-time authorization was consumed by a concurrent caller", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: preview.composedHash,
      origin: "ui_action",
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });
    // Simulate the race winner.
    expect(await authorizationModule.consume(issued.id, new Date())).toBe(true);

    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: neverSendFactory(),
    });
    const outcome = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(outcome.status).toBe("failed");
    // A consumed (or expired) authorization is not spendable — the spendability
    // gate reports APPROVAL_EXPIRED; ACTION_NOT_AUTHORIZED is the missing-row code.
    if (outcome.status === "failed") expect(outcome.code).toBe("APPROVAL_EXPIRED");
    // No stranded operation: the replay check runs before the spendability
    // gate, so no operation row exists for this refused send.
    const op = await delivery["operationModule"].findByIdempotencyKey(
      `fwv1:${preview.draftId}:${preview.revisionId}:${preview.composedHash}`
    );
    expect(op).toBeNull();
  });

  it("marks an all-rejected submission failed and leaves the draft unsubmitted", async () => {
    const preview = await draftService.createDraft({
      messageId: SOURCE_EMAIL_ID,
      to: ["finance@example.test"],
      note: null,
      attachmentSelection: { mode: "none" },
      provenance: "user",
      origin: "ui_action",
    });
    const issued = await authorizationModule.issue({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      payloadHash: preview.composedHash,
      origin: "ui_action",
      expiresAt: new Date(Date.now() + EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs),
    });
    const delivery = new EmailForwardDeliveryService({
      adapter: new FakeAdapter(() => ({
        status: "fetched",
        source: Buffer.from(RFC822_WITH_ATTACHMENT, "utf8"),
        uidValidity: "4242",
      })),
      artifactStore: artifacts,
      senderFactory: makeSenderFactory(() => ({ accepted: [], rejected: ["finance@example.test"] }), []),
    });
    const outcome = await delivery.sendApprovedForward({
      draftId: preview.draftId,
      revisionId: preview.revisionId,
      authorizationId: issued.id,
    });
    expect(outcome.status).toBe("submitted"); // submission happened; outcome is per-recipient
    if (outcome.status === "submitted") {
      expect(outcome.rejected).toEqual(["finance@example.test"]);
      expect(outcome.accepted).toEqual([]);
    }
    const op = await delivery["operationModule"].findByIdempotencyKey(
      `fwv1:${preview.draftId}:${preview.revisionId}:${preview.composedHash}`
    );
    expect(op?.status).toBe("failed");
    expect(op?.errorCode).toBe("PROVIDER_REJECTED");
    // A failed submission leaves the draft ready for a fresh authorized retry
    // (a new revision/authorization), not marked submitted.
    const detail = await draftService.readDraftDetail(preview.draftId);
    expect(detail.revisionId).toBe(preview.revisionId);
  });
});
