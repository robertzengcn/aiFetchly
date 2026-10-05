import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AiTaskExecutionEntity } from "@/entity/AiTaskExecution.entity";
import { AiTaskExecutionLedgerEntity } from "@/entity/AiTaskExecutionLedger.entity";
import { assertNotWorker } from "@/model/workerDbGuard";
import { randomUUID } from "node:crypto";
import type {
  TaskExecutionOrigin,
  TaskExecutionRoute,
  TaskOutcome,
} from "@/entityTypes/aiTaskExecutionTypes";

export interface CreateExecutionInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly submissionId: string | null;
  readonly requestHash: string;
  readonly origin: TaskExecutionOrigin;
  readonly route: TaskExecutionRoute;
  readonly completionOwner: "standalone" | "goal";
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
 * `active_execution_id` points at a nonexistent execution (B3).
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
  ): Promise<{ executionId: string; ledgerId: string; executionRowId: number }> {
    assertNotWorker("createExecution");
    const executionId = `exec-${randomUUID()}`;
    const ledgerId = `ledger-${randomUUID()}`;

    // Both rows in one transaction so a crash between saves cannot leave an
    // orphan ledger pointing at a nonexistent execution (B3, §6.2).
    return this.sqliteDb.connection.transaction(async (manager) => {
      const ledger = new AiTaskExecutionLedgerEntity();
      ledger.ledger_id = ledgerId;
      ledger.policy_limits_json = "{}";
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
      exec.lineage_ledger_id = ledgerId;
      exec.parent_execution_id = null;
      exec.contract_snapshot_json = null;
      exec.policy_snapshot_json = null;
      exec.execution_state_json = null;
      exec.contract_hash = null;
      exec.execution_state_version = 0;
      exec.finalized = false;
      exec.finalized_at = null;
      exec.task_outcome = null;
      exec.outcome_reason_code = null;
      exec.outcome_summary = null;
      exec.final_event_identity = null;
      exec.delivery_state = null;
      const saved = await manager
        .getRepository(AiTaskExecutionEntity)
        .save(exec);

      return {
        executionId,
        ledgerId,
        executionRowId: saved.id,
      };
    });
  }

  async getById(executionId: string): Promise<AiTaskExecutionEntity | null> {
    assertNotWorker("getById");
    return this.executionRepo.findOne({
      where: { execution_id: executionId },
    });
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
   */
  async saveExecution(exec: AiTaskExecutionEntity): Promise<void> {
    assertNotWorker("saveExecution");
    await this.executionRepo.save(exec);
  }
}
