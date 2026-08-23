import { BaseModule } from "@/modules/baseModule";
import { log } from "@/modules/Logger";
import {
  AIUserMemoryModel,
  AIUserMemoryCreateFields,
} from "@/model/AIUserMemory.model";
import { AIMemoryConsolidationRunEntity } from "@/entity/AIMemoryConsolidationRun.entity";
import { AIUserMemoryEntity } from "@/entity/AIUserMemory.entity";
import { looksSecretlike } from "@/service/MemorySecretFilter";
import type { ParseResult } from "@/service/AIAutoDreamPromptBuilder";
import { randomUUID } from "node:crypto";
import type {
  AIUserMemoryCreateInput,
  AIUserMemoryUpdateInput,
  AIUserMemorySearchInput,
  AIUserMemoryStatus,
  AIUserMemoryView,
} from "@/entityTypes/aiUserMemoryTypes";
import {
  isAIUserMemoryType,
  isAIUserMemoryStatus,
  isAIUserMemorySourceKind,
} from "@/entityTypes/aiUserMemoryTypes";

const MIN_TITLE_LEN = 1;
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 8000;
const MAX_SOURCE_MESSAGE_IDS = 100;

export class AIUserMemoryModule extends BaseModule {
  private memoryModel: AIUserMemoryModel;

  constructor() {
    super();
    this.memoryModel = new AIUserMemoryModel(this.dbpath);
  }

  async createMemory(
    input: AIUserMemoryCreateInput
  ): Promise<AIUserMemoryView> {
    validateCreate(input);
    const fields: AIUserMemoryCreateFields = {
      memoryId: `mem-${randomUUID()}`,
      type: input.type,
      title: input.title.trim(),
      content: input.content.trim(),
      status: "active",
      confidence: clampConfidence(input.confidence ?? 100),
    };
    if (
      input.sourceKind !== undefined &&
      isAIUserMemorySourceKind(input.sourceKind)
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
    input: AIUserMemoryUpdateInput
  ): Promise<AIUserMemoryView> {
    if (!input.memoryId) throw new Error("memoryId is required");
    const patch: Record<string, unknown> = {};
    if (input.type !== undefined) {
      if (!isAIUserMemoryType(input.type)) throw new Error("Invalid type");
      patch.type = input.type;
    }
    if (input.title !== undefined) {
      const t = input.title.trim();
      if (t.length < MIN_TITLE_LEN || t.length > MAX_TITLE_LEN)
        throw new Error("Invalid title length");
      patch.title = t;
    }
    if (input.content !== undefined) {
      const c = input.content.trim();
      if (c.length < 1 || c.length > MAX_CONTENT_LEN)
        throw new Error("Invalid content length");
      patch.content = c;
    }
    if (input.status !== undefined) {
      if (!isAIUserMemoryStatus(input.status))
        throw new Error("Invalid status");
      patch.status = input.status;
    }
    if (input.confidence !== undefined) {
      patch.confidence = clampConfidence(input.confidence);
    }
    if (input.metadata !== undefined) patch.metadata = input.metadata;
    const e = await this.memoryModel.updateByMemoryId(input.memoryId, patch);
    return this.toView(e);
  }

  async archiveMemory(memoryId: string): Promise<void> {
    await this.memoryModel.archive(memoryId);
  }

  async deleteMemory(memoryId: string): Promise<number> {
    return this.memoryModel.deleteByMemoryId(memoryId);
  }

  async getMemory(memoryId: string): Promise<AIUserMemoryView | null> {
    const e = await this.memoryModel.getByMemoryId(memoryId);
    return e ? this.toView(e) : null;
  }

  async listMemories(
    input: AIUserMemorySearchInput
  ): Promise<AIUserMemoryView[]> {
    const status = resolveListStatus(input.status);
    const rows = await this.memoryModel.list({
      ...input,
      status,
    });
    return rows.map((e) => this.toView(e));
  }

  async markMemoriesUsed(
    memoryIds: string[],
    usedAt: Date = new Date()
  ): Promise<void> {
    try {
      await this.memoryModel.markUsed(memoryIds, usedAt);
    } catch (err) {
      log.error("[ai-memory] markMemoriesUsed failed:", err);
    }
  }

  async listActiveForRetrieval(limit = 50): Promise<AIUserMemoryView[]> {
    const rows = await this.memoryModel.listActiveForRetrieval(limit);
    return rows.map((e) => this.toView(e));
  }

  /**
   * Apply a parsed consolidation plan AND mark the run completed in ONE
   * TypeORM transaction. Archive, update, and create operations run through
   * transaction-bound repositories; the run is marked completed with counts,
   * resolved model, and source-derived reviewedThrough in the same
   * transaction. Returns counts only AFTER commit.
   *
   * If either the memory-plan persistence or the run-completion update fails,
   * the entire transaction rolls back — the previous successful cursor remains
   * authoritative and no partial memory plan is applied. The caller must NOT
   * call the model again after this; all mutations occur after response
   * validation (tech-design §14.4, §9.5).
   */
  async applyPlanAndCompleteRun(input: {
    runId: string;
    plan: ParseResult;
    chatConversationsReviewed: number;
    agentTasksReviewed: number;
    model?: string;
    reviewedThrough?: Date | null;
  }): Promise<void> {
    await this.ensureConnection();
    await this.sqliteDb.connection.transaction(async (manager) => {
      const memoryRepo = manager.getRepository(AIUserMemoryEntity);
      const runRepo = manager.getRepository(AIMemoryConsolidationRunEntity);

      // Apply archives first to clear contradictions.
      for (const a of input.plan.archive) {
        await memoryRepo.update(
          { memoryId: a.memoryId },
          { status: "archived" }
        );
      }
      for (const u of input.plan.update) {
        const patch: Record<string, unknown> = {};
        if (u.title !== undefined) patch.title = u.title;
        if (u.content !== undefined) patch.content = u.content;
        if (u.confidence !== undefined)
          patch.confidence = clampConfidence(u.confidence);
        // Defense-in-depth: re-check update title/content for secret-like
        // values before writing (throws -> rollback).
        if (u.title !== undefined || u.content !== undefined) {
          rejectSecretLike(
            u.title !== undefined ? u.title : null,
            u.content !== undefined ? u.content : null
          );
        }
        if (Object.keys(patch).length > 0) {
          await memoryRepo.update({ memoryId: u.memoryId }, patch);
        }
      }
      for (const c of input.plan.create) {
        // Defense-in-depth: re-run the secret filter inside the transaction
        // so a plan that slipped past the parser (or came from a different
        // caller) cannot persist secret-like content. Throws -> rollback.
        rejectSecretLike(c.title, c.content);
        const e = new AIUserMemoryEntity();
        e.memoryId = `mem-${randomUUID()}`;
        e.type = c.type;
        e.title = c.title;
        e.content = c.content;
        e.status = "active";
        e.confidence = clampConfidence(c.confidence ?? 100);
        e.sourceKind =
          c.sourceKind === "chat_v2" || c.sourceKind === "agent_task"
            ? c.sourceKind
            : "manual";
        e.sourceConversationId = c.sourceKind === "chat_v2" ? c.sourceId : null;
        e.sourceAgentTaskId = c.sourceKind === "agent_task" ? c.sourceId : null;
        e.sourceMessageIds = c.sourceMessageIds ?? null;
        await memoryRepo.save(e);
      }

      // Mark the run completed in the same transaction.
      await runRepo.update(
        { runId: input.runId },
        {
          status: "completed",
          finishedAt: new Date(),
          chatConversationsReviewed: input.chatConversationsReviewed,
          agentTasksReviewed: input.agentTasksReviewed,
          memoriesCreated: input.plan.create.length,
          memoriesUpdated: input.plan.update.length,
          memoriesArchived: input.plan.archive.length,
          model: input.model ?? null,
          errorMessage: null,
          ...(input.reviewedThrough !== undefined
            ? { reviewedThrough: input.reviewedThrough }
            : {}),
        }
      );
    });
  }

  private toView(e: {
    id: number;
    memoryId: string;
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
  }): AIUserMemoryView {
    return {
      id: e.id,
      memoryId: e.memoryId,
      type: e.type as AIUserMemoryView["type"],
      title: e.title,
      content: e.content,
      status: e.status as AIUserMemoryView["status"],
      confidence: e.confidence,
      sourceKind: (e.sourceKind ?? undefined) as AIUserMemoryView["sourceKind"],
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

function validateCreate(input: AIUserMemoryCreateInput): void {
  if (!isAIUserMemoryType(input.type)) {
    throw new Error(`Invalid memory type: ${input.type}`);
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

function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 100;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Defense-in-depth secret rejection for transactional plan application. The
 * primary secret filter runs at parse time (parseAutoDreamModelOutput's
 * filterCreate), but re-checking here prevents a future caller from
 * persisting an unvalidated plan that slipped past the parser (or came from
 * a different parser). Throws on secret-like content so the transaction
 * rolls back before any mutation.
 */
function rejectSecretLike(title: string | null, content: string | null): void {
  if (looksSecretlike(title) || looksSecretlike(content)) {
    throw new Error(
      "Refusing to persist memory with secret-like content (secret filter)"
    );
  }
}

function resolveListStatus(
  status: AIUserMemorySearchInput["status"]
): AIUserMemoryStatus | undefined {
  if (status === "all") return undefined;
  if (status === undefined) return "active";
  if (!isAIUserMemoryStatus(status)) {
    throw new Error("Invalid memory status");
  }
  return status;
}
