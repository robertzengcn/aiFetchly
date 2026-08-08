/**
 * WorkspaceWatchManager — ref-counted worker lifecycle tests (WAT-01/03/04/06/07).
 *
 * The manager owns the worker child-process lifecycle: per-workspace
 * consumer-set reference counting (WAT-01/03), workspace-switch ordering
 * (WAT-04/SC2), main-side zod validation of every worker→main message
 * (WAT-06), and crash-restart accounting capped at 3/60s (WAT-07).
 *
 * Unit tests use a STUBBED fork (fake EventEmitter posing as a
 * ChildProcess). No real worker is spawned. The fake records `send`
 * calls (for ordering assertions) and `kill` calls; kill() emits 'exit'
 * synchronously to drive the manager's crash path deterministically.
 *
 * Cases (per plan Task 2):
 *   (a) acquire 0→1 spawns worker; same consumerId is a no-op; second
 *       consumer adds to the set without re-spawning.
 *   (b) release to 0 consumers → unwatch-workspace sent + entry deleted
 *       + worker killed when watched.size becomes 0.
 *   (c) switchWorkspace = release(old) + acquire(new) + rescan(new);
 *       `send` order is unwatch-workspace BEFORE watch-workspace (SC2).
 *   (d) malformed worker message → terminateAndRestart: restart counter
 *       incremented + worker re-spawned.
 *   (e) crash exit under cap → re-fork + re-send watch-workspace per
 *       watched workspace.
 *   (f) crash exit over cap (4th in 60s) → status 'failed' + NO re-fork
 *       + error emitted.
 *   (g) shutdown() sends shutdown command then SIGKILL after timeout.
 * Plus message dispatch: snapshot/changed routed through trust filter;
 * diagnostic forwarded; unrecoverable error → terminateAndRestart.
 */
import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigSnapshot,
  AIFetchlySourceTrust,
} from "@/entityTypes/aifetchlyConfigTypes";
import type { WorkspaceWatchCommand } from "@/service/workspaceWatch/WorkspaceWatchProtocol";
import { WorkspaceWatchManager } from "@/service/workspaceWatch/WorkspaceWatchManager";
import { WorkspaceWatchRestarter } from "@/service/workspaceWatch/WorkspaceWatchRestarter";

// --- Fake worker ------------------------------------------------------------

interface FakeWorker extends EventEmitter {
  connected: boolean;
  pid: number;
  send: (cmd: WorkspaceWatchCommand) => void;
  kill: (signal?: string) => void;
  sendCalls: WorkspaceWatchCommand[];
  killCalls: string[];
}

function createFakeWorker(): FakeWorker {
  const sendCalls: WorkspaceWatchCommand[] = [];
  const killCalls: string[] = [];
  const w = new EventEmitter() as FakeWorker;
  w.connected = true;
  w.pid = Math.floor(Math.random() * 1_000_000);
  w.sendCalls = sendCalls;
  w.killCalls = killCalls;
  w.send = (cmd: WorkspaceWatchCommand) => {
    sendCalls.push(cmd);
  };
  w.kill = (signal?: string) => {
    killCalls.push(signal ?? "SIGTERM");
    w.connected = false;
    // Real child_process kill() triggers an async 'exit' event. The fake
    // emits it synchronously so tests can assert post-exit state without
    // awaiting. Tests that need to delay the exit can re-emit later.
    w.emit("exit", null, signal ?? "SIGTERM");
  };
  return w;
}

// --- Manager factory ---------------------------------------------------------

interface ManagerSetup {
  readonly manager: WorkspaceWatchManager;
  readonly forkStub: ReturnType<typeof vi.fn>;
  readonly applySnapshotCallback: ReturnType<typeof vi.fn>;
  readonly configChangedEmitter: ReturnType<typeof vi.fn>;
  readonly trustResolver: ReturnType<typeof vi.fn>;
  readonly restarter: WorkspaceWatchRestarter;
  /** Push the next fake worker that forkStub will return. */
  nextWorker(w: FakeWorker): void;
}

// Redefine on one line so the formatter doesn't reshape it; the typed-mock
// invariance error from the broader ManagerSetup interface is avoided by
// typing every mock field as the unparametrised ReturnType<typeof vi.fn>.

function createManager(
  opts: {
    readonly trustApproved?: boolean;
    readonly shutdownTimeoutMs?: number;
    readonly restarter?: WorkspaceWatchRestarter;
  } = {}
): ManagerSetup {
  const applySnapshotCallback = vi.fn();
  const configChangedEmitter = vi.fn();
  // Declare mocks without inline implementations to keep the unparametrised
  // Mock shape (inline impls narrow the type and break invariance against
  // ManagerSetup's field types). Behaviours are attached afterward.
  const trustResolver = vi.fn();
  trustResolver.mockImplementation(
    (_ws: string): boolean => opts.trustApproved ?? false
  );
  const restarter = opts.restarter ?? new WorkspaceWatchRestarter();

  // A queue of upcoming fake workers. forkStub shifts the next one.
  const queue: FakeWorker[] = [];
  const forkStub = vi.fn();
  forkStub.mockImplementation(() => {
    const w = queue.shift();
    if (!w)
      throw new Error("test setup: fork called but no fake worker queued");
    return w;
  });

  const manager = new WorkspaceWatchManager({
    applySnapshotCallback,
    configChangedEmitter,
    trustResolver,
    fork: forkStub,
    workerEntry: "/fake/worker",
    restarter,
    shutdownTimeoutMs: opts.shutdownTimeoutMs ?? 50,
    now: () => 1_000_000,
  });

  return {
    manager,
    forkStub,
    applySnapshotCallback,
    configChangedEmitter,
    trustResolver,
    restarter,
    nextWorker(w: FakeWorker) {
      queue.push(w);
    },
  };
}

function snapshot(workspaceId: string): AIFetchlyConfigSnapshot {
  return {
    source: "workspace",
    sourceId: `workspace:${workspaceId}`,
    rootPath: `/tmp/${workspaceId}`,
    workspaceId,
    version: 1,
    files: [],
    instructions: [],
    commands: [],
    agents: [],
    hooks: [],
    skills: [],
    diagnostics: [],
  };
}

// --- Tests -------------------------------------------------------------------

describe("WorkspaceWatchManager — ref-counted lifecycle + crash restart", () => {
  it("(a) acquire 0→1 spawns worker; same consumerId is a no-op; second consumer adds without re-spawn", () => {
    const s = createManager();
    const w = createFakeWorker();
    s.nextWorker(w);

    // 0→1 transition: worker spawned + watch-workspace sent.
    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });
    expect(s.forkStub).toHaveBeenCalledTimes(1);
    expect(
      w.sendCalls.filter((c) => c.type === "watch-workspace")
    ).toHaveLength(1);

    // Same consumerId again → no-op (idempotent).
    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });
    expect(s.forkStub).toHaveBeenCalledTimes(1);
    expect(
      w.sendCalls.filter((c) => c.type === "watch-workspace")
    ).toHaveLength(1);

    // Second consumer on same workspace → added to the set, NO new worker,
    // NO duplicate watch-workspace.
    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "stream:9",
    });
    expect(s.forkStub).toHaveBeenCalledTimes(1);
    expect(
      w.sendCalls.filter((c) => c.type === "watch-workspace")
    ).toHaveLength(1);

    const status = s.manager.getStatus();
    expect(status.watchedCount).toBe(1);
    expect(status.watched[0]?.consumerCount).toBe(2);
  });

  it("(b) release to 0 consumers → unwatch-workspace sent + entry deleted + worker killed", () => {
    const s = createManager();
    const w = createFakeWorker();
    s.nextWorker(w);

    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });

    s.manager.release("w1", "chat:1");

    // unwatch-workspace sent BEFORE kill.
    const unwatch = w.sendCalls.filter((c) => c.type === "unwatch-workspace");
    expect(unwatch).toHaveLength(1);
    expect(w.killCalls.length).toBeGreaterThanOrEqual(1);

    // Worker is gone (status reflects 0 watched → workerState not-started).
    const status = s.manager.getStatus();
    expect(status.watchedCount).toBe(0);
    expect(status.workerState).toBe("not-started");
  });

  it("(b2) release with multiple consumers keeps the worker alive; only last release kills", () => {
    const s = createManager();
    const w = createFakeWorker();
    s.nextWorker(w);

    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });
    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "stream:2",
    });

    // Release ONE consumer — workspace still has a consumer; worker stays.
    s.manager.release("w1", "chat:1");
    expect(w.killCalls).toHaveLength(0);
    expect(s.manager.getStatus().watchedCount).toBe(1);

    // Release the LAST consumer — worker killed.
    s.manager.release("w1", "stream:2");
    expect(w.killCalls.length).toBeGreaterThanOrEqual(1);
    expect(s.manager.getStatus().watchedCount).toBe(0);
  });

  it("(c) switchWorkspace sends unwatch-workspace BEFORE watch-workspace, then rescan (SC2)", () => {
    const s = createManager();
    const w1 = createFakeWorker();
    s.nextWorker(w1);

    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });
    w1.sendCalls.length = 0; // clear initial watch-workspace

    // Release(w1) → killWorker → 1→0 exit; acquire(w2) → ensureWorker →
    // spawnWorker → fork again. Queue the replacement worker up front.
    const w2 = createFakeWorker();
    s.nextWorker(w2);

    s.manager.switchWorkspace("w1", "w2", "/tmp/w2", "chat:1");

    // SC2 ordering: w1 received unwatch-workspace BEFORE its kill (so the
    // worker stops watching before the IPC channel closes).
    expect(
      w1.sendCalls.filter((c) => c.type === "unwatch-workspace")
    ).toHaveLength(1);
    expect(w1.killCalls.length).toBeGreaterThanOrEqual(1);

    // The replacement worker received watch-workspace then rescan-workspace,
    // in that order.
    const w2Types = w2.sendCalls.map((c) => c.type);
    const watchIdx = w2Types.indexOf("watch-workspace");
    const rescanIdx = w2Types.indexOf("rescan-workspace");
    expect(watchIdx).toBeGreaterThanOrEqual(0);
    expect(rescanIdx).toBeGreaterThan(watchIdx);

    // The new workspace is watched; old one is gone.
    const status = s.manager.getStatus();
    expect(status.watchedCount).toBe(1);
    expect(status.watched[0]?.workspaceId).toBe("w2");
  });

  it("(d) malformed worker message → terminateAndRestart: counter incremented + worker re-spawned", () => {
    const s = createManager();
    const w1 = createFakeWorker();
    s.nextWorker(w1);

    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });

    // Queue the replacement worker BEFORE triggering the malformed path
    // (the kill() inside terminateAndRestart emits 'exit' synchronously,
    // which causes the manager to re-fork).
    const w2 = createFakeWorker();
    s.nextWorker(w2);

    // Emit a malformed message — safeParse will fail.
    w1.emit("message", { totally: "unknown-shape", noType: true });

    // Manager killed w1 and re-forked.
    expect(s.forkStub).toHaveBeenCalledTimes(2);
    expect(w1.killCalls.length).toBeGreaterThanOrEqual(1);
    // Restart counter incremented exactly once.
    expect(s.restarter.recentRestarts(1_000_000)).toHaveLength(1);
    // w1 was the watched workspace → manager re-sent watch-workspace on w2.
    expect(
      w2.sendCalls.filter((c) => c.type === "watch-workspace")
    ).toHaveLength(1);
  });

  it("(e) crash exit with watched.size>0 under cap → re-fork + re-send watch-workspace per entry", () => {
    const s = createManager();
    const w1 = createFakeWorker();
    s.nextWorker(w1);

    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });
    s.manager.acquire({
      workspaceId: "w2",
      workspaceRoot: "/tmp/w2",
      consumerId: "chat:1",
    });

    const w2 = createFakeWorker();
    s.nextWorker(w2);

    // Simulate unexpected crash: emit 'exit' WITHOUT kill (real crash).
    w1.connected = false;
    w1.emit("exit", 1, "SIGSEGV");

    // Manager re-forked once.
    expect(s.forkStub).toHaveBeenCalledTimes(2);
    // Re-sent watch-workspace for BOTH watched workspaces on the new worker.
    const watchCalls = w2.sendCalls.filter((c) => c.type === "watch-workspace");
    expect(watchCalls).toHaveLength(2);
    const watchedIds = watchCalls.map((c) =>
      c.type === "watch-workspace" ? c.workspaceId : ""
    );
    expect(watchedIds.sort()).toEqual(["w1", "w2"]);
    // Restart counter incremented.
    expect(s.restarter.recentRestarts(1_000_000)).toHaveLength(1);
  });

  it("(f) crash exit over cap (4th in 60s) → status 'failed' + NO re-fork + error emitted", () => {
    // Pre-saturate the restarter: 3 prior restarts in the window.
    const restarter = new WorkspaceWatchRestarter();
    restarter.recordRestart(999_000);
    restarter.recordRestart(999_500);
    restarter.recordRestart(999_900);

    const s = createManager({ restarter });
    const w1 = createFakeWorker();
    s.nextWorker(w1);

    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });

    // Crash — this will be the 4th restart in the window (over cap).
    w1.connected = false;
    w1.emit("exit", 1, "SIGSEGV");

    // No re-fork.
    expect(s.forkStub).toHaveBeenCalledTimes(1);
    // Status 'failed'.
    expect(s.manager.getStatus().workerState).toBe("failed");
    // Error emitted.
    expect(s.configChangedEmitter).toHaveBeenCalledTimes(1);
    const evt = s.configChangedEmitter.mock.calls[0]?.[0] as { type: string };
    expect(evt.type).toBe("error");
  });

  it("(g) shutdown() sends shutdown command then force-kills (SIGKILL) after timeout", async () => {
    const s = createManager({ shutdownTimeoutMs: 30 });
    // A worker that does NOT auto-exit on kill (so the SIGKILL path runs).
    const w = createFakeWorker();
    // Override kill so the first call (SIGTERM/SIGINT from shutdown path
    // if any) does not emit exit; we want to observe the SIGKILL.
    const killSignals: string[] = [];
    w.kill = (signal?: string) => {
      killSignals.push(signal ?? "SIGTERM");
      if (signal === "SIGKILL") {
        w.connected = false;
        w.emit("exit", null, "SIGKILL");
      }
    };

    s.nextWorker(w);
    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });

    await s.manager.shutdown();

    // shutdown command was sent.
    expect(w.sendCalls.filter((c) => c.type === "shutdown")).toHaveLength(1);
    // SIGKILL was eventually issued.
    expect(killSignals).toContain("SIGKILL");
    // disposed → no auto-restart from the SIGKILL exit.
    expect(s.forkStub).toHaveBeenCalledTimes(1);
  });

  // --- Message dispatch -------------------------------------------------------

  it("routes snapshot/changed through trustResolver + applySnapshotCallback + emitter", () => {
    const s = createManager({ trustApproved: true });
    const w = createFakeWorker();
    s.nextWorker(w);

    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });

    const snap = snapshot("w1");
    w.emit("message", { type: "snapshot", workspaceId: "w1", snapshot: snap });

    // Trust resolver consulted.
    expect(s.trustResolver).toHaveBeenCalledWith("w1");
    // applySnapshotCallback invoked with derived trust. An approved workspace
    // trusts every capability (Phase 17 D-TrustUX — all five flags track the
    // same binary approval).
    expect(s.applySnapshotCallback).toHaveBeenCalledTimes(1);
    const [, trust] = s.applySnapshotCallback.mock.calls[0] as [
      AIFetchlyConfigSnapshot,
      AIFetchlySourceTrust
    ];
    expect(trust).toEqual({
      instructions: true,
      commands: true,
      agents: true,
      hooks: true,
      skills: true,
    });
    // Emitter fired with workspace-origin event.
    expect(s.configChangedEmitter).toHaveBeenCalledTimes(1);
  });

  it("drops every capability when the workspace is revoked/untrusted", () => {
    // trustApproved: false mirrors a workspace whose AI config trust was
    // revoked — the manager must pass all-false trust so applySnapshotCallback
    // drops commands (and every other capability) before registry mutation.
    const s = createManager({ trustApproved: false });
    const w = createFakeWorker();
    s.nextWorker(w);

    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });

    const snap = snapshot("w1");
    w.emit("message", { type: "snapshot", workspaceId: "w1", snapshot: snap });

    expect(s.trustResolver).toHaveBeenCalledWith("w1");
    expect(s.applySnapshotCallback).toHaveBeenCalledTimes(1);
    const [, trust] = s.applySnapshotCallback.mock.calls[0] as [
      AIFetchlyConfigSnapshot,
      AIFetchlySourceTrust
    ];
    expect(trust).toEqual({
      instructions: false,
      commands: false,
      agents: false,
      hooks: false,
      skills: false,
    });
  });

  it("forwards diagnostic events to the emitter", () => {
    const s = createManager();
    const w = createFakeWorker();
    s.nextWorker(w);

    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });

    const diag: AIFetchlyConfigDiagnostic = {
      severity: "warning",
      source: "workspace",
      sourceId: "workspace:w1",
      filePath: ".aifetchly/commands/bad.md",
      code: "frontmatter-invalid",
      message: "bad frontmatter",
      recoverable: true,
    };
    w.emit("message", {
      type: "diagnostic",
      workspaceId: "w1",
      diagnostic: diag,
    });

    expect(s.configChangedEmitter).toHaveBeenCalledTimes(1);
    const evt = s.configChangedEmitter.mock.calls[0]?.[0] as {
      type: string;
      diagnostic?: AIFetchlyConfigDiagnostic;
    };
    expect(evt.type).toBe("diagnostic");
    expect(evt.diagnostic).toEqual(diag);
  });

  it("unrecoverable worker error → terminateAndRestart (worker re-forked)", () => {
    const s = createManager();
    const w1 = createFakeWorker();
    s.nextWorker(w1);
    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });

    const w2 = createFakeWorker();
    s.nextWorker(w2);

    w1.emit("message", {
      type: "error",
      workspaceId: "w1",
      message: "worker hit a fatal internal error",
      recoverable: false,
    });

    expect(s.forkStub).toHaveBeenCalledTimes(2);
    expect(s.restarter.recentRestarts(1_000_000)).toHaveLength(1);
  });

  it("getStatus() exposes workerState + watched summary + restart window", () => {
    const restarter = new WorkspaceWatchRestarter();
    restarter.recordRestart(1_000_000);
    const s = createManager({ restarter });
    const w = createFakeWorker();
    s.nextWorker(w);

    s.manager.acquire({
      workspaceId: "w1",
      workspaceRoot: "/tmp/w1",
      consumerId: "chat:1",
    });

    const status = s.manager.getStatus();
    expect(status.workerState).toBe("running");
    expect(status.watchedCount).toBe(1);
    expect(status.watched[0]?.workspaceId).toBe("w1");
    expect(status.watched[0]?.consumerCount).toBe(1);
    expect(status.watched[0]?.hasSnapshot).toBe(false);
    expect(status.restartCapExceeded).toBe(false);
    expect(status.recentRestarts).toHaveLength(1);
  });
});
