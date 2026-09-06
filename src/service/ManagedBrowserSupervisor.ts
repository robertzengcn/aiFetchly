import { log } from "@/modules/Logger";
import { MANAGED_BROWSER_TIMEOUTS } from "@/config/managedBrowser";
import type { ManagedBrowserProcessIdentity } from "@/entityTypes/managedBrowserTypes";
import type { ManagedBrowserWorkerClient } from "@/service/ManagedBrowserWorkerClient";

/**
 * Managed-browser supervisor (technical design §8.5).
 *
 * Owns all live worker clients. All terminal signals converge on ONE
 * idempotent cleanup path per session:
 *
 *   explicit stop | cancellation | worker error/exit | Chrome disconnected
 *   protocol violation | missed heartbeat | startup failure | before-quit
 *
 * Heartbeats: 5s cadence; 3 missed (15s) mark the session unresponsive and
 * trigger cleanup. A delayed heartbeat arriving after cleanup begins cannot
 * revive the session (the client is already dead).
 *
 * Orphan cleanup may terminate a Chrome process ONLY after validating that
 * its session identity (sessionId + nonce + executable version/fingerprint)
 * belongs to the managed session — PID alone is insufficient
 * (FR-RUNTIME-013).
 */

export interface SupervisedSessionInit {
  readonly sessionId: string;
  readonly accountId: number;
  readonly client: ManagedBrowserWorkerClient;
  /** Releases the account lease (supervisor does NOT own lease tokens). */
  readonly releaseLease: () => void;
  /** Sanitized terminal hook (chat notice / status event publisher). */
  readonly onTerminal: (sessionId: string, cause: string) => void;
}

interface SupervisedSession {
  readonly init: SupervisedSessionInit;
  readonly startedAt: number;
  terminated: boolean;
}

export class ManagedBrowserSupervisor {
  private readonly sessions = new Map<string, SupervisedSession>();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  public register(init: SupervisedSessionInit): void {
    if (this.sessions.has(init.sessionId)) {
      return;
    }
    this.sessions.set(init.sessionId, {
      init,
      startedAt: this.now(),
      terminated: false,
    });
    this.ensureWatchdog();
  }

  public unregister(sessionId: string): void {
    this.sessions.delete(sessionId);
    if (this.sessions.size === 0) {
      this.stopWatchdog();
    }
  }

  public get(sessionId: string): SupervisedSessionInit | null {
    return this.sessions.get(sessionId)?.init ?? null;
  }

  public listSessions(): readonly string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Single terminal path: unregister, release lease, notify, attempt
   * verified orphan cleanup. Idempotent per session.
   */
  public handleTerminal(sessionId: string, cause: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.terminated) {
      return;
    }
    entry.terminated = true;
    // GAP-06: unexpected exits must attempt VERIFIED orphan-Chrome cleanup
    // BEFORE the record is discarded — a crashed worker can otherwise leave
    // an authenticated Chrome running. The browserPid comes from the
    // client's validated SESSION_READY identity (checked against the
    // executable descriptor, nonce, and launch-time window when captured);
    // graceful causes closed Chrome inside the worker's dispose path.
    if (isUnexpectedExitCause(cause)) {
      const identity = entry.init.client.processIdentity;
      if (identity && identity.browserPid > 0) {
        killProcessTree(identity.browserPid);
      }
    }
    this.unregister(sessionId);
    try {
      entry.init.releaseLease();
    } catch (error) {
      log.warn(
        `[ManagedBrowserSupervisor] lease release failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    entry.init.onTerminal(sessionId, cause);
  }

  /**
   * Verify a process identity belongs to the expected managed session.
   * PID alone is NEVER sufficient (FR-RUNTIME-013).
   */
  public static verifyProcessIdentity(
    actual: ManagedBrowserProcessIdentity | null,
    expected: ManagedBrowserProcessIdentity | null
  ): boolean {
    if (!actual || !expected) {
      return false;
    }
    return (
      actual.sessionId === expected.sessionId &&
      actual.sessionNonce === expected.sessionNonce &&
      actual.executableVersion === expected.executableVersion &&
      actual.executableSha256 === expected.executableSha256 &&
      actual.workerPid === expected.workerPid &&
      actual.browserPid === expected.browserPid &&
      // GAP-06: launch-time window — clock drift tolerance only.
      Math.abs(actual.launchedAtEpochMs - expected.launchedAtEpochMs) <= 5_000
    );
  }

  /**
   * Best-effort orphan Chrome termination after a worker died uncleanly.
   * Identity is validated first; on any mismatch nothing is killed.
   */
  public attemptVerifiedOrphanCleanup(
    sessionId: string,
    observedIdentity: ManagedBrowserProcessIdentity | null
  ): void {
    const entry = this.sessions.get(sessionId);
    const expected = entry?.init.client.processIdentity ?? null;
    if (
      !observedIdentity ||
      !ManagedBrowserSupervisor.verifyProcessIdentity(
        observedIdentity,
        expected
      )
    ) {
      log.warn(
        `[ManagedBrowserSupervisor] orphan cleanup refused: identity mismatch for ${sessionId}`
      );
      return;
    }
    if (observedIdentity.browserPid <= 0) {
      return;
    }
    killProcessTree(observedIdentity.browserPid);
  }

  /**
   * Application shutdown: request graceful stops within the global deadline,
   * then force verified remaining processes to exit (FR-RUNTIME-015).
   */
  public async shutdownAll(deadlineMs: number): Promise<void> {
    const deadline = this.now() + deadlineMs;
    const stops = [...this.sessions.values()].map((entry) =>
      entry.init.client.stop("shutdown").catch(() => "forced")
    );
    await Promise.race([
      Promise.allSettled(stops),
      new Promise<void>((resolve) => {
        setTimeout(resolve, Math.max(0, deadline - this.now())).unref?.();
      }),
    ]);
    for (const [sessionId, entry] of [...this.sessions.entries()]) {
      this.attemptVerifiedOrphanCleanup(
        sessionId,
        entry.init.client.processIdentity
      );
      await entry.init.client.cleanup("shutdown").catch(() => undefined);
      this.handleTerminal(sessionId, "shutdown");
    }
  }

  private ensureWatchdog(): void {
    if (this.watchdog) {
      return;
    }
    this.watchdog = setInterval(() => {
      this.checkHeartbeats();
    }, MANAGED_BROWSER_TIMEOUTS.heartbeatIntervalMs);
  }

  private stopWatchdog(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  private checkHeartbeats(): void {
    const now = this.now();
    for (const [sessionId, entry] of [...this.sessions.entries()]) {
      if (entry.terminated) {
        continue;
      }
      const last = entry.init.client.lastHeartbeatTime;
      const startupGraceExpired =
        now - entry.startedAt >
        MANAGED_BROWSER_TIMEOUTS.workerReadyMs +
          MANAGED_BROWSER_TIMEOUTS.chromeLaunchAndSelfTestMs;
      if (last === 0 && !startupGraceExpired) {
        continue; // still starting — worker_ready/launch window
      }
      const reference = last === 0 ? entry.startedAt : last;
      if (now - reference > MANAGED_BROWSER_TIMEOUTS.heartbeatUnresponsiveMs) {
        log.warn(
          `[ManagedBrowserSupervisor] worker unresponsive: ${sessionId}`
        );
        void entry.init.client
          .cleanup("worker_unresponsive")
          .catch(() => undefined);
        this.attemptVerifiedOrphanCleanup(
          sessionId,
          entry.init.client.processIdentity
        );
        this.handleTerminal(sessionId, "worker_unresponsive");
      }
    }
  }
}

/** Best-effort process-tree kill (SIGTERM, then SIGKILL). */
function killProcessTree(pid: number): void {
  const signal = (name: string): void => {
    try {
      process.kill(pid, name as NodeJS.Signals);
    } catch {
      /* already gone */
    }
  };
  try {
    process.kill(pid, 0);
  } catch {
    return; // not alive
  }
  signal("SIGTERM");
  setTimeout(() => signal("SIGKILL"), 1_000).unref?.();
}

/**
 * Exit causes that mean the worker/Chrome died WITHOUT closing Chrome —
 * orphan cleanup is required. Graceful stops (user stop, cancellation,
 * shutdown, completed) and in-worker protocol enforcement closed Chrome in
 * the worker's dispose path.
 */
function isUnexpectedExitCause(cause: string): boolean {
  if (cause === "user_stop" || cause === "cancelled" || cause === "shutdown") {
    return false;
  }
  return (
    cause.startsWith("exit:") ||
    cause === "worker_unresponsive" ||
    cause === "worker_protocol_violation" ||
    cause === "worker_exited" ||
    cause === "chrome_disconnected" ||
    cause === "worker_start_timeout"
  );
}

let defaultSupervisor: ManagedBrowserSupervisor | null = null;

export function getDefaultManagedBrowserSupervisor(): ManagedBrowserSupervisor {
  if (!defaultSupervisor) {
    defaultSupervisor = new ManagedBrowserSupervisor();
  }
  return defaultSupervisor;
}

export function setDefaultManagedBrowserSupervisorForTest(
  supervisor: ManagedBrowserSupervisor | null
): void {
  defaultSupervisor = supervisor;
}
