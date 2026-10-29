// src/service/workspaceWatch/WorkspaceWatchManagerSingleton.ts
// Phase 14 (Plan 14-03) → Phase 17 (Plan 02 Task 2b): production wiring for
// the {@link WorkspaceWatchManager} singleton. Owns:
//   - The single manager instance (constructed lazily on first init).
//   - An ENTITY-BACKED synchronous workspace-trust cache that backs the
//     manager's trustResolver. Phase 17 replaces Phase 14's binary in-memory
//     approval map with a per-capability AIFetchlySourceTrust cache hydrated
//     from the persisted AIFetchlyWorkspaceTrust entity (TRS-02 / D-Migration).
//   - The emitter wiring (manager → BrowserWindow.webContents.send via the
//     shared {@link forwardManagerEvent} adapter — D-04 reuses
//     AIFETCHLY_CONFIG_CHANGED additively).
//
// Trust cache lifecycle (Phase 17):
//   - Lazily populated same-session: markWorkspaceApproved sets ALL_TRUE;
//     revokeWorkspaceTrust sets ALL_FALSE and triggers a manager.rescan so the
//     next applyWorkspaceSnapshot drops the source's hooks immediately
//     (Pitfall 2 — revoke reflects without an app restart, removing Phase 14's
//     documented limitation).
//   - hydrateWorkspaceTrustFromEntity reads the persisted entity for a
//     workspace root — the durable source — so a workspace trusted before this
//     session is honored on the first worker event without re-approval.
//   - Cross-restart durability is owned by WorkspaceModule.approveWorkspace
//     (sets approvalState='approved') + the Plan 01 migration seed (backfills
//     approved workspaces to ALL_TRUE on the next launch); the cache only has
//     to cover the current session.
//
// The trustResolver stays SYNCHRONOUS (Pitfall 5 sync/async bridge): it reads
// the in-memory map; the entity is the durable source hydrated via async paths.
//
// Design references: design §9.3 (manager types), §10.1 (acquire flow),
// §13.1 (Phase 14 binary gate vs Phase 17 per-capability entity).

import type { BrowserWindow } from "electron";
import { WorkspaceWatchManager } from "./WorkspaceWatchManager";
import { forwardManagerEvent } from "@/main-process/communication/workspace-watch-ipc";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import { AIFetchlyWorkspaceTrustModule } from "@/modules/AIFetchlyWorkspaceTrustModule";
import { computeWorkspaceRootHash } from "@/model/AIFetchlyWorkspaceTrust.model";
import type { AIFetchlySourceTrust } from "@/entityTypes/aifetchlyConfigTypes";
import { PortableWorkspaceMemorySyncCoordinator } from "@/service/PortableWorkspaceMemorySyncCoordinator";
import { AI_PORTABLE_WORKSPACE_MEMORY_CHANGED } from "@/config/channellist";
import type { PortableMemorySyncSummary } from "@/entityTypes/portableWorkspaceMemoryTypes";

let singleton: WorkspaceWatchManager | null = null;

/**
 * ONE shared portable-memory sync coordinator for the whole app (design
 * §13.3). Constructed lazily beside the manager; never per event. Its
 * renderer summaries ride the dedicated ai:portable-workspace-memory:changed
 * channel (main → renderer).
 */
let sharedPortableCoordinator: PortableWorkspaceMemorySyncCoordinator | null =
  null;

export function getSharedPortableMemorySyncCoordinator(): PortableWorkspaceMemorySyncCoordinator {
  if (!sharedPortableCoordinator) {
    // Constructed WITHOUT an emitter; the BrowserWindow sink is attached
    // later by initWorkspaceWatchManager via attachPortableMemorySummarySink
    // (AC-002). setEmitter is honored on every emit, so summaries emitted
    // before the sink is attached are dropped (advisory) rather than
    // permanently lost behind a stale closure.
    sharedPortableCoordinator = new PortableWorkspaceMemorySyncCoordinator({});
  }
  return sharedPortableCoordinator;
}

/**
 * Attach the renderer summary sink (the (channel, payload) → webContents.send
 * adapter) to the shared coordinator. Called by initWorkspaceWatchManager
 * once the BrowserWindow is available, and by tests.
 */
export function attachPortableMemorySummarySink(
  sink: ((summary: PortableMemorySyncSummary) => void) | null
): void {
  portableSummarySink = sink;
  if (sharedPortableCoordinator) {
    sharedPortableCoordinator.setEmitter(
      sink ? (summary) => portableSummarySink?.(summary) : null
    );
  }
}

/** Test-only: clear the sink so the next construction starts clean. */
export function resetPortableSummarySinkForTests(): void {
  portableSummarySink = null;
  sharedPortableCoordinator = null;
}

let portableSummarySink: ((summary: PortableMemorySyncSummary) => void) | null =
  null;

/** All five capabilities trusted (D-TrustUX block-write value). */
const ALL_TRUE: AIFetchlySourceTrust = Object.freeze({
  instructions: true,
  commands: true,
  agents: true,
  hooks: true,
  skills: true,
});
/** No capabilities trusted — the fail-closed value for absent/revoked rows. */
const ALL_FALSE: AIFetchlySourceTrust = Object.freeze({
  instructions: false,
  commands: false,
  agents: false,
  hooks: false,
  skills: false,
});

/**
 * Synchronous per-capability trust cache backing the manager's trustResolver.
 * Keyed by serialised workspace DB primary key (string), matching the
 * workspaceId convention used throughout the watcher stack. The manager's
 * trustResolver is synchronous (Pitfall 5); this map is the sync-read cache,
 * and the persisted AIFetchlyWorkspaceTrust entity is the durable source
 * hydrated via the async paths below.
 */
const trustCache = new Map<string, AIFetchlySourceTrust>();

/**
 * Under D-TrustUX all five flags track the same binary approval, so a workspace
 * is "trusted" iff every flag is true. Fail-closed for absent rows (the map
 * returns undefined → not trusted).
 */
function isFullyTrusted(trust: AIFetchlySourceTrust | undefined): boolean {
  return (
    trust !== undefined &&
    trust.instructions &&
    trust.commands &&
    trust.agents &&
    trust.hooks &&
    trust.skills
  );
}

/**
 * Synchronous trust read for a workspace (Pitfall 5 bridge). Returns true iff
 * the entity-backed cache holds an all-true trust entry for the workspace.
 * This is the exact predicate the manager's trustResolver uses, exposed so the
 * trust path is testable without initializing the full manager (which needs a
 * BrowserWindow).
 */
export function isWorkspaceTrusted(workspaceId: string): boolean {
  return isFullyTrusted(trustCache.get(workspaceId));
}

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
  attachPortableMemorySummarySink((summary) => {
    try {
      win.webContents.send(AI_PORTABLE_WORKSPACE_MEMORY_CHANGED, {
        scopeId: summary.scopeId,
        complete: summary.complete,
        imported: summary.imported,
        unchanged: summary.unchanged,
        rejected: summary.rejected,
        conflicted: summary.conflicted,
        pendingReview: summary.pendingReview,
        deleted: summary.deleted,
      });
    } catch {
      // Window may be closing — summaries are advisory.
    }
  });
  singleton = new WorkspaceWatchManager({
    applySnapshotCallback: (snapshot, trust) =>
      registrySync.applyWorkspaceSnapshot(snapshot, trust),
    configChangedEmitter: (event) => forwardManagerEvent(win, event),
    // Portable memory (design §13.1): fire-and-forget enqueue through the
    // shared coordinator. The manager never awaits synchronization here.
    portableMemorySnapshotCallback: (input) => {
      if (!input.snapshot) return;
      void getSharedPortableMemorySyncCoordinator().enqueueSnapshot({
        workspaceId: input.workspaceId,
        workspaceRoot: input.workspaceRoot,
        approved: input.approved,
        snapshot: input.snapshot,
      });
    },
    // Pitfall 5: synchronous read from the entity-backed cache. The manager
    // signature requires (workspaceId) => boolean; derivePhase14Trust then
    // propagates the boolean to every capability flag (D-TrustUX), so an
    // approved workspace trusts hooks (SC1) and a revoked one drops them.
    trustResolver: (workspaceId: string) => isWorkspaceTrusted(workspaceId),
  });
  return singleton;
}

/** Return the singleton, or null before {@link initWorkspaceWatchManager}. */
export function getWorkspaceWatchManager(): WorkspaceWatchManager | null {
  return singleton;
}

/**
 * Mark {@link workspaceId} as approved (all-true) in the sync trust cache.
 * Called by WorkspaceWatchModule after resolver.resolve confirms approval
 * (acquire) or after WorkspaceModule.approveWorkspace succeeds (setTrust).
 *
 * Same-session durability is the cache; cross-restart durability is owned by
 * WorkspaceModule.approveWorkspace (sets approvalState='approved') + the Plan 01
 * migration seed, so this function only updates the in-memory cache. Safe to
 * call from any path — the cache is read by the manager's trustResolver closure
 * on the same Node event loop.
 */
export function markWorkspaceApproved(workspaceId: string): void {
  trustCache.set(workspaceId, { ...ALL_TRUE });
}

/**
 * Revoke trust for {@link workspaceId} (Pitfall 2 — revoke-reflects). Sets the
 * sync cache to all-false and triggers a manager.rescan so the next
 * applyWorkspaceSnapshot drops the source's hooks/commands/agents via the
 * Task 2a trust filter + replaceSource(sourceId, []) — WITHOUT an app restart
 * (the Phase 14 limitation). Cross-restart, the caller is expected to clear the
 * WorkspaceEntity approvalState so the migration seed does not re-seed it.
 */
export function revokeWorkspaceTrust(workspaceId: string): void {
  trustCache.set(workspaceId, { ...ALL_FALSE });
  // Trigger an immediate re-apply so the now-untrusted capabilities are dropped
  // right away (best-effort; no-op before the manager singleton is initialized).
  if (singleton) {
    try {
      singleton.rescan(workspaceId);
    } catch {
      // Rescan is best-effort — a failure here must not unwind the revoke. The
      // cache is already all-false, so the next worker event drops the hooks.
    }
  }
}

/**
 * Hydrate the sync trust cache for a workspace from the persisted
 * {@link AIFetchlyWorkspaceTrust} entity (the durable source). Used by the
 * acquire path so a workspace trusted before this session is honored on the
 * first worker event. Fail-closed (all-false) when the entity read fails or the
 * row is absent. Async — callers must not block the sync trustResolver on it.
 */
export async function hydrateWorkspaceTrustFromEntity(
  workspaceId: string,
  rootPath: string
): Promise<void> {
  try {
    const trustModule = new AIFetchlyWorkspaceTrustModule();
    const hash = computeWorkspaceRootHash(rootPath);
    const trust = await trustModule.getTrust(hash);
    trustCache.set(workspaceId, trust ? { ...trust } : { ...ALL_FALSE });
  } catch {
    // DB not ready / read error — fail-closed.
    trustCache.set(workspaceId, { ...ALL_FALSE });
  }
}

/** Test-only: wipe the trust cache so tests do not leak across cases. */
export function resetTrustCacheForTests(): void {
  trustCache.clear();
}
