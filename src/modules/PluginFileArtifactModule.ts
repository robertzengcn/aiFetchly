import { log } from "@/modules/Logger";
import {
  PluginFileArtifactService,
  getPluginFileArtifactService,
  type RegisteredPluginArtifact,
} from "@/service/PluginFileArtifactService";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";

/**
 * PluginFileArtifactModule — the Model/Module boundary for the host-owned
 * plugin artifact store (design §13.4). IPC handlers call this module; it
 *
 *  1. resolves conversation ownership SERVER-SIDE: a renderer-supplied
   * conversation id must exist in the authenticated user's database before
   * any list/preview/export/delete operation is executed (B09 — a matching id
   * string is a reference, never authorization), and
 *  2. delegates to a PluginFileArtifactService whose root is derived from the
 *     authenticated host identity (account-scoped store; see the service's
 *     `resolvePluginArtifactScopeId`).
 *
 * No TypeORM repository is touched directly — persistence is host-owned
 * JSON files/metadata plus the existing conversation modules.
 */
export class PluginFileArtifactModule {
  private readonly service: PluginFileArtifactService;
  private readonly conversationLookup?:
    | ((conversationId: string) => Promise<boolean>)
    | undefined;

  constructor(
    service?: PluginFileArtifactService,
    conversationLookup?: (conversationId: string) => Promise<boolean>
  ) {
    this.service = service ?? getPluginFileArtifactService();
    this.conversationLookup = conversationLookup;
  }

  /**
   * Verify, against host-owned state, that the requested conversation exists
   * for the signed-in user. Unknown/foreign conversation ids are rejected
   * before any file an operation is performed (B09 done-when: foreign
   * conversation list/preview/export/delete are denied even with valid ids).
   */
  private async assertConversationOwned(conversationId: string): Promise<void> {
    const trimmed = conversationId.trim();
    if (trimmed.length === 0 || trimmed.length > 200) {
      throw new Error("Invalid conversation id for plugin artifacts.");
    }
    if (this.conversationLookup) {
      const owned = await this.conversationLookup(trimmed);
      if (!owned) {
        throw new Error("Conversation not found for plugin artifacts.");
      }
      return;
    }
    const conversations = new AIChatConversationModule();
    try {
      const projection = await conversations.getConversationProjection(trimmed);
      if (projection) return;
    } catch (e) {
      log.warn(
        `[PluginFileArtifactModule] conversation projection lookup failed: ${String(e)}`
      );
    }
    // Projection rows are backfilled lazily; fall back to message presence
    // so an existing conversation is not denied on a migration edge.
    let messageCount = 0;
    try {
      messageCount = (await new AIChatV2Module().getConversationMessages(trimmed))
        .length;
    } catch {
      messageCount = 0;
    }
    if (messageCount === 0) {
      throw new Error("Conversation not found for plugin artifacts.");
    }
  }

  public async listForConversation(
    conversationId: string
  ): Promise<RegisteredPluginArtifact[]> {
    await this.assertConversationOwned(conversationId);
    return this.service.listForConversation(conversationId);
  }

  public async preview(
    conversationId: string,
    artifactId: string,
    maxRows?: number
  ): Promise<
    | { ok: true; format: "json" | "csv"; rows: string; truncated: boolean }
    | { ok: false; error: string }
  > {
    await this.assertConversationOwned(conversationId);
    return this.service.preview(conversationId, artifactId, maxRows);
  }

  public async exportToPath(
    conversationId: string,
    artifactId: string,
    destination: string
  ): Promise<{ ok: true; sizeBytes: number } | { ok: false; error: string }> {
    await this.assertConversationOwned(conversationId);
    return this.service.exportToPath(conversationId, artifactId, destination);
  }

  public async delete(
    conversationId: string,
    artifactId: string
  ): Promise<{ ok: boolean; error?: string }> {
    await this.assertConversationOwned(conversationId);
    return this.service.delete(conversationId, artifactId);
  }

  /** Startup retention sweep — safe to call repeatedly. */
  public async sweepExpired(): Promise<number> {
    return this.service.sweepExpired();
  }
}

/** Lazily log-guarded startup hook used by the IPC registration path. */
export async function initializePluginArtifactStore(): Promise<void> {
  try {
    const module = new PluginFileArtifactModule();
    const removed = await module.sweepExpired();
    if (removed > 0) {
      log.info(`[PluginFileArtifactModule] expired ${removed} artifact(s)`);
    }
  } catch (e) {
    log.warn(
      `[PluginFileArtifactModule] startup sweep failed: ${String(e)}`
    );
  }
}
