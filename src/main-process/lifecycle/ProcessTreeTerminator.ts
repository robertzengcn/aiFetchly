import { log } from "@/modules/Logger";
import type { ProcessOps } from "@/main-process/lifecycle/processOps";
import type { OwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";

/**
 * ProcessTreeTerminator — verified, platform-specific process-tree
 * termination (technical design §8).
 *
 * Runs in the coordinator's force-and-verify phase. Rules implemented:
 *  - Windows: `taskkill /PID <pid> /T /F` (argument array, awaited), then
 *    liveness-verified. A root that already exited may not expose a tree —
 *    descendants captured while the root was alive are terminated
 *    individually afterwards.
 *  - macOS/Linux: an ISOLATED process group created at launch is signaled
 *    via its negative pgid (never the app's own group); otherwise
 *    descendants are discovered (with a post-kill re-check for spawn
 *    races) and terminated leaves+root with verified results.
 *  - Already-exited processes are SUCCESS after verification (identity
 *    check first — a reused PID is never signaled, AC-07).
 *  - Unvalidated worker-reported descendants are logged and NOT force
 *    killed (ambiguous ownership, §8); they surface as verification
 *    failures so the shutdown report stays honest (AC-15).
 *  - Termination helpers respect the remaining phase budget (§8).
 */

export interface TerminationSummary {
  forcedCount: number;
  verificationFailures: string[];
}

type RecordOutcome =
  | { kind: "already-exited" }
  | { kind: "forced"; count: number }
  | { kind: "skipped-unvalidated"; detail: string }
  | { kind: "failure"; detail: string };

const VERIFY_POLL_MS = 50;

export class ProcessTreeTerminator {
  private readonly registry: OwnedProcessRegistry;
  private readonly ops: ProcessOps;
  private readonly now: () => number;

  constructor(
    registry: OwnedProcessRegistry,
    ops: ProcessOps,
    now: () => number = Date.now
  ) {
    this.registry = registry;
    this.ops = ops;
    this.now = now;
  }

  /**
   * Force-stop every live owned record and verify exit. One record's
   * failure never stops the others (settled aggregation, design §5).
   */
  async terminateAll(remainingMs: () => number): Promise<TerminationSummary> {
    const deadline = this.now() + Math.max(0, remainingMs());
    const live = this.registry.list().filter((r) => !r.exited);

    const outcomes = await Promise.all(
      live.map((record) =>
        this.terminateRecord(record.id, deadline)
          .catch(
            (err): RecordOutcome => ({
              kind: "failure",
              detail: err instanceof Error ? err.message : String(err),
            })
          )
          .then((outcome) => ({ record, outcome }))
      )
    );

    let forcedCount = 0;
    const verificationFailures: string[] = [];
    for (const { record, outcome } of outcomes) {
      switch (outcome.kind) {
        case "forced":
          forcedCount += outcome.count;
          break;
        case "already-exited":
          break;
        case "skipped-unvalidated":
          verificationFailures.push(
            `${record.ownerId}: unvalidated descendant pid=${
              record.pid ?? "?"
            } not force-killed (${outcome.detail})`
          );
          break;
        case "failure":
          verificationFailures.push(`${record.ownerId}: ${outcome.detail}`);
          break;
      }
    }
    return { forcedCount, verificationFailures };
  }

  /** Terminate one record's tree; verify observed exit; clean the record. */
  private async terminateRecord(
    recordId: string,
    deadline: number
  ): Promise<RecordOutcome> {
    const record = this.registry.get(recordId);
    if (!record || record.exited) return { kind: "already-exited" };

    // Never force-kill an unvalidated worker report (§8).
    if (record.ownership === "spawned-by-owned-worker" && !record.validated) {
      return {
        kind: "skipped-unvalidated",
        detail: "failed ppid validation when reported",
      };
    }

    // Pending spawn that never resolved a pid: best-effort handle kill.
    if (record.pid === null) {
      if (this.registry.killViaHandle(recordId, "SIGKILL")) {
        const exited = await this.registry.observeExit(
          recordId,
          deadline - this.now()
        );
        return exited
          ? { kind: "forced", count: 1 }
          : { kind: "failure", detail: "pending-spawn handle kill unverified" };
      }
      this.registry.markObservedExit(recordId);
      this.registry.forget(recordId);
      return { kind: "already-exited" };
    }

    // Identity check FIRST — never signal a reused PID (AC-07).
    const identity = await this.registry.verifyIdentity(recordId);
    if (identity === "reuse" || identity === "gone") {
      this.registry.markObservedExit(recordId);
      this.registry.forget(recordId);
      return { kind: "already-exited" };
    }

    // Capture descendant identity while the root is alive (§8: a root that
    // already exited may no longer provide a discoverable tree).
    let descendants: number[] = [];
    if (this.ops.platform !== "win32") {
      descendants = await this.registry.listChildPids(recordId);
    }

    let signaled = 0;
    if (this.ops.platform === "win32") {
      const result = await this.ops.runTaskkillTree(record.pid);
      if (result === "error") {
        return {
          kind: "failure",
          detail: `taskkill failed for pid ${record.pid}`,
        };
      }
      if (result === "ok") signaled += 1;
    } else if (record.isolatedProcessGroupId !== null) {
      const result = this.ops.signalGroup(
        record.isolatedProcessGroupId,
        "SIGKILL"
      );
      if (result === "error") {
        return {
          kind: "failure",
          detail: `process-group signal failed for pgid ${record.isolatedProcessGroupId}`,
        };
      }
      if (result === "ok") signaled += 1;
    } else {
      const root = this.ops.signal(record.pid, "SIGKILL");
      if (root === "error") {
        return {
          kind: "failure",
          detail: `SIGKILL failed for pid ${record.pid}`,
        };
      }
      if (root === "ok") signaled += 1;
    }

    // Post-kill re-check for spawn races (§8): children spawned between the
    // pre-kill capture and the root's death.
    if (this.ops.platform !== "win32") {
      const postChildren = await this.registry.listChildPids(recordId);
      for (const pid of postChildren) {
        if (!descendants.includes(pid)) descendants.push(pid);
      }
    }

    // Terminate surviving descendants individually (root may already be
    // gone; the captured identity lets us still reach them, §8).
    for (const pid of descendants) {
      if (!this.ops.isAlive(pid)) continue;
      const result = this.ops.signal(pid, "SIGKILL");
      if (result === "ok") {
        signaled += 1;
      } else if (result === "error") {
        log.warn(`[terminator] failed to signal descendant pid ${pid}`);
      }
    }

    // Verify observed exit for root AND descendants within the budget.
    const failures: string[] = [];
    const targets = [record.pid, ...descendants];
    const verifyDeadline = Math.min(
      deadline,
      this.now() + Math.max(VERIFY_POLL_MS, deadline - this.now())
    );
    const pending = new Set(targets);
    while (pending.size > 0 && this.now() < verifyDeadline) {
      for (const pid of pending) {
        if (!this.ops.isAlive(pid)) pending.delete(pid);
      }
      if (pending.size === 0) break;
      await sleep(VERIFY_POLL_MS);
    }
    if (pending.size > 0) {
      failures.push(
        `pids still alive after force-kill: ${[...pending].join(", ")}`
      );
    }

    // Clean records: root + any records matching terminated descendants.
    const rootVerified = !this.ops.isAlive(record.pid);
    if (rootVerified) {
      this.registry.markObservedExit(recordId);
      this.registry.forget(recordId);
    }
    for (const other of this.registry.list()) {
      if (
        other.pid !== null &&
        other.pid !== record.pid &&
        descendants.includes(other.pid) &&
        !this.ops.isAlive(other.pid)
      ) {
        this.registry.markObservedExit(other.id);
        this.registry.forget(other.id);
      }
    }

    if (failures.length > 0) {
      return { kind: "failure", detail: failures.join("; ") };
    }
    return { kind: "forced", count: signaled };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === "function") t.unref();
  });
}
