import { BaseModule } from "@/modules/baseModule";
import { log } from "@/modules/Logger";
import {
  AIWorkspaceMemoryModel,
  AIWorkspaceMemoryCreateFields,
} from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryEntity } from "@/entity/AIWorkspaceMemory.entity";
import { AIWorkspaceMemoryConsolidationRunEntity } from "@/entity/AIWorkspaceMemoryConsolidationRun.entity";
import { applyConsolidationPlanInTransaction } from "@/modules/lib/consolidationPlanApply";
import type { WorkspaceAutoDreamParseResult } from "@/service/AIWorkspaceAutoDreamPromptBuilder";
import { randomUUID } from "node:crypto";
import { looksSecretlike } from "@/service/MemorySecretFilter";
import type {
  AIWorkspaceMemoryCreateInput,
  AIWorkspaceMemoryUpdateInput,
  AIWorkspaceMemorySearchInput,
  AIWorkspaceMemoryView,
  AIWorkspaceMemoryStatus,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import {
  isAIWorkspaceMemoryType,
  isAIWorkspaceMemoryStatus,
  isAIWorkspaceMemorySourceKind,
} from "@/entityTypes/aiWorkspaceMemoryTypes";

const MIN_TITLE_LEN = 1;
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 8000;
const MAX_SOURCE_MESSAGE_IDS = 100;

/**
 * Trusted, main-process-resolved workspace scope.
 *
 * The module never resolves a conversation into a workspace itself — it accepts
 * a scope that the service layer (WorkspaceMemoryContextResolver) has already
 * authenticated against an approved workspace.
 */
export interface WorkspaceMemoryScope {
  readonly workspaceKey: string;
  readonly workspaceRoot: string;
}

export class AIWorkspaceMemoryModule extends BaseModule {
  private memoryModel: AIWorkspaceMemoryModel;

  constructor() {
    super();
    this.memoryModel = new AIWorkspaceMemoryModel(this.dbpath);
  }

  async createMemory(
    scope: WorkspaceMemoryScope,
    input: Omit<AIWorkspaceMemoryCreateInput, "conversationId">
  ): Promise<AIWorkspaceMemoryView> {
    validateCreate(input);
    rejectSecretLike(input.title, input.content);

    const fields: AIWorkspaceMemoryCreateFields = {
      memoryId: `wmem-${randomUUID()}`,
      workspaceKey: scope.workspaceKey,
      workspaceRoot: scope.workspaceRoot,
      type: input.type,
      title: input.title.trim(),
      content: input.content.trim(),
      status: "active",
      confidence: clampConfidence(input.confidence ?? 100),
    };
    if (
      input.sourceKind !== undefined &&
      isAIWorkspaceMemorySourceKind(input.sourceKind)
    ) {
      fields.sourceKind = input.sourceKind;
    } else {
      fields.sourceKind = "manual";
    }
    if (input.sourceConversationId !== undefined)
      fields.sourceConversationId = input.sourceConversationId;
    if (input.sourceAgentTaskId !== undefined)
      fields.sourceAgentTaskId = input.sourceAgentTaskId;
    if (input.sourceMessageIds !== undefined) {
      fields.sourceMessageIds = input.sourceMessageIds.slice(
        0,
        MAX_SOURCE_MESSAGE_IDS
      );
    }
    if (input.metadata !== undefined) fields.metadata = input.metadata;
    const e = await this.memoryModel.create(fields);
    return this.toView(e);
  }

  async updateMemory(
    scope: WorkspaceMemoryScope,
    input: Omit<AIWorkspaceMemoryUpdateInput, "conversationId">
  ): Promise<AIWorkspaceMemoryView> {
    if (!input.memoryId) throw new Error("memoryId is required");
    const patch: Record<string, unknown> = {};
    if (input.type !== undefined) {
      if (!isAIWorkspaceMemoryType(input.type))
        throw new Error("Invalid workspace memory type");
      patch.type = input.type;
    }
    if (input.title !== undefined) {
      const t = input.title.trim();
      if (t.length < MIN_TITLE_LEN || t.length > MAX_TITLE_LEN)
        throw new Error("Invalid title length");
      rejectSecretLike(t, null);
      patch.title = t;
    }
    if (input.content !== undefined) {
      const c = input.content.trim();
      if (c.length < 1 || c.length > MAX_CONTENT_LEN)
        throw new Error("Invalid content length");
      rejectSecretLike(null, c);
      patch.content = c;
    }
    if (input.status !== undefined) {
      if (!isAIWorkspaceMemoryStatus(input.status))
        throw new Error("Invalid workspace memory status");
      patch.status = input.status;
    }
    if (input.confidence !== undefined) {
      patch.confidence = clampConfidence(input.confidence);
    }
    if (input.metadata !== undefined) patch.metadata = input.metadata;

    const e = await this.memoryModel.updateByWorkspaceAndMemoryId(
      scope.workspaceKey,
      input.memoryId,
      patch
    );
    return this.toView(e);
  }

  async archiveMemory(
    scope: WorkspaceMemoryScope,
    memoryId: string
  ): Promise<void> {
    await this.memoryModel.archive(scope.workspaceKey, memoryId);
  }

  async deleteMemory(
    scope: WorkspaceMemoryScope,
    memoryId: string
  ): Promise<number> {
    return this.memoryModel.deleteByWorkspaceAndMemoryId(
      scope.workspaceKey,
      memoryId
    );
  }

  async getMemory(
    scope: WorkspaceMemoryScope,
    memoryId: string
  ): Promise<AIWorkspaceMemoryView | null> {
    const e = await this.memoryModel.getByWorkspaceAndMemoryId(
      scope.workspaceKey,
      memoryId
    );
    return e ? this.toView(e) : null;
  }

  async listMemories(
    scope: WorkspaceMemoryScope,
    input: Omit<AIWorkspaceMemorySearchInput, "conversationId">
  ): Promise<AIWorkspaceMemoryView[]> {
    const status = resolveListStatus(input.status);
    const rows = await this.memoryModel.list({
      workspaceKey: scope.workspaceKey,
      query: input.query,
      type: input.type,
      status,
      sourceKind: input.sourceKind,
      limit: input.limit,
      offset: input.offset,
    });
    return rows.map((e) => this.toView(e));
  }

  async listActiveForRetrieval(
    scope: WorkspaceMemoryScope,
    limit = 50
  ): Promise<AIWorkspaceMemoryView[]> {
    const rows = await this.memoryModel.listActiveForRetrieval(
      scope.workspaceKey,
      limit
    );
    return rows.map((e) => this.toView(e));
  }

  async markMemoriesUsed(
    scope: WorkspaceMemoryScope,
    memoryIds: readonly string[],
    usedAt: Date = new Date()
  ): Promise<void> {
    try {
      await this.memoryModel.markUsed(scope.workspaceKey, memoryIds, usedAt);
    } catch (err) {
      log.error("[workspace-memory] markMemoriesUsed failed:", err);
    }
  }

  /**
   * Apply a parsed workspace consolidation plan AND mark the run completed in
   * ONE TypeORM transaction. Archive/update/create run through transaction-
   * bound repositories scoped to the workspace; the run is marked completed
   * with counts, resolved model, and source-derived reviewedThrough in the
   * same transaction. Returns counts only AFTER commit. A failure rolls back
   * all mutations (tech-design §14.4, §14.5).
   */
  async applyPlanAndCompleteRun(input: {
    scope: WorkspaceMemoryScope;
    runId: string;
    plan: WorkspaceAutoDreamParseResult;
    chatConversationsReviewed: number;
    agentTasksReviewed: number;
    model?: string;
    reviewedThrough?: Date | null;
  }): Promise<void> {
    await this.ensureConnection();
    const { workspaceKey, workspaceRoot } = input.scope;
    await this.sqliteDb.connection.transaction(async (manager) => {
      await applyConsolidationPlanInTransaction({
        manager,
        memoryEntity: AIWorkspaceMemoryEntity,
        runEntity: AIWorkspaceMemoryConsolidationRunEntity,
        plan: input.plan,
        runId: input.runId,
        completion: {
          chatConversationsReviewed: input.chatConversationsReviewed,
          agentTasksReviewed: input.agentTasksReviewed,
          model: input.model,
          reviewedThrough: input.reviewedThrough,
        },
        buildCreateEntity: (c) => {
          const e = new AIWorkspaceMemoryEntity();
          e.memoryId = `wmem-${randomUUID()}`;
          e.workspaceKey = workspaceKey;
          e.workspaceRoot = workspaceRoot;
          e.type = c.type;
          e.title = c.title;
          e.content = c.content;
          e.status = "active";
          e.confidence = clampConfidence(c.confidence ?? 100);
          e.sourceKind = "auto_dream";
          e.sourceConversationId =
            c.sourceKind === "chat_v2" ? c.sourceId ?? null : null;
          e.sourceAgentTaskId =
            c.sourceKind === "agent_task" ? c.sourceId ?? null : null;
          e.sourceMessageIds = (c.sourceMessageIds as string[] | null) ?? null;
          return e;
        },
        archiveWhere: (memoryId) => ({ workspaceKey, memoryId }),
        updateWhere: (memoryId) => ({ workspaceKey, memoryId }),
      });
    });
  }

  private toView(e: {
    id: number;
    memoryId: string;
    workspaceKey: string;
    workspaceRoot: string;
    type: string;
    title: string;
    content: string;
    status: string;
    confidence: number;
    sourceKind?: string | null;
    sourceConversationId?: string | null;
    sourceAgentTaskId?: string | null;
    sourceMessageIds?: string[] | null;
    lastUsedAt?: Date | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
  }): AIWorkspaceMemoryView {
    return {
      id: e.id,
      memoryId: e.memoryId,
      workspaceKey: e.workspaceKey,
      workspaceRoot: e.workspaceRoot,
      type: e.type as AIWorkspaceMemoryView["type"],
      title: e.title,
      content: e.content,
      status: e.status as AIWorkspaceMemoryView["status"],
      confidence: e.confidence,
      sourceKind: (e.sourceKind ??
        undefined) as AIWorkspaceMemoryView["sourceKind"],
      sourceConversationId: e.sourceConversationId ?? undefined,
      sourceAgentTaskId: e.sourceAgentTaskId ?? undefined,
      sourceMessageIds: e.sourceMessageIds ?? undefined,
      lastUsedAt: e.lastUsedAt?.toISOString(),
      metadata: e.metadata ?? undefined,
      createdAt: e.createdAt?.toISOString() ?? new Date(0).toISOString(),
      updatedAt: e.updatedAt?.toISOString() ?? new Date(0).toISOString(),
    };
  }
}

function validateCreate(
  input: Omit<AIWorkspaceMemoryCreateInput, "conversationId">
): void {
  if (!isAIWorkspaceMemoryType(input.type)) {
    throw new Error(`Invalid workspace memory type: ${input.type}`);
  }
  const title = input.title.trim();
  if (title.length < MIN_TITLE_LEN || title.length > MAX_TITLE_LEN) {
    throw new Error("Invalid title length (1..200)");
  }
  const content = input.content.trim();
  if (content.length < 1 || content.length > MAX_CONTENT_LEN) {
    throw new Error("Invalid content length (1..8000)");
  }
}

function rejectSecretLike(title: string | null, content: string | null): void {
  if (looksSecretlike(title) || looksSecretlike(content)) {
    throw new Error(
      "Workspace memory content looks like a secret or credential and was rejected."
    );
  }
}

function resolveListStatus(
  status: AIWorkspaceMemorySearchInput["status"]
): AIWorkspaceMemoryStatus | undefined {
  if (status === "all") return undefined;
  if (status === undefined) return "active";
  if (!isAIWorkspaceMemoryStatus(status)) {
    throw new Error("Invalid workspace memory status");
  }
  return status;
}

function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 100;
  return Math.max(0, Math.min(100, Math.round(v)));
}
