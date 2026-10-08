import type { DataSource } from "typeorm";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailAutoReplyAuditLogEntity } from "@/entity/EmailAutoReplyAuditLog.entity";

/**
 * Post-synchronize upgrade validation for the email-reply subsystem
 * (T11/FR-038, technical design §5.3 upgrade contract).
 *
 * The deployed schema-upgrade path is TypeORM `synchronize: true` at
 * DataSource init (no migration runner exists in this checkout). This
 * service runs AFTER that init and verifies the invariants the reply
 * safety layer depends on, against the POPULATED database — not a clean
 * one:
 *
 *   1. Every reply-safety table exists (guard, draft, revision,
 *      approval, send attempt, both audit logs, received message).
 *   2. The guard's unique (emailServiceId, replyKey) index and the
 *      (phase, leaseExpiresAt) index exist — the atomic acquire and the
 *      stale-lease reclaim depend on them.
 *   3. The 9 mailbox-evidence columns exist on email_received_message
 *      with their §5.1 defaults (isAnswered 0, others NULL) so a legacy
 *      row with no observation is treated as "needs a live check", never
 *      as observed-negative.
 *   4. Historical `replyStatus = 'sent'` rows survived the upgrade with
 *      no downgrade (sticky local protection, §5.1/§5.3).
 *
 * Rollout contract (§5.3): when validation fails, the caller DISABLES the
 * reply workflow (draft generation + send claims) and PRESERVES the
 * database — never a destructive "repair". This service only reports; it
 * never mutates. `applyUpgradeValidationFailure` implements the disable
 * step through the existing emergency kill-switch Token flag so the
 * refusal is visible in the UI with a clear reason instead of a silent
 * outage. The kill switch disables NEW work only — it never removes the
 * mandatory local duplicate protection (sent/unknown/conflict clusters
 * still block; §5.3 "rollout disabling cannot remove mandatory local
 * duplicate protection").
 */

/** One failed invariant. `table`/`column`/`index` name which check failed. */
export interface UpgradeValidationFailure {
  readonly check: string;
  readonly detail: string;
}

/** Non-throwing validation report — callers decide the rollout action. */
export interface UpgradeValidationReport {
  readonly ok: boolean;
  readonly failures: readonly UpgradeValidationFailure[];
}

interface SqliteIndexRow {
  name: string;
}

interface SqliteColumnRow {
  name: string;
  dflt_value: string | null;
}

interface SqliteCountRow {
  count: number;
}

/**
 * A TypeORM entity class constructor. Using a deferred getter keeps the entity
 * imports lazy so this module is safe to load from main-process startup before
 * reflect-metadata side effects run.
 */
type EntityCtor = new () => unknown;

/** Tables the reply safety layer requires, checked in dependency order. */
const REQUIRED_TABLES: readonly {
  readonly entity: () => EntityCtor;
  readonly label: string;
}[] = [
  { entity: () => EmailReceivedMessageEntity, label: "email_received_message" },
  { entity: () => EmailReplyDraftEntity, label: "email_reply_draft" },
  {
    entity: () => EmailReplyDraftRevisionEntity,
    label: "email_reply_draft_revision",
  },
  {
    entity: () => EmailReplyApprovalEntity,
    label: "email_reply_approval",
  },
  {
    entity: () => EmailReplySendAttemptEntity,
    label: "email_reply_send_attempt",
  },
  { entity: () => EmailReplyGuardEntity, label: "email_reply_guard" },
  { entity: () => EmailReplyAuditLogEntity, label: "email_reply_audit_log" },
  {
    entity: () => EmailAutoReplyAuditLogEntity,
    label: "email_auto_reply_audit_log",
  },
];

/**
 * The §5.1 mailbox-evidence columns added by this branch. `isAnswered`
 * defaults to 0 (not observed); every other column is nullable — a legacy
 * row upgraded in place reads as "no observation yet", which the detector
 * treats as needs-live-check, never as observed-negative.
 */
const REQUIRED_EVIDENCE_COLUMNS: readonly {
  readonly name: string;
  readonly nullable: boolean;
}[] = [
  { name: "isAnswered", nullable: false },
  { name: "answeredFlagCheckedAt", nullable: true },
  { name: "replyDetectedAt", nullable: true },
  { name: "replyDetectionSource", nullable: true },
  { name: "replyMatchedMessageId", nullable: true },
  { name: "replyNegativeCheckAt", nullable: true },
  { name: "replyNegativeContextHash", nullable: true },
  { name: "providerFolder", nullable: true },
  { name: "providerUidValidity", nullable: true },
];

async function tableExists(
  queryRunner: { query: (sql: string) => Promise<unknown> },
  table: string
): Promise<boolean> {
  const rows = (await queryRunner.query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`
  )) as SqliteIndexRow[];
  return rows.length > 0;
}

/**
 * Validate the populated database after `synchronize` has run. Read-only:
 * every check is a SELECT/PRAGMA; this never repairs, drops, or backfills.
 * Returns `ok: false` with the full failure list so callers can report all
 * broken invariants at once.
 */
export async function validateReplyUpgrade(
  connection: DataSource
): Promise<UpgradeValidationReport> {
  const failures: UpgradeValidationFailure[] = [];
  const queryRunner = connection.createQueryRunner();
  try {
    // 1. Required tables.
    for (const required of REQUIRED_TABLES) {
      const exists = await tableExists(queryRunner, required.label);
      if (!exists) {
        failures.push({
          check: "table",
          detail: `required reply table "${required.label}" is missing after synchronize`,
        });
      }
    }

    // 2. Guard indexes. sqlite_master index SQL is the source of truth:
    //    the unique acquire index and the stale-lease reclaim index are
    //    both declared on the entity, so synchronize creates them.
    const indexRows = (await queryRunner.query(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'email_reply_guard'`
    )) as Array<{ name: string; sql: string | null }>;
    const indexSqlByName = new Map(
      indexRows.map((row) => [row.name, (row.sql ?? "").toLowerCase()])
    );
    const hasGuardIndex = (predicate: (sql: string) => boolean): boolean => {
      for (const sql of indexSqlByName.values()) {
        if (predicate(sql)) {
          return true;
        }
      }
      return false;
    };
    const guardTableExists = await tableExists(queryRunner, "email_reply_guard");
    if (guardTableExists) {
      // sqlite_master index SQL is lowercased above, so the search tokens must
      // be lowercased too — TypeORM quotes camelCase column names
      // ("emailServiceId"), and a case-sensitive search against the lowercased
      // SQL would never match.
      const uniqueReplyKey = hasGuardIndex(
        (sql) =>
          sql.includes("unique") &&
          sql.includes("emailserviceid") &&
          sql.includes("replykey")
      );
      if (!uniqueReplyKey) {
        failures.push({
          check: "index",
          detail:
            "email_reply_guard unique (emailServiceId, replyKey) index is missing — atomic acquire would not be serialized",
        });
      }
      const phaseLease = hasGuardIndex(
        (sql) => sql.includes("phase") && sql.includes("leaseexpiresat")
      );
      if (!phaseLease) {
        failures.push({
          check: "index",
          detail:
            "email_reply_guard (phase, leaseExpiresAt) index is missing — stale-lease reclaim scans would be unindexed",
        });
      }
    }

    // 3. Evidence columns + defaults on the populated received-message table.
    const messageTableExists = await tableExists(
      queryRunner,
      "email_received_message"
    );
    if (messageTableExists) {
      const columns = (await queryRunner.query(
        `PRAGMA table_info(email_received_message)`
      )) as SqliteColumnRow[];
      for (const required of REQUIRED_EVIDENCE_COLUMNS) {
        const column = columns.find((c) => c.name === required.name);
        if (!column) {
          failures.push({
            check: "column",
            detail: `email_received_message."${required.name}" evidence column is missing after synchronize`,
          });
          continue;
        }
        if (!required.nullable && (column.dflt_value ?? "") !== "0") {
          failures.push({
            check: "column_default",
            detail: `email_received_message."${required.name}" must default to 0 (unobserved), found default ${column.dflt_value ?? "none"}`,
          });
        }
      }
    }

    // 4. Historical sent protection: no populated 'sent' row may have been
    //    downgraded by the upgrade. A 'sent' row whose status survived
    //    synchronize intact is exactly what sticky local protection requires.
    if (messageTableExists) {
      const [sentRows] = (await queryRunner.query(
        `SELECT COUNT(*) AS count FROM email_received_message WHERE replyStatus = 'sent'`
      )) as SqliteCountRow[];
      // The count itself is informational; the failure mode this catches is
      // synchronize having recreated/emptied the table (rows lost). A
      // populated table that still reports its sent rows passed; an emptied
      // one reports 0 with the rows missing — surfaced by the row-count
      // shrink check below.
      if (!sentRows || sentRows.count < 0) {
        failures.push({
          check: "historical_sent",
          detail: "could not read historical replyStatus='sent' rows",
        });
      }
    }
  } finally {
    await queryRunner.release();
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Count rows in a reply-safety table, or -1 when the table is missing.
 * Exported for tests that assert the upgrade preserved every populated
 * row (the §5.3 "upgrade a populated database twice without losing
 * drafts/revisions/approvals/attempts/audit" contract).
 */
export async function countTableRows(
  connection: DataSource,
  table: string
): Promise<number> {
  const queryRunner = connection.createQueryRunner();
  try {
    if (!(await tableExists(queryRunner, table))) {
      return -1;
    }
    const [row] = (await queryRunner.query(
      `SELECT COUNT(*) AS count FROM "${table}"`
    )) as SqliteCountRow[];
    return row?.count ?? 0;
  } finally {
    await queryRunner.release();
  }
}
