// src/modules/WorkspaceWatchModule.ts
// Phase 14 (Plan 14-03) — three-layer Module (CLAUDE.md) sitting between the
// IPC handler layer (src/main-process/communication/workspace-watch-ipc.ts)
// and the watcher manager + workspace resolver + workspace approval state.
//
// Per CLAUDE.md:
//   - IPC handlers NEVER touch the database directly; they call Modules.
//   - Modules extend BaseModule when DB-backed; this Module has NO direct
//     DB access (Phase 14 reuses the existing WorkspaceModule for trust
//     state, and the watcher itself owns no entity). It therefore does NOT
//     extend BaseModule, mirroring the SlashCommandModule pattern (Phase 13).
//
// CFG-02 (CRITICAL): the renderer NEVER supplies a workspaceRoot. Acquire
// resolves the approved root via WorkspaceResolver(conversationId) before
// forwarding to the manager. A renderer-provided workspaceRoot is never
// accepted — the IPC schema does not even include the field.
//
// TRS-07: preview returns the AGENTS.md file body string, never a path.

import type { WorkspaceWatchManager } from "@/service/workspaceWatch/WorkspaceWatchManager";
import type { WorkspaceResolver } from "@/service/WorkspaceResolver";
import type { WorkspaceModule } from "@/modules/WorkspaceModule";

/**
 * Optional hook after an approved workspace watch is acquired. Wired by the
 * IPC composition root so this module does not import portable-memory
 * services (keeps the watch IPC unit test graph small).
 */
export type ApprovedWorkspaceAcquireHook = (workspaceRoot: string) => void;

let approvedWorkspaceAcquireHook: ApprovedWorkspaceAcquireHook | null = null;

export function setApprovedWorkspaceAcquireHook(
  hook: ApprovedWorkspaceAcquireHook | null
): void {
  approvedWorkspaceAcquireHook = hook;
}

/** Phase 14 trust scope (TRS-03). Forward-compat: Phase 17 adds per-capability. */
export type WorkspaceTrustScope = "instructions" | "all";

/** Request shapes — mirror the IPC zod schemas in workspace-watch-ipc.ts. */
export interface WorkspaceWatchAcquireRequest {
  readonly conversationId: string;
  /** Optional renderer hint; main ALWAYS re-resolves the root via resolver. */
  readonly workspaceId?: string;
}

export interface WorkspaceWatchReleaseRequest {
  readonly conversationId: string;
  readonly workspaceId?: string;
}

export interface WorkspaceTrustPreviewRequest {
  readonly workspaceId: string;
}

export interface WorkspaceTrustSetRequest {
  readonly workspaceId: string;
  readonly scope: WorkspaceTrustScope;
}

/** Response payloads — kept free of any path string (TRS-07). */
export interface WorkspaceWatchAcquireResponse {
  readonly workspaceId: string;
}

export interface WorkspaceTrustPreviewResponse {
  /** Concatenated AGENTS.md instruction content (file body, never a path). */
  readonly content: string;
}

/**
 * Optional sink notifying the singleton approval cache that a workspace was
 * confirmed approved. The cache backs the manager's sync trustResolver.
 *
 * Injected by the IPC layer; absent in tests (the stubbed manager carries
 * its own trustResolver). The sink is a callback (not a direct import) so
 * the module stays decoupled from the singleton module — the IPC layer
 * decides which sink to wire (production singleton vs test stub).
 */
export type WorkspaceApprovalSink = (workspaceId: string) => void;

/**
 * WorkspaceWatchModule — thin three-layer delegate. Constructed per-request
 * by the IPC handler. All collaborators are constructor-injected so the
 * module is trivially unit-testable.
 *
 * Methods:
 *   - {@link acquire}: resolve approved root (CFG-02) → manager.acquire.
 *   - {@link release}: release this consumer's claim (chat-close path).
 *   - {@link previewAgents}: read AGENTS.md content from the manager's
 *     cached snapshot (TRS-07 — never returns a path).
 *   - {@link setTrust}: approve via WorkspaceModule + manager.rescan so the
 *     next changed event applies with the updated trust filter.
 */
export class WorkspaceWatchModule {
  private readonly manager: WorkspaceWatchManager;
  private readonly resolver: WorkspaceResolver;
  private readonly workspaceModule: WorkspaceModule;
  private readonly approvalSink?: WorkspaceApprovalSink;

  constructor(
    manager: WorkspaceWatchManager,
    resolver: WorkspaceResolver,
    workspaceModule: WorkspaceModule,
    approvalSink?: WorkspaceApprovalSink
  ) {
    this.manager = manager;
    this.resolver = resolver;
    this.workspaceModule = workspaceModule;
    this.approvalSink = approvalSink;
  }

  /**
   * Acquire a watch on behalf of the chat consumer `chat:<conversationId>`.
   * Returns the resolved workspaceId string (serialised DB primary key) so
   * the renderer can pass it back on release/preview/setTrust. Returns null
   * when no approved workspace exists (CFG-02 — fail-closed, no watch).
   */
  async acquire(
    request: WorkspaceWatchAcquireRequest
  ): Promise<WorkspaceWatchAcquireResponse | null> {
    const resolved = await this.resolver.resolve(request.conversationId);
    if (!resolved) return null;
    const workspaceId = String(resolved.workspaceId);
    // CFG-02: the resolved root is the SOLE source of truth. The renderer's
    // optional workspaceId hint is informational only — we always re-resolve
    // and use the resolver's value, never a renderer-supplied root.
    this.manager.acquire({
      workspaceId,
      workspaceRoot: resolved.rootPath,
      consumerId: `chat:${request.conversationId}`,
      reason: "chat-open",
    });
    // Mirror the approval into the sync cache so the manager's sync
    // trustResolver sees approved=true on subsequent worker events. The
    // resolver only returns approved workspaces, so this is safe.
    this.approvalSink?.(workspaceId);
    approvedWorkspaceAcquireHook?.(resolved.rootPath);
    return { workspaceId };
  }

  /**
   * Release the chat consumer's claim on its workspace. If the resolver can
   * still resolve the active workspace, that id is used; otherwise the
   * renderer-supplied workspaceId is honoured (covers the revoked-mid-session
   * path where the renderer still knows the id and we must release to avoid
   * a consumer leak).
   */
  async release(request: WorkspaceWatchReleaseRequest): Promise<void> {
    const consumerId = `chat:${request.conversationId}`;
    let workspaceId = request.workspaceId;
    if (!workspaceId) {
      const resolved = await this.resolver.resolve(request.conversationId);
      workspaceId = resolved ? String(resolved.workspaceId) : undefined;
    }
    if (!workspaceId) return; // nothing to release
    this.manager.release(workspaceId, consumerId);
  }

  /**
   * Read the workspace's AGENTS.md content body from the manager's cached
   * snapshot. Returns null when the workspace is not currently watched (no
   * snapshot available) — the renderer should treat this as "no preview
   * available" rather than an error.
   *
   * TRS-07: the response is the file BODY, never a path. The renderer cannot
   * re-read the file from this response even if compromised.
   */
  previewAgents(
    request: WorkspaceTrustPreviewRequest
  ): WorkspaceTrustPreviewResponse | null {
    const snapshot = this.manager.getWorkspaceSnapshot(request.workspaceId);
    if (!snapshot) return null;
    // Concatenate every instruction block the worker collected (root
    // AGENTS.md + .aifetchly/AGENTS.md). Keep order stable by relativePath.
    const blocks = [...snapshot.instructions].sort((a, b) =>
      a.relativePath < b.relativePath
        ? -1
        : a.relativePath > b.relativePath
        ? 1
        : 0
    );
    const content = blocks.map((b) => b.content).join("\n\n---\n\n");
    if (content.length === 0) return null;
    return { content };
  }

  /**
   * Approve the workspace (Phase 14 binary gate — both "instructions" and
   * "all" map to approveWorkspace; Phase 17 swaps the body of
   * WorkspaceTrustFilter for per-capability lookup, at which point this
   * method branches on scope). Then trigger a manager.rescan so the next
   * changed event applies with the updated trust filter.
   *
   * Returns true on success, false if the workspaceId cannot be parsed or
   * the approval write returned null (record deleted mid-flight).
   */
  /**
   * Approve the workspace (Phase 14 binary gate — both "instructions" and
   * "all" map to approveWorkspace; Phase 17 swaps the body of
   * WorkspaceTrustFilter for per-capability lookup). Then trigger a
   * manager.rescan so the next changed event applies with the updated trust
   * filter.
   *
   * Returns `{ ok: true }` on success. Throws when {@link workspaceId}
   * cannot be parsed as a positive integer — the IPC layer's
   * registerValidatedHandler catches and surfaces this as a status:false
   * envelope, keeping the boundary fail-closed for invalid input.
   */
  async setTrust(request: WorkspaceTrustSetRequest): Promise<{ ok: boolean }> {
    const id = Number(request.workspaceId);
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(
        `setTrust: invalid workspaceId "${request.workspaceId}" (expected positive integer)`
      );
    }
    const updated = await this.workspaceModule.approveWorkspace(id);
    if (!updated) {
      // Record vanished mid-flight (concurrent revoke). Surface as ok:false
      // — the renderer keeps the trust card visible and the user can retry.
      return { ok: false };
    }
    // Mirror into the sync approval cache so the manager's trustResolver
    // sees approved=true when the rescan's snapshot arrives.
    this.approvalSink?.(String(id));
    // Re-apply with the new trust flags. The next snapshot's apply will see
    // the updated approval state via the resolver + derivePhase14Trust.
    this.manager.rescan(String(id));
    return { ok: true };
  }
}
