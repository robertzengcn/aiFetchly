import { BaseModule } from "@/modules/baseModule";
import { AIChatGoalModel } from "@/model/AIChatGoal.model";
import { AIChatGoalRunModel } from "@/model/AIChatGoalRun.model";
import { AIChatGoalEvidenceModel } from "@/model/AIChatGoalEvidence.model";
import type {
  AIChatGoalCriterion,
  AIChatGoalLoopLimits,
  AIChatGoalRunView,
  AIChatGoalStatus,
  AIChatGoalView,
  GoalEvidenceSourceKind,
} from "@/entityTypes/aiChatGoalTypes";

function uuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson<T>(raw?: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Legal goal status transitions (design §4.4). Terminal states have none. */
const LEGAL_TRANSITIONS: Record<AIChatGoalStatus, readonly AIChatGoalStatus[]> =
  {
    draft: ["active", "cancelled"],
    active: ["running", "cancelled", "blocked"],
    running: [
      "complete",
      "blocked",
      "needs_user_input",
      "failed",
      "cancelled",
      "active",
    ],
    needs_user_input: ["active", "running", "cancelled"],
    complete: [],
    blocked: [],
    cancelled: [],
    failed: [],
  };

const TERMINAL_STATUSES: readonly AIChatGoalStatus[] = [
  "complete",
  "blocked",
  "failed",
  "cancelled",
];

/**
 * Business-rule layer for conversation goals and loop runs. IPC handlers and
 * the renderer call this module; it is the only component that touches the
 * goal repositories. Source: ai-chat-goal-loop-technical-design.md §4.3.
 */
export class AIChatGoalModule extends BaseModule {
  private goalModel: AIChatGoalModel;
  private runModel: AIChatGoalRunModel;
  private evidenceModel: AIChatGoalEvidenceModel;

  constructor() {
    super();
    this.goalModel = new AIChatGoalModel(this.dbpath);
    this.runModel = new AIChatGoalRunModel(this.dbpath);
    this.evidenceModel = new AIChatGoalEvidenceModel(this.dbpath);
  }

  // ---------- Goals ----------

  /**
   * Create a draft goal. Rejects a second non-terminal goal for the
   * conversation unless `replace` is true.
   */
  async createDraftGoal(input: {
    conversationId: string;
    objective: string;
    criteria: AIChatGoalCriterion[];
    planId?: string;
    loopLimits?: AIChatGoalLoopLimits;
    replace?: boolean;
  }): Promise<AIChatGoalView> {
    if (!input.conversationId) {
      throw new Error("conversationId is required");
    }
    if (!input.objective.trim()) {
      throw new Error("objective must be non-empty");
    }
    if (!Array.isArray(input.criteria) || input.criteria.length === 0) {
      throw new Error("at least one acceptance criterion is required");
    }

    const existing = await this.goalModel.getActiveByConversation(
      input.conversationId
    );
    if (existing && !input.replace) {
      throw new Error(
        "An active goal already exists for this conversation. Re-submit with replace=true to replace it."
      );
    }

    const goalId = `goal-${uuid()}`;
    const entity = await this.goalModel.createGoal({
      goalId,
      conversationId: input.conversationId,
      objective: input.objective,
      criteria: JSON.stringify(input.criteria),
      planId: input.planId,
      status: "draft",
      loopLimits: input.loopLimits
        ? JSON.stringify(input.loopLimits)
        : undefined,
    });
    return this.toGoalView(entity);
  }

  async getGoal(goalId: string): Promise<AIChatGoalView | null> {
    const entity = await this.goalModel.getByGoalId(goalId);
    return entity ? this.toGoalView(entity) : null;
  }

  async getActiveGoal(conversationId: string): Promise<AIChatGoalView | null> {
    const entity = await this.goalModel.getActiveByConversation(conversationId);
    return entity ? this.toGoalView(entity) : null;
  }

  /** Transition a goal's status, enforcing legal transitions. */
  async transitionGoalStatus(
    goalId: string,
    to: AIChatGoalStatus,
    patch?: {
      iterationCount?: number;
      latestVerdict?: string;
      terminalReason?: string;
      sourceRevisionFingerprint?: string;
    }
  ): Promise<AIChatGoalView> {
    const entity = await this.goalModel.getByGoalId(goalId);
    if (!entity) throw new Error(`Goal not found: ${goalId}`);
    const allowed = LEGAL_TRANSITIONS[entity.status];
    if (!allowed || !allowed.includes(to)) {
      throw new Error(
        `Illegal goal status transition: ${entity.status} -> ${to}`
      );
    }
    await this.goalModel.setStatus(goalId, to, patch);
    const updated = await this.goalModel.getByGoalId(goalId);
    return this.toGoalView(updated as never);
  }

  async setIterationCount(
    goalId: string,
    iterationCount: number
  ): Promise<void> {
    await this.goalModel.setStatus(
      goalId,
      "running" as never,
      {
        iterationCount,
      } as never
    );
  }

  // ---------- Runs ----------

  async createRun(input: {
    goalId: string;
    conversationId: string;
    maxIterations: number;
    maxRuntimeMs: number;
    repeatedFailureThreshold: number;
  }): Promise<AIChatGoalRunView> {
    const existing = await this.runModel.getActiveByGoal(input.goalId);
    if (existing) {
      throw new Error(
        "A loop run is already active for this goal. Stop it before starting another."
      );
    }
    const runId = `run-${uuid()}`;
    const entity = await this.runModel.createRun({
      runId,
      goalId: input.goalId,
      conversationId: input.conversationId,
      status: "running",
      maxIterations: input.maxIterations,
      maxRuntimeMs: input.maxRuntimeMs,
      repeatedFailureThreshold: input.repeatedFailureThreshold,
    });
    return this.toRunView(entity);
  }

  async getRun(runId: string): Promise<AIChatGoalRunView | null> {
    const entity = await this.runModel.getByRunId(runId);
    return entity ? this.toRunView(entity) : null;
  }

  async endRun(
    runId: string,
    status: AIChatGoalStatus,
    terminalReason?: string,
    cancelled = false
  ): Promise<void> {
    await this.runModel.endRun(runId, status, {
      terminalReason,
      cancelled: cancelled || undefined,
    });
  }

  // ---------- Evidence ----------

  async appendEvidence(input: {
    goalId: string;
    runId?: string;
    iteration?: number;
    criterionId?: string;
    sourceKind: GoalEvidenceSourceKind;
    state: "pass" | "fail" | "pending";
    sourceRevision?: string;
    contentHash?: string;
    resultMetadata?: string;
    excerpt?: string;
  }): Promise<void> {
    await this.evidenceModel.append({
      evidenceId: `ev-${uuid()}`,
      goalId: input.goalId,
      runId: input.runId,
      iteration: input.iteration,
      criterionId: input.criterionId,
      sourceKind: input.sourceKind,
      state: input.state,
      sourceRevision: input.sourceRevision,
      contentHash: input.contentHash,
      resultMetadata: input.resultMetadata,
      excerpt: input.excerpt,
      timestamp: new Date(),
    });
  }

  // ---------- Views ----------

  private toGoalView(entity: {
    goalId: string;
    conversationId: string;
    objective: string;
    criteria: string;
    planId?: string;
    status: AIChatGoalStatus;
    iterationCount: number;
    latestVerdict?: string;
    terminalReason?: string;
    createdAt?: Date;
    updatedAt?: Date;
  }): AIChatGoalView {
    const criteria = parseJson<AIChatGoalCriterion[]>(entity.criteria) ?? [];
    return {
      goalId: entity.goalId,
      conversationId: entity.conversationId,
      objective: entity.objective,
      criteria,
      planId: entity.planId,
      status: entity.status,
      iterationCount: entity.iterationCount,
      latestVerdict: entity.latestVerdict as AIChatGoalView["latestVerdict"],
      terminalReason: entity.terminalReason,
      createdAt: entity.createdAt?.toISOString() ?? "",
      updatedAt: entity.updatedAt?.toISOString() ?? "",
    };
  }

  private toRunView(entity: {
    runId: string;
    goalId: string;
    conversationId: string;
    status: AIChatGoalStatus;
    iterationCount: number;
    maxIterations: number;
    cancelled: boolean;
    terminalReason?: string;
    startedAt?: Date;
    endedAt?: Date;
  }): AIChatGoalRunView {
    return {
      runId: entity.runId,
      goalId: entity.goalId,
      conversationId: entity.conversationId,
      status: entity.status,
      iterationCount: entity.iterationCount,
      maxIterations: entity.maxIterations,
      cancelled: entity.cancelled,
      terminalReason: entity.terminalReason,
      startedAt: entity.startedAt?.toISOString() ?? "",
      endedAt: entity.endedAt?.toISOString(),
    };
  }

  static readonly terminalStatuses: readonly AIChatGoalStatus[] =
    TERMINAL_STATUSES;
  static readonly legalTransitions: Record<
    AIChatGoalStatus,
    readonly AIChatGoalStatus[]
  > = LEGAL_TRANSITIONS;
}
