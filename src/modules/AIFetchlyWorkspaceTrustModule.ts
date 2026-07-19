// src/modules/AIFetchlyWorkspaceTrustModule.ts
// Phase 17-01 (TRS-02 / D-Migration) — public CRUD + one-time migration seed
// for the persisted per-capability workspace trust entity. Mirrors the
// AgentDefinitionModule pattern (extends BaseModule, delegates to a Model).
import { BaseModule } from "@/modules/baseModule";
import {
  AIFetchlyWorkspaceTrustModel,
  computeWorkspaceRootHash,
  entityToTrust,
} from "@/model/AIFetchlyWorkspaceTrust.model";
import { WorkspaceEntity } from "@/entity/Workspace.entity";
import { Repository } from "typeorm";
import type { AIFetchlySourceTrust } from "@/entityTypes/aifetchlyConfigTypes";

/** A trust row surfaced for diagnostics / status UI. */
export interface AIFetchlyWorkspaceTrustView {
  readonly workspaceRootHash: string;
  readonly workspaceRootPath: string;
  readonly conversationId: string | null;
  readonly trust: AIFetchlySourceTrust;
}

/** All five flags true — the value the migration seed writes (D-Migration). */
const ALL_TRUSTED: AIFetchlySourceTrust = Object.freeze({
  instructions: true,
  commands: true,
  agents: true,
  hooks: true,
  skills: true,
});

export class AIFetchlyWorkspaceTrustModule extends BaseModule {
  private readonly model: AIFetchlyWorkspaceTrustModel;
  private readonly workspaceRepo: Repository<WorkspaceEntity>;

  constructor() {
    super(); // BaseModule resolves this.dbpath from the Token service.
    this.model = new AIFetchlyWorkspaceTrustModel(this.dbpath);
    // The migration seed reads approved workspaces from the existing
    // WorkspaceEntity table (one-time cross-entity read; the plan authorizes
    // querying this repository directly rather than via WorkspaceModel).
    this.workspaceRepo =
      this.sqliteDb.connection.getRepository(WorkspaceEntity);
  }

  /**
   * Read trust for a workspace root hash. Returns null when no row exists —
   * callers treat null as all-false (fail-closed, T-17-02).
   */
  async getTrust(rootHash: string): Promise<AIFetchlySourceTrust | null> {
    await this.ensureConnection();
    const entity = await this.model.getByRootHash(rootHash);
    return entity ? entityToTrust(entity) : null;
  }

  /**
   * Persist trust flags for a workspace root hash (upsert by hash).
   */
  async setTrust(
    rootHash: string,
    rootPath: string,
    flags: AIFetchlySourceTrust,
    conversationId: string | null = null
  ): Promise<void> {
    await this.ensureConnection();
    await this.model.upsert(rootHash, rootPath, flags, conversationId);
  }

  /** All persisted trust rows (defensive copies). */
  async listAll(): Promise<AIFetchlyWorkspaceTrustView[]> {
    await this.ensureConnection();
    const rows = await this.model.listAll();
    return rows.map((e) => ({
      workspaceRootHash: e.workspaceRootHash,
      workspaceRootPath: e.workspaceRootPath,
      conversationId: e.conversationId,
      trust: entityToTrust(e),
    }));
  }

  /**
   * One-time idempotent migration seed (D-Migration / T-17-01).
   *
   * Backfills every already-approved WorkspaceEntity (approvalState='approved')
   * to an all-true AIFetchlyWorkspaceTrust row keyed by the normalized-root
   * SHA-256 hash. Re-running is a no-op for already-seeded hashes, and a
   * revoked workspace (approvalState != 'approved') is never seeded here, so
   * the seed can never escalate trust on a workspace the user has since
   * revoked (Pitfall 2 — revoke reflection is Plan 02's runtime job).
   */
  async ensureMigrationSeed(): Promise<void> {
    await this.ensureConnection();
    const approved = await this.workspaceRepo.find({
      where: { approvalState: "approved" },
    });
    for (const ws of approved) {
      const hash = computeWorkspaceRootHash(ws.rootPath);
      // Idempotent: only insert when no trust row yet exists for this hash.
      const existing = await this.model.getByRootHash(hash);
      if (existing) continue;
      await this.model.upsert(hash, ws.rootPath, ALL_TRUSTED, ws.conversationId);
    }
  }
}
