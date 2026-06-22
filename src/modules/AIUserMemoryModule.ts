import { BaseModule } from "@/modules/baseModule";
import {
  AIUserMemoryModel,
  AIUserMemoryCreateFields,
} from "@/model/AIUserMemory.model";
import { randomUUID } from "node:crypto";
import type {
  AIUserMemoryCreateInput,
  AIUserMemoryUpdateInput,
  AIUserMemorySearchInput,
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
    const rows = await this.memoryModel.list({
      ...input,
      status: input.status ?? "active",
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
      console.error("[ai-memory] markMemoriesUsed failed:", err);
    }
  }

  async listActiveForRetrieval(limit = 50): Promise<AIUserMemoryView[]> {
    const rows = await this.memoryModel.listActiveForRetrieval(limit);
    return rows.map((e) => this.toView(e));
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
