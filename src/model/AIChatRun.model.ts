import { BaseDb } from "@/model/Basedb";
import { AIChatRunEntity } from "@/entity/AIChatRun.entity";
import { Repository, In } from "typeorm";
import type { ChatRunStatus } from "@/entityTypes/aiChatWorkspaceTypes";
import { isChatRunTerminal } from "@/entityTypes/aiChatWorkspaceTypes";

/** Non-terminal statuses queried during startup reconciliation. */
export const RUN_ACTIVE_STATUSES: readonly ChatRunStatus[] = [
  "queued",
  "running",
  "awaiting_permission",
  "awaiting_user",
];

/** Error raised when a compare-and-set transition loses its race. */
export class RunTransitionConflictError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedStatuses: readonly ChatRunStatus[],
    readonly actualStatus: string
  ) {
    super(
      `Run ${runId} transition conflict: expected one of ` +
        `[${expectedStatuses.join(", ")}] but found "${actualStatus}"`
    );
    this.name = "RunTransitionConflictError";
  }
}

function newRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `run-${crypto.randomUUID()}`;
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Durable chat-run envelope model with compare-and-set transitions
 * (technical-design §8.3, §9.1).
 */
export class AIChatRunModel extends BaseDb {
  public repository: Repository<AIChatRunEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(AIChatRunEntity);
  }

  private assertMainProcess(): void {
    if (process.env.WORKER_TYPE) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
          "Workers must send results to the main process via IPC."
      );
    }
  }

  async createRun(input: {
    conversationId: string;
    owner: "interactive" | "scheduled" | "goal" | "agent";
    sourceId?: string | null;
    resourceClass?: "general" | "browser" | "cpu" | "artifact_batch";
  }): Promise<AIChatRunEntity> {
    this.assertMainProcess();
    const now = new Date();
    const entity = new AIChatRunEntity();
    entity.runId = newRunId();
    entity.conversationId = input.conversationId;
    entity.owner = input.owner;
    entity.sourceId = input.sourceId ?? null;
    entity.resourceClass = input.resourceClass ?? "general";
    entity.status = "queued";
    entity.queuedAt = now;
    entity.startedAt = null;
    entity.waitingAt = null;
    entity.finishedAt = null;
    entity.assistantMessageId = null;
    entity.errorCode = null;
    entity.errorSummary = null;
    entity.revision = 0;
    entity.createdAt = now;
    entity.updatedAt = now;
    return this.repository.save(entity);
  }

  async getByRunId(runId: string): Promise<AIChatRunEntity | null> {
    this.assertMainProcess();
    return this.repository.findOne({ where: { runId } });
  }

  /** Newest runs for a conversation (Activity view). */
  async listByConversation(
    conversationId: string,
    limit = 20
  ): Promise<AIChatRunEntity[]> {
    this.assertMainProcess();
    return this.repository.find({
      where: { conversationId },
      order: { createdAt: "DESC" },
      take: limit,
    });
  }

  /** All non-terminal envelopes for the given conversations. */
  async listActiveByConversationIds(
    conversationIds: string[]
  ): Promise<AIChatRunEntity[]> {
    this.assertMainProcess();
    if (conversationIds.length === 0) return [];
    // Status predicate stays in SQL so the (status, updatedAt) index serves
    // the query and terminal history is never scanned.
    return this.repository.find({
      where: {
        conversationId: In(conversationIds),
        status: In(RUN_ACTIVE_STATUSES as string[]),
      },
      order: { createdAt: "DESC" },
    });
  }

  /** Every non-terminal envelope — startup reconciliation input (§19.4). */
  async listAllActive(): Promise<AIChatRunEntity[]> {
    this.assertMainProcess();
    return this.repository.find({
      where: { status: In(RUN_ACTIVE_STATUSES as string[]) },
      order: { updatedAt: "DESC" },
    });
  }

  /**
   * Compare-and-set transition using `revision` (design §9.1).
   *
   * - Terminal states are immutable: a transition out of a terminal status
   *   always fails with {@link RunTransitionConflictError}.
   * - A duplicate event repeating the CURRENT status is an idempotent no-op
   *   returning the unchanged row.
   */
  async transition(
    runId: string,
    next: ChatRunStatus,
    expected: readonly ChatRunStatus[],
    patch?: {
      assistantMessageId?: string;
      errorCode?: string | null;
      errorSummary?: string | null;
    }
  ): Promise<AIChatRunEntity> {
    this.assertMainProcess();
    const current = await this.getByRunId(runId);
    if (!current) {
      throw new RunTransitionConflictError(runId, expected, "(missing)");
    }
    const currentStatus = current.status as ChatRunStatus;
    if (isChatRunTerminal(currentStatus)) {
      if (currentStatus === next) return current; // duplicate terminal event
      throw new RunTransitionConflictError(runId, expected, currentStatus);
    }
    if (currentStatus === next) return current; // duplicate non-terminal
    if (!expected.includes(currentStatus)) {
      throw new RunTransitionConflictError(runId, expected, currentStatus);
    }
    const now = new Date();
    const entity = { ...current };
    entity.status = next;
    entity.revision = current.revision + 1;
    entity.updatedAt = now;
    if (next === "running" && !entity.startedAt) {
      entity.startedAt = now;
    }
    if (
      next === "awaiting_permission" ||
      next === "awaiting_user"
    ) {
      entity.waitingAt = now;
    }
    if (isChatRunTerminal(next)) {
      entity.finishedAt = now;
    }
    if (patch?.assistantMessageId !== undefined) {
      entity.assistantMessageId = patch.assistantMessageId;
    }
    if (patch?.errorCode !== undefined) {
      entity.errorCode = patch.errorCode;
    }
    if (patch?.errorSummary !== undefined) {
      entity.errorSummary = patch.errorSummary
        ? patch.errorSummary.slice(0, 500)
        : null;
    }
    return this.repository.save(entity);
  }

  /** Mark abandoned non-terminal runs interrupted at startup (§19.4). */
  async markInterrupted(
    runId: string,
    reason: string
  ): Promise<AIChatRunEntity | null> {
    this.assertMainProcess();
    const current = await this.getByRunId(runId);
    if (!current) return null;
    if (isChatRunTerminal(current.status as ChatRunStatus)) return current;
    const now = new Date();
    const entity = { ...current };
    entity.status = "interrupted";
    entity.revision = current.revision + 1;
    entity.errorCode = "process_loss";
    entity.errorSummary = reason.slice(0, 500);
    entity.finishedAt = now;
    entity.updatedAt = now;
    return this.repository.save(entity);
  }
}
