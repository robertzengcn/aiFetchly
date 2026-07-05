/**
 * Pure type declarations for the workspace config watcher stack (Phase 14).
 *
 * This module is the single source of truth for the data contracts shared by
 * the watcher manager (main process), the worker entry, the IPC layer, and
 * tests. It is intentionally dependency-free: no Electron, TypeORM, Vue, or
 * service imports, so it can be imported from any process context.
 *
 * Concrete command/event shapes live in WorkspaceWatchProtocol.ts (zod
 * schemas + inferred types) and are re-exported from here so callers have a
 * single type-import surface for the watcher stack.
 */

import type { AIFetchlyConfigSnapshot } from "@/entityTypes/aifetchlyConfigTypes";
// Re-export the protocol command/event types so consumers can import every
// watcher-related type from this module. The runtime zod schemas remain in
// WorkspaceWatchProtocol.ts (this is a type-only re-export to preserve the
// "no runtime deps" invariant).
export type {
  WorkspaceWatchCommand,
  WorkspaceWatchEvent,
} from "@/service/workspaceWatch/WorkspaceWatchProtocol";

/**
 * Input to WorkspaceWatchManager.acquire(): identifies the workspace being
 * watched and the consumer that requested the watch (reference-count key).
 */
export interface WorkspaceWatchAcquireInput {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  /**
   * Consumer identifier for reference counting. Convention: scoped by use
   * site, e.g. "chat:<conversationId>", "stream:<id>", "agent:<id>",
   * "tool:<id>" (design §9.3 / §10.1).
   */
  readonly consumerId: string;
  /** Free-form reason for observability (e.g. "chat-open", "stream-start"). */
  readonly reason?: string;
}

/**
 * Per-workspace state tracked by the watch manager.
 *
 * `consumers` is the reference-count set: 0 consumers → unwatch + (if no
 * other workspace is watched) worker shutdown. The set is Readonly in the
 * public interface; the manager owns mutation internally.
 */
export interface WatchedWorkspaceState {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly consumers: ReadonlySet<string>;
  /** Last applied snapshot (initial null until the first worker event). */
  readonly lastSnapshot?: AIFetchlyConfigSnapshot;
}

/**
 * Aggregate manager status surfaced to /status and diagnostics.
 *
 * Phase 14 fields mirror design §9.3. `workerState` transitions:
 *   "not-started" (0 watched) → "running" → "restarting" → "failed"
 *     (restart cap exceeded; manual /reload-config retry).
 */
export interface WorkspaceWatchManagerStatus {
  /** "not-started" | "running" | "restarting" | "failed" */
  readonly workerState: string;
  /** Number of currently-watched workspaces (length of watched map). */
  readonly watchedCount: number;
  /** Restart timestamps within the sliding 60s window (WAT-07). */
  readonly recentRestarts: readonly number[];
  /** Whether the restart cap has been exceeded (auto-watch paused). */
  readonly restartCapExceeded: boolean;
  /** Per-workspace summary (id + consumer count + has-snapshot flag). */
  readonly watched: ReadonlyArray<{
    readonly workspaceId: string;
    readonly consumerCount: number;
    readonly hasSnapshot: boolean;
  }>;
}
