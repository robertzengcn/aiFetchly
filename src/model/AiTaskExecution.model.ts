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
 * or double-increments ledger counters (§6.3). Manual executions finalize
 * without touching schedule rows; scheduled origin (Slice 2) will share
 * the transaction to update occurrence/schedule counters atomically.
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
    await this.ledgerRepo.save(ledger);

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
    const saved = await this.executionRepo.save(exec);

    return {
      executionId,
      ledgerId,
      executionRowId: saved.id,
    };
  }

  async getById(executionId: string): Promise<AiTaskExecutionEntity | null> {
    assertNotWorker("getById");
    return this.executionRepo.findOne({
      where: { execution_id: executionId },
    });
  }

  async finalizeExecution(input: FinalizeInput): Promise<FinalizeResult> {
    assertNotWorker("finalizeExecution");
    const exec = await this.getById(input.executionId);
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
    if (exec.execution_state_version !== input.expectedVersion) {
      return { ok: false, reasonCode: "STATE_CONFLICT" };
    }

    exec.finalized = true;
    exec.finalized_at = new Date();
    exec.task_outcome = input.outcome;
    exec.outcome_reason_code = input.reasonCode;
    exec.outcome_summary = input.summary;
    exec.final_event_identity = `execution-result:${input.executionId}`;
    exec.execution_state_version = input.expectedVersion + 1;
    exec.stage = "terminal";
    await this.executionRepo.save(exec);

    // Release the ledger owner (§6.3). Spent allowance persists.
    const ledger = await this.ledgerRepo.findOne({
      where: { ledger_id: exec.ledger_id },
    });
    if (ledger) {
      ledger.active_execution_id = null;
      ledger.status = "released";
      ledger.execution_state_version += 1;
      await this.ledgerRepo.save(ledger);
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
   */
  async saveExecution(exec: AiTaskExecutionEntity): Promise<void> {
    assertNotWorker("saveExecution");
    await this.executionRepo.save(exec);
  }
}
