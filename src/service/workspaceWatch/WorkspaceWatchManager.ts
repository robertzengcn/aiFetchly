/**
 * WorkspaceWatchManager — main-process owner of the watcher worker lifecycle.
 *
 * Owns:
 *   - Per-workspace consumer-set reference counting (WAT-01, WAT-03).
 *     Exactly ONE child_process worker serves ALL acquired workspaces.
 *     0 watched → no worker. 0→1 transition spawns; 1→0 kills.
 *   - Workspace switch (WAT-04 / SC2): release(old) + acquire(new) +
 *     rescan(new) produces an immediate fresh snapshot for the renderer.
 *   - Main-side zod validation of every worker→main message (WAT-06).
 *     Malformed → terminateAndRestart → re-fork under cap.
 *   - Crash-restart accounting via {@link WorkspaceWatchRestarter} (WAT-07):
 *     max 3/60s; exceeded → 'failed' + emit error. Full rescan on restart.
 *   - Trust filter boundary: routes every worker snapshot through the
 *     injected applySnapshotCallback(snapshot, trust) where trust is
 *     derived from {@link WorkspaceTrustFilter.derivePhase14Trust} based on
 *     the injected trustResolver (TRS-01). The manager has NO direct
 *     dependency on AIFetchlyRuntimeRegistrySync — the bridge is injected.
 *
 * Architecture notes:
 *   - The worker is forked via child_process.fork (Plan 14-01 D-02) → pure
 *     Node, structurally sandboxed (WAT-02). The manager is main-process
 *     only and MUST NOT be importable into the worker.
 *   - handleWorkerExit is the SOLE restart-accounting + re-fork point.
 *     terminateAndRestart() simply kills the worker; the resulting 'exit'
 *     event drives the accounting + re-fork (no double-counting).
 *   - The manager has NO direct dependency on Electron's BrowserWindow or
 *     AIFetchlyRuntimeRegistrySync — both are injected as callbacks. This
 *     keeps the manager unit-testable with stubs and isolates concerns.
 *
 * Design references: §9.3 (lifecycle), §9.8 (crash handling), §10.1/§10.4
 * (switch flow + immediate snapshot), §14.4 (worker message validation).
 */

import { fork, type ChildProcess, type ForkOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  resolvePackagedWorkerPath,
  type PackagedWorkerPathRuntime,
} from "@/utils/packagedWorkerPath";
import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigSnapshot,
  AIFetchlySourceTrust,
} from "@/entityTypes/aifetchlyConfigTypes";
import type {
  WorkspaceWatchAcquireInput,
  WorkspaceWatchManagerStatus,
} from "@/entityTypes/aifetchlyWorkspaceWatchTypes";
import type { WorkspaceWatchEvent } from "@/service/workspaceWatch/WorkspaceWatchProtocol";
import { workerEventSchema } from "@/service/workspaceWatch/WorkspaceWatchProtocol";
import type { WorkspaceWatchCommand } from "@/service/workspaceWatch/WorkspaceWatchProtocol";
import {
  WorkspaceWatchRestarter,
  MAX_RESTARTS,
} from "@/service/workspaceWatch/WorkspaceWatchRestarter";
import { derivePhase14Trust } from "@/service/workspaceWatch/WorkspaceTrustFilter";
import type { WorkspaceCommandDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";
import { buildWorkspaceCommandDefinitions } from "@/service/workspaceWatch/buildWorkspaceCommandDefinitions";

/**
 * Internal mutable variant of WatchedWorkspaceState. The public type
 * (aifetchlyWorkspaceWatchTypes.WatchedWorkspaceState) is readonly; the
 * manager owns mutation internally and projects to readonly on output.
 */
interface MutableWatchedWorkspaceState {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly consumers: Set<string>;
  lastSnapshot?: AIFetchlyConfigSnapshot;
}

/**
 * Event emitted via configChangedEmitter. Plan 14-03's IPC layer adapts
 * this to the existing AIFETCHLY_CONFIG_CHANGED channel (D-04).
 */
export type WorkspaceWatchManagerEvent =
  | {
      readonly type: "changed";
      readonly source: "workspace";
      readonly workspaceId: string;
      readonly sourceId: string;
      readonly summary: {
        readonly commandCount: number;
        readonly instructionCount: number;
        readonly diagnosticCount: number;
      };
    }
  | {
      readonly type: "diagnostic";
      readonly source: "workspace";
      readonly workspaceId: string;
      readonly diagnostic: AIFetchlyConfigDiagnostic;
    }
  | {
      readonly type: "error";
      readonly source: "workspace";
      readonly message: string;
    };

/** Logger sink — defaults to a thin shim over console. */
export type WorkspaceWatchLogger = (
  level: "warn" | "error" | "info",
  msg: string,
  meta?: unknown
) => void;

/** fork function signature (matches child_process.fork). */
export type ForkFn = (
  entry: string,
  args: readonly string[],
  opts: ForkOptions
) => ChildProcess;

/** Constructor dependencies. All callbacks are injected (test-friendly). */
export interface WorkspaceWatchManagerOptions {
  /**
   * Bridge to AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot(snapshot,
   * trust). Injected so the manager has NO direct dep on the sync module.
   * The IPC layer (Plan 14-03) wires the real instance.
   */
  readonly applySnapshotCallback: (
    snapshot: AIFetchlyConfigSnapshot,
    trust: AIFetchlySourceTrust
  ) => void;
  /**
   * Bridge to the IPC layer that emits AIFETCHLY_CONFIG_CHANGED (D-04).
   * Forwarded for every snapshot/changed event + diagnostics + cap-exceeded
   * errors.
   */
  readonly configChangedEmitter: (event: WorkspaceWatchManagerEvent) => void;
  /**
   * Reads workspace approval state. Plan 14-03 supplies a
   * WorkspaceResolver-backed implementation (CFG-02 — never trust the
   * renderer-provided path).
   */
  readonly trustResolver: (workspaceId: string) => boolean;
  /** Defaults to child_process.fork. Tests inject a stub. */
  readonly fork?: ForkFn;
  /** Worker entry path. Defaults to the bundled WorkspaceConfigWatchWorker. */
  readonly workerEntry?: string;
  /** Defaults to a new WorkspaceWatchRestarter. */
  readonly restarter?: WorkspaceWatchRestarter;
  /** Defaults to a console-based sink. */
  readonly logger?: WorkspaceWatchLogger;
  /** Grace period (ms) before SIGKILL on shutdown. Defaults to 2000. */
  readonly shutdownTimeoutMs?: number;
  /** Clock — defaults to Date.now. Injected for deterministic tests. */
  readonly now?: () => number;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
/** Worker env marker — also used by Plan 14-01's WAT-02 grep gate. */
const WORKER_TYPE_MARKER = "aifetchly-config";

function defaultLogger(
  level: "warn" | "error" | "info",
  msg: string,
  meta?: unknown
): void {
  // eslint-disable-next-line no-console
  const sink =
    level === "error"
      ? console.error
      : level === "warn"
      ? console.warn
      : console.info;
  if (meta !== undefined) sink(`[workspace-watch] ${msg}`, meta);
  else sink(`[workspace-watch] ${msg}`);
}

function defaultWorkerEntry(): string {
  const electronProcess = process as NodeJS.Process & {
    resourcesPath?: string;
  };
  const runtime: PackagedWorkerPathRuntime = {
    dirname: __dirname,
    cwd: process.cwd(),
    resourcesPath: electronProcess.resourcesPath,
    existsSync: fs.existsSync,
  };

  return (
    resolvePackagedWorkerPath(runtime, {
      dirnameRelativePaths: [
        "WorkspaceConfigWatchWorker.js",
        path.join(
          "..",
          "childprocess",
          "aifetchly-config",
          "WorkspaceConfigWatchWorker.js"
        ),
      ],
      cwdRelativePaths: [
        path.join(".vite", "build", "WorkspaceConfigWatchWorker.js"),
        path.join("dist", "WorkspaceConfigWatchWorker.js"),
        path.join(
          ".vite",
          "build",
          "childprocess",
          "aifetchly-config",
          "WorkspaceConfigWatchWorker.js"
        ),
      ],
    }) ?? path.join(__dirname, "WorkspaceConfigWatchWorker.js")
  );
}

/**
 * Reference-counted lifecycle owner for the watcher worker.
 *
 * Construct with injected callbacks; never call the constructor directly
 * from non-test code — Plan 14-03's IPC layer owns the singleton.
 */
export class WorkspaceWatchManager {
  private readonly watched = new Map<string, MutableWatchedWorkspaceState>();
  private worker: ChildProcess | null = null;
  private workerState: "not-started" | "running" | "restarting" | "failed" =
    "not-started";
  /** Set by shutdown() — exit handler becomes a no-op (no auto-restart). */
  private disposed = false;

  private readonly applySnapshotCallback: (
    s: AIFetchlyConfigSnapshot,
    t: AIFetchlySourceTrust
  ) => void;
  private readonly configChangedEmitter: (
    e: WorkspaceWatchManagerEvent
  ) => void;
  private readonly trustResolver: (workspaceId: string) => boolean;
  private readonly forkFn: ForkFn;
  private readonly workerEntry: string;
  private readonly restarter: WorkspaceWatchRestarter;
  private readonly logger: WorkspaceWatchLogger;
  private readonly shutdownTimeoutMs: number;
  private readonly now: () => number;

  constructor(opts: WorkspaceWatchManagerOptions) {
    this.applySnapshotCallback = opts.applySnapshotCallback;
    this.configChangedEmitter = opts.configChangedEmitter;
    this.trustResolver = opts.trustResolver;
    this.forkFn = opts.fork ?? fork;
    this.workerEntry = opts.workerEntry ?? defaultWorkerEntry();
    this.restarter = opts.restarter ?? new WorkspaceWatchRestarter();
    this.logger = opts.logger ?? defaultLogger;
    this.shutdownTimeoutMs =
      opts.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  // --- Public API (WAT-01/03/04/07) -----------------------------------------

  /**
   * Acquire a watch for {@link input.workspaceId} on behalf of
   * {@link input.consumerId}. Idempotent for the same consumerId. The 0→1
   * transition spawns the worker; subsequent consumers join the set
   * without re-spawning or re-sending watch-workspace.
   */
  acquire(input: WorkspaceWatchAcquireInput): void {
    if (this.disposed) {
      this.logger(
        "warn",
        `acquire ignored (manager disposed): ${input.workspaceId}`
      );
      return;
    }
    const existing = this.watched.get(input.workspaceId);
    if (existing) {
      existing.consumers.add(input.consumerId);
      return; // already watched
    }
    const state: MutableWatchedWorkspaceState = {
      workspaceId: input.workspaceId,
      workspaceRoot: input.workspaceRoot,
      consumers: new Set<string>([input.consumerId]),
    };
    this.watched.set(input.workspaceId, state);

    this.ensureWorker();
    this.send({
      type: "watch-workspace",
      workspaceId: input.workspaceId,
      workspaceRoot: input.workspaceRoot,
      includeRootAgentsFile: true,
    });
  }

  /**
   * Release {@link consumerId}'s claim on {@link workspaceId}. 0 consumers
   * → unwatch-workspace sent + watched entry deleted; if no workspaces
   * remain, the worker is killed (1→0 transition).
   */
  release(workspaceId: string, consumerId: string): void {
    const state = this.watched.get(workspaceId);
    if (!state) return;
    state.consumers.delete(consumerId);
    if (state.consumers.size > 0) return;

    this.watched.delete(workspaceId);
    this.send({ type: "unwatch-workspace", workspaceId });
    if (this.watched.size === 0) {
      this.killWorker();
    }
  }

  /**
   * Switch a consumer from {@link oldId} to {@link newId}. Serialized
   * release(old) → acquire(new) → rescan(new) (WAT-04 / SC2). The
   * immediate rescan produces a fresh snapshot that flows through the
   * trust filter and out to the renderer.
   */
  switchWorkspace(
    oldId: string | null,
    newId: string,
    newRoot: string,
    consumerId: string
  ): void {
    if (oldId !== null) this.release(oldId, consumerId);
    this.acquire({
      workspaceId: newId,
      workspaceRoot: newRoot,
      consumerId,
      reason: "workspace-switch",
    });
    this.rescan(newId);
  }

  /** Request an immediate rescan for {@link workspaceId}. */
  rescan(workspaceId: string): void {
    this.send({ type: "rescan-workspace", workspaceId });
  }

  /**
   * Graceful app-quit shutdown. Sends shutdown, waits up to
   * {@link shutdownTimeoutMs}, then SIGKILLs the worker if still alive
   * (no orphan workers — research §Pitfall 7). After shutdown the manager
   * is disposed; subsequent acquire() calls are ignored.
   */
  async shutdown(): Promise<void> {
    this.disposed = true;
    if (this.worker && this.worker.connected) {
      try {
        this.worker.send({ type: "shutdown" } satisfies WorkspaceWatchCommand);
      } catch (err) {
        this.logger("warn", "failed to send shutdown command", err);
      }
    }
    await this.waitForWorkerExit(this.shutdownTimeoutMs);
    if (this.worker) {
      try {
        this.worker.kill("SIGKILL");
      } catch {
        // Already gone — ignore.
      }
    }
    this.worker = null;
    this.workerState = "not-started";
  }

  /** Surface manager state to /status and diagnostics. */
  getStatus(): WorkspaceWatchManagerStatus {
    return {
      workerState: this.workerState,
      watchedCount: this.watched.size,
      recentRestarts: this.restarter.recentRestarts(this.now()),
      restartCapExceeded: !this.restarter.canRestart(),
      watched: [...this.watched.values()].map((s) => ({
        workspaceId: s.workspaceId,
        consumerCount: s.consumers.size,
        hasSnapshot: Boolean(s.lastSnapshot),
      })),
    };
  }

  /**
   * Return the most recent cached snapshot for {@link workspaceId}, or null
   * when the workspace is not currently watched (or no snapshot has arrived
   * yet — the worker emits asynchronously after acquire).
   *
   * Plan 14-03's IPC layer uses this to satisfy the AGENTS.md preview
   * request (TRS-07) without re-reading the file from the renderer side.
   * The snapshot was produced by the worker; main forwards its instruction
   * blocks' content rather than the path.
   */
  getWorkspaceSnapshot(workspaceId: string): AIFetchlyConfigSnapshot | null {
    const state = this.watched.get(workspaceId);
    return state?.lastSnapshot ?? null;
  }

  // --- Internals -------------------------------------------------------------

  /** Spawn the worker if not already running and not in 'failed' state. */
  private ensureWorker(): void {
    if (this.worker !== null) return;
    if (this.workerState === "failed") {
      // Auto-watch paused (restart cap exceeded). The workspace is still
      // tracked in `watched`; /reload-config (Plan 14-03 IPC) clears the
      // cap and re-triggers acquires.
      this.logger(
        "warn",
        "ensureWorker skipped — restart cap exceeded; use /reload-config to retry"
      );
      return;
    }
    this.spawnWorker();
  }

  private spawnWorker(): void {
    const worker = this.forkFn(this.workerEntry, [], {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      env: { ...process.env, WORKER_TYPE: WORKER_TYPE_MARKER },
    });
    this.worker = worker;
    this.workerState = "running";
    worker.on("message", (raw: unknown) => this.handleWorkerMessage(raw));
    worker.on("exit", (code, signal) => this.handleWorkerExit(code, signal));
    worker.on("error", (err) => {
      this.logger("error", "worker error event", err);
      // Treat as a crash — kill will trigger the exit handler.
      this.killWorker();
    });
  }

  private send(cmd: WorkspaceWatchCommand): void {
    const w = this.worker;
    if (w && w.connected) {
      try {
        w.send(cmd);
      } catch (err) {
        this.logger("warn", `failed to send ${cmd.type} command`, err);
      }
    }
  }

  private killWorker(): void {
    const w = this.worker;
    if (!w) return;
    try {
      w.kill();
    } catch {
      // Already gone — ignore.
    }
  }

  /**
   * Validate every worker→main message via workerEventSchema (WAT-06).
   * Malformed → terminateAndRestart (never apply the malformed payload).
   */
  private handleWorkerMessage(raw: unknown): void {
    const parsed = workerEventSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger(
        "warn",
        "malformed worker message; terminating worker",
        parsed.error
      );
      this.terminateAndRestart("malformed-message");
      return;
    }
    this.handleWorkerEvent(parsed.data);
  }

  /**
   * Dispatch a validated worker event. snapshot/changed flow through the
   * trust filter (TRS-01); diagnostic is forwarded; unrecoverable error
   * triggers terminateAndRestart.
   */
  private handleWorkerEvent(event: WorkspaceWatchEvent): void {
    const state = this.watched.get(event.workspaceId);
    if (!state) {
      this.logger(
        "warn",
        `received event for unwatched workspace: ${event.workspaceId}`
      );
      return;
    }
    switch (event.type) {
      case "snapshot":
      case "changed": {
        // Phase 15 (Plan 02): the worker ships opaque WorkspaceCommandDraft[]
        // in snapshot.commands. Convert them IN THE MAIN PROCESS into
        // validated SlashCommandDefinition[] before the snapshot reaches the
        // registry. The Phase-14 trust filter still runs unchanged inside
        // applyWorkspaceSnapshotCallback (this adds validation, not a new
        // trust surface). Validation diagnostics merge into the snapshot so
        // they surface in /status and the renderer event.
        const converted = buildWorkspaceCommandDefinitions(
          event.snapshot
            .commands as unknown as readonly WorkspaceCommandDraft[],
          {
            sourceId: event.snapshot.sourceId,
            sourceLabel: "Workspace",
            requiresTrust: true,
          }
        );
        const snapshot: AIFetchlyConfigSnapshot = {
          ...event.snapshot,
          commands: converted.definitions,
          diagnostics: [
            ...event.snapshot.diagnostics,
            ...converted.diagnostics,
          ],
        };
        state.lastSnapshot = snapshot;
        // Trust resolver is injected — fail closed on exception (Rule 2).
        let approved: boolean;
        try {
          approved = this.trustResolver(event.workspaceId);
        } catch (err) {
          this.logger(
            "error",
            `trustResolver threw for ${event.workspaceId}; treating as untrusted`,
            err
          );
          approved = false;
        }
        const trust = derivePhase14Trust(approved);
        try {
          this.applySnapshotCallback(snapshot, trust);
        } catch (err) {
          this.logger(
            "error",
            `applySnapshotCallback threw for ${event.workspaceId}`,
            err
          );
        }
        this.configChangedEmitter({
          type: "changed",
          source: "workspace",
          workspaceId: event.workspaceId,
          sourceId: snapshot.sourceId,
          summary: {
            commandCount: snapshot.commands.length,
            instructionCount: snapshot.instructions.length,
            diagnosticCount: snapshot.diagnostics.length,
          },
        });
        return;
      }
      case "diagnostic": {
        this.configChangedEmitter({
          type: "diagnostic",
          source: "workspace",
          workspaceId: event.workspaceId,
          diagnostic: event.diagnostic,
        });
        return;
      }
      case "error": {
        this.logger(
          "error",
          `worker error for ${event.workspaceId}: ${event.message}`
        );
        if (!event.recoverable) {
          this.terminateAndRestart(
            `worker-error:${event.message.slice(0, 100)}`
          );
        }
        return;
      }
      default: {
        // Exhaustiveness — if a new event type is added, this fails.
        const _exhaustive: never = event;
        return _exhaustive;
      }
    }
  }

  /**
   * Kill the worker; the resulting 'exit' event drives restart accounting
   * + re-fork (see {@link handleWorkerExit}). Single source of truth →
   * no double-counting between this and the exit path.
   */
  private terminateAndRestart(reason: string): void {
    this.logger("warn", `terminateAndRestart: ${reason}`);
    this.killWorker();
  }

  /**
   * The SOLE restart accounting + re-fork point. Called from both
   * unexpected crashes (worker.emit('exit') without prior kill) and
   * terminateAndRestart (kill → exit).
   *
   * If the manager is disposed (app shutdown) or watched.size===0
   * (expected 1→0 transition), no restart. Otherwise, record a restart
   * and re-fork if under cap; surface 'failed' + error if over.
   */
  private handleWorkerExit(
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    this.worker = null;
    if (this.disposed) return; // app shutdown
    if (this.watched.size === 0) {
      this.workerState = "not-started";
      return; // expected
    }
    // Crash with watched.size>0 → restart path.
    const result = this.restarter.recordRestart(this.now());
    if (result.canRestart) {
      this.workerState = "restarting";
      this.logger(
        "info",
        `worker exited (code=${code} signal=${signal}); restarting (${result.restartCount}/${MAX_RESTARTS})`
      );
      this.spawnWorker();
      this.resendAllWatches();
    } else {
      this.workerState = "failed";
      this.logger(
        "error",
        `restart cap exceeded (${result.restartCount} in 60s); auto-watch paused`
      );
      this.configChangedEmitter({
        type: "error",
        source: "workspace",
        message: `workspace watcher restart cap exceeded (${result.restartCount} restarts in 60s); use /reload-config to retry`,
      });
    }
  }

  /** Re-send watch-workspace for every entry in the watched map (crash recovery). */
  private resendAllWatches(): void {
    for (const state of this.watched.values()) {
      this.send({
        type: "watch-workspace",
        workspaceId: state.workspaceId,
        workspaceRoot: state.workspaceRoot,
        includeRootAgentsFile: true,
      });
    }
  }

  /**
   * Resolve when the worker exits OR {@link timeoutMs} elapses (whichever
   * first). Used by shutdown() to give the worker a grace period before
   * SIGKILL.
   */
  private waitForWorkerExit(timeoutMs: number): Promise<void> {
    const w = this.worker;
    if (!w) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        w.removeListener("exit", onExit);
        resolve();
      }, timeoutMs);
      const onExit = (): void => {
        clearTimeout(timer);
        resolve();
      };
      w.once("exit", onExit);
    });
  }
}
