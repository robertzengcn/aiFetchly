import { log } from "@/modules/Logger";
import {
  PluginFileArtifactService,
  getPluginFileArtifactService,
  type RegisteredPluginArtifact,
  type PluginExecutionJournalState,
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

  /**
   * G03: execution journals for a conversation (interrupted-but-real
   * executions the UI must surface). Ownership first, then the journal dir.
   */
  public async listExecutionJournals(
    conversationId: string
  ): Promise<PluginExecutionJournalState[]> {
    await this.assertConversationOwned(conversationId);
    return this.service.listJournalStatesForConversation(conversationId);
  }

  /**
   * G03: after a plugin is uninstalled its existing artifacts adopt a much
   * shorter retention window. Best-effort: uninstall never fails because
   * retention bookkeeping hiccuped.
   */
  public async applyPluginUninstallRetention(
    pluginName: string
  ): Promise<number> {
    try {
      return this.service.applyPluginUninstallRetention(pluginName);
    } catch (e) {
      log.warn(
        `[PluginFileArtifactModule] uninstall retention failed for ${pluginName}: ${String(e)}`
      );
      return 0;
    }
  }

  /** Startup retention sweep — safe to call repeatedly. */
  public async sweepExpired(): Promise<number> {
    return this.service.sweepExpired();
  }

  /**
   * B12: conversation deletion cascade — remove every promoted artifact
   * owned by the conversation. Best-effort (storage failure never blocks
   * the conversation deletion itself); the failed artifacts stay expirable
   * by the periodic sweep.
   */
  public async removeForConversation(conversationId: string): Promise<number> {
    try {
      return this.service.removeForConversation(conversationId);
    } catch (e) {
      log.warn(
        `[PluginFileArtifactModule] conversation artifact removal failed: ${String(e)}`
      );
      return 0;
    }
  }
}

/**
 * Lazily log-guarded startup hook used by the IPC registration path.
 * B12: also installs the process-wide periodic retention sweep so expiry
 * runs while the app stays open. The singleton guard keeps repeated calls
 * (e.g. background.ts + IPC init) from stacking intervals; the interval is
 * unref'd so it never keeps the process alive.
 */
export const PLUGIN_ARTIFACT_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

let periodicSweepInterval: ReturnType<typeof setInterval> | null = null;

export async function initializePluginArtifactStore(): Promise<void> {
  const runSweep = async (): Promise<void> => {
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
  };

  await runSweep();

  if (periodicSweepInterval === null) {
    periodicSweepInterval = setInterval(() => {
      void runSweep();
    }, PLUGIN_ARTIFACT_SWEEP_INTERVAL_MS);
    periodicSweepInterval.unref?.();
  }
}

/** Test hook: clears the singleton periodic-sweep guard. */
export function resetPluginArtifactSweepForTest(): void {
  if (periodicSweepInterval !== null) {
    clearInterval(periodicSweepInterval);
    periodicSweepInterval = null;
  }
}
