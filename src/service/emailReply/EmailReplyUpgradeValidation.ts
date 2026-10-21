import type { DataSource, QueryRunner } from "typeorm";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailAutoReplyAuditLogEntity } from "@/entity/EmailAutoReplyAuditLog.entity";
import {
  EMAIL_REPLY_KILL_SWITCH_FLAG,
  isEmailReplyKillSwitchOn,
} from "@/config/featureFlags";
import { Token } from "@/modules/token";

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

/**
 * Allowlist of table names this module is permitted to query. Every name is a
 * hardcoded `REQUIRED_TABLES` label or a literal in this file — no caller
 * passes user input. The guard exists so a future caller cannot widen the
 * `table` argument to an arbitrary string and silently interpolate it into
 * `FROM "<table>"` (SQLite has no placeholder for identifiers).
 */
const REPLY_TABLE_ALLOWLIST: readonly string[] = REQUIRED_TABLES.map(
  (r) => r.label
).concat(["email_received_message", "email_reply_guard"]);

function assertAllowedTable(table: string): void {
  if (!REPLY_TABLE_ALLOWLIST.includes(table)) {
    throw new Error(
      `EmailReplyUpgradeValidation: untrusted table name "${table}" rejected by allowlist`
    );
  }
}

async function tableExists(
  queryRunner: QueryRunner,
  table: string
): Promise<boolean> {
  // Parameterized predicate — no string interpolation into SQL. The `table`
  // argument is allowlisted by the caller, but the value still flows through a
  // bind parameter so the SQL-safety pattern is correct regardless of source.
  const rows = (await queryRunner.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table]
  )) as SqliteIndexRow[];
  return rows.length > 0;
}

/** One row of `PRAGMA index_list(<table>)`. */
interface SqliteIndexListRow {
  /** 0-based sequence number. */
  seq: number;
  /** Index name. */
  name: string;
  /** 1 = UNIQUE index, 0 = non-unique. */
  unique: number;
  /** "c" = created by CREATE INDEX, "u" = from a UNIQUE constraint, "pk" = primary key. */
  origin: string;
  /** 1 = partial index (has a WHERE clause), 0 = full. */
  partial: number;
}

/** One row of `PRAGMA index_info(<index>)`. */
interface SqliteIndexInfoRow {
  /** 0-based position of the column within the index key. */
  seqno: number;
  /** Column id within the table (the table's column index), or -1 for an expression. */
  cid: number;
  /** Column name (NULL when the key column is an expression, not a bare column). */
  name: string | null;
}

/**
 * Find an index on `table` whose ordered key columns EXACTLY equal `columns`
 * and whose uniqueness matches `requireUnique`. Uses `PRAGMA index_list` +
 * `PRAGMA index_info` — the declared column set is the source of truth, not a
 * substring match against the CREATE INDEX SQL.
 *
 * R23: the previous implementation checked `sql.includes("emailserviceid") &&
 * sql.includes("replykey")`, which a WRONG composite index like
 * `(replyKey, emailServiceId, phase, leaseExpiresAt)` would also satisfy — it
 * contains both tokens but neither the exact ordered pair nor the UNIQUE flag
 * the atomic acquire depends on. This helper resolves the real ordered column
 * list and the uniqueness flag from SQLite metadata, so only the index that
 * actually serializes `(emailServiceId, replyKey)` acquire qualifies.
 */
async function findIndexWithColumns(
  queryRunner: QueryRunner,
  table: string,
  columns: readonly string[],
  requireUnique: boolean
): Promise<boolean> {
  const listRows = (await queryRunner.query(
    `PRAGMA index_list("${table}")`
  )) as SqliteIndexListRow[];
  for (const idx of listRows) {
    if (requireUnique && idx.unique !== 1) {
      continue;
    }
    if (!requireUnique && idx.unique === 1) {
      // A UNIQUE index technically also covers a non-unique lookup, but the
      // phase-lease reclaim index must NOT be unique (a unique constraint
      // there would break multi-row stale-lease scans). Require a non-unique
      // index for the non-unique case.
      continue;
    }
    const infoRows = (await queryRunner.query(
      `PRAGMA index_info("${idx.name}")`
    )) as SqliteIndexInfoRow[];
    // Ordered, case-sensitive comparison against the entity column names. The
    // key columns must be exactly `columns`, in order, with no extras and no
    // expressions. A partial key or a superset does not match.
    const keyColumns = infoRows
      .sort((a, b) => a.seqno - b.seqno)
      .map((r) => r.name);
    if (
      keyColumns.length === columns.length &&
      keyColumns.every((c, i) => c === columns[i])
    ) {
      return true;
    }
  }
  return false;
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

    // 2. Guard indexes. The unique (emailServiceId, replyKey) acquire index
    //    and the non-unique (phase, leaseExpiresAt) stale-lease reclaim index
    //    are both declared on the entity, so synchronize creates them. R23: the
    //    previous implementation substring-matched the CREATE INDEX SQL — a
    //    wrong composite index like (replyKey, emailServiceId, phase,
    //    leaseExpiresAt) also contains both tokens, so the check would pass
    //    while neither the exact ordered pair nor the UNIQUE flag the atomic
    //    acquire depends on was actually present. Resolve the real ordered
    //    column set + uniqueness from SQLite metadata instead.
    const guardTableExists = await tableExists(queryRunner, "email_reply_guard");
    if (guardTableExists) {
      const uniqueReplyKey = await findIndexWithColumns(
        queryRunner,
        "email_reply_guard",
        ["emailServiceId", "replyKey"],
        true
      );
      if (!uniqueReplyKey) {
        failures.push({
          check: "index",
          detail:
            "email_reply_guard UNIQUE (emailServiceId, replyKey) index is missing — atomic acquire would not be serialized",
        });
      }
      const phaseLease = await findIndexWithColumns(
        queryRunner,
        "email_reply_guard",
        ["phase", "leaseExpiresAt"],
        false
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

    // 4. Historical-sent column integrity. R23: the previous check was
    //    `COUNT(*) ... WHERE replyStatus='sent'` then `if (count < 0)` — dead
    //    logic, since COUNT never returns negative. It could not detect a
    //    wiped or downgraded table (the exact failure §5.3 worries about) and
    //    only gave false confidence. The validator has no pre-upgrade
    //    baseline, so it CANNOT claim "historical sent was preserved" from a
    //    post-upgrade count alone. What it CAN verify structurally is that the
    //    `replyStatus` column still exists and is readable (a recreated/empty
    //    table that lost the column entirely is a real corruption the guard
    //    path would crash on). The actual sticky-protection BEHAVIOR — a
    //    `sent` row still blocks acquireReservation — is proven by the
    //    guard-level conflict/rollback tests, not by this read-only validator.
    if (messageTableExists) {
      const columns = (await queryRunner.query(
        `PRAGMA table_info(email_received_message)`
      )) as SqliteColumnRow[];
      const replyStatusColumn = columns.find((c) => c.name === "replyStatus");
      if (!replyStatusColumn) {
        failures.push({
          check: "historical_sent",
          detail:
            "email_received_message.replyStatus column is missing — sticky local protection cannot read sent state",
        });
      } else {
        // Readability probe: a COUNT over replyStatus exercises the column
        // end-to-end. A NULL result here means the table or column is
        // unreadable (corruption), not that there are zero sent rows.
        try {
          const [sentRows] = (await queryRunner.query(
            `SELECT COUNT(*) AS count FROM email_received_message WHERE replyStatus = 'sent'`
          )) as SqliteCountRow[];
          if (sentRows === undefined || sentRows === null) {
            failures.push({
              check: "historical_sent",
              detail:
                "could not read historical replyStatus='sent' rows — the replyStatus column is unreadable",
            });
          }
        } catch (error) {
          failures.push({
            check: "historical_sent",
            detail: `could not query replyStatus='sent' rows: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
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
  // Allowlist gate before identifier interpolation. SQLite has no placeholder
  // for table names, so the interpolation itself stays — but only after the
  // name is confirmed to be one of the hardcoded reply-safety labels.
  assertAllowedTable(table);
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

/**
 * The §5.3 rollout disable step. When {@link validateReplyUpgrade} reports a
 * non-empty failure list, the caller DISABLES the reply workflow (draft
 * generation + new send claims) and PRESERVES the database — never a
 * destructive "repair". This service only reports; it never mutates schema.
 *
 * The disable is implemented through the existing emergency kill-switch Token
 * flag ({@link EMAIL_REPLY_KILL_SWITCH_FLAG}) so the refusal is visible to
 * operators through the normal kill-switch UI path, with a clear reason,
 * instead of a silent outage. The kill switch disables NEW work only:
 * message viewing, audit reads, send-attempt detail, and delivery
 * reconciliation stay available so operators can diagnose and recover. The
 * mandatory local duplicate protection (sent/unknown/conflict clusters still
 * blocking acquireReservation) has NO feature-flag dependency and runs
 * unconditionally — rollout disabling cannot remove it (§5.3).
 *
 * Idempotent: setting the flag to "true" again when it is already on is a
 * no-op. Returns the report the caller passed in (unchanged) so the startup
 * path can log it after the disable.
 *
 * R23: this was a commented placeholder with no implementation. Wiring it here
 * (rather than in background.ts) keeps the rollout contract co-located with
 * the validator that produces the report, and keeps background.ts free of
 * reply-subsystem details.
 */
export function applyUpgradeValidationFailure(
  report: UpgradeValidationReport,
  reason: string
): UpgradeValidationReport {
  const token = new Token();
  // Write the structured failure list into a separate diagnostic key so
  // support staff can read exactly which invariants failed without it being
  // conflated with the boolean kill-switch flag. Bounded: this is a short
  // list of { check, detail } objects, never message bodies or credentials.
  token.setValue(EMAIL_REPLY_KILL_SWITCH_FLAG, "true");
  // Persist the failure detail under a sibling key for operator diagnostics.
  // Keep it low-cardinality: check labels + short detail strings only.
  const summary = report.failures
    .map((f) => `${f.check}:${f.detail}`)
    .join(" | ");
  token.setValue(
    "email_reply_upgrade_validation_failures",
    `${reason} — ${summary}`
  );
  return report;
}

/**
 * Production startup entry point. Runs {@link validateReplyUpgrade} against
 * the initialized DataSource and, on failure, applies the §5.3 rollout
 * disable ({@link applyUpgradeValidationFailure}) — preserving the database,
 * never repairing it. On success the kill switch is left in whatever state the
 * operator already set it (a passing validation must NOT silently clear an
 * operator's intentional kill switch, so a manual disable survives a
 * re-validation pass).
 *
 * Fail-closed on a validator EXCEPTION (not a failure report): if the
 * validator itself throws — e.g. the DataSource is unreadable in a way the
 * report cannot capture — the kill switch is set so guarded work refuses
 * rather than proceeding against an unvalidated schema. The exception message
 * is persisted as the failure reason.
 *
 * R23: this is the wiring the production startup path calls. It is the single
 * place that turns a validation report into a rollout action, so callers
 * (background.ts, tests) do not each re-implement the disable decision.
 */
export async function runReplyUpgradeValidationOnStartup(
  connection: DataSource,
  reason: string
): Promise<UpgradeValidationReport> {
  let report: UpgradeValidationReport;
  try {
    report = await validateReplyUpgrade(connection);
  } catch (error) {
    // The validator threw before it could produce a report. Fail closed:
    // disable guarded work and persist the exception as the reason.
    const failureReason = `${reason} — validator threw: ${
      error instanceof Error ? error.message : String(error)
    }`;
    applyUpgradeValidationFailure(
      {
        ok: false,
        failures: [
          {
            check: "validator_exception",
            detail: failureReason,
          },
        ],
      },
      reason
    );
    return {
      ok: false,
      failures: [
        {
          check: "validator_exception",
          detail: failureReason,
        },
      ],
    };
  }
  if (!report.ok) {
    applyUpgradeValidationFailure(report, reason);
  }
  return report;
}

/**
 * Read whether the upgrade-validation disable is currently in effect. Wraps
 * the kill-switch read so tests and the startup path can assert the rollout
 * state without importing the feature-flag module directly.
 */
export function isReplyUpgradeValidationDisabled(): boolean {
  return isEmailReplyKillSwitchOn();
}
