/**
 * WorkspaceConfigWatchWorker — D-02 pure-Node fork target.
 *
 * Spawned via child_process.fork() by WorkspaceWatchManager (Plan 14-02).
 * Communicates ONLY via process.on('message') / process.send() — there is no
 * Electron/ORM/DB surface reachable from this file (WAT-02 enforced by
 * construction: child_process.fork yields a pure-Node child).
 *
 * Prohibited imports (WorkerNoDbBoundary grep gate):
 *   - the Electron main module (cannot be required from a forked child)
 *   - the ORM
 *   - the @/modules business-logic tree
 *   - the @/model DB-model tree
 *   - any repository/datasource/SqliteDb symbol
 * Imports allowed: the protocol schemas (@/service/workspaceWatch/WorkspaceWatchProtocol),
 * the shared scanner (@/service/workspaceWatch/WorkspaceConfigScanner), the
 * worker-side scan wrapper (./workerScanner), the chokidar wrapper
 * (./WorkspaceChokidarWatcher), Phase 13 frontmatter helpers (pure, no DB),
 * and stdlib (path, fs, crypto).
 *
 * Lifecycle (design §9.6 + §9.8):
 *   main → watch-workspace  : create watcher + initial scan → emit {snapshot}
 *   main → unwatch-workspace: close watcher + drop state
 *   main → rescan-workspace : scan + diff vs lastSnapshot → emit {changed, diff}
 *   main → shutdown         : close all watchers (do NOT process.exit; main
 *                             owns the lifecycle and sends SIGTERM after a
 *                             timeout — WAT-07)
 *   FS event → debounce     : bump generation + scan → emit {changed, diff}
 *   uncaughtException /
 *   unhandledRejection       : emit {error, recoverable:false} + exit non-zero
 *                             (main restarts per WAT-07 restart-cap)
 *
 * Scan generations (§9.6): each scan tags itself with the watcher's generation
 * at scan-start; if the generation advances during the scan (another debounce
 * fired), the worker discards the stale scan and does not emit. This is the
 * primary defense against out-of-order results; main re-validates (Plan 14-02).
 */

import { computeSnapshotDiff } from "@/service/aifetchlyConfig/AIFetchlyConfigSnapshotDiff";
import type { AIFetchlyConfigSnapshot } from "@/entityTypes/aifetchlyConfigTypes";
import {
  workerCommandSchema,
  type WorkspaceWatchCommand,
  type WorkspaceWatchEvent,
} from "@/service/workspaceWatch/WorkspaceWatchProtocol";
import {
  createWorkspaceWatcher,
  type WorkspaceWatcherHandle,
} from "./WorkspaceChokidarWatcher";

/** parentPort — the utilityProcess transport (R4.6: process.send → parentPort). */
const parentPort = (
  process as unknown as {
    parentPort?: {
      on: (event: "message", cb: (e: { data: unknown }) => void) => void;
      postMessage: (msg: unknown) => void;
    };
  }
).parentPort;
import { scanWorkspace } from "./workerScanner";

/**
 * Per-workspace worker state. The worker maintains one entry per active
 * watch-workspace command; unwatch-workspace deletes the entry.
 */
interface WatchedEntry {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly handle: WorkspaceWatcherHandle;
  lastSnapshot: AIFetchlyConfigSnapshot | null;
}

const watched = new Map<string, WatchedEntry>();

/** Send a typed event to the parent process via parentPort. */
function emit(event: WorkspaceWatchEvent): void {
  if (parentPort) {
    parentPort.postMessage(event);
  }
}

/** Emit a worker→main error event. Message length capped per §14.4 (2000 chars). */
function emitError(
  workspaceId: string,
  message: string,
  recoverable: boolean
): void {
  const trimmed = message.length > 2000 ? message.slice(0, 2000) : message;
  emit({ type: "error", workspaceId, message: trimmed, recoverable });
}

/**
 * Run a scan with generation-staleness guard. Returns false if the scan was
 * discarded (stale), true if it was applied + emitted.
 *
 * Sequence (design §9.6):
 *   1. Snapshot the generation at scan-start.
 *   2. Run the scan (async, may take 10–500ms for typical .aifetchly trees).
 *   3. Re-check generation: if it advanced during the scan, discard.
 *   4. Diff against lastSnapshot; update lastSnapshot; emit {snapshot|changed}.
 */
async function runScan(
  entry: WatchedEntry,
  options: { readonly initial: boolean }
): Promise<boolean> {
  const startGen = entry.handle.getLastGeneration();
  try {
    const snapshot = await scanWorkspace({
      workspaceId: entry.workspaceId,
      workspaceRoot: entry.workspaceRoot,
      includeRootAgentsFile: true, // §9.5 watch the root AGENTS.md too
    });
    // Stale-check: if a later debounce fired during the scan, drop this result.
    if (entry.handle.getLastGeneration() !== startGen) {
      return false;
    }
    const prev = entry.lastSnapshot;
    entry.lastSnapshot = snapshot;
    if (options.initial || prev === null) {
      emit({ type: "snapshot", workspaceId: entry.workspaceId, snapshot });
    } else {
      const diff = computeSnapshotDiff(prev, snapshot);
      emit({ type: "changed", workspaceId: entry.workspaceId, snapshot, diff });
    }
    return true;
  } catch (err) {
    // Scanner never throws per contract, but defense-in-depth: never let an
    // unexpected exception cascade — surface as a recoverable error event.
    const message = err instanceof Error ? err.message : String(err);
    emitError(entry.workspaceId, `scan failed: ${message}`, true);
    return false;
  }
}

/** Handle a parsed main→worker command. */
async function handleCommand(cmd: WorkspaceWatchCommand): Promise<void> {
  switch (cmd.type) {
    case "watch-workspace": {
      // Idempotent: re-watch replaces the existing entry (main should send
      // unwatch first, but we tolerate a duplicate watch defensively).
      const existing = watched.get(cmd.workspaceId);
      if (existing) {
        await existing.handle.close();
      }
      const handle = createWorkspaceWatcher(
        cmd.workspaceRoot,
        cmd.includeRootAgentsFile,
        // Debounce callback: bump generation + run a scan. The generation
        // bump happens INSIDE createWorkspaceWatcher's debounce-fire; we
        // just trigger the scan here.
        () => {
          const entry = watched.get(cmd.workspaceId);
          if (!entry) return; // unwatched between debounce-fire and scan-start
          void runScan(entry, { initial: false });
        }
      );
      const entry: WatchedEntry = {
        workspaceId: cmd.workspaceId,
        workspaceRoot: cmd.workspaceRoot,
        handle,
        lastSnapshot: null,
      };
      watched.set(cmd.workspaceId, entry);
      // Initial snapshot — emit {snapshot} so main can apply it trust-filtered.
      await runScan(entry, { initial: true });
      return;
    }

    case "unwatch-workspace": {
      const entry = watched.get(cmd.workspaceId);
      if (entry) {
        watched.delete(cmd.workspaceId);
        await entry.handle.close();
      }
      return;
    }

    case "rescan-workspace": {
      const entry = watched.get(cmd.workspaceId);
      if (!entry) return; // not currently watched — no-op
      await runScan(entry, { initial: false });
      return;
    }

    case "shutdown": {
      // Close all watchers. Main owns the lifecycle — do NOT process.exit;
      // main sends SIGTERM then force-kills after a timeout (WAT-07).
      const entries = Array.from(watched.values());
      watched.clear();
      await Promise.all(entries.map((e) => e.handle.close()));
      return;
    }

    default: {
      // Exhaustiveness check — if a new command is added to the schema
      // without a handler here, TypeScript flags it at compile time.
      const _exhaustive: never = cmd;
      void _exhaustive;
      return;
    }
  }
}

/**
 * Worker entry point. Initialise the IPC listener + crash handlers. The
 * worker-ready signal defers to the first watch-workspace response (the
 * initial {snapshot} event) — main treats the lack of a ready event as
 * "worker is alive but idle", which is the correct state for a worker with
 * zero watched workspaces.
 */
function initializeWorker(): void {
  parentPort?.on("message", (e: { data: unknown }) => {
    const raw = e.data;
    // Defense-in-depth: main is trusted, but the worker guards anyway. A
    // malformed message is logged and dropped (no crash — main will retry).
    const parsed = workerCommandSchema.safeParse(raw);
    if (!parsed.success) {
      // Malformed inbound — log to stderr (visible to main via child.stdio)
      // and drop. Main is buggy if this happens; restart is unnecessary.
      const placeholder = "dropped malformed inbound message";
      // eslint-disable-next-line no-console
      console.warn(
        `[WorkspaceConfigWatchWorker] ${placeholder}:`,
        parsed.error.message
      );
      return;
    }
    void handleCommand(parsed.data).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // We don't know which workspace this command targeted (it could be a
      // multi-workspace command like shutdown). Use a sentinel id; main
      // routes the error event by process state, not by workspaceId.
      emitError("__unknown__", `command handler failed: ${message}`, true);
    });
  });

  process.on("uncaughtException", (error) => {
    // §9.8: emit a non-recoverable error event then exit non-zero. Main
    // restarts per WAT-07 restart-cap.
    const message = error.message || "uncaughtException";
    emitError("__unknown__", `uncaughtException: ${message}`, false);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    emitError("__unknown__", `unhandledRejection: ${message}`, false);
    process.exit(1);
  });
}

// Worker bootstrap — matches the ContactExtractionWorker pattern. The
// WORKER_TYPE env marker is set by the main process when forking.
if (require.main === module || process.env.WORKER_TYPE === "aifetchly-config") {
  initializeWorker();
}

export { initializeWorker };
