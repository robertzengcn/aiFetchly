import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AiTaskOperationEntity } from "@/entity/AiTaskOperation.entity";
import { assertNotWorker } from "@/model/workerDbGuard";
import type {
  AiTaskOperationState,
  TaskExecutionReasonCode,
} from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Legal §10.2 state machine: claimed → failed-before-dispatch fence, the
 * dispatched → unknown uncertainty branch, and terminal stickiness for
 * accepted/completed/failed (a settled consequential action never re-opens).
 * Only listed (from → to) pairs may transition.
 */
const OPERATION_STATE_TRANSITIONS: Readonly<
  Record<AiTaskOperationState, readonly AiTaskOperationState[]>
> = {
  pending: ["claimed"],
  claimed: ["dispatched", "failed"],
  dispatched: ["accepted", "failed", "unknown"],
  accepted: [],
  completed: [],
  failed: [],
  unknown: ["dispatched", "accepted", "failed"],
};

/**
 * §10.2 terminal states — reaching one stamps `settled_at`. `unknown` is
 * NOT terminal: §10.2 routes unknown → dispatched/accepted/failed (crash
 * reconciliation), so entering it must not claim a settlement timestamp.
 */
const TERMINAL_STATES: Readonly<Record<string, true>> = {
  accepted: true,
  completed: true,
  failed: true,
};

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

export interface SetReceiptInput {
  readonly operationKey: string;
  readonly expectedClaimGeneration: number;
  /** Native receipt reference (e.g. `attempt:<send_attempt_id>`). */
  readonly receiptReference?: string;
  /** Safe failure code for a no-effect outcome (never raw error text). */
  readonly failureCode?: string;
}

export interface UpdateStateResult {
  readonly ok: boolean;
  readonly reasonCode?: TaskExecutionReasonCode;
}

/**
 * Data-access layer for `ai_task_operation` (technical-design §6.1/§10).
 *
 * The unique `operation_key` dedups retries — `create` is idempotent and
 * returns `alreadyExists: true` without inserting a duplicate. When an
 * existing row IS found — pre-checked or via a unique-constraint collision
 * — `create` reloads the winner and compares the incoming `intentHash`,
 * `executionId`, and `toolIdentity` against it, returning `INTENT_CONFLICT`
 * if any differ. The canonical `intent_hash` prevents a changed target from
 * reusing an operation (§10.1); identical-intent collisions are receipt
 * reuse (T22).
 *
 * `updateState` (T22) is an atomic conditional UPDATE keyed on
 * `claim_generation` — no read/check/save race: two claimers of the same
 * generation race one `UPDATE ... WHERE claim_generation = ?` and exactly
 * one caller's statement matches (affected = 1); the loser gets
 * `STATE_CONFLICT`. Illegal transitions (terminal regression, claiming a
 * terminal op, pending → dispatched skipping the §10.2 claim fence) are
 * rejected typed before any write.
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
      // second hits the unique constraint. Reload the winner and compare
      // identity — a different intent must surface as INTENT_CONFLICT,
      // never as a harmless alreadyExists (T22; audit P2).
      if (this.isUniqueConstraintError(error)) {
        return this.compareWithExistingWinner(input);
      }
      throw error;
    }
    return { ok: true };
  }

  /**
   * Compare a colliding create against the row that actually won the
   * unique race. Identical identity (intent + execution + tool) is receipt
   * reuse (`alreadyExists`); any difference is `INTENT_CONFLICT` — the
   * loser of the race must not silently adopt another operation's receipt.
   */
  private async compareWithExistingWinner(
    input: CreateOperationInput
  ): Promise<CreateOperationResult> {
    const winner = await this.repository.findOne({
      where: { operation_key: input.operationKey },
    });
    if (!winner) {
      // The winner vanished between the constraint violation and this
      // read (delete window). Fail closed — the caller re-runs create.
      return { ok: false, reasonCode: "INTENT_CONFLICT" };
    }
    if (
      winner.intent_hash !== input.intentHash ||
      winner.execution_id !== input.executionId ||
      winner.tool_identity !== input.toolIdentity
    ) {
      return { ok: false, reasonCode: "INTENT_CONFLICT" };
    }
    return { ok: false, alreadyExists: true };
  }

  async getByKey(
    operationKey: string
  ): Promise<AiTaskOperationEntity | null> {
    assertNotWorker("AiTaskOperation.getByKey");
    return this.repository.findOne({
      where: { operation_key: operationKey },
    });
  }

  /**
   * §10.2 cross-execution unresolved-operations lookup: any prior operation
   * for the same domain intent (tool + target, or the same intent hash) that
   * has not reached a terminal state. `unknown` rows are the critical case —
   * a new execution ID or conversation must not bypass an earlier send whose
   * outcome was never observed. Backed by the `intent_hash` and
   * `operation_state` indexes; bounded by `limit` (oldest first).
   */
  async findUnresolvedByIntent(input: {
    readonly toolIdentity: string;
    readonly domainTarget: string | null;
    readonly intentHash: string;
    readonly limit?: number;
  }): Promise<AiTaskOperationEntity[]> {
    assertNotWorker("AiTaskOperation.findUnresolvedByIntent");
    const unresolvedStates: AiTaskOperationState[] = [
      "pending",
      "claimed",
      "dispatched",
      "unknown",
    ];
    const qb = this.repository
      .createQueryBuilder("op")
      .where("op.operation_state IN (:...states)", { states: unresolvedStates })
      .andWhere(
        "((op.tool_identity = :toolIdentity AND op.domain_target = :domainTarget) OR op.intent_hash = :intentHash)",
        {
          toolIdentity: input.toolIdentity,
          domainTarget: input.domainTarget,
          intentHash: input.intentHash,
        }
      )
      .orderBy("op.id", "ASC")
      .limit(input.limit ?? 50);
    return qb.getMany();
  }

  /**
   * Occurrence-ordinal source for the TaskOperationGuard (§10.1): count ALL
   * stored rows for ONE execution + intent, INCLUDING terminal ones. The
   * §10.1 retry ordinal must be derived from the store and strictly
   * increasing — counting only unresolved rows re-derives the same ordinal
   * once a failed occurrence settles, wedging later retries against the
   * terminal row's key. Backed by the `intent_hash` index; bounded by
   * `limit` (oldest first).
   */
  async countOccurrencesByIntent(input: {
    readonly executionId: string;
    readonly toolIdentity: string;
    readonly domainTarget: string | null;
    readonly intentHash: string;
    readonly limit?: number;
  }): Promise<number> {
    assertNotWorker("AiTaskOperation.countOccurrencesByIntent");
    const qb = this.repository
      .createQueryBuilder("op")
      .where("op.execution_id = :executionId", { executionId: input.executionId })
      .andWhere(
        "((op.tool_identity = :toolIdentity AND op.domain_target = :domainTarget) OR op.intent_hash = :intentHash)",
        {
          toolIdentity: input.toolIdentity,
          domainTarget: input.domainTarget,
          intentHash: input.intentHash,
        }
      )
      .orderBy("op.id", "ASC")
      .limit(input.limit ?? 500);
    const rows = await qb.getMany();
    return rows.length;
  }

  async updateState(
    input: UpdateStateInput
  ): Promise<UpdateStateResult> {
    assertNotWorker("AiTaskOperation.updateState");
    // Read-only pre-checks for typed diagnostics. The write below is the
    // actual gate: a conditional UPDATE that only matches when the row is
    // still on the expected generation AND on a state that legally
    // transitions to the requested one. Two concurrent claimers race this
    // single statement — exactly one UPDATE matches, so exactly one
    // caller observes a success (T22; audit P1).
    const current = await this.getByKey(input.operationKey);
    if (!current) {
      return { ok: false, reasonCode: "OPERATION_NOT_FOUND" };
    }
    if (current.claim_generation !== input.expectedClaimGeneration) {
      return { ok: false, reasonCode: "STATE_CONFLICT" };
    }
    if (
      !OPERATION_STATE_TRANSITIONS[current.operation_state]?.includes(
        input.newState
      )
    ) {
      return { ok: false, reasonCode: "STATE_CONFLICT" };
    }

    const affected = await this.conditionalStateUpdate(input);
    if (affected !== 1) {
      // Lost the race (another claimer advanced the generation between
      // the read and the write) or the state moved off the legal path —
      // either way the caller must re-read before retrying.
      return { ok: false, reasonCode: "STATE_CONFLICT" };
    }
    return { ok: true };
  }

  /**
   * Set the native receipt reference and/or a safe failure code on the row,
   * CAS-conditional on `claim_generation` (same single-statement pattern as
   * `conditionalStateUpdate` — no read/check/save race with a concurrent
   * settler). Does NOT change `operation_state` or the generation: the
   * receipt annotates the CURRENT settlement, it is not a transition.
   * §10.1: receipt references are opaque native identifiers (attempt ids) —
   * raw error text or sensitive data must never land here.
   */
  async setReceipt(input: SetReceiptInput): Promise<boolean> {
    assertNotWorker("AiTaskOperation.setReceipt");
    if (
      input.receiptReference === undefined &&
      input.failureCode === undefined
    ) {
      return false;
    }
    const setClauses = ["updatedAt = CURRENT_TIMESTAMP"];
    const parameters: (string | number)[] = [];
    if (input.receiptReference !== undefined) {
      setClauses.push("receipt_reference = ?");
      parameters.push(input.receiptReference);
    }
    if (input.failureCode !== undefined) {
      setClauses.push("failure_code = ?");
      parameters.push(input.failureCode);
    }
    parameters.push(input.operationKey, input.expectedClaimGeneration);
    const runner = this.sqliteDb.connection.createQueryRunner();
    try {
      const result = (await runner.query(
        `UPDATE ai_task_operation
            SET ${setClauses.join(", ")}
          WHERE operation_key = ?
            AND claim_generation = ?`,
        parameters,
        true // useStructuredResult — exposes .affected on the driver result
      )) as { affected?: number };
      return (result.affected ?? 0) === 1;
    } finally {
      await runner.release();
    }
  }

  /**
   * Single-statement guarded transition. Matches only when the row still
   * carries the expected generation and sits on a state that legally
   * transitions to `newState`; bumps the generation and stamps the §10.2
   * transition timestamps in the same statement.
   *
   * Raw driver SQL via the QueryRunner (matching the T11/B2 finalize CAS in
   * `AiTaskExecution.model.ts`): `manager.query()` drops the
   * `useStructuredResult` flag, and the QueryBuilder's `.affected` path is
   * unreliable on better-sqlite3. The WHERE predicate is evaluated
   * atomically with the SET, so two concurrent claimers race one statement
   * and exactly one UPDATE matches.
   */
  private async conditionalStateUpdate(
    input: UpdateStateInput
  ): Promise<number> {
    const legalSourceStates = (
      Object.keys(OPERATION_STATE_TRANSITIONS) as AiTaskOperationState[]
    ).filter((state) =>
      OPERATION_STATE_TRANSITIONS[state].includes(input.newState)
    );
    // Stamp only the timestamp this transition owns — the three target
    // kinds are mutually exclusive, so at most one clause is added. An
    // unconditional SET would null timestamps recorded by earlier
    // transitions (a claimed → failed outcome would wipe claimed_at,
    // erasing the claim-order trail downstream audits rely on).
    const timestampClause =
      input.newState === "claimed"
        ? "claimed_at = CURRENT_TIMESTAMP"
        : input.newState === "dispatched"
          ? "dispatched_at = CURRENT_TIMESTAMP"
          : input.newState in TERMINAL_STATES
            ? "settled_at = CURRENT_TIMESTAMP"
            : null;
    const setClauses = [
      "operation_state = ?",
      "claim_generation = claim_generation + 1",
      ...(timestampClause ? [timestampClause] : []),
      "updatedAt = CURRENT_TIMESTAMP",
    ];
    const parameters: (string | number)[] = [
      input.newState,
      input.operationKey,
      input.expectedClaimGeneration,
      ...legalSourceStates,
    ];
    const runner = this.sqliteDb.connection.createQueryRunner();
    try {
      const result = (await runner.query(
        `UPDATE ai_task_operation
            SET ${setClauses.join(", ")}
          WHERE operation_key = ?
            AND claim_generation = ?
            AND operation_state IN (${legalSourceStates
              .map(() => "?")
              .join(", ")})`,
        parameters,
        true // useStructuredResult — exposes .affected on the driver result
      )) as { affected?: number };
      return result.affected ?? 0;
    } finally {
      await runner.release();
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Error && /unique constraint/i.test(error.message)
    );
  }
}
