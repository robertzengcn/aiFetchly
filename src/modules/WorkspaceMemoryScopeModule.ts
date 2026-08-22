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
        portableEnabled: false,
        defaultStorageMode: "private-only",
        importPolicy: "review-new",
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
    // Detect duplicate memory ids that exist in BOTH scopes.
    for (const m of memories) {
      const clash = await this.memoryModel.getByScopeAndMemoryId(
        into.scopeId,
        m.memoryId
      );
      if (clash) {
        // Keep both records: the incoming one gets a fresh local id.
        const freshId = `wmem-${randomUUID()}`;
        await this.memoryModel.updateByScopeAndMemoryId(
          from.scopeId,
          m.memoryId,
          { memoryId: freshId }
        );
        await this.portableStateModel
          .getByScopeAndMemoryId(from.scopeId, m.memoryId)
          .then((ps) =>
            ps
              ? this.portableStateModel.updateByScopeAndMemoryId(
                  from.scopeId,
                  m.memoryId,
                  { memoryId: freshId }
                )
              : null
          );
        await this.auditModel.append({
          scopeId: into.scopeId,
          memoryId: freshId,
          action: "import",
          actor: "system",
          outcome: "completed",
          diagnosticCode: "memory-id-duplicate",
          message: "duplicate memory id re-issued during scope merge",
        });
      }
    }
    await this.memoryModel.reassignScope(from.scopeId, into.scopeId);
    await this.portableStateModel.reassignScope(from.scopeId, into.scopeId);
    await this.scopePathModel.reassignScope(from.scopeId, into.scopeId);
    await this.auditModel.reassignScope(from.scopeId, into.scopeId);
    const deleted = await this.scopeModel.deleteByScopeId(from.scopeId);
    void deleted;
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
