// src/model/AIFetchlyWorkspaceTrust.model.ts
// Phase 17-01 (TRS-02) — data-access layer for the persisted per-capability
// workspace trust entity. Mirrors the AgentDefinition.model.ts pattern
// (extends BaseDb, public repository, async upsert/get/list methods).
import * as crypto from "crypto";
import * as path from "path";
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AIFetchlyWorkspaceTrustEntity } from "@/entity/AIFetchlyWorkspaceTrust.entity";
import type { AIFetchlySourceTrust } from "@/entityTypes/aifetchlyConfigTypes";

/**
 * Normalize a workspace root path before hashing so the same logical root
 * always produces the same {@link computeWorkspaceRootHash} regardless of
 * trailing separators or intermediate `.`/`..` segments.
 *
 * Symlink/case resolution is intentionally NOT performed here: the stored
 * {@link WorkspaceEntity.rootPath} is the canonical path the runtime resolver
 * returns verbatim (WorkspaceResolver.resolve -> record.rootPath), so hashing
 * it as-stored keeps the trust key consistent with the resolver's view (A1
 * resolved). Plan 02's trust cache lookup reuses this exact helper.
 */
export function normalizeWorkspaceRoot(rootPath: string): string {
  if (!rootPath) return "";
  // path.normalize collapses "."/".." and duplicate separators but does NOT
  // remove a single trailing separator, so "/x" and "/x/" would otherwise
  // hash to different keys. Strip trailing separators (preserving the root
  // "/") so the trust key is stable regardless of trailing slash (A1) and
  // stays consistent with runtime resolver lookups.
  let normalized = path.normalize(rootPath);
  while (normalized.length > 1 && normalized.endsWith(path.sep)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Stable SHA-256 hex digest of the normalized workspace root path (A1).
 * The unique key for {@link AIFetchlyWorkspaceTrustEntity} rows so trust
 * survives DB reloads (SC3) and is stable across path moves. NOT for secrecy
 * — the plaintext rootPath is also stored for UX (T-17-03 accept).
 */
export function computeWorkspaceRootHash(rootPath: string): string {
  return crypto
    .createHash("sha256")
    .update(normalizeWorkspaceRoot(rootPath))
    .digest("hex");
}

/** Map a trust entity row to the {@link AIFetchlySourceTrust} interface. */
export function entityToTrust(
  e: AIFetchlyWorkspaceTrustEntity
): AIFetchlySourceTrust {
  return {
    instructions: e.trustInstructions,
    commands: e.trustCommands,
    agents: e.trustAgents,
    hooks: e.trustHooks,
    skills: e.trustSkills,
  };
}

/** Throws if the model is constructed/used inside a worker process. */
function assertNotWorker(label: string): void {
  if (process.env.WORKER_TYPE) {
    throw new Error(
      `Direct database access from worker process is not allowed (${label}). ` +
        "Worker should send data to main process via IPC."
    );
  }
}

export class AIFetchlyWorkspaceTrustModel extends BaseDb {
  public repository: Repository<AIFetchlyWorkspaceTrustEntity>;

  constructor(dbpath: string) {
    // Guard before touching the connection — this model is main-process only
    // (CLAUDE.md worker-no-DB rule). The constructor reads process.env only,
    // never `this`, so it is safe ahead of super().
    assertNotWorker("AIFetchlyWorkspaceTrustModel");
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIFetchlyWorkspaceTrustEntity
    );
  }

  /**
   * Upsert a trust row keyed by {@link rootHash}. On conflict the existing
   * row is updated in place (no duplicate, no throw).
   */
  async upsert(
    rootHash: string,
    rootPath: string,
    flags: AIFetchlySourceTrust,
    conversationId: string | null = null
  ): Promise<void> {
    assertNotWorker("AIFetchlyWorkspaceTrustModel.upsert");
    const existing = await this.repository.findOne({
      where: { workspaceRootHash: rootHash },
    });
    const merged: Partial<AIFetchlyWorkspaceTrustEntity> = {
      workspaceRootHash: rootHash,
      workspaceRootPath: rootPath,
      conversationId,
      trustInstructions: flags.instructions,
      trustCommands: flags.commands,
      trustAgents: flags.agents,
      trustHooks: flags.hooks,
      trustSkills: flags.skills,
    };
    if (existing) {
      await this.repository.save({ ...existing, ...merged });
    } else {
      await this.repository.save(merged as AIFetchlyWorkspaceTrustEntity);
    }
  }

  async getByRootHash(
    rootHash: string
  ): Promise<AIFetchlyWorkspaceTrustEntity | null> {
    assertNotWorker("AIFetchlyWorkspaceTrustModel.getByRootHash");
    return this.repository.findOne({ where: { workspaceRootHash: rootHash } });
  }

  async listAll(): Promise<AIFetchlyWorkspaceTrustEntity[]> {
    assertNotWorker("AIFetchlyWorkspaceTrustModel.listAll");
    return this.repository.find();
  }
}
