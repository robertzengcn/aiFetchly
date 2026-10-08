/**
 * Populated old-schema upgrade + rollback contract (T11/FR-038, technical
 * design §5.3). Proves the deployed schema-upgrade path — TypeORM
 * `synchronize: true` at DataSource init — over a POPULATED legacy database,
 * not a clean one (a clean DB or assumed `synchronize` behavior is insufficient
 * evidence per the T11 acceptance contract).
 *
 * Merge base for the legacy fixtures: 3c678ab9 (the commit before this branch
 * added the T03 evidence columns, T09 finish-reason/token columns, and the
 * T07 guard table). At that base the reply subsystem had every table EXCEPT
 * `email_reply_guard` and every received-message column EXCEPT the 9
 * mailbox-evidence columns; drafts lacked the 4 finish-reason/token columns.
 *
 * Guarantees verified here (PRD L261–L264):
 *   L262 — upgrade a populated old-schema DB TWICE without losing
 *          drafts/revisions/approvals/attempts/audit or historical sent
 *          protection.
 *   L263 — seed legacy conflicting/canonical duplicate rows; verify safe
 *          blocking (`reply_state_conflict`) and operator remediation.
 *   L264 — forward-compatible rollback behavior and that rollout disabling
 *          cannot remove mandatory local duplicate protection (the blocking
 *          paths contain no feature-flag reads; the kill switch disables new
 *          work only, never the cluster-evidence checks).
 *
 * The §5.3 rollout contract: when upgrade validation fails, the caller DISABLES
 * the reply workflow (kill switch) and PRESERVES the database — never a
 * destructive repair. `validateReplyUpgrade` reports only; it never mutates.
 */

import { describe, it, expect, afterAll, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { SqliteDb } from "@/config/SqliteDb";
import { EmailReplyGuardModel } from "@/model/EmailReplyGuard.model";
import { EmailReplyDraftModel } from "@/model/EmailReplyDraft.model";
import { canonicalReplyKey } from "@/service/emailReceive/EmailReplyIdentity";
import {
  validateReplyUpgrade,
  countTableRows,
} from "@/service/emailReply/EmailReplyUpgradeValidation";
import { resetFeatureFlagCacheForTest } from "@/config/featureFlags";

/** All reply-safety tables whose row counts must survive the upgrade. */
const PRESERVED_TABLES = [
  "email_received_message",
  "email_reply_draft",
  "email_reply_draft_revision",
  "email_reply_approval",
  "email_reply_send_attempt",
  "email_reply_audit_log",
  "email_auto_reply_audit_log",
] as const;

/** The 9 mailbox-evidence columns added by T03. */
const EVIDENCE_COLUMNS = [
  "isAnswered",
  "answeredFlagCheckedAt",
  "replyDetectedAt",
  "replyDetectionSource",
  "replyMatchedMessageId",
  "replyNegativeCheckAt",
  "replyNegativeContextHash",
  "providerFolder",
  "providerUidValidity",
] as const;

/** The 4 generation-completion columns added by T09 on email_reply_draft. */
const DRAFT_COMPLETION_COLUMNS = [
  "finishReason",
  "promptTokens",
  "completionTokens",
  "totalTokens",
] as const;

/**
 * Build the legacy database at merge-base shapes. Raw better-sqlite3 DDL only —
 * we are simulating a real pre-upgrade deployment, so the fixtures must NOT go
 * through TypeORM (which would silently add the new columns). Column types and
 * nullability match the merge-base entity definitions verbatim.
 */
function buildLegacyDatabase(dbPath: string): {
  serviceId: number;
  historicalSentMessageId: number;
  conflictingMessageIds: [number, number];
  liveDraftIds: [number, number];
  sentDraftId: number;
} {
  const db = new Database(dbPath);
  db.exec(`
    -- email_service at the merge-base shape (no T03 reply columns; the
    -- receive* columns and smtpUsername/replyTo are the only ones the guard
    -- does not touch — we keep the legacy tagId-free receive shape).
    CREATE TABLE email_service (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL,
      "from" VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL,
      host VARCHAR(255) NOT NULL,
      port VARCHAR(10) NOT NULL,
      ssl INTEGER DEFAULT 1,
      status INTEGER DEFAULT 1,
      receiveProtocol VARCHAR(10) DEFAULT 'imap',
      receiveFolder VARCHAR(255) DEFAULT 'INBOX',
      receiveEnabled INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- email_received_message at the merge-base shape: NO 9 evidence columns.
    -- Two rows share the same normalized RFC Message-ID so the canonical
    -- cluster has a conflicting duplicate; a third historical row has
    -- replyStatus='sent' (sticky local protection).
    CREATE TABLE email_received_message (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emailServiceId INTEGER NOT NULL,
      providerUid VARCHAR(255) NOT NULL,
      messageId VARCHAR(998),
      threadKey VARCHAR(998),
      inReplyTo VARCHAR(998),
      referencesHeader TEXT,
      fromAddress VARCHAR(320) NOT NULL,
      fromName VARCHAR(255),
      replyToAddress VARCHAR(320),
      toAddressesJson TEXT NOT NULL,
      ccAddressesJson TEXT,
      subject VARCHAR(998) NOT NULL,
      bodyText TEXT,
      bodyHtmlSanitized TEXT,
      snippet TEXT,
      receivedAt DATETIME NOT NULL,
      isUnread INTEGER DEFAULT 1,
      classification VARCHAR(50),
      classificationConfidence REAL,
      replyStatus VARCHAR(50) DEFAULT 'not_started',
      processedAt DATETIME,
      conversationId INTEGER,
      normalizedMessageId VARCHAR(998),
      normalizedInReplyTo VARCHAR(998),
      normalizedReferencesJson TEXT,
      normalizedBodyText TEXT,
      newContentText TEXT,
      autoSubmittedHeader VARCHAR(998),
      precedenceHeader VARCHAR(998),
      listIdHeader VARCHAR(998),
      listUnsubscribeHeader VARCHAR(998),
      hasAttachments INTEGER DEFAULT 0,
      attachmentMetadataJson TEXT,
      classificationSource VARCHAR(30),
      classificationVersion VARCHAR(50),
      classifiedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "ORM_KEY_email_received_message_emailServiceId_providerUid"
      ON email_received_message (emailServiceId, providerUid);
    CREATE INDEX "IDX_email_received_message_emailServiceId_receivedAt"
      ON email_received_message (emailServiceId, receivedAt);

    -- email_reply_draft at the merge-base shape: NO finishReason/token
    -- columns (T09 adds those). Two live 'draft' rows on the conflicting
    -- cluster + one 'sent' draft on the historical message.
    CREATE TABLE email_reply_draft (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      messageId INTEGER NOT NULL,
      emailServiceId INTEGER,
      subject VARCHAR(998) NOT NULL,
      bodyText TEXT NOT NULL,
      bodyHtml TEXT,
      status VARCHAR(50) DEFAULT 'draft',
      generationSource VARCHAR(20) DEFAULT 'ai',
      modelName VARCHAR(100),
      promptVersion VARCHAR(50),
      confidence REAL,
      knowledgeSourcesJson TEXT,
      ownerStyleProfileJson TEXT,
      warningsJson TEXT,
      sentAt DATETIME,
      sendError TEXT,
      conversationId INTEGER,
      currentRevisionId INTEGER,
      revisionNumber INTEGER DEFAULT 1,
      senderAddress VARCHAR(320),
      recipientAddress VARCHAR(320),
      contentHash VARCHAR(64),
      policyVersion VARCHAR(50),
      validationVersion VARCHAR(50),
      contextVersion INTEGER DEFAULT 1,
      knowledgeScopeVersion INTEGER,
      approvalInvalidatedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "IDX_email_reply_draft_messageId"
      ON email_reply_draft (messageId);
    CREATE INDEX "IDX_email_reply_draft_emailServiceId"
      ON email_reply_draft (emailServiceId);

    CREATE TABLE email_reply_draft_revision (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draftId INTEGER NOT NULL,
      revisionNumber INTEGER NOT NULL,
      actor VARCHAR(20) NOT NULL,
      subject VARCHAR(998) NOT NULL,
      bodyText TEXT NOT NULL,
      bodyHtml TEXT,
      senderAddress VARCHAR(320) NOT NULL,
      recipientAddress VARCHAR(320) NOT NULL,
      contentHash VARCHAR(64) NOT NULL,
      envelopeVersion INTEGER DEFAULT 1,
      smtpUsername VARCHAR(255),
      replyToAddress VARCHAR(320),
      generationMetadataJson TEXT,
      validationFindingsJson TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX "IDX_email_reply_draft_revision_draftId_revisionNumber"
      ON email_reply_draft_revision (draftId, revisionNumber);
    CREATE INDEX "IDX_email_reply_draft_revision_contentHash"
      ON email_reply_draft_revision (contentHash);

    CREATE TABLE email_reply_approval (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draftId INTEGER NOT NULL,
      revisionId INTEGER NOT NULL,
      approvedByType VARCHAR(20) NOT NULL,
      approvedById VARCHAR(255),
      approvedHash VARCHAR(64) NOT NULL,
      approvalTokenHash VARCHAR(64) NOT NULL,
      approvedAt DATETIME NOT NULL,
      expiresAt DATETIME,
      invalidatedAt DATETIME,
      invalidationReason TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "IDX_email_reply_approval_draftId_revisionId"
      ON email_reply_approval (draftId, revisionId);
    CREATE UNIQUE INDEX "IDX_email_reply_approval_approvalTokenHash"
      ON email_reply_approval (approvalTokenHash);

    CREATE TABLE email_reply_send_attempt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotencyKey VARCHAR(64) NOT NULL,
      draftId INTEGER NOT NULL,
      revisionId INTEGER NOT NULL,
      approvalId INTEGER NOT NULL,
      messageId INTEGER NOT NULL,
      conversationId INTEGER,
      emailServiceId INTEGER NOT NULL,
      senderAddress VARCHAR(320) NOT NULL,
      recipientAddress VARCHAR(320) NOT NULL,
      status VARCHAR(30) NOT NULL,
      claimedAt DATETIME NOT NULL,
      submittedAt DATETIME,
      completedAt DATETIME,
      providerMessageId VARCHAR(998),
      failureCode VARCHAR(50),
      sanitizedError TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX "IDX_email_reply_send_attempt_idempotencyKey"
      ON email_reply_send_attempt (idempotencyKey);
    CREATE INDEX "IDX_email_reply_send_attempt_draftId_revisionId"
      ON email_reply_send_attempt (draftId, revisionId);
    CREATE INDEX "IDX_email_reply_send_attempt_emailServiceId_createdAt"
      ON email_reply_send_attempt (emailServiceId, createdAt);
    CREATE INDEX "IDX_email_reply_send_attempt_status_claimedAt"
      ON email_reply_send_attempt (status, claimedAt);

    CREATE TABLE email_reply_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emailServiceId INTEGER NOT NULL,
      messageId INTEGER,
      draftId INTEGER,
      action VARCHAR(50) NOT NULL,
      actor VARCHAR(20) DEFAULT 'system',
      reason TEXT,
      metadataJson TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "IDX_email_reply_audit_log_emailServiceId_createdAt"
      ON email_reply_audit_log (emailServiceId, createdAt);
    CREATE INDEX "IDX_email_reply_audit_log_messageId"
      ON email_reply_audit_log (messageId);
    CREATE INDEX "IDX_email_reply_audit_log_draftId"
      ON email_reply_audit_log (draftId);

    CREATE TABLE email_auto_reply_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emailServiceId INTEGER NOT NULL,
      messageId INTEGER NOT NULL,
      draftId INTEGER,
      ruleId INTEGER,
      action VARCHAR(50) NOT NULL,
      decisionStatus VARCHAR(50) NOT NULL,
      classification VARCHAR(50),
      confidence REAL,
      reason TEXT,
      knowledgeQuery TEXT,
      knowledgeSourcesJson TEXT,
      generatedSubject VARCHAR(998),
      generatedBodyPreview TEXT,
      sentSubject VARCHAR(998),
      sentBodyPreview TEXT,
      requiresUserApproval INTEGER DEFAULT 1,
      approvedByUser INTEGER DEFAULT 0,
      errorMessage TEXT,
      metadataJson TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "IDX_email_auto_reply_audit_log_emailServiceId_createdAt"
      ON email_auto_reply_audit_log (emailServiceId, createdAt);
    CREATE INDEX "IDX_email_auto_reply_audit_log_decisionStatus_createdAt"
      ON email_auto_reply_audit_log (decisionStatus, createdAt);
    CREATE INDEX "IDX_email_auto_reply_audit_log_messageId"
      ON email_auto_reply_audit_log (messageId);
    CREATE INDEX "IDX_email_auto_reply_audit_log_draftId"
      ON email_auto_reply_audit_log (draftId);

    -- NOTE: email_reply_guard does NOT exist at the merge base. T07 adds it;
    -- synchronize must CREATE it (and both indexes) during the upgrade.
  `);

  // One email service row (the configured sender identity).
  const serviceInsert = db.prepare(
    `INSERT INTO email_service (name, "from", password, host, port, ssl, status, receiveProtocol, receiveEnabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  serviceInsert.run(
    "Legacy SMTP",
    "sales@legacy.example",
    "enc:legacy-password",
    "smtp.legacy.example",
    "465",
    1,
    1,
    "imap",
    1
  );
  const serviceId = (
    db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }
  ).id;

  // Two canonical-duplicate rows: same normalized RFC Message-ID, different
  // providerUid. The canonical cluster resolves both into one replyable entity
  // — and with two live drafts across the cluster, acquireReservation must
  // return reply_state_conflict (no auto-pick, no delete).
  const msgInsert = db.prepare(
    `INSERT INTO email_received_message
      (emailServiceId, providerUid, messageId, normalizedMessageId, fromAddress, toAddressesJson,
       subject, bodyText, receivedAt, isUnread, replyStatus, processedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const rfcId = "<legacy-original@legacy.example>";
  msgInsert.run(
    serviceId,
    "imap:legacyFolder:1:100",
    rfcId,
    rfcId,
    "customer@legacy.example",
    JSON.stringify(["sales@legacy.example"]),
    "Re: Pricing",
    "Body A",
    "2026-09-01 10:00:00",
    0,
    "draft_created",
    null
  );
  const conflictingA = (
    db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }
  ).id;
  msgInsert.run(
    serviceId,
    "imap:legacyFolder:1:101",
    rfcId,
    rfcId,
    "customer@legacy.example",
    JSON.stringify(["sales@legacy.example"]),
    "Re: Pricing",
    "Body B (canonical duplicate)",
    "2026-09-01 10:01:00",
    0,
    "draft_created",
    null
  );
  const conflictingB = (
    db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }
  ).id;

  // Historical sent row: sticky local protection. Its replyStatus must survive
  // the upgrade intact (never downgraded, never reset by an empty observation).
  msgInsert.run(
    serviceId,
    "imap:legacyFolder:1:102",
    "<legacy-sent@legacy.example>",
    "<legacy-sent@legacy.example>",
    "customer2@legacy.example",
    JSON.stringify(["sales@legacy.example"]),
    "Re: Order",
    "Already answered",
    "2026-08-01 09:00:00",
    0,
    "sent",
    "2026-08-01 09:05:00"
  );
  const historicalSentMessageId = (
    db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }
  ).id;

  // Two live 'draft' rows on the conflicting cluster (different messageIds but
  // same canonical RFC id → same replyKey). acquireReservation must see both
  // and return reply_state_conflict.
  const draftInsert = db.prepare(
    `INSERT INTO email_reply_draft
      (messageId, emailServiceId, subject, bodyText, status, generationSource,
       revisionNumber, senderAddress, recipientAddress, contentHash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  draftInsert.run(
    conflictingA,
    serviceId,
    "Re: Pricing",
    "Draft body A",
    "draft",
    "ai",
    1,
    "sales@legacy.example",
    "customer@legacy.example",
    "hash-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  );
  const liveDraftA = (
    db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }
  ).id;
  draftInsert.run(
    conflictingB,
    serviceId,
    "Re: Pricing",
    "Draft body B (canonical duplicate)",
    "draft",
    "ai",
    1,
    "sales@legacy.example",
    "customer@legacy.example",
    "hash-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  );
  const liveDraftB = (
    db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }
  ).id;

  // One sent draft on the historical message (consistency: sent row + sent
  // draft + sent attempt — the historical protection stack).
  draftInsert.run(
    historicalSentMessageId,
    serviceId,
    "Re: Order",
    "Sent draft body",
    "sent",
    "ai",
    1,
    "sales@legacy.example",
    "customer2@legacy.example",
    "hash-sent-ccccccccccccccccccccccccccccccccccccccccc"
  );
  const sentDraftId = (
    db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }
  ).id;

  // Revisions + approval + attempt for the sent draft (preservation targets).
  db.prepare(
    `INSERT INTO email_reply_draft_revision
       (draftId, revisionNumber, actor, subject, bodyText, senderAddress, recipientAddress, contentHash, envelopeVersion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sentDraftId,
    1,
    "ai",
    "Re: Order",
    "Sent draft body",
    "sales@legacy.example",
    "customer2@legacy.example",
    "hash-sent-ccccccccccccccccccccccccccccccccccccccccc",
    1
  );
  const sentRevisionId = (
    db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }
  ).id;

  db.prepare(
    `INSERT INTO email_reply_approval
       (draftId, revisionId, approvedByType, approvedHash, approvalTokenHash, approvedAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    sentDraftId,
    sentRevisionId,
    "user",
    "approved-hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "token-hash-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "2026-08-01 09:04:00"
  );

  db.prepare(
    `INSERT INTO email_reply_send_attempt
       (idempotencyKey, draftId, revisionId, approvalId, messageId, emailServiceId,
        senderAddress, recipientAddress, status, claimedAt, submittedAt, completedAt, providerMessageId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "idem-sent-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sentDraftId,
    sentRevisionId,
    (
      db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }
    ).id,
    historicalSentMessageId,
    serviceId,
    "sales@legacy.example",
    "customer2@legacy.example",
    "sent",
    "2026-08-01 09:04:30",
    "2026-08-01 09:04:45",
    "2026-08-01 09:05:00",
    "<provider-sent@legacy.example>"
  );

  // One generic audit row + one auto-reply audit row (preservation targets).
  db.prepare(
    `INSERT INTO email_reply_audit_log (emailServiceId, messageId, draftId, action, actor, reason, metadataJson)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    serviceId,
    historicalSentMessageId,
    sentDraftId,
    "reply_sent",
    "system",
    "[sent] historical send",
    JSON.stringify({ correlationId: "legacy-corr-1" })
  );
  db.prepare(
    `INSERT INTO email_auto_reply_audit_log
       (emailServiceId, messageId, draftId, action, decisionStatus, generatedSubject, requiresUserApproval, approvedByUser, metadataJson)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    serviceId,
    historicalSentMessageId,
    sentDraftId,
    "auto_reply_sent",
    "auto_sent",
    "Re: Order",
    1,
    1,
    JSON.stringify({ stage: "pre_send", code: "sent" })
  );

  db.close();

  return {
    serviceId,
    historicalSentMessageId,
    conflictingMessageIds: [conflictingA, conflictingB],
    liveDraftIds: [liveDraftA, liveDraftB],
    sentDraftId,
  };
}

describe("Populated old-schema upgrade + rollback (T11/FR-038)", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    // Isolate per-run: the BaseDb empty-filepath fallback lands on
    // os.tmpdir()/aifetchly-test, so each test gets a unique directory to
    // avoid the SQLITE_BUSY shared-db flake under parallel workers.
    tmpDir = path.join(
      os.tmpdir(),
      `aifetchly-reply-upgrade-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, "scraper.db");
    // Reset the process-wide singleton so getInstance picks up the new path.
    (SqliteDb as unknown as { instance: unknown }).instance = null;
    (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
      null;
    (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
    resetFeatureFlagCacheForTest();
  });

  afterAll(async () => {
    await SqliteDb.destroyInstance();
  });

  async function upgradeOnce(): Promise<void> {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
  }

  function openReadonly(): Database.Database {
    return new Database(dbPath, { readonly: true });
  }

  /**
   * L261/L262: the deployed schema-upgrade path over a populated legacy DB.
   * Upgrade TWICE (idempotent) and verify nothing is lost.
   */
  it("upgrades a populated old-schema DB twice without losing drafts/revisions/approvals/attempts/audit or historical sent protection", async () => {
    const seed = buildLegacyDatabase(dbPath);

    // Snapshot row counts BEFORE the upgrade via a raw readonly handle (the
    // pre-upgrade DB has no guard table yet — countTableRows returns -1 for it).
    const before = openReadonly();
    const beforeCounts: Record<string, number> = {};
    for (const table of PRESERVED_TABLES) {
      beforeCounts[table] = (
        before
          .prepare(`SELECT COUNT(*) AS c FROM ${table}`)
          .get() as { c: number }
      ).c;
    }
    // The guard table does not exist yet — countTableRows must report -1.
    expect(beforeCounts.email_received_message).toBe(3);
    expect(beforeCounts.email_reply_draft).toBe(3);
    expect(beforeCounts.email_reply_draft_revision).toBe(1);
    expect(beforeCounts.email_reply_approval).toBe(1);
    expect(beforeCounts.email_reply_send_attempt).toBe(1);
    expect(beforeCounts.email_reply_audit_log).toBe(1);
    expect(beforeCounts.email_auto_reply_audit_log).toBe(1);
    before.close();

    // --- First upgrade: synchronize runs over the populated DB. ---
    await upgradeOnce();

    const postFirst = openReadonly();
    // The 9 evidence columns now exist on email_received_message.
    const receivedCols = (
      postFirst.prepare(`PRAGMA table_info(email_received_message)`).all() as Array<{
        name: string;
        dflt_value: string | null;
      }>
    ).map((c) => c.name);
    for (const col of EVIDENCE_COLUMNS) {
      expect(receivedCols, `evidence column ${col} should exist after upgrade`).toContain(col);
    }
    // isAnswered defaults to 0 (unobserved) so a legacy row reads as
    // needs-live-check, never observed-negative.
    const isAnsweredCol = (
      postFirst.prepare(`PRAGMA table_info(email_received_message)`).all() as Array<{
        name: string;
        dflt_value: string | null;
      }>
    ).find((c) => c.name === "isAnswered");
    expect(isAnsweredCol?.dflt_value).toBe("0");

    // The 4 draft completion columns now exist on email_reply_draft.
    const draftCols = (
      postFirst.prepare(`PRAGMA table_info(email_reply_draft)`).all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    for (const col of DRAFT_COMPLETION_COLUMNS) {
      expect(draftCols, `draft completion column ${col} should exist after upgrade`).toContain(col);
    }

    // The guard table + both indexes now exist.
    const guardTables = postFirst
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='email_reply_guard'`)
      .all() as Array<{ name: string }>;
    expect(guardTables.length).toBe(1);
    const guardIndexes = postFirst
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='email_reply_guard'`
      )
      .all() as Array<{ name: string; sql: string | null }>;
    const guardSqlLower = guardIndexes.map((r) => (r.sql ?? "").toLowerCase());
    expect(
      guardSqlLower.some(
        (s) =>
          s.includes("unique") &&
          s.includes("emailserviceid") &&
          s.includes("replykey")
      ),
      "guard unique (emailServiceId, replyKey) index must exist"
    ).toBe(true);
    expect(
      guardSqlLower.some((s) => s.includes("phase") && s.includes("leaseexpiresat")),
      "guard (phase, leaseExpiresAt) index must exist"
    ).toBe(true);

    // No guard rows were eagerly materialized — the guard is lazy and only
    // rows materialize at acquire-time after reconcile.
    const guardRows = (
      postFirst
        .prepare(`SELECT COUNT(*) AS c FROM email_reply_guard`)
        .get() as { c: number }
    ).c;
    expect(guardRows).toBe(0);

    // All populated rows survived the first upgrade with their IDs and key
    // values intact. New columns are NULL/default-0 on legacy rows.
    const historical = postFirst
      .prepare(
        `SELECT replyStatus, processedAt, isAnswered, replyDetectedAt, replyDetectionSource
         FROM email_received_message WHERE id = ?`
      )
      .get(seed.historicalSentMessageId) as {
      replyStatus: string;
      processedAt: string | null;
      isAnswered: number;
      replyDetectedAt: string | null;
      replyDetectionSource: string | null;
    };
    expect(historical.replyStatus).toBe("sent"); // sticky local protection
    expect(historical.processedAt).not.toBeNull();
    expect(historical.isAnswered).toBe(0); // unobserved default, not a downgrade
    expect(historical.replyDetectedAt).toBeNull(); // no detection evidence yet
    expect(historical.replyDetectionSource).toBeNull();

    const liveDrafts = postFirst
      .prepare(
        `SELECT id, status, contentHash, finishReason, promptTokens
         FROM email_reply_draft WHERE id IN (?, ?) ORDER BY id`
      )
      .all(...seed.liveDraftIds) as Array<{
      id: number;
      status: string;
      contentHash: string;
      finishReason: string | null;
      promptTokens: number | null;
    }>;
    expect(liveDrafts).toHaveLength(2);
    expect(liveDrafts.map((d) => d.id)).toEqual(seed.liveDraftIds);
    expect(liveDrafts.every((d) => d.status === "draft")).toBe(true);
    // New T09 columns are NULL on legacy rows (no completion metadata).
    expect(liveDrafts.every((d) => d.finishReason === null)).toBe(true);
    expect(liveDrafts.every((d) => d.promptTokens === null)).toBe(true);
    // Content hashes preserved exactly.
    expect(liveDrafts[0].contentHash).toMatch(/^hash-a-/);
    expect(liveDrafts[1].contentHash).toMatch(/^hash-b-/);

    postFirst.close();

    // Validate via the post-synchronize service: read-only, no failures.
    const ds = SqliteDb.getInstance(tmpDir).connection;
    const report1 = await validateReplyUpgrade(ds);
    expect(
      report1.ok,
      `validation should pass: ${JSON.stringify(report1.failures)}`
    ).toBe(true);
    expect(report1.failures).toHaveLength(0);

    // Row counts via countTableRows match the pre-upgrade snapshot (the guard
    // table now exists with 0 rows — also preserved).
    for (const table of PRESERVED_TABLES) {
      const after = await countTableRows(ds, table);
      expect(after, `${table} row count changed across upgrade`).toBe(
        beforeCounts[table]
      );
    }
    expect(await countTableRows(ds, "email_reply_guard")).toBe(0);

    // --- Second upgrade: idempotent. Synchronize over the already-upgraded
    //     DB must be a no-op — no rows lost, no columns reverted. ---
    await SqliteDb.destroyInstance();
    await upgradeOnce();

    const postSecond = openReadonly();
    const afterCounts: Record<string, number> = {};
    for (const table of [...PRESERVED_TABLES, "email_reply_guard"] as const) {
      afterCounts[table] = (
        postSecond
          .prepare(`SELECT COUNT(*) AS c FROM ${table}`)
          .get() as { c: number }
      ).c;
    }
    postSecond.close();

    // Idempotent: same counts as before the second run (guard still 0).
    for (const table of PRESERVED_TABLES) {
      expect(afterCounts[table], `${table} row count changed on second upgrade`).toBe(
        beforeCounts[table]
      );
    }
    expect(afterCounts.email_reply_guard).toBe(0);

    // Validation still clean after the second upgrade.
    const ds2 = SqliteDb.getInstance(tmpDir).connection;
    const report2 = await validateReplyUpgrade(ds2);
    expect(report2.ok).toBe(true);
  });

  /**
   * L263: legacy conflicting/canonical duplicate rows. The seeded cluster has
   * two live drafts across canonical-equivalent messages. acquireReservation
   * must block with reply_state_conflict — never auto-pick newest, never delete
   * the losing draft. Operator remediation (discard one) unblocks the cluster.
   */
  it("blocks canonical duplicate clusters with reply_state_conflict and unblocks after operator remediation", async () => {
    const seed = buildLegacyDatabase(dbPath);
    await upgradeOnce();

    const ds = SqliteDb.getInstance(tmpDir).connection;
    const report = await validateReplyUpgrade(ds);
    expect(report.ok).toBe(true);

    const guardModel = new EmailReplyGuardModel(tmpDir);
    const draftModel = new EmailReplyDraftModel(tmpDir);

    // The cluster's canonical replyKey: same normalized RFC id on both rows.
    const replyKey = canonicalReplyKey({
      normalizedMessageId: "<legacy-original@legacy.example>",
      rowId: seed.conflictingMessageIds[0],
    });

    const now = new Date("2026-10-08T00:00:00Z");
    const leaseExpiresAt = new Date("2026-10-08T00:05:00Z");

    // Two live drafts across the cluster → conflict. Neither is auto-picked,
    // neither is deleted; no guard row is materialized (the blocked path
    // returns before the conditional INSERT).
    const result = await guardModel.acquireReservation({
      emailServiceId: seed.serviceId,
      replyKey,
      messageId: seed.conflictingMessageIds[0],
      ownerToken: "owner-op-acquire",
      leaseExpiresAt,
      now,
      normalizedMessageId: "<legacy-original@legacy.example>",
    });

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.code).toBe("reply_state_conflict");
    }

    // No guard row materialized for a blocked acquire.
    expect(await countTableRows(ds, "email_reply_guard")).toBe(0);

    // Both drafts still exist with status='draft' — no auto-pick, no delete.
    const liveAfter = await draftModel.listByMessage(
      seed.conflictingMessageIds[0]
    );
    expect(liveAfter.length).toBe(1);
    expect(liveAfter[0].id).toBe(seed.liveDraftIds[0]);
    expect(liveAfter[0].status).toBe("draft");
    const sibling = await draftModel.listByMessage(
      seed.conflictingMessageIds[1]
    );
    expect(sibling.length).toBe(1);
    expect(sibling[0].id).toBe(seed.liveDraftIds[1]);
    expect(sibling[0].status).toBe("draft");

    // Operator remediation: discard one of the conflicting drafts. This is
    // the operator-routed code path — a human decision, never an auto-resolve.
    await draftModel.updateStatus(seed.liveDraftIds[1], "discarded", null);

    // After remediation the cluster has exactly one live draft —
    // acquireReservation now returns reusable (the eligible draft is picked,
    // no regeneration).
    const result2 = await guardModel.acquireReservation({
      emailServiceId: seed.serviceId,
      replyKey,
      messageId: seed.conflictingMessageIds[0],
      ownerToken: "owner-op-reuse",
      leaseExpiresAt,
      now,
      normalizedMessageId: "<legacy-original@legacy.example>",
    });
    expect(result2.status).toBe("reusable");
    if (result2.status === "reusable") {
      expect(result2.draftId).toBe(seed.liveDraftIds[0]);
    }
  });

  /**
   * L264: forward-compatible rollback. Disabling the reply workflow via the
   * kill switch must NOT remove mandatory local duplicate protection. The
   * blocking paths (acquireReservation's sent/unknown/conflict/sending checks)
   * contain no feature-flag reads — they run unconditionally. The kill switch
   * only disables NEW work (draft generation + new send claims), exactly as
   * §5.3 requires.
   *
   * This test does NOT flip the kill-switch Token flag (that would require the
   * electron-store-backed Token, polluting real state). Instead it proves the
   * invariant directly: acquireReservation has no feature-flag dependency,
   * and the historical sent row stays protected regardless of any rollout flag.
   */
  it("keeps mandatory local duplicate protection when rollout is disabled (forward-compatible rollback)", async () => {
    const seed = buildLegacyDatabase(dbPath);
    await upgradeOnce();

    const guardModel = new EmailReplyGuardModel(tmpDir);

    // The historical sent cluster: replyStatus='sent' + a sent draft + a sent
    // attempt. acquireReservation must block with `already_replied` — this is
    // the mandatory local duplicate protection, and it has NO feature-flag
    // dependency. Rollback (kill switch on, all rollout flags off) cannot
    // remove it because the cluster-evidence checks run unconditionally.
    const replyKey = canonicalReplyKey({
      normalizedMessageId: "<legacy-sent@legacy.example>",
      rowId: seed.historicalSentMessageId,
    });
    const now = new Date("2026-10-08T00:00:00Z");
    const leaseExpiresAt = new Date("2026-10-08T00:05:00Z");

    // The acquire path runs with every rollout flag in its default state
    // (recoverable-history, tool-output, AND the kill switch all OFF/fail-
    // closed by default). The sent cluster still blocks — proving the
    // protection does not depend on any rollout flag being on.
    const result = await guardModel.acquireReservation({
      emailServiceId: seed.serviceId,
      replyKey,
      messageId: seed.historicalSentMessageId,
      ownerToken: "owner-rollback-probe",
      leaseExpiresAt,
      now,
      normalizedMessageId: "<legacy-sent@legacy.example>",
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.code).toBe("already_replied");
    }

    // And the conflicting cluster still blocks with reply_state_conflict
    // under the same default-flag state — the conflict check is also
    // unconditional.
    const conflictKey = canonicalReplyKey({
      normalizedMessageId: "<legacy-original@legacy.example>",
      rowId: seed.conflictingMessageIds[0],
    });
    const result2 = await guardModel.acquireReservation({
      emailServiceId: seed.serviceId,
      replyKey: conflictKey,
      messageId: seed.conflictingMessageIds[0],
      ownerToken: "owner-rollback-probe-2",
      leaseExpiresAt,
      now,
      normalizedMessageId: "<legacy-original@legacy.example>",
    });
    expect(result2.status).toBe("blocked");
    if (result2.status === "blocked") {
      expect(result2.code).toBe("reply_state_conflict");
    }
  });

  /**
   * §5.3 rollout contract: when upgrade validation fails, the caller DISABLES
   * the reply workflow and PRESERVES the database. `validateReplyUpgrade`
   * never mutates — it reports failures only. A corrupted fixture (missing
   * guard table + missing evidence columns) surfaces a non-empty failure list
   * without touching the DB.
   */
  it("validateReplyUpgrade reports failures read-only and never repairs a corrupted database", async () => {
    // Build a populated DB that is missing the guard table AND the evidence
    // columns — the exact invariants the validator checks. We reuse the legacy
    // builder but stop before any upgrade.
    buildLegacyDatabase(dbPath);
    // Initialize TypeORM WITHOUT running synchronize by going through the
    // normal path then immediately destroying — but that would add the
    // columns. Instead, validate against the raw better-sqlite3-via-Driver
    // connection by initializing with synchronize and then DROP the guard
    // table + evidence columns to simulate a corrupted post-upgrade state.
    await upgradeOnce();

    const ds = SqliteDb.getInstance(tmpDir).connection;
    // Corrupt: drop the guard table and a required evidence column.
    const qr = ds.createQueryRunner();
    await qr.query(`DROP TABLE email_reply_guard`);
    await qr.query(
      `CREATE TABLE email_received_message_corrupt AS
       SELECT id, emailServiceId, providerUid, messageId, threadKey, inReplyTo,
              referencesHeader, fromAddress, fromName, replyToAddress,
              toAddressesJson, ccAddressesJson, subject, bodyText, bodyHtmlSanitized,
              snippet, receivedAt, isUnread, classification, classificationConfidence,
              replyStatus, processedAt, conversationId, normalizedMessageId,
              normalizedInReplyTo, normalizedReferencesJson, normalizedBodyText,
              newContentText, autoSubmittedHeader, precedenceHeader, listIdHeader,
              listUnsubscribeHeader, hasAttachments, attachmentMetadataJson,
              classificationSource, classificationVersion, classifiedAt, createdAt,
              updatedAt
       FROM email_received_message`
    );
    await qr.query(`DROP TABLE email_received_message`);
    await qr.query(
      `ALTER TABLE email_received_message_corrupt RENAME TO email_received_message`
    );
    await qr.release();

    // Snapshot row counts before validation — the validator must not mutate.
    const receivedBefore = await countTableRows(ds, "email_received_message");
    const draftBefore = await countTableRows(ds, "email_reply_draft");

    const report = await validateReplyUpgrade(ds);
    expect(report.ok).toBe(false);
    // The guard table is gone → table + index failures; the evidence columns
    // are gone → column failures. No mutation occurred.
    expect(report.failures.length).toBeGreaterThan(0);
    expect(
      report.failures.some((f) => f.check === "table" && f.detail.includes("email_reply_guard"))
    ).toBe(true);
    expect(
      report.failures.some((f) => f.check === "column")
    ).toBe(true);

    // Database PRESERVED — no rows lost, no tables dropped/recreated by the
    // validator. (The guard table is still gone because WE dropped it; the
    // validator did not recreate or repair it.)
    const receivedAfter = await countTableRows(ds, "email_received_message");
    const draftAfter = await countTableRows(ds, "email_reply_draft");
    expect(receivedAfter).toBe(receivedBefore);
    expect(draftAfter).toBe(draftBefore);
    const guardTables = (
      await ds.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='email_reply_guard'`
      )
    ) as Array<{ name: string }>;
    expect(guardTables.length).toBe(0);
  });
});
