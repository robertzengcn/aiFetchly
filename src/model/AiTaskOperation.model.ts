import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AiTaskOperationEntity } from "@/entity/AiTaskOperation.entity";
import { assertNotWorker } from "@/model/workerDbGuard";
import type {
  AiTaskOperationState,
  TaskExecutionReasonCode,
} from "@/entityTypes/aiTaskExecutionTypes";

export interface CreateOperationInput {
  readonly operationKey: string;
  readonly executionId: string;
  readonly toolIdentity: string;
  readonly domainTarget: string | null;
  readonly intentHash: string;
}

export interface CreateOperationResult {
  readonly ok: boolean;
  readonly alreadyExists?: boolean;
  readonly reasonCode?: TaskExecutionReasonCode;
}

export interface UpdateStateInput {
  readonly operationKey: string;
  readonly expectedClaimGeneration: number;
  readonly newState: AiTaskOperationState;
}

export interface UpdateStateResult {
  readonly ok: boolean;
  readonly reasonCode?: TaskExecutionReasonCode;
}

/**
 * Data-access layer for `ai_task_operation` (technical-design §6.1/§10).
 *
 * Slice 1 implements create/get/updateState with claim-generation CAS so the
 * schema is stable and the worker guard is enforced. Full receipt
 * reconciliation (FR-11; AC-09/10/13/28) lands in Slice 3.
 *
 * The unique `operation_key` dedups retries — `create` is idempotent and
 * returns `alreadyExists: true` without inserting a duplicate. When an
 * existing row IS found, `create` compares the incoming `intentHash`,
 * `executionId`, and `toolIdentity` against the stored row and returns
 * `INTENT_CONFLICT` if any differ — the entity's canonical `intent_hash`
 * genuinely prevents a changed target from reusing an operation (§10.1).
 *
 * The check-then-insert is vulnerable to a concurrent same-key create: two
 * callers both read null, both insert, and the second hits a raw
 * unique-constraint violation. `create` catches that violation and returns
 * `alreadyExists: true` instead of throwing, so concurrent retries resolve
 * to a typed result either way.
 *
 * CAS on `claim_generation` prevents stale dispatch: a caller holding a
 * stale generation receives `STATE_CONFLICT` and must re-read.
 *
 * Worker guard: every method calls `assertNotWorker` first — workers must
 * never touch this table directly (NFR-03).
 */
export class AiTaskOperationModel extends BaseDb {
  private repository: Repository<AiTaskOperationEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      AiTaskOperationEntity
    );
  }

  protected override onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(
      AiTaskOperationEntity
    );
  }

  async create(
    input: CreateOperationInput
  ): Promise<CreateOperationResult> {
    assertNotWorker("AiTaskOperation.create");
    const existing = await this.repository.findOne({
      where: { operation_key: input.operationKey },
    });
    if (existing) {
      // A same-key create with a changed intent must NOT silently return
      // alreadyExists — the canonical intent_hash exists precisely to
      // prevent a changed target from reusing an operation (§10.1).
      if (
        existing.intent_hash !== input.intentHash ||
        existing.execution_id !== input.executionId ||
        existing.tool_identity !== input.toolIdentity
      ) {
        return { ok: false, reasonCode: "INTENT_CONFLICT" };
      }
      return { ok: false, alreadyExists: true };
    }
    const op = new AiTaskOperationEntity();
    op.operation_key = input.operationKey;
    op.execution_id = input.executionId;
    op.tool_identity = input.toolIdentity;
    op.domain_target = input.domainTarget;
    op.intent_hash = input.intentHash;
    op.operation_state = "pending";
    op.claim_generation = 0;
    op.receipt_reference = null;
    op.failure_code = null;
    op.claimed_at = null;
    op.dispatched_at = null;
    op.settled_at = null;
    try {
      await this.repository.save(op);
    } catch (error) {
      // Concurrent same-key create: both callers read null, both insert,
      // second hits the unique constraint. Resolve to the typed result
      // instead of surfacing a raw SQLite UNIQUE error.
      if (this.isUniqueConstraintError(error)) {
        return { ok: false, alreadyExists: true };
      }
      throw error;
    }
    return { ok: true };
  }

  async getByKey(
    operationKey: string
  ): Promise<AiTaskOperationEntity | null> {
    assertNotWorker("AiTaskOperation.getByKey");
    return this.repository.findOne({
      where: { operation_key: operationKey },
    });
  }

  async updateState(
    input: UpdateStateInput
  ): Promise<UpdateStateResult> {
    assertNotWorker("AiTaskOperation.updateState");
    const op = await this.getByKey(input.operationKey);
    if (!op) {
      return { ok: false, reasonCode: "OPERATION_NOT_FOUND" };
    }
    if (op.claim_generation !== input.expectedClaimGeneration) {
      return { ok: false, reasonCode: "STATE_CONFLICT" };
    }
    op.operation_state = input.newState;
    op.claim_generation = input.expectedClaimGeneration + 1;
    if (input.newState === "claimed") {
      op.claimed_at = new Date();
    }
    if (input.newState === "dispatched") {
      op.dispatched_at = new Date();
    }
    if (
      input.newState === "accepted" ||
      input.newState === "completed" ||
      input.newState === "failed" ||
      input.newState === "unknown"
    ) {
      op.settled_at = new Date();
    }
    await this.repository.save(op);
    return { ok: true };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Error && /unique constraint/i.test(error.message)
    );
  }
}
