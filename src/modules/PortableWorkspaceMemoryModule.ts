import { BaseModule } from "@/modules/baseModule";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";
import { AIWorkspaceMemorySyncAuditModel } from "@/model/AIWorkspaceMemorySyncAudit.model";
import type {
  PortableMemoryDiagnosticView,
  PortableMemoryDocumentV1,
  PortableMemoryImportPolicy,
  PortableMemorySyncState,
  WorkspaceMemoryScopeContext,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import { randomUUID } from "crypto";

/**
 * Portable storage business rules (design §10.4).
 *
 * Coordinates the SQLite projection for portable records: upserting validated
 * documents, retaining the last valid projection after rejections, conflict
 * and missing-file state machines, promotion of private records, and
 * sanitized audit rows. It performs NO filesystem I/O — the sync coordinator
 * and PortableWorkspaceMemoryService own file stores.
 */

export interface PortableUpsertContext {
  readonly actor: "user" | "aifetchly" | "external" | "import" | "system";
  readonly scanId?: string;
  /** Review policy applied to external creates. */
  readonly pendingReview: boolean;
}

export interface PortableRejectedFileInput {
  readonly relativePath: string;
  readonly memoryId?: string;
  readonly observedHash?: string | null;
  readonly diagnostic: PortableMemoryDiagnosticView;
  readonly scanId?: string;
}

export interface PortableConflictInput {
  readonly memoryId: string;
  readonly relativePath: string;
  readonly message: string;
}

export interface PortableReconcileResult {
  readonly deletedMemoryIds: readonly string[];
  readonly missingMemoryIds: readonly string[];
}

export class PortableWorkspaceMemoryModule extends BaseModule {
  private readonly memoryModel: AIWorkspaceMemoryModel;
  private readonly portableStateModel: AIWorkspaceMemoryPortableStateModel;
  private readonly auditModel: AIWorkspaceMemorySyncAuditModel;

  constructor() {
    super();
    this.memoryModel = new AIWorkspaceMemoryModel(this.dbpath);
    this.portableStateModel = new AIWorkspaceMemoryPortableStateModel(
      this.dbpath
    );
    this.auditModel = new AIWorkspaceMemorySyncAuditModel(this.dbpath);
  }

  /**
   * Upsert a validated portable document: file is authority for portable
   * fields (D-02). Creates or updates the memory projection row AND the
   * portable-state row, then audits. `syncState` becomes `synced` or
   * `pending-review` per the review policy.
   */
  async upsertValidatedDocument(
    scope: WorkspaceMemoryScopeContext,
    document: PortableMemoryDocumentV1,
    input: PortableUpsertContext
  ): Promise<void> {
    const f = document.frontmatter;
    const syncState: PortableMemorySyncState = input.pendingReview
      ? "pending-review"
      : "synced";

    const existing = await this.memoryModel.getByScopeAndMemoryId(
      scope.scopeId,
      f.id
    );
    const previousHash =
      (
        await this.portableStateModel.getByScopeAndMemoryId(scope.scopeId, f.id)
      )?.lastValidHash ?? null;

    if (existing) {
      await this.memoryModel.updateByScopeAndMemoryId(scope.scopeId, f.id, {
        type: f.type,
        title: document.title,
        content: document.content,
        status: f.status,
        confidence: f.confidence,
        scopeId: scope.scopeId,
        workspaceKey: scope.workspaceKey,
        workspaceRoot: scope.workspaceRoot,
      });
    } else {
      await this.memoryModel.create({
        memoryId: f.id,
        scopeId: scope.scopeId,
        workspaceKey: scope.workspaceKey,
        workspaceRoot: scope.workspaceRoot,
        type: f.type,
        title: document.title,
        content: document.content,
        status: f.status,
        confidence: f.confidence,
        sourceKind: f.createdBy === "user" ? "manual" : "auto_dream",
      });
    }

    await this.portableStateModel.upsert({
      scopeId: scope.scopeId,
      memoryId: f.id,
      relativePath: document.relativePath,
      visibility: f.visibility,
      createdBy: f.createdBy,
      portableCreatedAt: new Date(f.createdAt),
      portableUpdatedAt: new Date(f.updatedAt),
      supersedes: f.supersedes ? [...f.supersedes] : null,
      tags: f.tags ? [...f.tags] : null,
      reviewedAt: f.reviewedAt ? new Date(f.reviewedAt) : null,
      reviewedBy: f.reviewedBy ?? null,
      lastValidHash: document.contentHash,
      observedHash: document.contentHash,
      syncState,
      diagnosticCode: null,
      diagnosticMessage: null,
      lastImportedAt: new Date(),
      lastScanId: input.scanId ?? null,
    });

    await this.auditModel.append({
      scopeId: scope.scopeId,
      memoryId: f.id,
      relativePath: document.relativePath,
      action: existing ? "import" : "import",
      actor: input.actor,
      outcome: "completed",
      previousHash,
      nextHash: document.contentHash,
    });
  }

  /**
   * A known-or-unknown file became invalid (D-07): store only path + hashes +
   * sanitized diagnostic. Keep the last valid projection untouched; mark the
   * portable state `rejected` so retrieval excludes the record (fail closed).
   */
  async markRejectedFile(
    scope: WorkspaceMemoryScopeContext,
    input: PortableRejectedFileInput
  ): Promise<void> {
    if (input.memoryId) {
      const state = await this.portableStateModel.getByScopeAndMemoryId(
        scope.scopeId,
        input.memoryId
      );
      if (state) {
        await this.portableStateModel.updateByScopeAndMemoryId(
          scope.scopeId,
          input.memoryId,
          {
            observedHash: input.observedHash ?? state.observedHash,
            syncState: "rejected",
            diagnosticCode: input.diagnostic.code,
            diagnosticMessage: sanitize(input.diagnostic.message),
            lastScanId: input.scanId ?? state.lastScanId,
          }
        );
      }
    }
    await this.auditModel.append({
      scopeId: scope.scopeId,
      memoryId: input.memoryId ?? null,
      relativePath: input.relativePath,
      action: "reject",
      actor: "external",
      outcome: "rejected",
      diagnosticCode: input.diagnostic.code,
      message: sanitize(input.diagnostic.message),
    });
  }

  /** Mark a record conflicted (app edit raced an external edit, §14.6). */
  async markConflict(
    scope: WorkspaceMemoryScopeContext,
    input: PortableConflictInput
  ): Promise<void> {
    // Upsert rather than update: a conflict can be detected on a first write
    // to a scope that has no prior portable-state row yet (the caller read
    // the file directly). Fall back to creating a row with the conflict.
    const existing = await this.portableStateModel.getByScopeAndMemoryId(
      scope.scopeId,
      input.memoryId
    );
    if (existing) {
      await this.portableStateModel.updateByScopeAndMemoryId(
        scope.scopeId,
        input.memoryId,
        {
          syncState: "conflicted",
          diagnosticCode: "memory-conflict",
          diagnosticMessage: sanitize(input.message),
        }
      );
    } else {
      await this.portableStateModel.upsert({
        scopeId: scope.scopeId,
        memoryId: input.memoryId,
        relativePath: input.relativePath,
        visibility: "local",
        createdBy: "external",
        portableCreatedAt: new Date(),
        portableUpdatedAt: new Date(),
        lastValidHash: null,
        observedHash: null,
        syncState: "conflicted",
        diagnosticCode: "memory-conflict",
        diagnosticMessage: sanitize(input.message),
        lastImportedAt: new Date(),
        lastScanId: null,
      });
    }
    await this.auditModel.append({
      scopeId: scope.scopeId,
      memoryId: input.memoryId,
      relativePath: input.relativePath,
      action: "conflict",
      actor: "system",
      outcome: "conflicted",
      diagnosticCode: "memory-conflict",
      message: sanitize(input.message),
    });
  }

  /**
   * Reconcile known portable paths absent from a COMPLETE scan (§14.5).
   * `automatic` deletes projection + state after an audit row; review
   * policies mark `missing` and wait for approval.
   */
  async reconcileMissingPaths(
    scope: WorkspaceMemoryScopeContext,
    seenRelativePaths: ReadonlySet<string>,
    scanId: string,
    policy: PortableMemoryImportPolicy
  ): Promise<PortableReconcileResult> {
    const states = await this.portableStateModel.listByScope(scope.scopeId);
    const deletedMemoryIds: string[] = [];
    const missingMemoryIds: string[] = [];

    for (const state of states) {
      if (seenRelativePaths.has(state.relativePath)) continue;
      if (policy === "automatic") {
        await this.auditModel.append({
          scopeId: scope.scopeId,
          memoryId: state.memoryId,
          relativePath: state.relativePath,
          action: "delete",
          actor: "external",
          outcome: "completed",
          previousHash: state.lastValidHash,
          diagnosticCode: null,
          message: "file absent from complete scan",
        });
        await this.portableStateModel.deleteByScopeAndMemoryId(
          scope.scopeId,
          state.memoryId
        );
        await this.memoryModel.deleteByScopeAndMemoryId(
          scope.scopeId,
          state.memoryId
        );
        deletedMemoryIds.push(state.memoryId);
      } else {
        await this.portableStateModel.updateByScopeAndMemoryId(
          scope.scopeId,
          state.memoryId,
          {
            syncState: "missing",
            diagnosticCode: null,
            diagnosticMessage: "file absent from complete scan; awaiting review",
            lastScanId: scanId,
          }
        );
        missingMemoryIds.push(state.memoryId);
      }
    }
    return { deletedMemoryIds, missingMemoryIds };
  }

  /**
   * Link an existing private memory row to portable state without creating a
   * duplicate logical record (PRD §14.3 step 5 / FR-038).
   */
  async promotePrivateMemory(
    scope: WorkspaceMemoryScopeContext,
    memoryId: string,
    document: PortableMemoryDocumentV1,
    contentHash: string
  ): Promise<void> {
    const existing = await this.memoryModel.getByScopeAndMemoryId(
      scope.scopeId,
      memoryId
    );
    if (!existing) {
      throw new Error(`Workspace memory not found: ${memoryId}`);
    }
    const f = document.frontmatter;
    await this.memoryModel.updateByScopeAndMemoryId(scope.scopeId, memoryId, {
      type: f.type,
      title: document.title,
      content: document.content,
      status: f.status,
      confidence: f.confidence,
    });
    await this.portableStateModel.upsert({
      scopeId: scope.scopeId,
      memoryId,
      relativePath: document.relativePath,
      visibility: f.visibility,
      createdBy: f.createdBy,
      portableCreatedAt: new Date(f.createdAt),
      portableUpdatedAt: new Date(f.updatedAt),
      supersedes: f.supersedes ? [...f.supersedes] : null,
      tags: f.tags ? [...f.tags] : null,
      reviewedAt: null,
      reviewedBy: null,
      lastValidHash: contentHash,
      observedHash: contentHash,
      syncState: "synced",
      diagnosticCode: null,
      diagnosticMessage: null,
      lastImportedAt: new Date(),
      lastScanId: null,
    });
    await this.auditModel.append({
      scopeId: scope.scopeId,
      memoryId,
      relativePath: document.relativePath,
      action: "promote",
      actor: "user",
      outcome: "completed",
      nextHash: contentHash,
    });
  }

  /**
   * Detach a record from portable storage (make private): keep the projection
   * row, delete the portable state (rollback behavior, PRD §19.4).
   */
  async privatizeMemory(
    scope: WorkspaceMemoryScopeContext,
    memoryId: string,
    relativePath: string
  ): Promise<void> {
    await this.portableStateModel.deleteByScopeAndMemoryId(
      scope.scopeId,
      memoryId
    );
    await this.auditModel.append({
      scopeId: scope.scopeId,
      memoryId,
      relativePath,
      action: "privatize",
      actor: "user",
      outcome: "completed",
    });
  }

  /** Approve a pending-review external record into `synced`. */
  async approvePendingReview(
    scope: WorkspaceMemoryScopeContext,
    memoryId: string
  ): Promise<void> {
    await this.portableStateModel.updateByScopeAndMemoryId(
      scope.scopeId,
      memoryId,
      {
        syncState: "synced",
        diagnosticCode: null,
        diagnosticMessage: null,
      }
    );
    await this.auditModel.append({
      scopeId: scope.scopeId,
      memoryId,
      action: "resolve",
      actor: "user",
      outcome: "completed",
    });
  }

  /**
   * Clear a conflict after the user chose a version (design §14.7). The caller
   * (service) has already written the chosen bytes and validated them; this
   * method updates the portable state to `synced` with the new lastValidHash
   * and records a sanitized audit row. Never touches files.
   */
  async resolveConflictClear(
    scope: WorkspaceMemoryScopeContext,
    memoryId: string,
    nextHash: string
  ): Promise<void> {
    await this.portableStateModel.updateByScopeAndMemoryId(
      scope.scopeId,
      memoryId,
      {
        syncState: "synced",
        diagnosticCode: null,
        diagnosticMessage: null,
        lastValidHash: nextHash,
        observedHash: nextHash,
      }
    );
    await this.auditModel.append({
      scopeId: scope.scopeId,
      memoryId,
      action: "resolve",
      actor: "user",
      outcome: "completed",
      nextHash,
    });
  }

  /** Per-file diagnostics for the UI (rejected / conflicted / missing). */
  async listDiagnostics(
    scope: WorkspaceMemoryScopeContext
  ): Promise<PortableMemoryDiagnosticView[]> {
    const states = await this.portableStateModel.listByScope(scope.scopeId);
    return states
      .filter(
        (s) =>
          (s.syncState === "rejected" ||
            s.syncState === "conflicted" ||
            s.syncState === "missing") &&
          s.diagnosticCode
      )
      .map((s) => ({
        code: s.diagnosticCode as PortableMemoryDiagnosticView["code"],
        relativePath: s.relativePath,
        message: s.diagnosticMessage ?? s.diagnosticCode ?? "",
        recoverable: s.syncState !== "rejected",
      }));
  }

  /** Set of memory ids whose portable state must be excluded from retrieval. */
  async listExcludedMemoryIds(
    scope: WorkspaceMemoryScopeContext
  ): Promise<Set<string>> {
    const states = await this.portableStateModel.listByScope(scope.scopeId);
    return new Set(
      states
        .filter(
          (s) =>
            s.syncState === "rejected" ||
            s.syncState === "conflicted" ||
            s.syncState === "missing" ||
            s.syncState === "pending-review"
        )
        .map((s) => s.memoryId)
    );
  }

  /**
   * Records currently in the conflicted state (FR-041 / §14.7): the file was
   * edited externally between AiFetchly's read and write, so neither version
   * is safe to apply. Surfaces the memoryId, relativePath, last valid hash,
   * and observed hash for the conflict-resolution UI.
   */
  async listConflicts(
    scope: WorkspaceMemoryScopeContext
  ): Promise<
    readonly {
      readonly memoryId: string;
      readonly relativePath: string;
      readonly lastValidHash?: string | null;
      readonly observedHash?: string | null;
      readonly message: string;
    }[]
  > {
    const states = await this.portableStateModel.listByScope(
      scope.scopeId,
      "conflicted"
    );
    return states.map((s) => ({
      memoryId: s.memoryId,
      relativePath: s.relativePath,
      lastValidHash: s.lastValidHash,
      observedHash: s.observedHash,
      message: s.diagnosticMessage ?? "concurrent edit detected",
    }));
  }

  async getPortableState(
    scope: WorkspaceMemoryScopeContext,
    memoryId: string
  ): Promise<
    | {
        readonly relativePath: string;
        readonly syncState: string;
        readonly lastValidHash?: string | null;
        readonly visibility: string;
      }
    | null
  > {
    const s = await this.portableStateModel.getByScopeAndMemoryId(
      scope.scopeId,
      memoryId
    );
    return s
      ? {
          relativePath: s.relativePath,
          syncState: s.syncState,
          lastValidHash: s.lastValidHash,
          visibility: s.visibility,
        }
      : null;
  }

  async recordAudit(input: {
    readonly scopeId: string;
    readonly memoryId?: string | null;
    readonly relativePath?: string | null;
    readonly action: string;
    readonly actor: string;
    readonly outcome: string;
    readonly diagnosticCode?: string | null;
    readonly message?: string | null;
  }): Promise<void> {
    await this.auditModel.append(input);
  }

  async enforceAuditRetention(): Promise<void> {
    await this.auditModel.enforceRetention();
  }

  /** Deterministic scan id (design §12.3) — caller supplies generation. */
  static buildScanId(
    workspaceId: string,
    generation: number,
    contentDigest: string
  ): string {
    return `pmem-scan-${workspaceId}-${generation}-${contentDigest
      .slice(0, 12)
      .replace(/[^a-zA-Z0-9]/g, "")}-${randomUUID().slice(0, 8)}`;
  }
}

function sanitize(message: string): string {
  let out = message.replace(/\s+/g, " ").trim();
  if (out.length > 900) out = `${out.slice(0, 900)}…`;
  return out;
}
