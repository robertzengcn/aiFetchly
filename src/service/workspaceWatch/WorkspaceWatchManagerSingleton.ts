// src/service/workspaceWatch/WorkspaceWatchManagerSingleton.ts
// Phase 14 (Plan 14-03) — production wiring for the {@link WorkspaceWatchManager}
// singleton. Owns:
//   - The single manager instance (constructed lazily on first init).
//   - A synchronous workspace-approval cache that backs the manager's
//     trustResolver. Phase 14 binary gate: approved cache = true means the
//     manager applies instructions+commands from snapshots; absent or false
//     means it drops them (TRS-01 fail-closed).
//   - The emitter wiring (manager → BrowserWindow.webContents.send via the
//     shared {@link forwardManagerEvent} adapter — D-04 reuses
//     AIFETCHLY_CONFIG_CHANGED additively).
//
// Approval cache lifecycle:
//   - On acquire: WorkspaceWatchModule writes cache[workspaceId] = true after
//     the async WorkspaceResolver confirms approval. The manager's sync
//     trustResolver then sees true for every subsequent worker event.
//   - On setTrust: WorkspaceWatchModule writes cache[workspaceId] = true
//     after the WorkspaceModule.approveWorkspace write succeeds.
//   - Phase 14 does NOT surface a revoke path through the trust card. The
//     existing workspace-revoke IPC (Phase 12) updates the DB; the cache
//     stays stale until the next app restart. Documented as a known
//     limitation — Phase 17 replaces this cache with a per-capability entity.
//
// Design references: design §9.3 (manager types), §10.1 (acquire flow),
// §13.1 (Phase 14 binary gate). Plan 14-02 SUMMARY handoff notes that
// 14-03 supplies the resolver-backed trustResolver; this file is that
// supply.

import type { BrowserWindow } from "electron";
import { WorkspaceWatchManager } from "./WorkspaceWatchManager";
import { forwardManagerEvent } from "@/main-process/communication/workspace-watch-ipc";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";

let singleton: WorkspaceWatchManager | null = null;

/**
 * Synchronous approval cache backing the manager's trustResolver. The manager
 * signature requires a sync resolver; WorkspaceResolver.resolve is async. We
 * bridge by populating this cache from async paths (acquire, setTrust) and
 * reading it synchronously inside the manager's emitter callback.
 *
 * Keyed by serialised workspace DB primary key (string), matching the
 * workspaceId convention used throughout the watcher stack.
 */
const approvalCache = new Map<string, boolean>();

/**
 * Construct (first call) or return the existing {@link WorkspaceWatchManager}
 * singleton. The {@link win} argument is captured in the emitter closure so
 * the manager can forward worker events to the renderer. Subsequent calls
 * return the same instance regardless of {@link win} (the original window
 * reference is retained — Phase 14 is single-window).
 *
 * Construction is lazy so app launch is NEVER blocked on the watcher (research
 * §Anti-Patterns). The worker is forked only on the first acquire.
 */
export function initWorkspaceWatchManager(
  win: BrowserWindow
): WorkspaceWatchManager {
  if (singleton) return singleton;
  const configManager = getAIFetchlyConfigManager();
  const registrySync = configManager.getRegistrySync();
  singleton = new WorkspaceWatchManager({
    applySnapshotCallback: (snapshot, trust) =>
      registrySync.applyWorkspaceSnapshot(snapshot, trust),
    configChangedEmitter: (event) => forwardManagerEvent(win, event),
    trustResolver: (workspaceId: string) =>
      approvalCache.get(workspaceId) ?? false,
  });
  return singleton;
}

/** Return the singleton, or null before {@link initWorkspaceWatchManager}. */
export function getWorkspaceWatchManager(): WorkspaceWatchManager | null {
  return singleton;
}

/**
 * Mark {@link workspaceId} as approved (trusted) in the sync cache. Called
 * by WorkspaceWatchModule after resolver.resolve confirms approval (acquire)
 * or after WorkspaceModule.approveWorkspace succeeds (setTrust).
 *
 * Safe to call from any path — the cache is only read by the manager's
 * trustResolver closure, which runs on the same Node event loop.
 */
export function markWorkspaceApproved(workspaceId: string): void {
  approvalCache.set(workspaceId, true);
}
