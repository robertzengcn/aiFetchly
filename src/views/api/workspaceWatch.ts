// src/views/api/workspaceWatch.ts
// Phase 14 (Plan 14-04) — renderer-side wrappers for the workspace-watcher
// IPC surface (the four invoke channels registered in Plan 14-03). Mirrors
// the flat windowInvoke pattern of src/views/api/slashCommands.ts and
// src/views/api/workspace.ts.
//
// Trust & security boundary (TRS-07 / CFG-02):
//   - This file MUST NOT import fs/path/os or touch the filesystem. The
//     renderer reaches the main process ONLY through the preload invoke
//     whitelist. Plan 14-05 enforces this with the boundary grep test
//     (rendererNoFsAccessToAifetchly.test.ts) that walks src/views/**.
//   - previewWorkspaceAgents returns the AGENTS.md file BODY string from
//     the main process — never a path the renderer could re-read.
//   - acquireWorkspaceWatch accepts only conversationId + an optional
//     workspaceId hint; it NEVER sends a workspaceRoot. Main re-resolves
//     the approved root via WorkspaceResolver (CFG-02).
//
// None of these wrappers are AI-gated: the watcher loads local config
// files, not AI output. CLAUDE.md's USER_AI_ENABLED rule applies to
// handlers that execute AI work; acquire/release/preview/setTrust do not.

import { windowInvoke } from "@/views/utils/apirequest";
import {
  AIFETCHLY_WORKSPACE_WATCH_ACQUIRE,
  AIFETCHLY_WORKSPACE_WATCH_RELEASE,
  AIFETCHLY_WORKSPACE_TRUST_PREVIEW,
  AIFETCHLY_WORKSPACE_TRUST_SET,
} from "@/config/channellist";
import type {
  WorkspaceTrustScope,
  WorkspaceWatchAcquireRequest,
  WorkspaceWatchAcquireResponse,
  WorkspaceWatchReleaseRequest,
  WorkspaceTrustPreviewResponse,
  WorkspaceTrustSetRequest,
  WorkspaceTrustSetResponse,
} from "@/entityTypes/aiChatV2Types";

/**
 * Acquire a watch on behalf of the chat consumer `chat:<conversationId>`.
 * Called on chat-open with an approved workspace (Plan 14-04 wiring in
 * AiChatV2.vue). Returns the resolved workspaceId token (serialised DB
 * primary key) that the renderer passes back on release/preview/setTrust,
 * or null when no approved workspace exists (fail-closed — CFG-02).
 *
 * Non-throwing on the unhappy path: windowInvoke throws on status:false,
 * so callers MUST wrap in try/catch and treat failure as non-fatal (chat
 * still works without live-update — the user can /reload-config).
 */
export async function acquireWorkspaceWatch(
  request: WorkspaceWatchAcquireRequest
): Promise<WorkspaceWatchAcquireResponse | null> {
  return windowInvoke(
    AIFETCHLY_WORKSPACE_WATCH_ACQUIRE,
    request
  ) as Promise<WorkspaceWatchAcquireResponse | null>;
}

/**
 * Release the chat consumer's claim on its workspace. Called on chat-close,
 * unmount, or workspace switch (release old + acquire new). Idempotent —
 * releasing an un-watched workspace is a no-op on the main side.
 */
export async function releaseWorkspaceWatch(
  request: WorkspaceWatchReleaseRequest
): Promise<void> {
  await windowInvoke(AIFETCHLY_WORKSPACE_WATCH_RELEASE, request);
}

/**
 * Read the workspace's AGENTS.md content body from the main process. The
 * main side reads from its cached snapshot (produced by the worker) — the
 * renderer NEVER touches the filesystem (TRS-07). Returns the empty string
 * when no preview is available (workspace not watched, no AGENTS.md, or
 * empty content) so callers can render without a separate null branch.
 *
 * The returned string is the file BODY, never a path. Even a compromised
 * renderer cannot re-read the file from this response.
 */
export async function previewWorkspaceAgents(
  workspaceId: string
): Promise<string> {
  const response = (await windowInvoke(AIFETCHLY_WORKSPACE_TRUST_PREVIEW, {
    workspaceId,
  })) as WorkspaceTrustPreviewResponse | null;
  return response?.content ?? "";
}

/**
 * Set the workspace trust scope (TRS-03 prompt actions). Phase 14 binary
 * gate: both "instructions" and "all" approve the workspace; Phase 17
 * branches on scope for per-capability trust. Returns `{ ok: true }` on
 * success or `{ ok: false }` when the underlying approval write returned
 * null (record deleted mid-flight via concurrent revoke) — the renderer
 * keeps the trust card visible for retry in that case.
 */
export async function setWorkspaceTrust(
  request: WorkspaceTrustSetRequest
): Promise<WorkspaceTrustSetResponse> {
  return windowInvoke(AIFETCHLY_WORKSPACE_TRUST_SET, {
    workspaceId: request.workspaceId,
    scope: request.scope satisfies WorkspaceTrustScope,
  }) as Promise<WorkspaceTrustSetResponse>;
}
