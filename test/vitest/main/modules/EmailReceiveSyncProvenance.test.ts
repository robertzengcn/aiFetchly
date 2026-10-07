import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { SqliteDb } from "@/config/SqliteDb";
import { EmailReceiveSyncService } from "@/service/emailReceive/EmailReceiveSyncService";
import { EmailReceivedMessageModel } from "@/model/EmailReceivedMessage.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import type {
  EmailReceiveClient,
  ParsedInboundEmail,
} from "@/service/emailReceive/EmailReceiveClient";
import {
  buildNamespacedProviderUid,
  isNamespacedProviderUid,
  parseNamespacedProviderUid,
} from "@/service/emailReceive/EmailReplyIdentity";

// Same isolated-per-run temp-path pattern as the other DB-integration
// suites: a second worker running synchronize() DDL on the shared
// `aifetchly-test` file throws SQLITE_BUSY.

/**
 * T03/FR-030 Step 3 — sync provenance. Proves:
 *  - the IMAP client emits the namespaced providerUid and carries
 *    folder/UIDVALIDITY provenance;
 *  - toEntity no longer derives replyStatus from \Answered (the overload bug);
 *  - a legacy bare-UID row is adopted ONLY after its stored RFC identity
 *    validates against the fetched message, with all local state preserved;
 *  - an identity mismatch inserts a new row and leaves the legacy row alone;
 *  - the POP3 path keeps its bare UIDL-uid and null provenance.
 */
describe("EmailReceiveSyncService provenance + legacy adoption (T03)", () => {
  let dbpath: string;
  let model: EmailReceivedMessageModel;

  beforeAll(async () => {
    dbpath = path.join(os.tmpdir(), `aifetchly-sync-prov-${Date.now()}`);
    fs.mkdirSync(dbpath, { recursive: true });
    await SqliteDb.resetInstance(dbpath);
    await SqliteDb.ensureInitialized();
    model = new EmailReceivedMessageModel(dbpath);

    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailServiceEntity
    );
    const service = new EmailServiceEntity();
    service.name = "Sync Provenance Service";
    service.from = "me@x.com";
    service.password = "secret";
    service.host = "imap.example.com";
    service.port = "993";
    service.receiveProtocol = "imap";
    service.receiveEnabled = 1;
    service.imapHost = "imap.example.com";
    service.imapPort = "993";
    service.imapSsl = 1;
    service.receiveUsername = "me@x.com";
    service.receivePassword = "recv-secret";
    service.receiveFolder = "INBOX";
    await repo.save(service);
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
    try {
      fs.rmSync(dbpath, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  const SERVICE_ID = 1; // first save in a fresh DB

  function namespacedUid(uid: string | number): string {
    return buildNamespacedProviderUid({
      folder: "INBOX",
      uidValidity: "424242",
      uid,
    });
  }

  function inboundMessage(
    uid: string | number,
    over: Partial<ParsedInboundEmail> = {}
  ): ParsedInboundEmail {
    const uidStr = String(uid);
    return {
      providerUid: namespacedUid(uid),
      providerFolder: "INBOX",
      providerUidValidity: "424242",
      messageId: `<orig-${uidStr}@example.com>`,
      threadKey: `<orig-${uidStr}@example.com>`,
      inReplyTo: null,
      referencesHeader: null,
      fromAddress: "prospect@example.com",
      fromName: "Prospect",
      replyToAddress: null,
      toAddresses: ["me@x.com"],
      ccAddresses: [],
      subject: "Pricing?",
      bodyText: "How much does it cost?",
      bodyHtmlSanitized: null,
      snippet: "How much does it cost?",
      receivedAt: new Date("2026-10-05T10:00:00Z"),
      isUnread: true,
      isAnswered: false,
      autoSubmitted: null,
      precedence: null,
      listIdHeader: null,
      listUnsubscribeHeader: null,
      attachments: [],
      ...over,
    };
  }

  /** Fake receive client replaying caller-supplied messages. */
  function fakeClient(
    messages: ParsedInboundEmail[]
  ): (protocol: string) => EmailReceiveClient {
    const client: EmailReceiveClient = {
      async testConnection(): Promise<void> {
        /* no network in tests */
      },
      async fetchMessages(): Promise<ParsedInboundEmail[]> {
        return messages;
      },
    };
    return () => client;
  }

  /** Seed a legacy bare-UID row directly (pre-namespace sync shape). */
  async function seedLegacyRow(
    uid: string | number,
    over: Partial<EmailReceivedMessageEntity> = {}
  ): Promise<EmailReceivedMessageEntity> {
    const uidStr = String(uid);
    const message = new EmailReceivedMessageEntity();
    message.emailServiceId = SERVICE_ID;
    message.providerUid = uidStr;
    message.messageId = `<orig-${uidStr}@example.com>`;
    message.fromAddress = "prospect@example.com";
    message.toAddressesJson = '["me@x.com"]';
    message.subject = "Pricing?";
    message.receivedAt = new Date("2026-10-05T10:00:00Z");
    message.isUnread = 1;
    Object.assign(message, over);
    return await model.upsertByProviderUid(message);
  }

  it("stores a namespaced providerUid with folder + uidValidity provenance", async () => {
    const service = new EmailReceiveSyncService({
      clientFactory: fakeClient([inboundMessage(101)]),
    });
    const result = await service.syncUnread(SERVICE_ID, { unreadOnly: false });

    expect(result.stored).toBe(1);
    const stored = await SqliteDb.getInstance(dbpath).connection
      .getRepository(EmailReceivedMessageEntity)
      .findOneByOrFail({ id: result.messageIds[0] });
    expect(isNamespacedProviderUid(stored.providerUid)).toBe(true);
    const parsed = parseNamespacedProviderUid(stored.providerUid);
    expect(parsed?.uidValidity).toBe("424242");
    expect(parsed?.uid).toBe("101");
    expect(stored.providerFolder).toBe("INBOX");
    expect(stored.providerUidValidity).toBe("424242");
    // The replyStatus overload bug is gone: the raw flag stays 0 and the
    // projection is untouched by sync for a fresh insert (entity default).
    expect(stored.isAnswered).toBe(0);
    expect(stored.answeredFlagCheckedAt).toBeInstanceOf(Date);
    expect(stored.replyStatus).toBe("not_started");
  });

  it("does not reset replyStatus of a local sent reply when the flag is answered", async () => {
    // Local state: the app itself replied (replyStatus sent by finalization).
    const seeded = await seedLegacyRow(201, {
      replyStatus: "sent",
      processedAt: new Date("2026-10-05T12:00:00Z"),
      classification: "interested",
    });

    // A later sync observes \Answered for a DIFFERENT namespaced identity.
    const service = new EmailReceiveSyncService({
      clientFactory: fakeClient([inboundMessage(202, { isAnswered: true })]),
    });
    await service.syncUnread(SERVICE_ID, { unreadOnly: false });

    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    const legacyRow = await repo.findOneByOrFail({ id: seeded.id });
    // Untouched — different providerUid, no adoption (bare uid 202 ≠ 201).
    expect(legacyRow.replyStatus).toBe("sent");
    expect(legacyRow.classification).toBe("interested");
  });

  it("adopts a legacy bare-UID row only when the RFC identity validates", async () => {
    const legacy = await seedLegacyRow(301, {
      replyStatus: "draft_created",
      classification: "interested",
      classificationConfidence: 0.9,
      processedAt: new Date("2026-10-05T11:30:00Z"),
    });

    const service = new EmailReceiveSyncService({
      clientFactory: fakeClient([inboundMessage(301)]),
    });
    await service.syncUnread(SERVICE_ID, { unreadOnly: false });

    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    const adopted = await repo.findOneByOrFail({ id: legacy.id });
    // Adopted: bare "301" became the namespaced key, local state preserved.
    // (Classification is legitimately re-computed by normalizeAndAssociate on
    // every sync — FR-007 deterministic classifier — so it is NOT asserted
    // here; its preservation through the adoption UPDATE itself is proven at
    // the model level in EmailReceivedMessageUpsert tests.)
    expect(adopted.providerUid).toBe(namespacedUid(301));
    expect(adopted.providerFolder).toBe("INBOX");
    expect(adopted.providerUidValidity).toBe("424242");
    expect(adopted.replyStatus).toBe("draft_created");
    expect(adopted.processedAt?.toISOString()).toBe(
      "2026-10-05T11:30:00.000Z"
    );

    // Exactly one row for the namespaced identity (no duplicate insert).
    const byNamespaced = await repo.find({
      where: {
        emailServiceId: SERVICE_ID,
        providerUid: namespacedUid(301),
      },
    });
    expect(byNamespaced.length).toBe(1);
  });

  it("inserts a new row and preserves the legacy row when identity mismatches", async () => {
    // Legacy row under bare UID "401" holds a DIFFERENT RFC identity — the
    // folder was renamed / UIDVALIDITY bumped and the UID now names another
    // message. Adoption must be refused.
    const legacy = await seedLegacyRow(401, {
      messageId: "<a-different-message@example.com>",
      replyStatus: "draft_created",
    });

    const service = new EmailReceiveSyncService({
      clientFactory: fakeClient([inboundMessage(401)]),
    });
    await service.syncUnread(SERVICE_ID, { unreadOnly: false });

    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    // The legacy row is untouched.
    const untouched = await repo.findOneByOrFail({ id: legacy.id });
    expect(untouched.providerUid).toBe("401");
    expect(untouched.messageId).toBe("<a-different-message@example.com>");
    expect(untouched.replyStatus).toBe("draft_created");

    // The fetched message landed under its own namespaced key.
    const fresh = await repo.findOneByOrFail({
      emailServiceId: SERVICE_ID,
      providerUid: namespacedUid(401),
    });
    expect(fresh.id).not.toBe(legacy.id);
    expect(fresh.messageId).toBe("<orig-401@example.com>");
  });

  it("never adopts a legacy row when the fetched message has no RFC id", async () => {
    const legacy = await seedLegacyRow(501, {
      replyStatus: "draft_created",
    });

    const service = new EmailReceiveSyncService({
      clientFactory: fakeClient([
        inboundMessage(501, { messageId: null, threadKey: null }),
      ]),
    });
    await service.syncUnread(SERVICE_ID, { unreadOnly: false });

    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    const untouched = await repo.findOneByOrFail({ id: legacy.id });
    expect(untouched.providerUid).toBe("501");
    // The no-id message was still stored under its namespaced key.
    const fresh = await repo.findOneByOrFail({
      emailServiceId: SERVICE_ID,
      providerUid: namespacedUid(501),
    });
    expect(fresh.id).not.toBe(legacy.id);
  });

  it("refuses adoption when the namespaced key is already taken by a newer row", async () => {
    // A prior sync already inserted the namespaced row for uid 601 while the
    // legacy bare row lingered. Adoption must be refused (collision-safe),
    // the upsert refreshes the existing namespaced row, and the legacy row
    // keeps guarding its own identity.
    const namespacedRow = await model.upsertByProviderUid(
      (() => {
        const e = new EmailReceivedMessageEntity();
        e.emailServiceId = SERVICE_ID;
        e.providerUid = namespacedUid(601);
        e.messageId = "<orig-601@example.com>";
        e.fromAddress = "prospect@example.com";
        e.toAddressesJson = '["me@x.com"]';
        e.subject = "Pricing?";
        e.receivedAt = new Date();
        return e;
      })()
    );
    const legacy = await seedLegacyRow(601, {
      replyStatus: "draft_created",
    });

    const service = new EmailReceiveSyncService({
      clientFactory: fakeClient([inboundMessage(601)]),
    });
    // Must not throw UNIQUE-constraint: the adoption is skipped and the
    // normal upsert refreshes the existing namespaced row.
    await service.syncUnread(SERVICE_ID, { unreadOnly: false });

    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    const untouched = await repo.findOneByOrFail({ id: legacy.id });
    expect(untouched.providerUid).toBe("601");
    const refreshed = await repo.findOneByOrFail({ id: namespacedRow.id });
    expect(refreshed.providerUid).toBe(namespacedUid(601));
  });

  it("answered flag on a namespaced upsert still promotes replyStatus exactly once", async () => {
    const service = new EmailReceiveSyncService({
      clientFactory: fakeClient([inboundMessage(701, { isAnswered: true })]),
    });
    await service.syncUnread(SERVICE_ID, { unreadOnly: false });

    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    const row = await repo.findOneByOrFail({
      emailServiceId: SERVICE_ID,
      providerUid: namespacedUid(701),
    });
    // Historical promotion (narrowed in step 2): freshly-observed \Answered
    // strengthens a non-sent projection to sent.
    expect(row.isAnswered).toBe(1);
    expect(row.replyStatus).toBe("sent");
  });

  it("POP3 sync keeps the bare UIDL uid and null provenance", async () => {
    const service = new EmailReceiveSyncService({
      clientFactory: fakeClient([
        inboundMessage(801, {
          providerUid: "pop3-uidl-hash-1",
          providerFolder: null,
          providerUidValidity: null,
          messageId: "<pop3-msg@example.com>",
        }),
      ]),
    });
    await service.syncUnread(SERVICE_ID, { unreadOnly: false });

    const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
      EmailReceivedMessageEntity
    );
    const row = await repo.findOneByOrFail({
      emailServiceId: SERVICE_ID,
      providerUid: "pop3-uidl-hash-1",
    });
    expect(isNamespacedProviderUid(row.providerUid)).toBe(false);
    expect(row.providerFolder).toBeNull();
    expect(row.providerUidValidity).toBeNull();
    expect(row.isAnswered).toBe(0);
  });
});
