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
import {
  PortableWorkspaceMemoryFileStore,
} from "@/service/PortableWorkspaceMemoryFileStore";
import {
  PortableWorkspaceIdentityService,
} from "@/service/PortableWorkspaceIdentityService";
import {
  PortableWorkspaceMemoryIndexService,
} from "@/service/PortableWorkspaceMemoryIndexService";
import { PortableWorkspaceMemoryFormat } from "@/service/PortableWorkspaceMemoryFormat";
import {
  PortableWorkspaceMemoryGitStatusService,
} from "@/service/PortableWorkspaceMemoryGitStatusService";
import { WorkspaceMemoryContextResolver } from "@/service/WorkspaceMemoryContextResolver";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import { PortableWorkspaceMemoryModule } from "@/modules/PortableWorkspaceMemoryModule";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";
import type {
  PortableMemoryDefaultStorageMode,
  PortableMemoryDiagnosticView,
  PortableMemoryImportPolicy,
  PortableMemorySyncSummary,
  PortableWorkspaceStatusView,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import type { WorkspaceMemoryContext } from "@/service/WorkspaceMemoryContextResolver";
import type { AIWorkspaceMemoryStatus, AIWorkspaceMemoryType } from "@/entityTypes/aiWorkspaceMemoryTypes";
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
  readonly skipped: readonly { readonly memoryId: string; readonly reason: string }[];
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
    this.memoryModel = new AIWorkspaceMemoryModel("");
    this.stateModel = new AIWorkspaceMemoryPortableStateModel("");
  }

  // --- Status -------------------------------------------------------------------

  async getStatus(conversationId: string): Promise<PortableWorkspaceStatusView> {
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

  async enable(input: PortableMemoryEnableInput): Promise<PortableWorkspaceStatusView> {
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
    if (written.length > 0) {
      await store.writeIndex(this.indexService.buildIndex(written));
    }
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
    const store = new PortableWorkspaceMemoryFileStore(ctx.workspaceRoot);
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
    const serialized = this.format.serialize(document);
    const written = await store.writeRecord(row.memoryId, serialized);
    await this.portableModule.promotePrivateMemory(
      scope,
      row.memoryId,
      document,
      written.contentHash
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
    await this.portableModule.privatizeMemory(
      scope,
      input.memoryId,
      state.relativePath
    );
    await store.deleteRecord(input.memoryId);
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

  async getGitStatus(conversationId: string): Promise<string> {
    const ctx = await this.requireContext(conversationId);
    return this.gitStatusService.getTrackingState(ctx.workspaceRoot);
  }

  // --- Rescan ----------------------------------------------------------------------

  /**
   * Trigger a watcher rescan through the shared manager (best-effort — the
   * coordinator reconciles the resulting snapshot).
   */
  async rescan(conversationId: string): Promise<PortableMemorySyncSummary | null> {
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
      const mod = await import("@/service/workspaceWatch/WorkspaceWatchManagerSingleton");
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
    const ctx = await this.contextResolver.resolveForConversation(conversationId);
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
          createdBy: state.createdBy as PortableMemoryDocumentV1["frontmatter"]["createdBy"],
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

function isStorageMode(
  v: string
): v is PortableMemoryDefaultStorageMode {
  return [
    "private-only",
    "portable-local",
    "portable-team",
    "ask-each-time",
  ].includes(v);
}
