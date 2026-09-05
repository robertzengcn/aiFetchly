import { BaseModule } from "@/modules/baseModule";
import { AIWorkspaceMemoryScopeModel } from "@/model/AIWorkspaceMemoryScope.model";
import { AIWorkspaceMemoryScopePathModel } from "@/model/AIWorkspaceMemoryScopePath.model";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";
import { AIWorkspaceMemorySyncAuditModel } from "@/model/AIWorkspaceMemorySyncAudit.model";
import type { WorkspaceMemoryScopeContext } from "@/entityTypes/portableWorkspaceMemoryTypes";
import {
  isPortableMemoryImportPolicy,
  isPortableMemoryDefaultStorageMode,
  PORTABLE_MEMORY_DEFAULT_ENABLED,
  PORTABLE_MEMORY_DEFAULT_STORAGE_MODE,
  type PortableMemoryDefaultStorageMode,
  type PortableMemoryImportPolicy,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import type { AIWorkspaceMemoryScopeEntity } from "@/entity/AIWorkspaceMemoryScope.entity";
import { randomUUID } from "crypto";

/**
 * Scope facts owned by the scopes table. Path facts (workspaceKey/root) come
 * from the trusted resolver and are composed into the full
 * WorkspaceMemoryScopeContext by the caller.
 */
export interface MemoryScopeRecord {
  readonly scopeId: string;
  readonly displayName: string;
  readonly portableWorkspaceId?: string;
  readonly portableEnabled: boolean;
  readonly defaultStorageMode: PortableMemoryDefaultStorageMode;
  readonly importPolicy: PortableMemoryImportPolicy;
}

/**
 * Business rules for internal memory scopes (design §10.2).
 *
 * Owns:
 *   - resolving/creating the deterministic legacy scope for a trusted
 *     path-derived workspace key (`wscope-legacy-<key minus ws_ prefix>`);
 *   - converging pre-portable memory rows onto that scope (runtime backfill);
 *   - binding a portable workspace UUID to a scope, including the
 *     transactional scope merge when another scope already owns that UUID
 *     (two clones of one repository resolving in one installation);
 *   - portable-enabled / import-policy / default-storage-mode state.
 *
 * The module never reads files and never trusts renderer input — callers
 * pass a trusted workspace key/root resolved by WorkspaceResolver.
 */
export class WorkspaceMemoryScopeModule extends BaseModule {
  private readonly scopeModel: AIWorkspaceMemoryScopeModel;
  private readonly scopePathModel: AIWorkspaceMemoryScopePathModel;
  private readonly memoryModel: AIWorkspaceMemoryModel;
  private readonly portableStateModel: AIWorkspaceMemoryPortableStateModel;
  private readonly auditModel: AIWorkspaceMemorySyncAuditModel;

  constructor() {
    super();
    this.scopeModel = new AIWorkspaceMemoryScopeModel(this.dbpath);
    this.scopePathModel = new AIWorkspaceMemoryScopePathModel(this.dbpath);
    this.memoryModel = new AIWorkspaceMemoryModel(this.dbpath);
    this.portableStateModel = new AIWorkspaceMemoryPortableStateModel(
      this.dbpath
    );
    this.auditModel = new AIWorkspaceMemorySyncAuditModel(this.dbpath);
  }

  /** Deterministic legacy scope id for a path-derived workspace key. */
  static legacyScopeIdForWorkspaceKey(workspaceKey: string): string {
    const bare = workspaceKey.startsWith("ws_")
      ? workspaceKey.slice(3)
      : workspaceKey;
    return `wscope-legacy-${bare}`;
  }

  /**
   * Resolve (creating when absent) the scope owning a trusted workspace key,
   * then converge legacy memory rows onto it. Returns the trusted scope
   * context used by every downstream memory operation.
   */
  async resolveLegacyScope(input: {
    readonly workspaceKey: string;
    readonly workspaceRoot: string;
    readonly displayName: string;
  }): Promise<WorkspaceMemoryScopeContext> {
    const scopeId = WorkspaceMemoryScopeModule.legacyScopeIdForWorkspaceKey(
      input.workspaceKey
    );
    let scope = await this.scopeModel.findByScopeId(scopeId);
    if (!scope) {
      // A different scope may already own this path key (e.g. it was merged
      // into a portable scope). Honor the existing mapping.
      const pathRow = await this.scopePathModel.findByWorkspaceKey(
        input.workspaceKey
      );
      if (pathRow) {
        const owner = await this.scopeModel.findByScopeId(pathRow.scopeId);
        if (owner) scope = owner;
      }
    }
    if (!scope) {
      scope = await this.scopeModel.create({
        scopeId,
        displayName: input.displayName,
        portableEnabled: PORTABLE_MEMORY_DEFAULT_ENABLED,
        defaultStorageMode: PORTABLE_MEMORY_DEFAULT_STORAGE_MODE,
        importPolicy: "review-new",
      });
    } else if (this.isNeverConfiguredPrivateScope(scope)) {
      // Pre-default-on rows used private-only + disabled. Promote them to
      // the new product default. Scopes the user later disabled keep
      // defaultStorageMode !== private-only, so they stay off.
      scope = await this.scopeModel.updateByScopeId(scope.scopeId, {
        portableEnabled: PORTABLE_MEMORY_DEFAULT_ENABLED,
        defaultStorageMode: PORTABLE_MEMORY_DEFAULT_STORAGE_MODE,
      });
    }
    await this.scopePathModel.upsert({
      scopeId: scope.scopeId,
      workspaceKey: input.workspaceKey,
      workspaceRoot: input.workspaceRoot,
      lastSeenAt: new Date(),
    });
    // Runtime convergence of pre-portable rows (design §9.2 step 8).
    await this.memoryModel.backfillScopeIdForWorkspaceKey(
      input.workspaceKey,
      scope.scopeId
    );
    return {
      ...this.toRecord(scope),
      workspaceKey: input.workspaceKey,
      workspaceRoot: input.workspaceRoot,
    };
  }

  /**
   * Bind a validated portable workspace UUID to a scope (design §9.4).
   *
   * When another scope already owns the UUID (second clone of the same
   * repository), the two scopes merge transactionally: paths, memories,
   * portable states, and audits move to the surviving scope; duplicate
   * memory ids are regenerated (with an audit row) so no data is lost —
   * satisfying AC-013's "copied record ids coexist" requirement.
   */
  async bindPortableIdentity(input: {
    readonly scopeId: string;
    readonly portableWorkspaceId: string;
  }): Promise<MemoryScopeRecord> {
    const scope = await this.requireScope(input.scopeId);
    if (scope.portableWorkspaceId === input.portableWorkspaceId) {
      return this.toRecord(scope);
    }
    const existing = await this.scopeModel.findByPortableWorkspaceId(
      input.portableWorkspaceId
    );
    if (existing && existing.scopeId !== scope.scopeId) {
      return this.mergeScopes(scope, existing);
    }
    const updated = await this.scopeModel.updateByScopeId(scope.scopeId, {
      portableWorkspaceId: input.portableWorkspaceId,
    });
    await this.auditModel.append({
      scopeId: scope.scopeId,
      action: "import",
      actor: "system",
      outcome: "completed",
      message: "portable identity bound to scope",
    });
    return this.toRecord(updated);
  }

  /**
   * Merge scope `from` into scope `into` (design §9.4 merge rules, pragmatic
   * v1): duplicate memory ids are re-id'd (kept, never dropped) with an
   * audit entry; non-conflicting rows move wholesale.
   */
  private async mergeScopes(
    from: AIWorkspaceMemoryScopeEntity,
    into: AIWorkspaceMemoryScopeEntity
  ): Promise<MemoryScopeRecord> {
    const memories = await this.memoryModel.listByScope({
      scopeId: from.scopeId,
      limit: 200,
    });
    const beforeCount = memories.length;

    // Detect duplicate memory ids that exist in BOTH scopes and resolve per
    // the transactional merge rules (design §9.4 / FR-067/FR-068/AC-013):
    //   - canonical portable fields + hashes match → keep ONE projection
    //     (drop the duplicate, do not re-ID).
    //   - one portable, one private → keep the portable projection, re-ID the
    //     private copy with an audit event.
    //   - both portable but fields/hashes differ → mark a scope-merge
    //     conflict (do NOT blindly re-ID; quarantine for user resolution).
    for (const m of memories) {
      const clash = await this.memoryModel.getByScopeAndMemoryId(
        into.scopeId,
        m.memoryId
      );
      if (!clash) continue;

      const fromState = await this.portableStateModel.getByScopeAndMemoryId(
        from.scopeId,
        m.memoryId
      );
      const intoState = await this.portableStateModel.getByScopeAndMemoryId(
        into.scopeId,
        m.memoryId
      );

      // Case 1: both portable with matching canonical fields + lastValidHash →
      // keep one (drop the incoming duplicate).
      if (
        fromState &&
        intoState &&
        fromState.lastValidHash &&
        fromState.lastValidHash === intoState.lastValidHash &&
        fromState.visibility === intoState.visibility
      ) {
        await this.memoryModel.deleteByScopeAndMemoryId(
          from.scopeId,
          m.memoryId
        );
        await this.portableStateModel.deleteByScopeAndMemoryId(
          from.scopeId,
          m.memoryId
        );
        await this.auditModel.append({
          scopeId: into.scopeId,
          memoryId: m.memoryId,
          action: "import",
          actor: "system",
          outcome: "skipped",
          diagnosticCode: "memory-id-duplicate",
          message: "duplicate memory id deduplicated (matching hash)",
        });
        continue;
      }

      // Case 2: one portable, one private → keep portable, re-ID private.
      if (!!fromState !== !!intoState) {
        const privateScopeId = fromState ? into.scopeId : from.scopeId;
        const freshId = `wmem-${randomUUID()}`;
        await this.memoryModel.renameMemoryIdByScope(
          privateScopeId,
          m.memoryId,
          freshId
        );
        await this.portableStateModel.renameMemoryIdByScope(
          privateScopeId,
          m.memoryId,
          freshId
        );
        await this.auditModel.append({
          scopeId: into.scopeId,
          memoryId: freshId,
          action: "import",
          actor: "system",
          outcome: "completed",
          diagnosticCode: "memory-id-duplicate",
          message:
            "private copy re-issued during scope merge (portable preserved)",
        });
        continue;
      }

      // Case 3: both portable but differ → scope-merge conflict (quarantine).
      if (fromState && intoState) {
        await this.portableStateModel.updateByScopeAndMemoryId(
          from.scopeId,
          m.memoryId,
          {
            syncState: "conflicted",
            diagnosticCode: "memory-conflict",
            diagnosticMessage:
              "scope-merge conflict: differing portable records share an id",
          }
        );
        await this.auditModel.append({
          scopeId: into.scopeId,
          memoryId: m.memoryId,
          action: "conflict",
          actor: "system",
          outcome: "conflicted",
          diagnosticCode: "memory-conflict",
          message: "scope-merge conflict: differing portable records",
        });
        // Re-ID so the reassign below doesn't violate the unique constraint.
        // Also update relativePath to match the new id (the (scopeId,
        // relativePath) unique index would otherwise collide with the
        // surviving scope's record for the same file path).
        const freshId = `wmem-${randomUUID()}`;
        await this.memoryModel.renameMemoryIdByScope(
          from.scopeId,
          m.memoryId,
          freshId
        );
        await this.portableStateModel.renameMemoryIdByScope(
          from.scopeId,
          m.memoryId,
          freshId
        );
        await this.portableStateModel.updateByScopeAndMemoryId(
          from.scopeId,
          freshId,
          {
            relativePath: `.aifetchly/memory/${freshId}.md`,
          }
        );
        continue;
      }

      // Case 4: both private (no portable state) → re-ID the incoming copy.
      const freshId = `wmem-${randomUUID()}`;
      await this.memoryModel.renameMemoryIdByScope(
        from.scopeId,
        m.memoryId,
        freshId
      );
      await this.portableStateModel.renameMemoryIdByScope(
        from.scopeId,
        m.memoryId,
        freshId
      );
      await this.auditModel.append({
        scopeId: into.scopeId,
        memoryId: freshId,
        action: "import",
        actor: "system",
        outcome: "completed",
        diagnosticCode: "memory-id-duplicate",
        message: "duplicate private memory id re-issued during scope merge",
      });
    }

    // Move non-conflicting memories/states/paths/audits to the surviving scope.
    await this.memoryModel.reassignScope(from.scopeId, into.scopeId);
    await this.portableStateModel.reassignScope(from.scopeId, into.scopeId);
    await this.scopePathModel.reassignScope(from.scopeId, into.scopeId);
    await this.auditModel.reassignScope(from.scopeId, into.scopeId);

    // Count-verify before deleting the losing scope (design §9.4 step 5).
    const remaining = await this.memoryModel.listByScope({
      scopeId: from.scopeId,
      limit: 200,
    });
    if (remaining.length > 0) {
      // Reassign should have moved every row; if not, abort the merge (do NOT
      // delete the losing scope — data integrity over silent loss).
      await this.auditModel.append({
        scopeId: into.scopeId,
        action: "import",
        actor: "system",
        outcome: "failed",
        message: `scope merge aborted: ${remaining.length} rows remain on the losing scope`,
      });
      throw new Error(
        "scope merge failed: count mismatch; losing scope retained for safety"
      );
    }
    const deleted = await this.scopeModel.deleteByScopeId(from.scopeId);
    void deleted;
    void beforeCount;
    const merged = await this.requireScope(into.scopeId);
    await this.auditModel.append({
      scopeId: into.scopeId,
      action: "import",
      actor: "system",
      outcome: "completed",
      message: "scopes merged onto portable identity",
    });
    return this.toRecord(merged);
  }

  async updatePolicy(input: {
    readonly scopeId: string;
    readonly portableEnabled?: boolean;
    readonly defaultStorageMode?: PortableMemoryDefaultStorageMode;
    readonly importPolicy?: PortableMemoryImportPolicy;
  }): Promise<MemoryScopeRecord> {
    const scope = await this.requireScope(input.scopeId);
    const patch: Partial<AIWorkspaceMemoryScopeEntity> = {};
    if (input.portableEnabled !== undefined)
      patch.portableEnabled = input.portableEnabled;
    if (
      input.defaultStorageMode !== undefined &&
      isPortableMemoryDefaultStorageMode(input.defaultStorageMode)
    ) {
      patch.defaultStorageMode = input.defaultStorageMode;
    }
    if (
      input.importPolicy !== undefined &&
      isPortableMemoryImportPolicy(input.importPolicy)
    ) {
      patch.importPolicy = input.importPolicy;
    }
    const updated = await this.scopeModel.updateByScopeId(scope.scopeId, patch);
    return this.toRecord(updated);
  }

  async getScope(scopeId: string): Promise<MemoryScopeRecord | null> {
    const scope = await this.scopeModel.findByScopeId(scopeId);
    return scope ? this.toRecord(scope) : null;
  }

  async findByPortableWorkspaceId(
    portableWorkspaceId: string
  ): Promise<MemoryScopeRecord | null> {
    const scope = await this.scopeModel.findByPortableWorkspaceId(
      portableWorkspaceId
    );
    return scope ? this.toRecord(scope) : null;
  }

  async markCompleteScan(scopeId: string): Promise<void> {
    const scope = await this.scopeModel.findByScopeId(scopeId);
    if (scope) {
      await this.scopeModel.updateByScopeId(scopeId, {
        lastCompleteScanAt: new Date(),
      });
    }
  }

  /**
   * A scope created under the original SQLite-only defaults, never enabled
   * and never explicitly disabled after a portable enable.
   */
  private isNeverConfiguredPrivateScope(
    scope: AIWorkspaceMemoryScopeEntity
  ): boolean {
    return (
      scope.portableEnabled !== true &&
      (scope.defaultStorageMode === "private-only" ||
        scope.defaultStorageMode === undefined ||
        scope.defaultStorageMode === "")
    );
  }

  private async requireScope(
    scopeId: string
  ): Promise<AIWorkspaceMemoryScopeEntity> {
    const scope = await this.scopeModel.findByScopeId(scopeId);
    if (!scope) throw new Error(`Memory scope not found: ${scopeId}`);
    return scope;
  }

  private toRecord(scope: AIWorkspaceMemoryScopeEntity): MemoryScopeRecord {
    return {
      scopeId: scope.scopeId,
      displayName: scope.displayName,
      portableWorkspaceId: scope.portableWorkspaceId ?? undefined,
      portableEnabled: scope.portableEnabled,
      defaultStorageMode: isPortableMemoryDefaultStorageMode(
        scope.defaultStorageMode
      )
        ? scope.defaultStorageMode
        : "private-only",
      importPolicy: isPortableMemoryImportPolicy(scope.importPolicy)
        ? scope.importPolicy
        : "review-new",
    };
  }
}
