/**
 * PortableWorkspaceMemoryService — renderer-facing orchestration for
 * portable workspace memory (design §19.2).
 *
 * Every public method begins with conversation→workspace→scope resolution in
 * the main process. None accept a trusted root, scope id, or file path from
 * the renderer (FR-055/FR-056). Non-AI operations — no USER_AI_ENABLED gate
 * applies here (design §20.4).
 *
 * Enable follows PRD §16.1: preview (exact planned writes) → explicit confirm
 * → apply. Promotion links existing SQLite rows to their files without
 * duplicating logical records (FR-038). Hard deletes confirm via the caller's
 * UI and go file-first through the coordinator queue.
 */

import { randomUUID } from "crypto";
import type {
  PortableMemoryBridgePreview,
  PortableMemoryBridgeResult,
  BridgeTarget,
} from "@/service/PortableWorkspaceMemoryBridgeService";
import { PortableWorkspaceMemoryBridgeService } from "@/service/PortableWorkspaceMemoryBridgeService";
import { PortableWorkspaceMemoryFileStore } from "@/service/PortableWorkspaceMemoryFileStore";
import { PortableWorkspaceMemorySyncCoordinator } from "@/service/PortableWorkspaceMemorySyncCoordinator";
import { PortableWorkspaceIdentityService } from "@/service/PortableWorkspaceIdentityService";
import { PortableWorkspaceMemoryIndexService } from "@/service/PortableWorkspaceMemoryIndexService";
import { PortableWorkspaceMemoryFormat } from "@/service/PortableWorkspaceMemoryFormat";
import {
  parseYamlFrontmatter,
  stripFrontmatterBlock,
} from "@/service/portableMemoryFrontmatter";
import { PortableWorkspaceMemoryGitStatusService } from "@/service/PortableWorkspaceMemoryGitStatusService";
import { WorkspaceMemoryContextResolver } from "@/service/WorkspaceMemoryContextResolver";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import { PortableWorkspaceMemoryModule } from "@/modules/PortableWorkspaceMemoryModule";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";
import type {
  PortableMemoryDefaultStorageMode,
  PortableMemoryDiagnosticView,
  PortableMemoryImportPolicy,
  PortableMemoryRowView,
  PortableMemorySyncSummary,
  PortableWorkspaceStatusView,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import type { WorkspaceMemoryContext } from "@/service/WorkspaceMemoryContextResolver";
import type {
  AIWorkspaceMemoryStatus,
  AIWorkspaceMemoryType,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import type { PortableMemoryDocumentV1 } from "@/entityTypes/portableWorkspaceMemoryTypes";

type PortableDocumentType = Parameters<
  PortableWorkspaceMemoryFormat["buildDocument"]
>[0]["type"];
type PortableDocumentStatus = Parameters<
  PortableWorkspaceMemoryFormat["buildDocument"]
>[0]["status"];

const NO_WORKSPACE_MESSAGE =
  "Choose an approved workspace before using portable memory.";

/** Scope facts + trusted path facts — the full internal memory scope. */
type ScopedMemoryContext =
  import("@/entityTypes/portableWorkspaceMemoryTypes").WorkspaceMemoryScopeContext & {
    readonly defaultStorageMode: PortableMemoryDefaultStorageMode;
  };

// --- View contracts -----------------------------------------------------------

export interface PortableMemoryEnablePreview {
  readonly identityState: "missing" | "valid" | "invalid";
  readonly existingRecordCount: number;
  readonly memoryDirectoryPresent: boolean;
  readonly plannedFiles: readonly string[];
  readonly gitTrackingState: string;
  readonly bridges: readonly {
    readonly target: BridgeTarget;
    readonly preview: PortableMemoryBridgePreview;
  }[];
}

export interface PortableMemoryEnableInput {
  readonly conversationId: string;
  readonly defaultStorageMode: PortableMemoryDefaultStorageMode;
  readonly importPolicy: PortableMemoryImportPolicy;
  readonly exportScope: "none" | "active" | "all";
  readonly visibility: "local" | "team";
  readonly installBridges: readonly BridgeTarget[];
}

export interface PortableMemoryExportPreview {
  readonly exportableCount: number;
  readonly skipped: readonly {
    readonly memoryId: string;
    readonly reason: string;
  }[];
}

export interface PortableMemoryExportResult {
  readonly exportedCount: number;
  readonly skippedCount: number;
}

export interface PortableMemoryPromoteInput {
  readonly conversationId: string;
  readonly memoryId: string;
  readonly visibility: "local" | "team";
}

export class PortableWorkspaceMemoryService {
  private readonly contextResolver: WorkspaceMemoryContextResolver;
  private readonly scopeModule: WorkspaceMemoryScopeModule;
  private readonly portableModule: PortableWorkspaceMemoryModule;
  private readonly identityService: PortableWorkspaceIdentityService;
  private readonly indexService: PortableWorkspaceMemoryIndexService;
  private readonly format: PortableWorkspaceMemoryFormat;
  private readonly bridgeService: PortableWorkspaceMemoryBridgeService;
  private readonly gitStatusService: PortableWorkspaceMemoryGitStatusService;
  private readonly coordinator: PortableWorkspaceMemorySyncCoordinator;
  private readonly memoryModel: AIWorkspaceMemoryModel;
  private readonly stateModel: AIWorkspaceMemoryPortableStateModel;

  constructor(
    contextResolver: WorkspaceMemoryContextResolver = new WorkspaceMemoryContextResolver(),
    scopeModule: WorkspaceMemoryScopeModule = new WorkspaceMemoryScopeModule(),
    portableModule: PortableWorkspaceMemoryModule = new PortableWorkspaceMemoryModule()
  ) {
    this.contextResolver = contextResolver;
    this.scopeModule = scopeModule;
    this.portableModule = portableModule;
    this.identityService = new PortableWorkspaceIdentityService();
    this.indexService = new PortableWorkspaceMemoryIndexService();
    this.format = new PortableWorkspaceMemoryFormat();
    this.bridgeService = new PortableWorkspaceMemoryBridgeService();
    this.gitStatusService = new PortableWorkspaceMemoryGitStatusService();
    this.coordinator = new PortableWorkspaceMemorySyncCoordinator({});
    this.memoryModel = new AIWorkspaceMemoryModel("");
    this.stateModel = new AIWorkspaceMemoryPortableStateModel("");
  }

  // --- Status -------------------------------------------------------------------

  async getStatus(
    conversationId: string
  ): Promise<PortableWorkspaceStatusView> {
    const ctx = await this.requireContext(conversationId);
    const scope = await this.requireScope(ctx);
    const states = await this.stateModel.listByScope(scope.scopeId);
    const count = (state: string): number =>
      states.filter((s) => s.syncState === state).length;
    const gitTrackingState = await this.gitStatusService.getTrackingState(
      ctx.workspaceRoot
    );
    const portable = states.length;
    const total = (
      await this.memoryModel.listByScope({
        scopeId: scope.scopeId,
        limit: 200,
        status: undefined,
      })
    ).length;
    return {
      enabled: scope.portableEnabled,
      ...(scope.portableWorkspaceId
        ? { portableWorkspaceId: scope.portableWorkspaceId }
        : {}),
      defaultStorageMode: isStorageMode(scope.defaultStorageMode)
        ? scope.defaultStorageMode
        : "private-only",
      importPolicy: scope.importPolicy,
      syncState: "idle",
      privateCount: total - portable,
      portableCount: portable,
      rejectedCount: count("rejected"),
      conflictCount: count("conflicted"),
      pendingReviewCount: count("pending-review"),
      gitTrackingState,
    };
  }

  /**
   * List memories enriched with per-record portable storage/sync state
   * (FR-061). Each row carries storageMode, visibility, syncState,
   * relativePath, and portableUpdatedAt so the UI can badge every memory.
   */
  async listWithPortableState(
    conversationId: string
  ): Promise<readonly PortableMemoryRowView[]> {
    const ctx = await this.requireContext(conversationId);
    const scope = await this.requireScope(ctx);
    const rows = await this.memoryModel.listByScope({
      scopeId: scope.scopeId,
      limit: 200,
      status: undefined,
    });
    const states = await this.stateModel.listByScope(scope.scopeId);
    const stateByMemoryId = new Map(states.map((s) => [s.memoryId, s]));
    return rows.map((row) => {
      const state = stateByMemoryId.get(row.memoryId);
      const storageMode: "private" | "portable-local" | "portable-team" = state
        ? state.visibility === "team"
          ? "portable-team"
          : "portable-local"
        : "private";
      return {
        memoryId: row.memoryId,
        type: row.type as PortableMemoryRowView["type"],
        title: row.title,
        content: row.content,
        status: row.status as PortableMemoryRowView["status"],
        confidence: row.confidence,
        updatedAt: row.updatedAt?.toISOString() ?? "",
        storageMode,
        ...(state
          ? {
              syncState: state.syncState as PortableMemoryRowView["syncState"],
              relativePath: state.relativePath,
              visibility:
                state.visibility as PortableMemoryRowView["visibility"],
              portableUpdatedAt: state.portableUpdatedAt.toISOString(),
              ...(state.diagnosticCode
                ? {
                    diagnostic: {
                      code: state.diagnosticCode as PortableMemoryDiagnosticView["code"],
                      relativePath: state.relativePath,
                      message: state.diagnosticMessage ?? state.diagnosticCode,
                      recoverable: state.syncState !== "rejected",
                    },
                  }
                : {}),
            }
          : {}),
      };
    });
  }

  // --- Enable flow ----------------------------------------------------------------

  async previewEnable(
    conversationId: string
  ): Promise<PortableMemoryEnablePreview> {
    const ctx = await this.requireContext(conversationId);
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);
    const identity = await this.identityService.inspectOnDisk(store);
    const existingRecords = await this.scanFileCount(store);
    const bridges = await Promise.all(
      (["AGENTS.md", "CLAUDE.md"] as const).map(async (target) => ({
        target,
        preview: await this.bridgeService.preview(ctx.workspaceRoot, target),
      }))
    );
    const plannedFiles = [
      ".aifetchly/workspace.json",
      ".aifetchly/memory/README.md",
      ".aifetchly/memory/INDEX.md",
    ];
    return {
      identityState: identity.state,
      existingRecordCount: existingRecords,
      memoryDirectoryPresent: await store.memoryDirExists(),
      plannedFiles,
      gitTrackingState: await this.gitStatusService.getTrackingState(
        ctx.workspaceRoot
      ),
      bridges,
    };
  }

  async enable(
    input: PortableMemoryEnableInput
  ): Promise<PortableWorkspaceStatusView> {
    const ctx = await this.requireContext(input.conversationId);
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);

    // 1. Identity: create when missing; keep valid; refuse invalid (FR-004).
    const identity = await this.identityService.inspectOnDisk(store);
    if (identity.state === "invalid") {
      throw new Error(
        identity.diagnostic?.message ??
          "workspace identity file is invalid; fix or remove .aifetchly/workspace.json"
      );
    }
    if (identity.state === "missing") {
      const fresh = this.identityService.createIdentity({
        name: ctx.displayName || "workspace",
      });
      await this.identityService.writeIdentity(store, fresh);
    }

    // 2. Enable policy on the scope (binds identity on next snapshot).
    const scopeBefore = await this.requireScope(ctx);
    await this.scopeModule.updatePolicy({
      scopeId: scopeBefore.scopeId,
      portableEnabled: true,
      defaultStorageMode: input.defaultStorageMode,
      importPolicy: input.importPolicy,
    });

    // 3. README managed block.
    await store.ensureMemoryDir();
    const readmeBlock = this.indexService.buildReadmeManagedBlock({
      sharingMode: input.visibility,
    });
    const existingReadme = await store.readReadme();
    const nextReadme = this.indexService.applyManagedBlock(
      existingReadme,
      readmeBlock
    );
    if (nextReadme !== null) {
      await store.writeReadme(nextReadme);
    }

    // 4. Export selected memories (file-first + promote).
    if (input.exportScope !== "none") {
      await this.exportInternal(ctx, input.exportScope, input.visibility);
    }

    // 5. Bridges (each apply re-checks against the previewed bytes).
    for (const target of input.installBridges) {
      await this.bridgeService.apply({
        canonicalRoot: ctx.workspaceRoot,
        target,
      });
    }

    await this.portableModule.recordAudit({
      scopeId: scopeBefore.scopeId,
      action: "enable",
      actor: "user",
      outcome: "completed",
      message: "portable memory enabled",
    });

    return this.getStatus(input.conversationId);
  }

  async disable(conversationId: string): Promise<PortableWorkspaceStatusView> {
    const ctx = await this.requireContext(conversationId);
    const scope = await this.requireScope(ctx);
    await this.scopeModule.updatePolicy({
      scopeId: scope.scopeId,
      portableEnabled: false,
    });
    await this.portableModule.recordAudit({
      scopeId: scope.scopeId,
      action: "disable",
      actor: "user",
      outcome: "completed",
      message: "portable memory disabled (files preserved)",
    });
    return this.getStatus(conversationId);
  }

  // --- Export ------------------------------------------------------------------------

  async previewExport(
    conversationId: string
  ): Promise<PortableMemoryExportPreview> {
    const ctx = await this.requireContext(conversationId);
    const scope = await this.requireScope(ctx);
    const rows = await this.memoryModel.listByScope({
      scopeId: scope.scopeId,
      limit: 200,
    });
    const skipped: { memoryId: string; reason: string }[] = [];
    let exportable = 0;
    for (const row of rows) {
      const already = await this.stateModel.getByScopeAndMemoryId(
        scope.scopeId,
        row.memoryId
      );
      if (already) {
        skipped.push({ memoryId: row.memoryId, reason: "already portable" });
        continue;
      }
      exportable += 1;
    }
    return { exportableCount: exportable, skipped };
  }

  async exportMemories(input: {
    readonly conversationId: string;
    readonly scope: "active" | "all";
    readonly visibility: "local" | "team";
  }): Promise<PortableMemoryExportResult> {
    const ctx = await this.requireContext(input.conversationId);
    return this.exportInternal(ctx, input.scope, input.visibility);
  }

  private async exportInternal(
    ctx: WorkspaceMemoryContext,
    scope: "active" | "all",
    visibility: "local" | "team"
  ): Promise<PortableMemoryExportResult> {
    const scopeCtx = await this.requireScope(ctx);
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);
    const rows = await this.memoryModel.listByScope({
      scopeId: scopeCtx.scopeId,
      limit: 200,
      status: scope === "active" ? "active" : undefined,
    });
    let exported = 0;
    let skipped = 0;
    const written: PortableMemoryDocumentV1[] = [];
    for (const row of rows) {
      const already = await this.stateModel.getByScopeAndMemoryId(
        scopeCtx.scopeId,
        row.memoryId
      );
      if (already) {
        skipped += 1;
        continue;
      }
      const document = this.format.buildDocument({
        id: row.memoryId,
        type: row.type as PortableDocumentType,
        status: row.status as PortableDocumentStatus,
        confidence: row.confidence,
        visibility,
        createdAt: row.createdAt ?? new Date(),
        updatedAt: new Date(),
        createdBy: "user",
        title: row.title,
        content: row.content,
      });
      const serialized = this.format.serialize(document);
      const writtenInfo = await store.writeRecord(row.memoryId, serialized);
      await this.portableModule.promotePrivateMemory(
        scopeCtx,
        row.memoryId,
        document,
        writtenInfo.contentHash
      );
      written.push({
        ...document,
        contentHash: writtenInfo.contentHash,
        sizeBytes: writtenInfo.sizeBytes,
      });
      exported += 1;
    }
    // Rebuild INDEX from the COMPLETE eligible record set (FR-031/FR-043),
    // not just the current export batch — active synced records only,
    // excluding archived/contradicted/rejected/conflicted/pending/missing.
    await this.refreshIndex(ctx, scopeCtx);
    await this.portableModule.recordAudit({
      scopeId: scopeCtx.scopeId,
      action: "export",
      actor: "user",
      outcome: "completed",
      message: `exported ${exported} memories`,
    });
    return { exportedCount: exported, skippedCount: skipped };
  }

  // --- Promotion / privatization -----------------------------------------------------

  async promote(input: PortableMemoryPromoteInput): Promise<void> {
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    const row = await this.memoryModel.getByScopeAndMemoryId(
      scope.scopeId,
      input.memoryId
    );
    if (!row) throw new Error("Workspace memory not found");
    const document = this.format.buildDocument({
      id: row.memoryId,
      type: row.type as PortableDocumentType,
      status: row.status as PortableDocumentStatus,
      confidence: row.confidence,
      visibility: input.visibility,
      createdAt: row.createdAt ?? new Date(),
      updatedAt: new Date(),
      createdBy: "user",
      title: row.title,
      content: row.content,
    });
    // File-first through the per-scope queue (D-05/D-06): write, re-parse,
    // then promote the SQLite projection.
    await this.runQueued(scope, () =>
      this.coordinator.applyAppWrite(scope, document)
    );
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);
    const written = await store.readRecord(row.memoryId);
    await this.portableModule.promotePrivateMemory(
      scope,
      row.memoryId,
      document,
      written!.contentHash
    );
    await this.refreshIndex(ctx, scope);
  }

  async privatize(input: {
    readonly conversationId: string;
    readonly memoryId: string;
  }): Promise<void> {
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    const state = await this.stateModel.getByScopeAndMemoryId(
      scope.scopeId,
      input.memoryId
    );
    if (!state) throw new Error("Memory is not portable");
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);
    await this.runQueued(scope, async () => {
      // Delete the file first; only on success remove portable state.
      const deleted = await store.deleteRecord(input.memoryId);
      if (!deleted) {
        throw new Error(
          "portable memory file could not be deleted; portable state retained"
        );
      }
      await this.portableModule.privatizeMemory(
        scope,
        input.memoryId,
        state.relativePath
      );
    });
    await this.refreshIndex(ctx, scope);
  }

  // --- Diagnostics / review ----------------------------------------------------------

  async listDiagnostics(
    conversationId: string
  ): Promise<PortableMemoryDiagnosticView[]> {
    const ctx = await this.requireContext(conversationId);
    const scope = await this.requireScope(ctx);
    return this.portableModule.listDiagnostics(scope);
  }

  async approveReview(input: {
    readonly conversationId: string;
    readonly memoryId: string;
  }): Promise<void> {
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    await this.portableModule.approvePendingReview(scope, input.memoryId);
  }

  async rejectReview(input: {
    readonly conversationId: string;
    readonly memoryId: string;
  }): Promise<void> {
    // Rejected review: keep the projection out of retrieval and archive it.
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    await this.memoryModel.updateByScopeAndMemoryId(
      scope.scopeId,
      input.memoryId,
      { status: "archived" }
    );
    await this.portableModule.approvePendingReview(scope, input.memoryId);
  }

  // --- Policy / identity ----------------------------------------------------------

  async updatePolicy(input: {
    readonly conversationId: string;
    readonly portableEnabled?: boolean;
    readonly defaultStorageMode?: PortableMemoryDefaultStorageMode;
    readonly importPolicy?: PortableMemoryImportPolicy;
  }): Promise<PortableWorkspaceStatusView> {
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    await this.scopeModule.updatePolicy({
      scopeId: scope.scopeId,
      portableEnabled: input.portableEnabled,
      defaultStorageMode: input.defaultStorageMode,
      importPolicy: input.importPolicy,
    });
    return this.getStatus(input.conversationId);
  }

  async regenerateIdentity(input: {
    readonly conversationId: string;
  }): Promise<PortableWorkspaceStatusView> {
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);
    const current = await this.identityService.inspectOnDisk(store);
    if (current.state !== "valid" || !current.identity) {
      throw new Error("No valid workspace identity to regenerate");
    }
    const next = this.identityService.regenerateIdentity({
      name: current.identity.name,
      previous: current.identity,
    });
    await this.identityService.writeIdentity(store, next);
    await this.scopeModule.bindPortableIdentity({
      scopeId: scope.scopeId,
      portableWorkspaceId: next.workspaceId,
    });
    await this.portableModule.recordAudit({
      scopeId: scope.scopeId,
      action: "identity-regenerate",
      actor: "user",
      outcome: "completed",
      message: "workspace identity regenerated (record ids retained)",
    });
    return this.getStatus(input.conversationId);
  }

  // --- Bridge / git ----------------------------------------------------------------

  async previewBridge(input: {
    readonly conversationId: string;
    readonly target: BridgeTarget;
  }): Promise<PortableMemoryBridgePreview> {
    const ctx = await this.requireContext(input.conversationId);
    return this.bridgeService.preview(ctx.workspaceRoot, input.target);
  }

  async applyBridge(input: {
    readonly conversationId: string;
    readonly target: BridgeTarget;
    readonly expectedBeforeHash?: string;
  }): Promise<PortableMemoryBridgeResult> {
    const ctx = await this.requireContext(input.conversationId);
    const result = await this.bridgeService.apply({
      canonicalRoot: ctx.workspaceRoot,
      target: input.target,
      expectedBeforeHash: input.expectedBeforeHash,
    });
    const scope = await this.requireScope(ctx);
    await this.portableModule.recordAudit({
      scopeId: scope.scopeId,
      action: "update",
      actor: "user",
      outcome: result.applied ? "completed" : "skipped",
      relativePath: input.target,
      message: result.message,
    });
    return result;
  }

  async removeBridge(input: {
    readonly conversationId: string;
    readonly target: BridgeTarget;
    readonly expectedBeforeHash?: string;
  }): Promise<PortableMemoryBridgeResult> {
    const ctx = await this.requireContext(input.conversationId);
    return this.bridgeService.remove({
      canonicalRoot: ctx.workspaceRoot,
      target: input.target,
      expectedBeforeHash: input.expectedBeforeHash,
    });
  }

  // --- Portable CRUD (file-first through the coordinator queue) ---------------

  /**
   * Create a new portable record (FR-037). The file is written atomically
   * BEFORE the SQLite projection is created (D-06); the written bytes are
   * re-parsed through the shared validator before projection. Serialized per
   * scope through the coordinator queue.
   */
  async createPortable(input: {
    readonly conversationId: string;
    readonly type: PortableDocumentType;
    readonly title: string;
    readonly content: string;
    readonly confidence: number;
    readonly visibility: "local" | "team";
    readonly status?: PortableDocumentStatus;
  }): Promise<PortableMemoryRowView> {
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    const memoryId = `wmem-${randomUUID()}`;
    const now = new Date();
    const document = this.format.buildDocument({
      id: memoryId,
      type: input.type,
      status: input.status ?? "active",
      confidence: input.confidence,
      visibility: input.visibility,
      createdAt: now,
      updatedAt: now,
      createdBy: "user",
      title: input.title,
      content: input.content,
    });
    await this.runQueued(scope, () =>
      this.coordinator.applyAppWrite(scope, document)
    );
    await this.refreshIndex(ctx, scope);
    const row = await this.memoryModel.getByScopeAndMemoryId(
      scope.scopeId,
      memoryId
    );
    return this.toRowView(scope, row!);
  }

  /**
   * Update a portable record file-first (FR-039, FR-029). The caller's
   * `expectedHash` is compared to the current on-disk hash inside
   * `applyAppWrite`; a mismatch marks the record conflicted without
   * overwriting external bytes (AC-007).
   */
  async updatePortable(input: {
    readonly conversationId: string;
    readonly memoryId: string;
    readonly type: PortableDocumentType;
    readonly title: string;
    readonly content: string;
    readonly confidence: number;
    readonly status: PortableDocumentStatus;
    readonly visibility: "local" | "team";
    readonly expectedHash?: string | null;
  }): Promise<PortableMemoryRowView> {
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    const existing = await this.memoryModel.getByScopeAndMemoryId(
      scope.scopeId,
      input.memoryId
    );
    if (!existing) throw new Error("Workspace memory not found");
    const document = this.format.buildDocument({
      id: input.memoryId,
      type: input.type,
      status: input.status,
      confidence: input.confidence,
      visibility: input.visibility,
      createdAt: existing.createdAt ?? new Date(),
      updatedAt: new Date(),
      createdBy: "user",
      title: input.title,
      content: input.content,
    });
    const result = await this.runQueued(scope, () =>
      this.coordinator.applyAppWrite(scope, document, {
        expectedHash: input.expectedHash ?? null,
      })
    );
    if (result.conflicted) {
      throw new Error(
        "concurrent external edit detected; use the conflict resolver to choose a version"
      );
    }
    await this.refreshIndex(ctx, scope);
    const row = await this.memoryModel.getByScopeAndMemoryId(
      scope.scopeId,
      input.memoryId
    );
    return this.toRowView(scope, row!);
  }

  /**
   * Archive a portable record: update `status` in the file first (FR-039),
   * re-import, remove from INDEX. File-first through the coordinator queue.
   */
  async archivePortable(input: {
    readonly conversationId: string;
    readonly memoryId: string;
  }): Promise<void> {
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    const existing = await this.memoryModel.getByScopeAndMemoryId(
      scope.scopeId,
      input.memoryId
    );
    if (!existing) throw new Error("Workspace memory not found");
    const state = await this.stateModel.getByScopeAndMemoryId(
      scope.scopeId,
      input.memoryId
    );
    const document = this.format.buildDocument({
      id: input.memoryId,
      type: existing.type as PortableDocumentType,
      status: "archived",
      confidence: existing.confidence,
      visibility: (state?.visibility === "team" ? "team" : "local") as
        | "local"
        | "team",
      createdAt: existing.createdAt ?? new Date(),
      updatedAt: new Date(),
      createdBy: (state?.createdBy ??
        "user") as PortableMemoryDocumentV1["frontmatter"]["createdBy"],
      title: existing.title,
      content: existing.content,
    });
    await this.runQueued(scope, () =>
      this.coordinator.applyAppWrite(scope, document, {
        expectedHash: state?.lastValidHash ?? null,
      })
    );
    await this.refreshIndex(ctx, scope);
    await this.portableModule.recordAudit({
      scopeId: scope.scopeId,
      memoryId: input.memoryId,
      relativePath: PortableWorkspaceMemoryFileStore.relativePathForMemoryId(
        input.memoryId
      ),
      action: "archive",
      actor: "user",
      outcome: "completed",
    });
  }

  /**
   * Hard-delete a portable record (FR-039). Requires explicit confirmation
   * (caller-supplied). Deletes the FILE first; only on successful removal
   * does it delete the projection + portable state. A failed file deletion
   * leaves no silent detached projection (AC-006).
   */
  async deletePortable(input: {
    readonly conversationId: string;
    readonly memoryId: string;
  }): Promise<void> {
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    const state = await this.stateModel.getByScopeAndMemoryId(
      scope.scopeId,
      input.memoryId
    );
    if (!state) {
      // Private record — fall back to the SQLite-only delete.
      await this.memoryModel.deleteByScopeAndMemoryId(
        scope.scopeId,
        input.memoryId
      );
      return;
    }
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);
    await this.runQueued(scope, async () => {
      // Delete the file first; a failure here MUST NOT touch the projection.
      const deleted = await store.deleteRecord(input.memoryId);
      if (!deleted) {
        throw new Error(
          "portable memory file could not be deleted; projection retained"
        );
      }
      await this.portableModule.recordAudit({
        scopeId: scope.scopeId,
        memoryId: input.memoryId,
        relativePath: state.relativePath,
        action: "delete",
        actor: "user",
        outcome: "completed",
        message: "portable record hard-deleted",
      });
      await this.stateModel.deleteByScopeAndMemoryId(
        scope.scopeId,
        input.memoryId
      );
      await this.memoryModel.deleteByScopeAndMemoryId(
        scope.scopeId,
        input.memoryId
      );
    });
    await this.refreshIndex(ctx, scope);
  }

  /** Build a PortableMemoryRowView from a memory entity + its portable state. */
  private async toRowView(
    scope: ScopedMemoryContext,
    row: import("@/entity/AIWorkspaceMemory.entity").AIWorkspaceMemoryEntity
  ): Promise<PortableMemoryRowView> {
    const state = await this.stateModel.getByScopeAndMemoryId(
      scope.scopeId,
      row.memoryId
    );
    const storageMode: "private" | "portable-local" | "portable-team" = state
      ? state.visibility === "team"
        ? "portable-team"
        : "portable-local"
      : "private";
    return {
      memoryId: row.memoryId,
      type: row.type as PortableMemoryRowView["type"],
      title: row.title,
      content: row.content,
      status: row.status as PortableMemoryRowView["status"],
      confidence: row.confidence,
      updatedAt: row.updatedAt?.toISOString() ?? "",
      storageMode,
      ...(state
        ? {
            syncState: state.syncState as PortableMemoryRowView["syncState"],
            relativePath: state.relativePath,
            visibility: state.visibility as PortableMemoryRowView["visibility"],
            portableUpdatedAt: state.portableUpdatedAt.toISOString(),
          }
        : {}),
    };
  }

  /** Run an operation through the per-scope coordinator queue (D-05). */
  private async runQueued<T>(
    scope: ScopedMemoryContext,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.coordinator.enqueueOperation(scope.scopeId, operation);
  }

  async getGitStatus(conversationId: string): Promise<string> {
    const ctx = await this.requireContext(conversationId);
    return this.gitStatusService.getTrackingState(ctx.workspaceRoot);
  }

  /**
   * Fetch portable state for a single memory (FR-038): the editor uses the
   * returned lastValidHash as a concurrency token on update so the main
   * process can detect a concurrent external edit before writing.
   */
  async getPortableMemoryState(
    conversationId: string,
    memoryId: string
  ): Promise<{
    readonly portable: boolean;
    readonly syncState?: string;
    readonly lastValidHash?: string | null;
    readonly relativePath?: string;
    readonly visibility?: string;
  }> {
    const ctx = await this.requireContext(conversationId);
    const scope = await this.requireScope(ctx);
    const state = await this.portableModule.getPortableState(scope, memoryId);
    if (!state) return { portable: false };
    return {
      portable: true,
      syncState: state.syncState,
      lastValidHash: state.lastValidHash,
      relativePath: state.relativePath,
      visibility: state.visibility,
    };
  }

  // --- Conflicts (FR-041 / §14.7) -----------------------------------------------

  /**
   * List records in the conflicted state, with the last-valid projection and
   * the current on-disk file (parsed on demand) so the UI can render both
   * versions + a Markdown diff. Never persists rejected external content
   * merely to render a diff (§14.6).
   */
  async listConflicts(conversationId: string): Promise<
    readonly {
      readonly memoryId: string;
      readonly relativePath: string;
      readonly lastValidHash?: string | null;
      readonly observedHash?: string | null;
      readonly message: string;
      readonly currentFileContent?: string;
      readonly currentFileParseable: boolean;
    }[]
  > {
    const ctx = await this.requireContext(conversationId);
    const scope = await this.requireScope(ctx);
    const conflicts = await this.portableModule.listConflicts(scope);
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);
    return Promise.all(
      conflicts.map(async (c) => {
        let currentFileContent: string | undefined;
        let currentFileParseable = false;
        try {
          const read = await store.readRecord(c.memoryId);
          if (read) {
            currentFileContent = read.content;
            currentFileParseable = true;
          }
        } catch {
          // Read failure → file absent or unreadable; treat as unparseable.
        }
        return {
          memoryId: c.memoryId,
          relativePath: c.relativePath,
          lastValidHash: c.lastValidHash,
          observedHash: c.observedHash,
          message: c.message,
          currentFileContent,
          currentFileParseable,
        };
      })
    );
  }

  /**
   * Resolve a conflict per PRD §14.7. The caller chooses the authority:
   *   - "use-file":    validate the current file, update projection+hash.
   *   - "use-app":     require a second confirmation (caller-supplied); write
   *                    the app draft atomically, then import.
   *   - "merge":       the caller supplies a merged document; write+import.
   * Every action writes a sanitized audit row (FR-060).
   */
  async resolveConflict(input: {
    readonly conversationId: string;
    readonly memoryId: string;
    readonly action: "use-file" | "use-app" | "merge";
    readonly mergedDocument?: {
      readonly title: string;
      readonly content: string;
      readonly type: import("@/entityTypes/aiWorkspaceMemoryTypes").AIWorkspaceMemoryType;
      readonly status: import("@/entityTypes/aiWorkspaceMemoryTypes").AIWorkspaceMemoryStatus;
      readonly confidence: number;
      readonly visibility: "local" | "team";
    };
    /** The on-disk hash the user saw when choosing; re-compared before write. */
    readonly expectedObservedHash?: string | null;
  }): Promise<void> {
    const ctx = await this.requireContext(input.conversationId);
    const scope = await this.requireScope(ctx);
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);

    // Route the entire resolution through the per-scope queue so it cannot
    // race a watcher snapshot or another mutation (D-05, FR-041).
    await this.runQueued(scope, async () => {
      // Re-read the file INSIDE the queue (race-safe, §14.7).
      const read = await store.readRecord(input.memoryId);
      if (!read) {
        throw new Error(
          "portable memory file is absent; cannot resolve conflict"
        );
      }
      // Race-safe check: if the file changed since the user chose, re-conflict.
      if (
        input.expectedObservedHash &&
        input.expectedObservedHash !== read.contentHash
      ) {
        await this.portableModule.markConflict(scope, {
          memoryId: input.memoryId,
          relativePath:
            PortableWorkspaceMemoryFileStore.relativePathForMemoryId(
              input.memoryId
            ),
          message:
            "file changed again before resolution could apply; please re-review",
        });
        throw new Error(
          "file changed again before resolution could apply; please re-review"
        );
      }

      let nextHash: string;
      if (input.action === "use-file") {
        // Validate the current file through the parser; import if it parses.
        const parsed = this.format.parseDraft({
          relativePath:
            PortableWorkspaceMemoryFileStore.relativePathForMemoryId(
              input.memoryId
            ),
          fileName: `${input.memoryId}.md`,
          contentHash: read.contentHash,
          sizeBytes: read.sizeBytes,
          mtimeMs: read.mtimeMs,
          rawFrontmatter: parseYamlFrontmatter(read.content),
          markdownBody: stripFrontmatterBlock(read.content),
          isSymbolicLink: false,
        });
        if (!parsed.ok) {
          throw new Error(
            `current file is invalid: ${parsed.diagnostic.message}`
          );
        }
        await this.portableModule.upsertValidatedDocument(
          scope,
          parsed.document,
          {
            actor: "user",
            pendingReview: false,
          }
        );
        nextHash = read.contentHash;
      } else if (input.action === "use-app" || input.action === "merge") {
        if (!input.mergedDocument) {
          throw new Error(
            "use-app/merge requires a mergedDocument with title/content/type/status/confidence/visibility"
          );
        }
        const existing = await this.memoryModel.getByScopeAndMemoryId(
          scope.scopeId,
          input.memoryId
        );
        const createdAt = existing?.createdAt ?? new Date();
        const document = this.format.buildDocument({
          id: input.memoryId,
          type: input.mergedDocument.type,
          status: input.mergedDocument.status,
          confidence: input.mergedDocument.confidence,
          visibility: input.mergedDocument.visibility,
          createdAt,
          updatedAt: new Date(),
          createdBy: "user",
          title: input.mergedDocument.title,
          content: input.mergedDocument.content,
        });
        // Write atomically, then RE-PARSE the written bytes (the shared
        // validator + secret filter run on the canonical output, not just
        // the caller's draft — §19/P0 "make app writes use the shared
        // validator").
        const serialized = this.format.serialize(document);
        const written = await store.writeRecord(input.memoryId, serialized);
        const readBack = await store.readRecord(input.memoryId);
        if (!readBack) {
          throw new Error("portable record write could not be verified");
        }
        const reparsed = this.format.parseDraft({
          relativePath:
            PortableWorkspaceMemoryFileStore.relativePathForMemoryId(
              input.memoryId
            ),
          fileName: `${input.memoryId}.md`,
          contentHash: written.contentHash,
          sizeBytes: written.sizeBytes,
          mtimeMs: readBack.mtimeMs,
          rawFrontmatter: parseYamlFrontmatter(readBack.content),
          markdownBody: stripFrontmatterBlock(readBack.content),
          isSymbolicLink: false,
        });
        if (!reparsed.ok) {
          throw new Error(
            `merged document failed validation after write: ${reparsed.diagnostic.message}`
          );
        }
        await this.portableModule.upsertValidatedDocument(
          scope,
          reparsed.document,
          {
            actor: "user",
            pendingReview: false,
          }
        );
        nextHash = written.contentHash;
      } else {
        throw new Error(`unknown conflict action: ${input.action}`);
      }

      await this.portableModule.resolveConflictClear(
        scope,
        input.memoryId,
        nextHash
      );
      await this.refreshIndex(ctx, scope);
    });
  }

  // --- Rescan ----------------------------------------------------------------------

  /**
   * Trigger a watcher rescan through the shared manager (best-effort — the
   * coordinator reconciles the resulting snapshot).
   */
  async rescan(
    conversationId: string
  ): Promise<PortableMemorySyncSummary | null> {
    const ctx = await this.requireContext(conversationId);
    const manager = await this.getWatchManager();
    if (manager) {
      manager.rescan(String(ctx.workspaceId));
      return null;
    }
    return null;
  }

  private async getWatchManager(): Promise<{
    rescan: (workspaceId: string) => void;
  } | null> {
    try {
      const mod = await import(
        "@/service/workspaceWatch/WorkspaceWatchManagerSingleton"
      );
      return mod.getWorkspaceWatchManager();
    } catch {
      return null;
    }
  }

  // --- Internals --------------------------------------------------------------------

  private async requireContext(
    conversationId: string
  ): Promise<WorkspaceMemoryContext> {
    if (!conversationId || typeof conversationId !== "string") {
      throw new Error("conversationId is required");
    }
    const ctx = await this.contextResolver.resolveForConversation(
      conversationId
    );
    if (!ctx) throw new Error(NO_WORKSPACE_MESSAGE);
    return ctx;
  }

  private async requireScope(
    ctx: WorkspaceMemoryContext
  ): Promise<ScopedMemoryContext> {
    if (!ctx.scopeId) throw new Error("Memory scope unavailable for workspace");
    const scope = await this.scopeModule.getScope(ctx.scopeId);
    if (!scope) throw new Error("Memory scope unavailable for workspace");
    return {
      ...scope,
      workspaceKey: ctx.workspaceKey,
      workspaceRoot: ctx.workspaceRoot,
    };
  }

  private async scanFileCount(
    store: PortableWorkspaceMemoryFileStore
  ): Promise<number> {
    if (!(await store.memoryDirExists())) return 0;
    // Count via a bounded directory listing of .md record files.
    const fsp = await import("fs/promises");
    const entries = await fsp.readdir(store.memoryDir());
    return entries.filter(
      (name) =>
        name.endsWith(".md") && name !== "README.md" && name !== "INDEX.md"
    ).length;
  }

  private async refreshIndex(
    ctx: WorkspaceMemoryContext,
    scope: import("@/entityTypes/portableWorkspaceMemoryTypes").WorkspaceMemoryScopeContext
  ): Promise<void> {
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);
    const states = await this.stateModel.listByScope(scope.scopeId, "synced");
    const docs: PortableMemoryDocumentV1[] = [];
    for (const state of states) {
      const row = await this.memoryModel.getByScopeAndMemoryId(
        scope.scopeId,
        state.memoryId
      );
      if (!row || row.status !== "active") continue;
      docs.push({
        frontmatter: {
          schema: "aifetchly.memory/v1",
          id: state.memoryId,
          type: row.type as AIWorkspaceMemoryType,
          status: row.status as AIWorkspaceMemoryStatus,
          confidence: row.confidence,
          visibility: state.visibility === "team" ? "team" : "local",
          createdAt: state.portableCreatedAt.toISOString(),
          updatedAt: state.portableUpdatedAt.toISOString(),
          createdBy:
            state.createdBy as PortableMemoryDocumentV1["frontmatter"]["createdBy"],
        },
        title: row.title,
        content: row.content,
        relativePath: state.relativePath,
        contentHash: state.lastValidHash ?? "",
        sizeBytes: 0,
        mtimeMs: 0,
      });
    }
    await store.writeIndex(this.indexService.buildIndex(docs));
    void randomUUID; // keep import used for future audit ids
  }
}

function isStorageMode(v: string): v is PortableMemoryDefaultStorageMode {
  return [
    "private-only",
    "portable-local",
    "portable-team",
    "ask-each-time",
  ].includes(v);
}
