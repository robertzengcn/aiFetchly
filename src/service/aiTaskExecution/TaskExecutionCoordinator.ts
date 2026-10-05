/**
 * Creates execution-scoped identity and the trusted runtime binding
 * (technical-design §5, FR-17/20).
 *
 * The binding is MAIN-PROCESS STATE, never serializable renderer input
 * (§4A.1). The coordinator creates durable identity BEFORE slow resolution
 * so Stop already works (FR-17). Manual execution has its own durable
 * identity — not a fake schedule/run or goal record (FR-20).
 *
 * Slice 1 scope: identity creation + binding assembly + snapshot (for
 * persistence). Live lease acquisition against the
 * ConversationTurnCoordinator and live continuation dispatch land in Slice 2.
 *
 * Single completion owner (FR-20): one of "standalone" or "goal" per
 * execution. An unrelated active conversation goal cannot take over an
 * ordinary manual request.
 */
import type {
  TaskExecutionBindingSnapshot,
  TaskExecutionOrigin,
  TaskExecutionRoute,
  TaskCompletionContract,
} from "@/entityTypes/aiTaskExecutionTypes";
import { TaskRunBudget } from "@/service/aiTaskExecution/TaskRunBudget";
import { MANUAL_BUDGET_DEFAULTS } from "@/service/aiTaskExecution/budgetDefaults";
import type { BudgetLimitsInput } from "@/service/aiTaskExecution/budgetDefaults";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { TaskCompletionController } from "@/service/aiTaskExecution/TaskCompletionController";
import type {
  CreateExecutionResult,
  ExistingExecutionSnapshot,
} from "@/model/AiTaskExecution.model";

export interface TaskExecutionBinding {
  readonly executionId: string;
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly origin: TaskExecutionOrigin;
  readonly route: TaskExecutionRoute;
  readonly completionOwner: "standalone" | "goal";
  readonly leaseGeneration: number;
  readonly ledgerId: string;
  readonly contract: TaskCompletionContract | null;
  readonly contractHash: string | null;
  readonly controller: TaskCompletionController;
  readonly budget: TaskRunBudget;
}

/**
 * Discriminated result of `startManual`/`startScheduled` (AC-26, §4A.1).
 *
 * - `created`: a new execution was inserted; a fresh binding (with a fresh
 *   budget/controller) is returned for the caller to drive.
 * - `reused`: a same-(conversation, submission) execution with the same
 *   request_hash already exists. This is a transport retry — the caller must
 *   NOT re-dispatch effects or renew limits. No fresh budget/controller is
 *   constructed (AC-26: "no duplicated effects or renewed limits"); the
 *   existing execution's current/final status is authoritative. Resurrecting
 *   the live budget from the ledger is Slice 2 (live ledger-backed
 *   reservations).
 * - `conflict`: same submission ID, different request_hash →
 *   `SUBMISSION_CONFLICT`. The caller surfaces the conflict and must not
 *   persist a second row.
 */
export type StartBindingResult =
  | { readonly status: "created"; readonly binding: TaskExecutionBinding }
  | { readonly status: "reused"; readonly existing: ExistingExecutionSnapshot }
  | {
      readonly status: "conflict";
      readonly reasonCode: "SUBMISSION_CONFLICT";
      readonly existing: ExistingExecutionSnapshot;
    };

export interface StartManualInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly submissionId: string;
  readonly requestHash: string;
  readonly route: TaskExecutionRoute;
  readonly completionOwner: "standalone" | "goal";
}

export interface StartScheduledInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly requestHash: string;
  readonly route: TaskExecutionRoute;
  readonly taskId: number;
  readonly runId: number;
  readonly occurrenceKey: string;
  readonly budgetLimits: BudgetLimitsInput;
}

export class TaskExecutionCoordinator {
  private readonly module: AiTaskExecutionModule;

  constructor(module?: AiTaskExecutionModule) {
    // Constructed lazily — never at module top level (BaseModule TDZ).
    this.module = module ?? new AiTaskExecutionModule();
  }

  async startManual(input: StartManualInput): Promise<StartBindingResult> {
    const origin: TaskExecutionOrigin = {
      type: "manual",
      submissionId: input.submissionId,
    };
    return this.startBinding({
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      requestHash: input.requestHash,
      route: input.route,
      completionOwner: input.completionOwner,
      origin,
      budgetLimits: MANUAL_BUDGET_DEFAULTS,
      submissionId: input.submissionId,
    });
  }

  async startScheduled(
    input: StartScheduledInput
  ): Promise<StartBindingResult> {
    const origin: TaskExecutionOrigin = {
      type: "scheduled",
      taskId: input.taskId,
      runId: input.runId,
      occurrenceKey: input.occurrenceKey,
    };
    return this.startBinding({
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      requestHash: input.requestHash,
      route: input.route,
      completionOwner: "standalone",
      origin,
      budgetLimits: input.budgetLimits,
      submissionId: null,
    });
  }

  private async startBinding(input: {
    conversationId: string;
    sourceUserMessageId: string;
    requestHash: string;
    route: TaskExecutionRoute;
    completionOwner: "standalone" | "goal";
    origin: TaskExecutionOrigin;
    budgetLimits: BudgetLimitsInput;
    submissionId: string | null;
  }): Promise<StartBindingResult> {
    const started: CreateExecutionResult = await this.module.startExecution({
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      submissionId: input.submissionId,
      requestHash: input.requestHash,
      origin: input.origin,
      route: input.route,
      completionOwner: input.completionOwner,
      budgetLimits: input.budgetLimits,
    });

    // AC-26: a reused or conflicting submission must NOT construct a fresh
    // budget/controller — that would renew limits or duplicate the binding.
    // Propagate the typed result; Slice 2 resurrects the live budget from
    // the ledger on the reused path.
    if (started.status === "reused") {
      return { status: "reused", existing: started.existing };
    }
    if (started.status === "conflict") {
      return {
        status: "conflict",
        reasonCode: "SUBMISSION_CONFLICT",
        existing: started.existing,
      };
    }

    const budget = new TaskRunBudget(input.budgetLimits);
    const controller = new TaskCompletionController();

    return {
      status: "created",
      binding: {
        executionId: started.executionId,
        conversationId: input.conversationId,
        sourceUserMessageId: input.sourceUserMessageId,
        origin: input.origin,
        route: input.route,
        completionOwner: input.completionOwner,
        leaseGeneration: 0,
        ledgerId: started.ledgerId,
        contract: null,
        contractHash: null,
        controller,
        budget,
      },
    };
  }

  /** Serialize the binding for persistence; excludes runtime objects. */
  toSnapshot(binding: TaskExecutionBinding): TaskExecutionBindingSnapshot {
    return {
      executionId: binding.executionId,
      conversationId: binding.conversationId,
      sourceUserMessageId: binding.sourceUserMessageId,
      origin: binding.origin,
      route: binding.route,
      completionOwner: binding.completionOwner,
      leaseGeneration: binding.leaseGeneration,
      ledgerId: binding.ledgerId,
      contractHash: binding.contractHash,
    };
  }
}
