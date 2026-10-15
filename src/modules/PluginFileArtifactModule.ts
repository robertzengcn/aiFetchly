import { log } from "@/modules/Logger";
import {
  PluginFileArtifactService,
  getPluginFileArtifactService,
  type RegisteredPluginArtifact,
} from "@/service/PluginFileArtifactService";

/**
 * PluginFileArtifactModule — the Model/Module boundary for the host-owned
 * plugin artifact store (design §13.4). IPC handlers call this module; it
 * enforces conversation ownership before any read, preview, export, or
 * delete. A request id is a reference, never authorization.
 *
 * No TypeORM repository is touched — v1 persistence is host-owned JSON
 * files/metadata (PRD: no plugin database access, no new Yellow Pages
 * entities).
 */
export class PluginFileArtifactModule {
  private readonly service: PluginFileArtifactService;

  constructor(service?: PluginFileArtifactService) {
    this.service = service ?? getPluginFileArtifactService();
  }

  public async listForConversation(
    conversationId: string
  ): Promise<RegisteredPluginArtifact[]> {
    return this.service.listForConversation(conversationId);
  }

  public async preview(
    conversationId: string,
    artifactId: string,
    maxRows?: number
  ): Promise<{ ok: true; format: "json" | "csv"; rows: string } | { ok: false; error: string }> {
    return this.service.preview(conversationId, artifactId, maxRows);
  }

  public async exportToPath(
    conversationId: string,
    artifactId: string,
    destination: string
  ): Promise<{ ok: true; sizeBytes: number } | { ok: false; error: string }> {
    return this.service.exportToPath(conversationId, artifactId, destination);
  }

  public async delete(
    conversationId: string,
    artifactId: string
  ): Promise<{ ok: boolean; error?: string }> {
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
