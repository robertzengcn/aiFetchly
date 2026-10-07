import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import { AiTaskExecutionLedgerEntity } from "@/entity/AiTaskExecutionLedger.entity";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import { ScheduleTaskEntity, ScheduleStatus } from "@/entity/ScheduleTask.entity";
import { assertNotWorker } from "@/model/workerDbGuard";
import { AsyncMutex } from "@/utils/asyncMutex";
import { randomUUID } from "node:crypto";
import {
  clampToHardCaps,
} from "@/service/aiTaskExecution/budgetDefaults";
import type {
  BudgetLimitsInput,
} from "@/service/aiTaskExecution/budgetDefaults";
import type {
  TaskExecutionOrigin,
  TaskExecutionRoute,
  TaskOutcome,
} from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Process-wide serializer for execution-create transactions. See
 * {@link AsyncMutex}: TypeORM's `connection.transaction()` over the
 * better-sqlite3 driver cannot run two transaction bodies concurrently on the
 * shared single connection — the second `BEGIN` throws "cannot start a
 * transaction within a transaction". Serializing the dedup-lookup + insert
 * makes the check-then-insert atomic relative to concurrent callers (the
 * second caller's lookup sees the first caller's committed row and resolves
 * to reused/conflict instead of colliding). The partial unique index remains
 * the SQL-level guarantee; the mutex removes the connection overlap.
 */
const executionCreateMutex = new AsyncMutex();

/**
 * Internal control-flow signals for the scheduled-finalization transaction.
 * Thrown inside the transaction body to roll back an abortive CAS (the
 * transaction must be rolled back when the execution CAS affected zero rows
 * — the run/schedule accounting that follows must never commit without a
 * finalized execution row). The module layer translates them into the typed
 * `FinalizeResult` variants.
 */
class AlreadyFinalizedError extends Error {
  constructor() {
    super("ALREADY_FINALIZED");
    this.name = "AlreadyFinalizedError";
  }
}

class StateConflictError extends Error {
  constructor() {
    super("STATE_CONFLICT");
    this.name = "StateConflictError";
  }
}

/**
 * T19 (FR-24, AC-32): the run/schedule/idempotency-key supplied to
 * `finalizeScheduledExecution` does not link back to the execution row being
 * finalized. Thrown inside the transaction so the whole finalization rolls
 * back — no partial schedule-accounting on an unrelated schedule.
 */
class LinkedRecordMismatchError extends Error {
  constructor() {
    super("LINKED_RECORD_MISMATCH");
    this.name = "LinkedRecordMismatchError";
  }
}

export interface CreateExecutionInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly submissionId: string | null;
  readonly requestHash: string;
  readonly origin: TaskExecutionOrigin;
  readonly route: TaskExecutionRoute;
  readonly completionOwner: "standalone" | "goal";
  /**
   * Budget limits to freeze into ledger.policy_limits_json at creation time
   * (PRD §9, GAP-S1). Clamped to HARD_CAPS before persistence so a malformed
   * or hostile task config can never produce an unbounded budget ledger.
   */
  readonly budgetLimits: BudgetLimitsInput;
  /**
   * Continue/retry lineage (FR-21/22, Unit 3). When set, the new execution
   * shares the parent's lineage ledger (shared budget) and records its
   * `parent_execution_id`. A fresh start leaves both null and mints a new
   * ledger. `lineageLedgerId` defaults to the new execution's own ledger
   * when absent so the column is never null.
   */
  readonly parentExecutionId?: string | null;
  readonly lineageLedgerId?: string | null;
  /**
   * Frozen contract snapshot + canonical hash (FR-19, Unit 3). Persisted at
   * creation so a crash between enrollment and finalization cannot lose the
   * contract that authorized the work. Null when no contract was frozen
   * (response_only / best_effort without criteria).
   */
  readonly contractSnapshotJson?: string | null;
  readonly contractHash?: string | null;
}

/**
 * Read-only projection of a ledger row returned by {@link getLedgerById}.
 * The coordinator reads `owner_generation` (→ leaseGeneration fencing) and
 * the consumed/policy fields to resurrect a {@link TaskRunBudget} mirror on
 * the Continue path (FR-21/22, §9). Returned as a typed projection so the
 * coordinator layer does not depend on TypeORM column shapes.
 */
export interface LedgerSnapshot {
  readonly ledgerId: string;
  readonly ownerGeneration: number;
  readonly policyLimitsJson: string;
  readonly consumedContinuations: number;
  readonly consumedProviderAttempts: number;
  readonly consumedToolExecutions: number;
  readonly consumedCheckerAttempts: number;
  readonly consumedTokens: number;
  readonly consumedActiveMs: number;
  readonly consumedWaitMs: number;
  readonly noProgressStreak: number;
  readonly status: string;
}

/**
 * Discriminated result of `createExecution` (AC-26, §4A.1).
 *
 * - `created`: a brand-new execution row was inserted. The caller proceeds
 *   with resolver/maker dispatch.
 * - `reused`: a row with the same `(conversation_id, submission_id)` and the
 *   same `request_hash` already exists. This is a transport retry of the same
 *   accepted submission; the caller must NOT re-dispatch effects or renew
 *   limits — the existing execution's current/final status is authoritative.
 *   `existing` carries that status snapshot.
 * - `conflict`: a row with the same `(conversation_id, submission_id)` exists
 *   but with a different `request_hash`. Same submission ID, different request
 *   payload — `SUBMISSION_CONFLICT`. The caller must surface the conflict and
 *   must not persist a second row.
 *
 * Note that `submission_id` is nullable: scheduled-origin executions carry
 * `null` and are exempt from this dedup (their lineage key is the
 * `occurrence_key`); the partial unique index skips them.
 */
export type CreateExecutionResult =
  | {
      readonly status: "created";
      readonly executionId: string;
      readonly ledgerId: string;
      readonly executionRowId: number;
    }
  | {
      readonly status: "reused";
      readonly reasonCode?: never;
      readonly existing: ExistingExecutionSnapshot;
    }
  | {
      readonly status: "conflict";
      readonly reasonCode: "SUBMISSION_CONFLICT";
      readonly existing: ExistingExecutionSnapshot;
    };

/**
 * Read-only snapshot of an existing execution returned on reuse/conflict. We
 * return a typed projection rather than the raw entity so the coordinator
 * layer does not depend on TypeORM column shapes.
 */
export interface ExistingExecutionSnapshot {
  readonly executionId: string;
  readonly ledgerId: string;
  readonly conversationId: string | null;
  readonly submissionId: string | null;
  readonly requestHash: string | null;
  readonly stage: string;
  readonly finalized: boolean;
  readonly taskOutcome: string | null;
  readonly outcomeReasonCode: string | null;
  readonly executionStateVersion: number;
}

export interface FinalizeInput {
  readonly executionId: string;
  readonly expectedVersion: number;
  readonly outcome: TaskOutcome;
  readonly reasonCode: string;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly remainingWork: readonly string[];
  /**
   * The assistant result message produced by this execution, if any.
   * §6.3 step 2 requires the finalization to link "outcome, reason, linked
   * assistant result, evidence/counter summary". Previously this field was
   * absent and the result message id was never persisted at finalization,
   * despite being a §6.3 required field. Slice 1 has no evidence store, so
   * evidenceIds/remainingWork are persisted into execution_state_json as a
   * checkpoint instead of being silently dropped (B6).
   */
  readonly assistantResultMessageId?: string | null;
}

export interface FinalizeResult {
  readonly ok: boolean;
  readonly alreadyFinalized?: boolean;
  readonly reasonCode?: string;
}

/**
 * Input for the scheduled-finalization transaction (Unit 6, FR-12, §6.3).
 * Carries the REAL schedule id + run id explicitly — the execution row's
 * `schedule_id` column stores the TASK id (a known quirk of
 * `createExecution`), so the caller must not rely on it for schedule
 * accounting.
 */
export interface FinalizeScheduledInput {
  readonly executionId: string;
  readonly expectedVersion: number;
  readonly runId: number;
  readonly scheduleId: number;
  readonly taskOutcome: TaskOutcome;
  readonly reasonCode: string;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly remainingWork: readonly string[];
  readonly idempotencyKey: string;
  /**
   * Failed/incomplete/timeout increments the streak; cancelled never does.
   * Legacy boolean — still honoured for backward compatibility with the
   * ScheduledAiMessageRunner outcome mapping. When false, the streak
   * semantics derive from `taskOutcome` (T19): verified_complete resets to
   * 0, cancelled stays untouched, other outcomes increment.
   */
  readonly incrementFailure: boolean;
  /**
   * T19: explicit success override — reset consecutive_failure_count to 0
   * regardless of `incrementFailure`/`taskOutcome`. Callers that already
   * know the run succeeded (e.g. a verified contract) set this true instead
   * of relying on outcome derivation. Defaults false.
   */
  readonly resetStreak?: boolean;
  readonly nextRunAt: Date;
  readonly terminalStatus?: "expired" | "failed" | "stopped";
  readonly terminalReason?: string;
  readonly pause?: { readonly reason: string };
  readonly assistantResultMessageId?: string | null;
}

/**
 * Data-access layer for `ai_task_execution` + `ai_task_execution_ledger`
 * (technical-design §6.1/§6.3).
 *
 * Compare-and-set on `execution_state_version` guards concurrent
 * finalization: a stale-version finalizer never overwrites the outcome
 * or double-increments ledger counters (§6.3). The finalization is atomic
 * — a single `UPDATE … WHERE execution_state_version = :v AND finalized = 0`
 * with an affected-rows check, so two concurrent finalizers cannot both
 * pass the version check and the second receives `STATE_CONFLICT` or
 * `ALREADY_FINALIZED` based on the row state at update time (B2). The
 * ledger-owner release runs in the same transaction.
 *
 * `createExecution` writes the ledger and execution rows in a single
 * transaction so a crash between them cannot leave an orphan ledger whose
 * `active_execution_id` points at a nonexistent execution (B3). The dedup
 * lookup + insert run under a process-wide `AsyncMutex` so concurrent
 * same-(conversation, submission) callers serialize: the second sees the
 * first's committed row and resolves to `reused`/`conflict` instead of
 * colliding on the shared better-sqlite3 connection (AC-26, §4A.1). The
 * partial unique index on `(conversation_id, submission_id) WHERE
 * submission_id IS NOT NULL` is the SQL-level guarantee; the mutex removes
 * the connection overlap.
 *
 * Manual executions finalize without touching schedule rows; scheduled
 * origin (Slice 2) will share the transaction to update occurrence/schedule
 * counters atomically.
 *
 * Worker guard: every method calls `assertNotWorker` first — workers must
 * never touch these tables directly (NFR-03).
 */
export class AiTaskExecutionModel extends BaseDb {
  private executionRepo: Repository<AiTaskExecutionEntity>;
  private ledgerRepo: Repository<AiTaskExecutionLedgerEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.executionRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionEntity
    );
    this.ledgerRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionLedgerEntity
    );
  }

  protected override onSqliteDbRebound(): void {
    this.executionRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionEntity
    );
    this.ledgerRepo = this.sqliteDb.connection.getRepository(
      AiTaskExecutionLedgerEntity
    );
  }

  async createExecution(
    input: CreateExecutionInput
  ): Promise<CreateExecutionResult> {
    assertNotWorker("createExecution");

    // Serialize the dedup-lookup + insert. The mutex makes check-then-insert
    // atomic relative to concurrent callers: a racing same-(conversation,
    // submission) caller that reads null before the first inserts instead
    // waits, then sees the committed row and resolves to reused/conflict.
    // It also prevents two `connection.transaction()` bodies from overlapping
    // on the shared better-sqlite3 connection (which would raise "cannot start
    // a transaction within a transaction"). See {@link AsyncMutex}.
    return executionCreateMutex.run(() => this.createExecutionInner(input));
  }

  private async createExecutionInner(
    input: CreateExecutionInput
  ): Promise<CreateExecutionResult> {
    // AC-26 / §4A.1: scoped submission uniqueness. A non-null submissionId is
    // a transport-retry correlation key — the renderer generates and retains
    // it across retries. Before inserting, look up the existing row by
    // (conversation_id, submission_id). A null submissionId (scheduled origin)
    // is exempt: the partial unique index skips it, and the lineage key is the
    // occurrence_key, not the submission_id.
    if (input.submissionId !== null) {
      const existing = await this.executionRepo.findOne({
        where: {
          conversation_id: input.conversationId,
          submission_id: input.submissionId,
        },
      });
      if (existing) {
        // Same submission ID, different request payload — the canonical
        // request_hash mismatch means this is NOT a retry of the same
        // accepted message (§4A.1: "Same ID with a different request hash is
        // SUBMISSION_CONFLICT"). Surface the conflict; do not persist a
        // second row and do not overwrite the existing request.
        if (existing.request_hash !== input.requestHash) {
          return {
            status: "conflict",
            reasonCode: "SUBMISSION_CONFLICT",
            existing: this.toSnapshot(existing),
          };
        }
        // Same ID, same request hash — a genuine transport retry of the same
        // accepted submission. Return the existing execution's current/final
        // status; the caller must NOT re-dispatch effects or renew limits
        // (AC-26: "no duplicated effects or renewed limits").
        return {
          status: "reused",
          existing: this.toSnapshot(existing),
        };
      }
    }

    const executionId = `exec-${randomUUID()}`;
    const ledgerId = `ledger-${randomUUID()}`;
    // FR-21/22: a Continue successor shares the parent's lineage ledger so its
    // budget mirror resurrects the parent's spent allowance. A fresh start
    // points lineage at its own ledger (the column is non-nullable).
    const lineageLedgerId = input.lineageLedgerId ?? ledgerId;

    // Both rows in one transaction so a crash between saves cannot leave an
    // orphan ledger pointing at a nonexistent execution (B3, §6.2). The mutex
    // guarantees no concurrent transaction overlaps this one on the shared
    // connection, so the unique-constraint catch below is defense-in-depth.
    try {
      const saved = await this.sqliteDb.connection.transaction(async (manager) => {
        const ledger = new AiTaskExecutionLedgerEntity();
        ledger.ledger_id = ledgerId;
        // GAP-S1: freeze the clamped budget limits into policy_limits_json so
        // the persisted ledger never exceeds HARD_CAPS, even if the in-memory
        // TaskRunBudget is later tampered with. Previously this wrote "{}",
        // losing the budget entirely.
        ledger.policy_limits_json = JSON.stringify(
          clampToHardCaps(input.budgetLimits)
        );
        ledger.consumed_continuations = 0;
        ledger.consumed_provider_attempts = 0;
        ledger.consumed_tool_executions = 0;
        ledger.consumed_checker_attempts = 0;
        ledger.consumed_tokens = 0;
        ledger.consumed_active_ms = 0;
        ledger.consumed_wait_ms = 0;
        ledger.no_progress_streak = 0;
        ledger.active_execution_id = executionId;
        ledger.owner_generation = 0;
        ledger.status = "active";
        await manager.getRepository(AiTaskExecutionLedgerEntity).save(ledger);

        const exec = new AiTaskExecutionEntity();
        exec.execution_id = executionId;
        exec.conversation_id = input.conversationId;
        exec.source_user_message_id = input.sourceUserMessageId;
        exec.submission_id = input.submissionId;
        exec.assistant_result_message_id = null;
        exec.request_hash = input.requestHash;
        exec.origin_type = input.origin.type;
        exec.route = input.route;
        exec.completion_owner = input.completionOwner;
        exec.stage = "resolving";
        exec.schedule_id =
          input.origin.type === "scheduled" ? input.origin.taskId : null;
        exec.run_id =
          input.origin.type === "scheduled" ? input.origin.runId : null;
        exec.occurrence_key =
          input.origin.type === "scheduled" ? input.origin.occurrenceKey : null;
        exec.ledger_id = ledgerId;
        // Lineage points at the shared parent ledger on Continue, or this
        // row's own ledger on a fresh start (FR-21/22).
        exec.lineage_ledger_id = lineageLedgerId;
        // parent_execution_id is set only on Continue/retry successors.
        exec.parent_execution_id = input.parentExecutionId ?? null;
        // FR-19: persist the frozen contract snapshot + canonical hash at
        // creation so a crash between enrollment and finalization cannot
        // lose the contract that authorized the work. Null when no contract
        // was frozen (response_only / best_effort without criteria).
        exec.contract_snapshot_json = input.contractSnapshotJson ?? null;
        exec.contract_hash = input.contractHash ?? null;
        exec.policy_snapshot_json = null;
        exec.execution_state_json = null;
        exec.execution_state_version = 0;
        exec.finalized = false;
        exec.finalized_at = null;
        exec.task_outcome = null;
        exec.outcome_reason_code = null;
        exec.outcome_summary = null;
        exec.final_event_identity = null;
        exec.delivery_state = null;
        const savedExec = await manager
          .getRepository(AiTaskExecutionEntity)
          .save(exec);
        return savedExec;
      });

      return {
        status: "created",
        executionId,
        ledgerId,
        executionRowId: saved.id,
      };
    } catch (error) {
      // Defense-in-depth: the mutex serializes callers, so a unique-constraint
      // violation here means the row appeared between the lookup and the
      // insert within this same critical section (only possible if a separate
      // code path inserts without the mutex — none exists today). Resolve to
      // reused/conflict instead of surfacing a raw SQLite UNIQUE error, then
      // fall through to re-throw for any other error.
      if (this.isUniqueConstraintError(error) && input.submissionId !== null) {
        const winner = await this.executionRepo.findOne({
          where: {
            conversation_id: input.conversationId,
            submission_id: input.submissionId,
          },
        });
        if (winner) {
          if (winner.request_hash !== input.requestHash) {
            return {
              status: "conflict",
              reasonCode: "SUBMISSION_CONFLICT",
              existing: this.toSnapshot(winner),
            };
          }
          return {
            status: "reused",
            existing: this.toSnapshot(winner),
          };
        }
      }
      throw error;
    }
  }

  /**
   * Project a loaded entity into the read-only snapshot returned on
   * reuse/conflict. Centralizes the column→field mapping so the coordinator
   * layer never touches TypeORM column shapes.
   */
  private toSnapshot(
    exec: AiTaskExecutionEntity
  ): ExistingExecutionSnapshot {
    return {
      executionId: exec.execution_id,
      ledgerId: exec.ledger_id,
      conversationId: exec.conversation_id,
      submissionId: exec.submission_id,
      requestHash: exec.request_hash,
      stage: exec.stage,
      finalized: exec.finalized,
      taskOutcome: exec.task_outcome,
      outcomeReasonCode: exec.outcome_reason_code,
      executionStateVersion: exec.execution_state_version,
    };
  }

  async getById(executionId: string): Promise<AiTaskExecutionEntity | null> {
    assertNotWorker("getById");
    return this.executionRepo.findOne({
      where: { execution_id: executionId },
    });
  }

  /**
   * Load a ledger row as a typed projection (FR-21/22, §9). The coordinator
   * reads `owner_generation` (→ leaseGeneration fencing) and the consumed +
   * policy fields to resurrect a {@link TaskRunBudget} mirror on the
   * Continue path so a successor shares the parent's spent allowance.
   */
  async getLedgerById(ledgerId: string): Promise<LedgerSnapshot | null> {
    assertNotWorker("getLedgerById");
    const ledger = await this.ledgerRepo.findOne({
      where: { ledger_id: ledgerId },
    });
    if (!ledger) return null;
    return {
      ledgerId: ledger.ledger_id,
      ownerGeneration: ledger.owner_generation,
      policyLimitsJson: ledger.policy_limits_json,
      consumedContinuations: ledger.consumed_continuations,
      consumedProviderAttempts: ledger.consumed_provider_attempts,
      consumedToolExecutions: ledger.consumed_tool_executions,
      consumedCheckerAttempts: ledger.consumed_checker_attempts,
      consumedTokens: ledger.consumed_tokens,
      consumedActiveMs: ledger.consumed_active_ms,
      consumedWaitMs: ledger.consumed_wait_ms,
      noProgressStreak: ledger.no_progress_streak,
      status: ledger.status,
    };
  }

  async finalizeExecution(input: FinalizeInput): Promise<FinalizeResult> {
    assertNotWorker("finalizeExecution");

    // First detect missing execution (no row to update) before the CAS. This
    // is a read, not a check-then-act on the CAS field — the CAS UPDATE below
    // is the atomic guard.
    const exec = await this.executionRepo.findOne({
      where: { execution_id: input.executionId },
    });
    if (!exec) {
      return { ok: false, reasonCode: "MISSING_TASK_OUTCOME" };
    }
    if (exec.finalized) {
      // §6.3: a second finalizer returns the existing outcome; counters
      // never increment twice.
      return {
        ok: false,
        alreadyFinalized: true,
        reasonCode: "ALREADY_FINALIZED",
      };
    }

    // B6: persist the evidenceIds/remainingWork checkpoint and the assistant
    // result message id so caller inputs are not silently dropped. Slice 1
    // has no evidence store, so these are recorded into execution_state_json
    // as a finalization checkpoint until the Slice 2 checkpoint format lands.
    const checkpoint = JSON.stringify({
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      evidenceIds: [...input.evidenceIds],
      remainingWork: [...input.remainingWork],
      assistantResultMessageId: input.assistantResultMessageId ?? null,
      finalizedAt: new Date().toISOString(),
    });

    // B2: atomic CAS finalization. A single UPDATE statement is atomic in
    // SQLite — the WHERE predicate (execution_state_version = ? AND
    // finalized = 0) is evaluated atomically with the SET, so two concurrent
    // finalizers racing on the same expectedVersion cannot both succeed:
    // exactly one UPDATE affects a row, the other affects zero rows.
    //
    // We do NOT wrap this in `connection.transaction()`. better-sqlite3 uses
    // a single connection with no pool; two concurrent `transaction()` calls
    // on it collide with "cannot start a transaction within a transaction".
    // The CAS UPDATE does not need a transaction wrapper — it is one atomic
    // statement. The ledger release below is a separate atomic UPDATE. If the
    // process crashes between them, the execution is finalized but the ledger
    // stays "active"; a recovery pass can detect finalized executions whose
    // ledger is still active and release it. The CAS itself is never broken.
    //
    // IMPORTANT: `manager.query()` / `connection.query()` only forward
    // (sql, params) to the driver — they drop any third argument.
    // better-sqlite3 exposes the affected-row count ONLY when
    // `useStructuredResult=true` is passed directly to the driver
    // QueryRunner.query(); the plain return is `lastInsertRowid` (a number),
    // not `{changes}`. So we reach the driver QueryRunner via
    // `this.sqliteDb.connection.createQueryRunner().query(..., true)` (a
    // fresh runner we release ourselves) to get `.affected`. Calling
    // `connection.query(sql, params, true)` would silently return
    // lastInsertRowid, `.affected` would be undefined, and every finalization
    // would wrongly report STATE_CONFLICT.
    const finalEventIdentity = `execution-result:${input.executionId}`;
    const runner = this.sqliteDb.connection.createQueryRunner();
    try {
      const result = (await runner.query(
        `UPDATE ai_task_execution
           SET finalized = 1,
               finalized_at = ?,
               task_outcome = ?,
               outcome_reason_code = ?,
               outcome_summary = ?,
               final_event_identity = ?,
               execution_state_version = execution_state_version + 1,
               stage = 'terminal',
               execution_state_json = ?,
               assistant_result_message_id = COALESCE(?, assistant_result_message_id)
         WHERE execution_id = ?
           AND execution_state_version = ?
           AND finalized = 0`,
        [
          new Date().toISOString(),
          input.outcome,
          input.reasonCode,
          input.summary,
          finalEventIdentity,
          checkpoint,
          input.assistantResultMessageId ?? null,
          input.executionId,
          input.expectedVersion,
        ],
        true // useStructuredResult — exposes .affected on the driver result
      )) as { affected?: number };
      const affected = result.affected ?? 0;
      if (affected !== 1) {
        // Between our read and the UPDATE, a concurrent finalizer either
        // bumped the version (STATE_CONFLICT) or finalized the row
        // (ALREADY_FINALIZED). Re-read to distinguish.
        const fresh = await this.executionRepo.findOne({
          where: { execution_id: input.executionId },
        });
        if (fresh?.finalized) {
          return {
            ok: false,
            alreadyFinalized: true,
            reasonCode: "ALREADY_FINALIZED",
          };
        }
        return { ok: false, reasonCode: "STATE_CONFLICT" };
      }

      // Release the ledger owner (§6.3). Spent allowance persists. Separate
      // atomic UPDATE — see the note above on why this is not in the same
      // transaction as the CAS UPDATE.
      await runner.query(
        `UPDATE ai_task_execution_ledger
            SET active_execution_id = NULL,
                status = 'released',
                execution_state_version = execution_state_version + 1
          WHERE ledger_id = ?`,
        [exec.ledger_id]
      );

      return { ok: true };
    } finally {
      await runner.release();
    }
  }

  /**
   * Scheduled finalization in ONE transaction (GAP-S2 #9, FR-12, §6.3,
   * AC-32): CAS-finalize the execution + release the ledger + update the run
   * row + update schedule counters + pause-if-needed, all serialized via the
   * `executionCreateMutex` so the multi-statement transaction cannot overlap
   * a concurrent `createExecution` on the single better-sqlite3 connection.
   *
   * Missing execution → `MISSING_TASK_OUTCOME` (ok:false) and NO schedule
   * accounting happens (never fall back to success). Already finalized →
   * ok:false alreadyFinalized (the outcome is immutable; counters increment
   * at most once). CAS conflict → STATE_CONFLICT; the caller re-reads.
   */
  async finalizeScheduledExecution(
    input: FinalizeScheduledInput
  ): Promise<FinalizeResult> {
    assertNotWorker("finalizeScheduledExecution");

    const exec = await this.executionRepo.findOne({
      where: { execution_id: input.executionId },
    });
    if (!exec) {
      return { ok: false, reasonCode: "MISSING_TASK_OUTCOME" };
    }
    if (exec.finalized) {
      // §6.3: counters increment at most once — repeated finalization
      // never re-applies schedule accounting.
      return {
        ok: false,
        alreadyFinalized: true,
        reasonCode: "ALREADY_FINALIZED",
      };
    }

    const checkpoint = JSON.stringify({
      outcome: input.taskOutcome,
      reasonCode: input.reasonCode,
      evidenceIds: [...input.evidenceIds],
      remainingWork: [...input.remainingWork],
      assistantResultMessageId: input.assistantResultMessageId ?? null,
      finalizedAt: new Date().toISOString(),
    });
    const finalEventIdentity = `execution-result:${input.executionId}`;

    // T19 (FR-12/24, AC-04/05/10/15/32): three-way failure-streak semantics
    // derived from taskOutcome. The prior `incrementFailure` boolean only
    // encoded increment-vs-leave-untouched, so verified_complete (callers pass
    // incrementFailure=false) LEFT the streak untouched — a failure → success
    // → failure sequence grew the streak across the success and triggered
    // premature REPEATED_RUN_FAILURE. The fix:
    //   - verified_complete → reset consecutive_failure_count to 0 (success
    //     breaks the failure streak, matching ScheduleTask.model.ts:869).
    //   - cancelled → leave untouched (FR-12: cancellation is neither a
    //     failure nor a success; neither reset nor increment).
    //   - incomplete/failed/timeout/blocked_by_policy/needs_user_input →
    //     increment (failure streak grows).
    // `resetStreak` on the input (set explicitly by callers that want
    // success-semantics without relying on the outcome) takes precedence;
    // otherwise the outcome decides. `incrementFailure=true` still honoured
    // for backward compatibility with the existing mapping at
    // ScheduledAiMessageRunner.ts:1505 — when set it forces increment.
    const streakMode: "reset" | "increment" | "untouched" = (() => {
      if (input.resetStreak === true) return "reset";
      if (input.incrementFailure) return "increment";
      if (input.taskOutcome === "verified_complete") return "reset";
      if (input.taskOutcome === "cancelled") return "untouched";
      return "increment";
    })();

    try {
      await executionCreateMutex.run(async () => {
        // Manually-managed QueryRunner transaction (mirrors TypeORM's own
        // `transaction()` internals). We CANNOT use
        // `connection.transaction((manager) => ...)` here: EntityManager.query
        // forwards only (sql, params) to DataSource.query, which drops any
        // third argument — so the transaction manager can never request
        // `useStructuredResult=true` and `.affected` stays undefined. A manual
        // runner reaches the driver QueryRunner directly (3-arg query works)
        // while `runner.manager` still provides the transactional entity
        // manager for the entity updates below.
        const runner = this.sqliteDb.connection.createQueryRunner();
        await runner.startTransaction();
        try {
          const manager = runner.manager;

          // 0. T19 (FR-24, AC-32): linked-record validation — the run row
          // must belong to this execution (exec.run_id set at create time)
          // and to the supplied schedule, and the run's idempotency key must
          // match the finalize input. A mismatch means the caller wired the
          // wrong run/schedule to the execution — abort the whole transaction
          // with LINKED_RECORD_MISMATCH and update nothing (no partial
          // finalization, no schedule accounting). This guards against a
          // wrong-schedule count increment that would silently corrupt the
          // streak/next-run accounting of an unrelated schedule.
          const runRow = await manager.findOne(AiMessageTaskRunEntity, {
            where: { id: input.runId },
          });
          const scheduleRow = await manager.findOne(ScheduleTaskEntity, {
            where: { id: input.scheduleId },
          });
          const linkedOk =
            runRow !== null &&
            scheduleRow !== null &&
            (exec.run_id === null || exec.run_id === input.runId) &&
            runRow.schedule_id === input.scheduleId &&
            runRow.task_id === scheduleRow.task_id &&
            (runRow.idempotency_key === null ||
              runRow.idempotency_key === input.idempotencyKey);
          if (!linkedOk) {
            throw new LinkedRecordMismatchError();
          }

          // 1. CAS-finalize the execution row (same predicate as
          // finalizeExecution so a concurrent finalizer still loses).
          const casResult = (await runner.query(
            `UPDATE ai_task_execution
               SET finalized = 1,
                   finalized_at = ?,
                   task_outcome = ?,
                   outcome_reason_code = ?,
                   outcome_summary = ?,
                   final_event_identity = ?,
                   execution_state_version = execution_state_version + 1,
                   stage = 'terminal',
                   execution_state_json = ?,
                   assistant_result_message_id = COALESCE(?, assistant_result_message_id)
             WHERE execution_id = ?
               AND execution_state_version = ?
               AND finalized = 0`,
            [
              new Date().toISOString(),
              input.taskOutcome,
              input.reasonCode,
              input.summary,
              finalEventIdentity,
              checkpoint,
              input.assistantResultMessageId ?? null,
              input.executionId,
              input.expectedVersion,
            ],
            true // useStructuredResult — exposes .affected on the driver result
          )) as { affected?: number };
          if ((casResult.affected ?? 0) !== 1) {
            const fresh = await manager.findOne(AiTaskExecutionEntity, {
              where: { execution_id: input.executionId },
            });
            if (fresh?.finalized) {
              throw new AlreadyFinalizedError();
            }
            throw new StateConflictError();
          }

          // 2. Release the ledger owner (§6.3). Spent allowance persists.
          await manager.query(
            `UPDATE ai_task_execution_ledger
                SET active_execution_id = NULL,
                    status = 'released',
                    execution_state_version = execution_state_version + 1
              WHERE ledger_id = ?`,
            [exec.ledger_id]
          );

          // 3. Update the run row: link the execution + outcome + terminal
          // status (FR-12 §6.3 step 2 — outcome, reason, summary linked and
          // the row leaves "pending"/"running" before terminal events). The
          // run status derives from the task outcome: verified_complete →
          // completed; incomplete → incomplete; needs_user_input →
          // needs_user_input; failed/timeout → failed/timeout; everything
          // else (cancelled, blocked_by_policy) maps 1:1.
          const runStatus: AiMessageTaskRunEntity["status"] = (() => {
            switch (input.taskOutcome) {
              case "verified_complete":
                return "completed";
              case "incomplete":
                return "incomplete";
              case "needs_user_input":
                return "needs_user_input";
              case "failed":
                return "failed";
              case "timeout":
                return "timeout";
              case "blocked_by_policy":
                return "blocked_by_policy";
              case "cancelled":
                return "cancelled";
              default:
                return "failed";
            }
          })();
          await manager.update(
            AiMessageTaskRunEntity,
            { id: input.runId },
            {
              execution_id: input.executionId,
              status: runStatus,
              finished_at: new Date(),
              task_outcome: input.taskOutcome,
              task_outcome_reason: input.reasonCode,
              task_result_summary: input.summary,
            }
          );

          // 4. Schedule accounting — exactly once inside the transaction.
          if (input.pause) {
            await manager.update(ScheduleTaskEntity, { id: input.scheduleId }, {
              is_active: false,
              status: ScheduleStatus.PAUSED,
              terminal_reason: input.pause.reason,
              last_modified: new Date(),
            });
          } else {
            const update: QueryDeepPartialEntity<ScheduleTaskEntity> = {
              next_run_time: input.nextRunAt,
              last_modified: new Date(),
            };
            // T19: three-way streak semantics. reset → 0 (success);
            // increment → +1 (failure); untouched → no change (cancelled).
            // failure_count is cumulative — only ever incremented, never
            // reset (a success does not erase the historical failure tally).
            if (streakMode === "increment") {
              update.failure_count = () => "failure_count + 1";
              update.consecutive_failure_count = () =>
                "consecutive_failure_count + 1";
            } else if (streakMode === "reset") {
              update.consecutive_failure_count = 0;
              // failure_count intentionally NOT reset — it tracks total
              // failures across the schedule's lifetime, not the streak.
            }
            // streakMode === "untouched" (cancelled, FR-12): neither reset
            // nor increment — cancellation is not a failure and not a
            // success, so the streak is left as-is.
            if (input.terminalStatus === "expired") {
              update.is_active = false;
              update.status = ScheduleStatus.EXPIRED;
              update.terminal_reason =
                input.terminalReason ?? "SCHEDULE_EXPIRED";
            } else if (input.terminalStatus === "failed") {
              update.is_active = false;
              update.status = ScheduleStatus.FAILED;
              update.terminal_reason =
                input.terminalReason ?? "REPEATED_RUN_FAILURE";
            } else if (input.terminalStatus === "stopped") {
              update.is_active = false;
              update.status = ScheduleStatus.STOPPED;
              update.terminal_reason = input.terminalReason ?? "STOPPED";
            }
            await manager.update(
              ScheduleTaskEntity,
              { id: input.scheduleId },
              update
            );
          }
          await runner.commitTransaction();
        } catch (txError) {
          await runner.rollbackTransaction();
          throw txError;
        } finally {
          await runner.release();
        }
      });
    } catch (error) {
      if (error instanceof AlreadyFinalizedError) {
        return {
          ok: false,
          alreadyFinalized: true,
          reasonCode: "ALREADY_FINALIZED",
        };
      }
      if (error instanceof StateConflictError) {
        return { ok: false, reasonCode: "STATE_CONFLICT" };
      }
      if (error instanceof LinkedRecordMismatchError) {
        return { ok: false, reasonCode: "LINKED_RECORD_MISMATCH" };
      }
      throw error;
    }

    return { ok: true };
  }

  async getUnfinalized(): Promise<AiTaskExecutionEntity[]> {
    assertNotWorker("getUnfinalized");
    return this.executionRepo.find({
      where: { finalized: false },
    });
  }

  /**
   * Persist an already-loaded execution entity (e.g. after mutating
   * `execution_state_json` for a shadow decision). Used by the module's
   * `recordShadowDecision` so it does not need bracket-access to a private
   * repository field.
   *
   * NOTE: this is a full-row UPSERT with no CAS guard. It is retained for
   * callers that hold the executionCreateMutex or otherwise serialize access.
   * `recordShadowDecision` does NOT hold that mutex and must use
   * {@link applyShadowDecisionCas} instead, which guards against the
   * finalize-then-shadow interleaving the full-row save would clobber.
   */
  async saveExecution(exec: AiTaskExecutionEntity): Promise<void> {
    assertNotWorker("saveExecution");
    await this.executionRepo.save(exec);
  }

  /**
   * Atomically merge a shadow decision into `execution_state_json` and bump
   * the CAS version, guarded by `finalized = 0` and the expected version.
   *
   * This is the CAS-protected counterpart to {@link saveExecution} for the
   * shadow-decision path. The previous full-row `saveExecution` was a
   * read-then-write UPSERT with no WHERE predicate: a finalizer that
   * committed its atomic CAS UPDATE *between* the shadow path's `getById`
   * read and its `saveExecution` would have its `finalized=1`, outcome, and
   * `finalized_at` silently reverted to the stale in-memory entity's
   * `finalized=0` — an inconsistent row with a released ledger but no
   * outcome. The B8.2 version bump only protected the shadow-THEN-finalize
   * ordering (the finalizer's stale CAS rejects); it did NOT protect
   * finalize-THEN-shadow.
   *
   * This single atomic statement fixes both directions:
   *  - finalize-THEN-shadow: the `finalized = 0` predicate fails (the
   *    finalizer set `finalized = 1`), so `affected = 0` and the shadow
   *    decision is silently dropped — the terminal outcome wins, as it must.
   *  - shadow-THEN-finalize: the version bump (`+ 1` in the SET, matched
   *    against `= :expectedVersion` in the WHERE) means the finalizer's
   *    stale `expectedVersion` CAS no longer matches and it returns
   *    STATE_CONFLICT — the shadow decision wins and the finalizer must
   *    re-read.
   *
   * Returns true if the shadow decision was applied (1 row affected), false
   * if the row was missing, already finalized, or at a different version
   * (concurrent shadow or finalize won). The caller treats false as a no-op.
   */
  async applyShadowDecisionCas(input: {
    executionId: string;
    expectedVersion: number;
    mergedStateJson: string;
  }): Promise<boolean> {
    assertNotWorker("applyShadowDecisionCas");
    const runner = this.sqliteDb.connection.createQueryRunner();
    try {
      const result = (await runner.query(
        `UPDATE ai_task_execution
            SET execution_state_json = ?,
                execution_state_version = execution_state_version + 1
          WHERE execution_id = ?
            AND finalized = 0
            AND execution_state_version = ?`,
        [
          input.mergedStateJson,
          input.executionId,
          input.expectedVersion,
        ],
        true // useStructuredResult — exposes .affected (see finalizeExecution)
      )) as { affected?: number };
      return (result.affected ?? 0) === 1;
    } finally {
      await runner.release();
    }
  }

  /**
   * Detect a SQLite unique-constraint violation from a thrown driver error.
   * better-sqlite3 surfaces `SQLITE_CONSTRAINT_UNIQUE` messages containing
   * "UNIQUE constraint failed"; TypeORM wraps these in `QueryFailedError`.
   * Mirrors `AiTaskOperation.model.ts`. Reachable only via the
   * defense-in-depth catch in `createExecutionInner` — the
   * `executionCreateMutex` serializes callers so concurrent inserts cannot
   * both reach the INSERT, but a unique-constraint violation is still the
   * typed fallback if a row appears between the lookup and the insert.
   */
  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Error && /unique constraint/i.test(error.message)
    );
  }
}
