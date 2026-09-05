/**
 * WorkspaceChokidarWatcher — WAT-05 chokidar wrapper + 500ms debounce +
 * monotonic scan generations.
 *
 * Lives under src/childprocess/aifetchly-config/ per CLAUDE.md mandate (it is
 * worker-specific: only the worker process ever needs to instantiate chokidar
 * directly). The main process NEVER imports chokidar — it drives watchers
 * through the worker's IPC protocol (design §9.6).
 *
 * Prohibited imports (WorkerNoDbBoundary grep gate):
 *   - the Electron main module
 *   - the ORM
 *   - the @/modules business-logic tree
 *   - the @/model DB-model tree
 *   - any direct repository/datasource/SqliteDb symbol
 * This file uses only: chokidar, node path, and pure helpers. The shared
 * scanner/parser/limits helpers under @/service/aifetchlyConfig are pure
 * (no DB coupling — verified Phase 13-01) and are imported by the
 * worker-side wrapper, NOT here.
 *
 * §9.6 contract:
 *   - One chokidar FSWatcher per workspace instance.
 *   - One debounce timer per workspace (500ms per WAT-05).
 *   - Monotonic generation counter increments on each debounce-fire; callers
 *     tag scans with the generation at scan-start and discard any scan whose
 *     generation is older than the current counter.
 *
 * Chokidar options (PINNED, do not drift):
 *   - ignoreInitial: true (the watch-workspace command emits the initial
 *     snapshot explicitly — chokidar's "add" burst would duplicate it).
 *   - awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 } —
 *     handles atomic-save (editor temp+rename) + large-file copies by waiting
 *     for size stability. 500ms threshold aligns with the debounce window.
 *   - atomic: true — emits unlink+add (not a partial-read change) for atomic
 *     writes (temp file → rename). Backstops the rename-missed-event case.
 *   - depth: 5 — bound recursion (defense in depth; .aifetchly is shallow).
 *   - persistent: true — keep the worker alive across watches.
 *   - scoped globs to .aifetchly/** + optional root AGENTS.md ONLY (never the
 *     whole workspace; design §9.5).
 *   - ignored: node_modules and .git hygiene (defense in depth; the scoped
 *     watchPaths already restricts scope).
 */

import chokidar, { type FSWatcher } from "chokidar";
import * as path from "path";

const WATCH_DEBOUNCE_MS = 500; // §9.6

/**
 * Public interface returned by createWorkspaceWatcher. Methods (not bare
 * fields) so callers can be agnostic to internal state layout.
 */
export interface WorkspaceWatcherHandle {
  /** The underlying chokidar FSWatcher (exposed for event-emitter tests). */
  readonly watcher: FSWatcher;
  /**
   * Bump the generation counter. Exposed for tests that want to assert the
   * starting value; production callers use getLastGeneration().
   */
  bumpGeneration(): void;
  /** Current generation value (monotonic; starts at 0). */
  getLastGeneration(): number;
  /** Close the underlying watcher + clear any pending debounce timer. */
  close(): Promise<void>;
}

/**
 * Create a chokidar watcher scoped to the workspace's .aifetchly/ subtree
 * (and optionally the root AGENTS.md). The `onDebouncedChange` callback is
 * invoked ONCE per burst of events after a 500ms quiet window; the
 * generation counter is bumped exactly once per callback invocation.
 *
 * Callers (the worker) tag each scan with `getLastGeneration()` at scan
 * start; if the generation has advanced by the time the scan completes,
 * the scan is stale and the result is discarded (design §9.6).
 */
export function createWorkspaceWatcher(
  workspaceRoot: string,
  includeRootAgentsFile: boolean,
  onDebouncedChange: () => void
): WorkspaceWatcherHandle {
  const watchPaths: string[] = [path.join(workspaceRoot, ".aifetchly")];
  if (includeRootAgentsFile) {
    watchPaths.push(path.join(workspaceRoot, "AGENTS.md"));
  }

  let generation = 0;
  let timer: NodeJS.Timeout | null = null;

  const fire = (): void => {
    timer = null;
    generation += 1;
    onDebouncedChange();
  };

  const debounced = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(fire, WATCH_DEBOUNCE_MS);
  };

  const watcher = chokidar.watch(watchPaths, {
    ignored: (testPath: string) =>
      /(^|[/\\])node_modules([/\\]|$)/.test(testPath) ||
      /(^|[/\\])\.git([/\\]|$)/.test(testPath) ||
      // Portable-memory atomic-write temp files (write-file-atomic): the
      // final rename triggers the debounced scan; temp churn is noise
      // (design §12.1).
      /(^|[/\\])(?:[^/\\]*\\.(?:tmp|bak)|\\.[^/\\]*\\.tmp)$/.test(testPath),
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
    atomic: true,
    persistent: true,
    depth: 5,
  });

  watcher.on("add", debounced);
  watcher.on("change", debounced);
  watcher.on("unlink", debounced);
  watcher.on("addDir", debounced);
  watcher.on("unlinkDir", debounced);

  return {
    watcher,
    bumpGeneration: () => {
      generation += 1;
    },
    getLastGeneration: () => generation,
    close: async () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await watcher.close();
    },
  };
}
