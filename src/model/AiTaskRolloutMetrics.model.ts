import { BaseDb } from "@/model/Basedb";
import { assertNotWorker } from "@/model/workerDbGuard";
import { makeEmptyRolloutOriginCohort } from "@/entityTypes/aiTaskRolloutMetricsTypes";
import type {
  RolloutConsumption,
  RolloutLatency,
  RolloutMetricsQuery,
  RolloutOriginCohort,
} from "@/entityTypes/aiTaskRolloutMetricsTypes";
import type { TaskOutcome } from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Read-only §17 rollout-metrics aggregation over three durable tables
 * (technical-design §17 "Monitor …" gate; PRD §12 measure list):
 *
 *   ai_task_execution        → outcomes, routes, incomplete reasons, latency
 *   ai_task_execution_ledger → consumption counters (tokens/attempts/waits)
 *   ai_task_operation        → operation-state histogram (reconciliation)
 *
 * Everything here is derivable from durable rows — no live in-memory state —
 * so the snapshot is reproducible after a restart. The model NEVER mutates:
 * every query is a SELECT (GROUP BY / SUM / COUNT). Workers must never read
 * this aggregation (NFR-03): `assertNotWorker` guards the single entry point.
 *
 * Enrollment scoping: the flag-gated policy only writes rows for ENROLLED
 * runs (flag on at creation). Rows created while the flag was off belong to
 * the shadow/legacy baseline and are excluded via their `createdAt` window
 * only insofar as the operator scopes `since`; no per-row "enrolled" column
 * exists (design §17: the snapshot is segmented by origin/route, and the
 * flag-off baseline is captured by the same query under the flag-off DB).
 *
 * Secret policy (§17 "safe logs only"): the aggregation returns counters,
 * enums, and durations. It never selects prompt/argument/recipient/summary
 * columns, so a leak through the snapshot is structurally impossible.
 *
 * Datetime note: the physical timestamp columns differ by origin — the
 * AuditableEntity-inherited `createdAt` is a TypeORM `datetime` (SQLite
 * stores it as a `CURRENT_TIMESTAMP` string, "YYYY-MM-DD HH:MM:SS", UTC,
 * and the PHYSICAL column name is camelCase `createdAt` because
 * AuditableEntity declares the property camelCase with no naming
 * strategy); `finalized_at` is an explicit snake_case property written by
 * the model as `new Date().toISOString()` ("YYYY-MM-DDTHH:MM:SS.sssZ").
 * Both are UTC, but the textual shapes differ — the latency aggregation
 * parses BOTH through `Date.parse` in JS rather than comparing raw strings
 * in SQL, so shape drift cannot corrupt the monitor.
 */

/** Grouped execution row from the outcome/route/reason histogram query. */
interface ExecutionGroupRow {
  readonly origin_type: string;
  readonly route: string;
  readonly task_outcome: string | null;
  readonly outcome_reason_code: string | null;
  readonly finalized: number;
  readonly row_count: number;
}

/** Grouped ledger-consumption row, joined to its execution's origin. */
interface LedgerGroupRow {
  readonly origin_type: string;
  readonly consumed_continuations: number;
  readonly consumed_provider_attempts: number;
  readonly consumed_tool_executions: number;
  readonly consumed_checker_attempts: number;
  readonly consumed_tokens: number;
  readonly consumed_active_ms: number;
  readonly consumed_wait_ms: number;
}

/** Operation-state histogram row (unsegmented — §17 reconciliation view). */
interface OperationGroupRow {
  readonly operation_state: string;
  readonly row_count: number;
}

/** Minimal finalized-row projection for the JS-side latency pass. */
interface LatencyRow {
  readonly origin_type: string;
  /** Physical AuditableEntity column — camelCase `createdAt`, not `created_at`. */
  readonly createdAt: string | Date | null;
  readonly finalized_at: string | Date | null;
}

export class AiTaskRolloutMetricsModel extends BaseDb {
  constructor(filepath: string) {
    super(filepath);
  }

  protected override onSqliteDbRebound(): void {
    // No repositories to rebind — all reads go through the raw driver via
    // `this.sqliteDb.connection`, which BaseDb keeps current on rebound.
  }

  /**
   * Aggregate the §17 snapshot for rows with `createdAt >= since`. All
   * queries are read-only SELECTs. Returns plain grouped rows; cohort
   * assembly (schema validation) happens in the service layer so the model
   * stays a pure data-access class.
   */
  async aggregateSince(query: RolloutMetricsQuery): Promise<{
    readonly executionGroups: readonly ExecutionGroupRow[];
    readonly ledgerGroups: readonly LedgerGroupRow[];
    readonly operationGroups: readonly OperationGroupRow[];
    readonly latencyRows: readonly LatencyRow[];
  }> {
    assertNotWorker("AiTaskRolloutMetrics.aggregateSince");
    // Bind `since` as SQLite datetime TEXT, not a Date object: TypeORM's
    // better-sqlite3 QueryRunner passes raw parameters straight to
    // `stmt.all(...)` with no driver-side Date transform (the
    // `escapeParameters` Date path is used by QueryBuilder, not raw
    // runner.query), and better-sqlite3 itself rejects Date bindings.
    // "YYYY-MM-DD HH:MM:SS.SSS" is the same shape TypeORM escapes Dates
    // to, and it compares lexicographically against both the
    // CURRENT_TIMESTAMP-written `createdAt` ("YYYY-MM-DD HH:MM:SS") and
    // millisecond variants — ISO-derived text is order-preserving.
    const sinceText = toSqliteDatetimeText(new Date(query.since));

    const runner = this.sqliteDb.connection.createQueryRunner();
    try {
      // Outcome/route/reason histogram per origin.
      const executionGroups = (await runner.query(
        `SELECT origin_type,
                route,
                task_outcome,
                outcome_reason_code,
                finalized,
                COUNT(*) AS row_count
           FROM ai_task_execution
          WHERE "createdAt" >= ?
          GROUP BY origin_type, route, task_outcome,
                   outcome_reason_code, finalized`,
        [sinceText]
      )) as unknown as ExecutionGroupRow[];

      // Ledger consumption per origin: join the ledger (via the execution's
      // lineage_ledger_id) back to the execution's origin_type. One
      // execution row per lineage member, so SUM over the join double-counts
      // a SHARED ledger once per member. §17 measures lineage consumption per
      // enrolled run — de-duplicate by ledger before joining.
      //
      // G03 (FR-24, §17): the cohort anchor is the stable lineage ROOT (the
      // member with parent_execution_id IS NULL), NOT MIN(execution_id).
      // execution_id is a random UUID string, so MIN picks an arbitrary
      // member — a scheduled lineage with a manual Continue would flip
      // cohorts as successors arrive. The root never changes, so shared
      // consumption attributes stably to the lineage's origin cohort.
      // Mixed-origin lineages attribute wholly to the root cohort: member
      // spend is not tracked per member (the ledger holds shared counters),
      // so a per-origin split would fabricate precision.
      const ledgerGroups = (await runner.query(
        `SELECT e.origin_type,
                SUM(l.consumed_continuations)      AS consumed_continuations,
                SUM(l.consumed_provider_attempts)  AS consumed_provider_attempts,
                SUM(l.consumed_tool_executions)    AS consumed_tool_executions,
                SUM(l.consumed_checker_attempts)   AS consumed_checker_attempts,
                SUM(l.consumed_tokens)             AS consumed_tokens,
                SUM(l.consumed_active_ms)           AS consumed_active_ms,
                SUM(l.consumed_wait_ms)            AS consumed_wait_ms
           FROM (
                  SELECT lineage_ledger_id, MIN(execution_id) AS anchor_id
                    FROM ai_task_execution root
                   WHERE "createdAt" >= ?
                     AND root.parent_execution_id IS NULL
                   GROUP BY lineage_ledger_id
                ) anchor
           JOIN ai_task_execution e
             ON e.execution_id = anchor.anchor_id
            AND e."createdAt" >= ?
           LEFT JOIN ai_task_execution_ledger l
             ON l.ledger_id = e.lineage_ledger_id
          GROUP BY e.origin_type`,
        [sinceText, sinceText]
      )) as unknown as LedgerGroupRow[];

      // Operation-state histogram (§17 "operation reconciliation"). The
      // window is the operation's own createdAt (an operation belongs to
      // the execution that dispatched it, but §17 asks for the backlog
      // shape, which is created-at scoped).
      const operationGroups = (await runner.query(
        `SELECT operation_state, COUNT(*) AS row_count
           FROM ai_task_operation
          WHERE "createdAt" >= ?
          GROUP BY operation_state`,
        [sinceText]
      )) as unknown as OperationGroupRow[];

      // Latency source rows: finalized, in-window executions only, carrying
      // origin_type so the service can segment latency per origin (§17).
      // The createdAt/finalized_at shapes differ textually (see class doc),
      // so the subtraction happens in JS through Date.parse, not in SQL.
      const latencyRows = (await runner.query(
        `SELECT origin_type, "createdAt", finalized_at
           FROM ai_task_execution
          WHERE "createdAt" >= ? AND finalized = 1`,
        [sinceText]
      )) as unknown as LatencyRow[];

      return { executionGroups, ledgerGroups, operationGroups, latencyRows };
    } finally {
      await runner.release();
    }
  }

  /**
   * Table-presence shape for the service fail-closed path. All three tables
   * missing = pre-migration DB (or fresh install) — NOT degraded. SOME
   * missing = corrupt / concurrently-migrating store — the read itself is
   * untrustworthy, so the module must flag degraded (D7 review fix: a
   * partial drop previously read as "pre-migration" and masked a broken
   * monitor as an empty rollout).
   */
  async describeTables(): Promise<{
    readonly present: number;
    readonly allPresent: boolean;
  }> {
    assertNotWorker("AiTaskRolloutMetrics.describeTables");
    const runner = this.sqliteDb.connection.createQueryRunner();
    try {
      const rows = (await runner.query(
        `SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name IN ('ai_task_execution',
                         'ai_task_execution_ledger',
                         'ai_task_operation')`
      )) as unknown as readonly { readonly name: string }[];
      return {
        present: rows.length,
        allPresent: rows.length === 3,
      };
    } finally {
      await runner.release();
    }
  }
}

/**
 * Build one origin cohort from grouped rows. Exported for the module layer
 * (and tests) so cohort assembly — outcome zero-fill, route/reason
 * histograms, latency sums — lives in one pure, schema-adjacent place.
 *
 * The caller pre-filters rows to the cohort's origin (a corrupt
 * `origin_type` text simply matches neither cohort and is visibly absent
 * rather than silently misfiled).
 */
export function buildOriginCohort(input: {
  readonly origin: "manual" | "scheduled";
  readonly executionGroups: readonly ExecutionGroupRow[];
  readonly ledgerGroup: LedgerGroupRow | undefined;
  readonly latencyRows: readonly LatencyRow[];
}): RolloutOriginCohort {
  const cohort = makeEmptyRolloutOriginCohort(input.origin);
  const routes: Record<string, number> = {};
  const incompleteReasons: Record<string, number> = {};
  const outcomes: Record<TaskOutcome, number> = { ...cohort.outcomes };
  const consumption: RolloutConsumption = { ...cohort.consumption };
  const latency: RolloutLatency = { ...cohort.latency };

  let executions = 0;
  for (const row of input.executionGroups) {
    executions += row.row_count;
    routes[row.route] = (routes[row.route] ?? 0) + row.row_count;
    const outcome = row.task_outcome;
    if (isTaskOutcome(outcome)) {
      outcomes[outcome] += row.row_count;
    }
    if (
      row.finalized === 1 &&
      outcome !== null &&
      outcome !== "verified_complete"
    ) {
      incompleteReasons[row.outcome_reason_code ?? "unknown"] =
        (incompleteReasons[row.outcome_reason_code ?? "unknown"] ?? 0) +
        row.row_count;
    }
  }

  if (input.ledgerGroup) {
    consumption.continuations = asCount(input.ledgerGroup.consumed_continuations);
    consumption.providerAttempts = asCount(
      input.ledgerGroup.consumed_provider_attempts
    );
    consumption.toolExecutions = asCount(
      input.ledgerGroup.consumed_tool_executions
    );
    consumption.checkerAttempts = asCount(
      input.ledgerGroup.consumed_checker_attempts
    );
    consumption.actualTokens = asCount(input.ledgerGroup.consumed_tokens);
    consumption.activeRuntimeMs = asCount(
      input.ledgerGroup.consumed_active_ms
    );
    consumption.waitMs = asCount(input.ledgerGroup.consumed_wait_ms);
  }
  consumption.executions = executions;

  for (const row of input.latencyRows) {
    const createdMs = parseTimestamp(row.createdAt);
    const finalizedMs = parseTimestamp(row.finalized_at);
    if (createdMs === null || finalizedMs === null) continue;
    const latencyMs = Math.max(0, finalizedMs - createdMs);
    latency.finalizedCount += 1;
    latency.totalLatencyMs += latencyMs;
    latency.maxLatencyMs = Math.max(latency.maxLatencyMs, latencyMs);
  }

  return { ...cohort, routes, outcomes, incompleteReasons, consumption, latency };
}

function isTaskOutcome(value: string | null): value is TaskOutcome {
  return (
    value === "verified_complete" ||
    value === "incomplete" ||
    value === "needs_user_input" ||
    value === "blocked_by_policy" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "timeout"
  );
}

/** Clamp a SQL SUM result (string | number | null under better-sqlite3). */
function asCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Parse a stored timestamp (Date object, ISO text, or SQLite text) as UTC.
 *
 * SQLite's `CURRENT_TIMESTAMP` writes "YYYY-MM-DD HH:MM:SS" — a UTC value
 * with NO timezone marker. Bare `Date.parse` on that shape treats it as
 * LOCAL time (the spec makes date-time-without-offset local), which would
 * shift every latency on a non-UTC machine by the local offset. ISO strings
 * with a trailing Z are parsed correctly by `Date.parse` directly.
 */
function parseTimestamp(value: string | Date | null): number | null {
  if (value === null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  // No offset marker — SQLite CURRENT_TIMESTAMP shape; append UTC marker.
  const ms = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Render a Date as SQLite datetime TEXT ("YYYY-MM-DD HH:MM:SS.SSS") — the
 * shape TypeORM's `escapeParameters` produces for Date values, and the
 * same order-preserving textual shape as `CURRENT_TIMESTAMP`-written
 * columns so `"createdAt" >= ?` compares correctly.
 */
function toSqliteDatetimeText(date: Date): string {
  const pad = (n: number, width = 2): string =>
    String(n).padStart(width, "0");
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-` +
    `${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:` +
    `${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.` +
    `${pad(date.getUTCMilliseconds(), 3)}`
  );
}
