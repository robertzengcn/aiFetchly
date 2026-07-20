import { BaseModule } from "@/modules/baseModule";
import { AIArtifactModel } from "@/model/AIArtifact.model";
import { AIArtifactEntity } from "@/entity/AIArtifact.entity";
import type {
  AIArtifactRecord,
  AIArtifactSummary,
} from "@/entityTypes/aiArtifactTypes";

/** Generate a stable public artifact id. */
function generateArtifactId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `artifact-${crypto.randomUUID()}`;
  }
  return `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** ISO timestamp helper that tolerates the optional Date columns on the entity. */
function toIso(date: Date | undefined): string {
  return date instanceof Date ? date.toISOString() : new Date(0).toISOString();
}

/**
 * Business-logic layer for AI artifacts.
 *
 * Owns artifact id generation, version bookkeeping, and entity↔record
 * mapping. Database access is delegated to {@link AIArtifactModel}.
 */
export class AIArtifactModule extends BaseModule {
  /**
   * Persist a new HTML artifact version.
   *
   * Versioning is scoped by (conversationId, normalized title): a repeat
   * generation with the same title increments the version and creates a new
   * row with a fresh artifactId, preserving prior versions in history.
   */
  async createHtmlArtifact(input: {
    conversationId: string;
    title: string;
    description?: string;
    html: string;
  }): Promise<AIArtifactRecord> {
    await this.ensureConnection();
    const model = new AIArtifactModel(this.dbpath);

    const version =
      (await model.getLatestVersion(input.conversationId, input.title)) + 1;

    const entity = new AIArtifactEntity();
    entity.artifactId = generateArtifactId();
    entity.conversationId = input.conversationId;
    entity.type = "html";
    entity.title = input.title;
    entity.description = input.description;
    entity.mimeType = "text/html";
    entity.content = input.html;
    entity.version = version;

    const saved = await model.saveArtifact(entity);
    return this.toRecord(saved);
  }

  /** Fetch a full artifact (including content) by its stable id. */
  async getArtifact(artifactId: string): Promise<AIArtifactRecord | null> {
    await this.ensureConnection();
    const model = new AIArtifactModel(this.dbpath);
    const entity = await model.getByArtifactId(artifactId);
    return entity ? this.toRecord(entity) : null;
  }

  /** List content-free summaries for a conversation, newest first. */
  async listArtifacts(conversationId: string): Promise<AIArtifactSummary[]> {
    await this.ensureConnection();
    const model = new AIArtifactModel(this.dbpath);
    const entities = await model.listByConversation(conversationId);
    return entities.map((entity) => this.toSummary(entity));
  }

  /** Delete all artifacts for a conversation. Returns rows removed. */
  async deleteByConversation(conversationId: string): Promise<number> {
    await this.ensureConnection();
    const model = new AIArtifactModel(this.dbpath);
    return model.deleteByConversation(conversationId);
  }

  private toRecord(entity: AIArtifactEntity): AIArtifactRecord {
    return {
      id: entity.artifactId,
      conversationId: entity.conversationId,
      type: entity.type,
      title: entity.title,
      description: entity.description,
      mimeType: entity.mimeType,
      content: entity.content,
      version: entity.version,
      createdAt: toIso(entity.createdAt),
      updatedAt: toIso(entity.updatedAt),
    };
  }

  private toSummary(entity: AIArtifactEntity): AIArtifactSummary {
    return {
      id: entity.artifactId,
      conversationId: entity.conversationId,
      type: entity.type,
      title: entity.title,
      description: entity.description,
      mimeType: entity.mimeType,
      version: entity.version,
      createdAt: toIso(entity.createdAt),
      updatedAt: toIso(entity.updatedAt),
    };
  }
}
