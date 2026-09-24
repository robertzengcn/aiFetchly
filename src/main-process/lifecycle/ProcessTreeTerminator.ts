import { log } from "@/modules/Logger";
import type { ProcessOps } from "@/main-process/lifecycle/processOps";
import type { OwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";

/**
 * ProcessTreeTerminator — verified, platform-specific process-tree
 * termination (technical design §8; 2026-09-21 audit T02–T04).
 *
 * Runs in the coordinator's force-and-verify phase. Rules implemented:
 *  - The COMPLETE TRANSITIVE tree is captured while the root is alive
 *    (recursive child walk with a per-node budget), not just direct
 *    children; discovery failures surface as incomplete cleanup instead of
 *    silently emptying the tree (T02).
 *  - Every discovered descendant's start-time identity is captured at
 *    discovery and RE-CHECKED immediately before signaling; a changed
 *    identity (PID reuse) is never signaled and is recorded as incomplete
 *    cleanup (T03, AC-07).
 *  - Already-exited processes are SUCCESS after verification (identity
 *    check first — a reused PID is never signaled).
 *  - A pending-spawn record whose PID never resolved CANNOT be marked
 *    exited without proof: a failed/absent handle kill keeps the record
 *    and reports an explicit failure so the report stays honest (T04).
 *  - Windows: `taskkill /PID <pid> /T /F` (argument array, awaited) walks
 *    the tree; the POSIX-side transitive walk also runs there when the
 *    platform ops support it so surviving members are still verified.
 *  - Unvalidated worker-reported descendants are logged and NOT force
 *    killed (ambiguous ownership, §8); they surface as verification
 *    failures (AC-15).
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
/** Per-node discovery budget slice (bounded from the phase deadline). */
const DISCOVER_NODE_BUDGET_MS = 250;
/** Max transitive depth — cycle/insane-tree backstop, well past real trees. */
const MAX_TREE_DEPTH = 24;

interface DiscoveredMember {
  readonly pid: number;
  readonly startedAtIdentity: string | null;
}

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

    // Pending spawn that never resolved a pid (T04): a successful handle
    // kill plus observed exit proves termination; ANYTHING LESS keeps the
    // record and reports an explicit failure — never a silent discard.
    if (record.pid === null) {
      if (this.registry.killViaHandle(recordId, "SIGKILL")) {
        const exited = await this.registry.observeExit(
          recordId,
          deadline - this.now()
        );
        if (exited) return { kind: "forced", count: 1 };
        return {
          kind: "failure",
          detail:
            "pending-spawn (pid never resolved) survived handle kill; record retained as incomplete cleanup",
        };
      }
      if (this.registry.hasHandle(recordId)) {
        return {
          kind: "failure",
          detail:
            "pending-spawn handle kill failed; record retained as incomplete cleanup",
        };
      }
      return {
        kind: "failure",
        detail:
          "pending-spawn resolved neither pid nor usable handle; record retained as incomplete cleanup",
      };
    }

    // Identity check FIRST — never signal a reused PID (AC-07, T03).
    const identity = await this.registry.verifyIdentity(recordId);
    if (identity === "reuse") {
      this.registry.markObservedExit(recordId);
      this.registry.forget(recordId);
      return { kind: "already-exited" };
    }
    if (identity === "gone") {
      // T02: an exited group LEADER may leave group members behind (the
      // pgid outlives the leader on POSIX). Signal the recorded own-group
      // once, verify its members, and only then treat the record as exited.
      if (
        record.isolatedProcessGroupId !== null &&
        this.ops.platform !== "win32"
      ) {
        const failures: string[] = [];
        const group = this.ops.signalGroup(
          record.isolatedProcessGroupId,
          "SIGKILL"
        );
        if (group === "error") {
          failures.push(
            `group signal failed for surviving pgid ${record.isolatedProcessGroupId}`
          );
        }
        const verifyDeadline = deadline;
        let groupAlive = this.ops.isGroupAlive(
          record.isolatedProcessGroupId
        );
        while (groupAlive && this.now() < verifyDeadline) {
          await sleep(VERIFY_POLL_MS);
          groupAlive = this.ops.isGroupAlive(
            record.isolatedProcessGroupId
          );
        }
        if (groupAlive) {
          failures.push("orphaned group members survived force-kill");
        }
        this.registry.markObservedExit(recordId);
        this.registry.forget(recordId);
        if (failures.length > 0) {
          return { kind: "failure", detail: failures.join("; ") };
        }
      }
      this.registry.markObservedExit(recordId);
      this.registry.forget(recordId);
      return { kind: "already-exited" };
    }

    // Capture the COMPLETE transitive tree while the root is alive (T02).
    // Discovery runs on every platform whose ops enumerate children; a
    // discovery ERROR is recorded, never silently treated as "no children".
    const tree = await this.collectTree(record.pid, deadline);
    const descendants = tree.members;

    let signaled = 0;
    const failures: string[] = [];
    if (tree.discoveryError !== null) {
      failures.push(`descendant discovery failed: ${tree.discoveryError}`);
    }

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
    // pre-kill capture and the root's death, found via the parent pid for
    // as long as the OS still reports it.
    if (this.ops.platform !== "win32") {
      try {
        const postChildren = await this.ops.listChildren(record.pid);
        for (const pid of postChildren) {
          if (!descendants.some((d) => d.pid === pid)) {
            descendants.push({ pid, startedAtIdentity: null });
          }
        }
      } catch (err) {
        failures.push(
          `post-kill child re-check failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    // Terminate surviving descendants individually, each guarded by an
    // identity RE-CHECK (T03): a pid whose start identity changed since
    // discovery is PID REUSE — never signal it, record incomplete cleanup.
    for (const member of descendants) {
      if (!this.ops.isAlive(member.pid)) continue;
      if (
        await this.identityChangedAsync(member.pid, member.startedAtIdentity)
      ) {
        failures.push(
          `descendant pid ${member.pid} identity changed (PID reuse); not signaled`
        );
        continue;
      }
      const result = this.ops.signal(member.pid, "SIGKILL");
      if (result === "ok") {
        signaled += 1;
      } else if (result === "error") {
        failures.push(`failed to signal descendant pid ${member.pid}`);
      }
    }

    // Verify observed exit for root AND every tree member within the budget.
    const targets = [record.pid, ...descendants.map((d) => d.pid)];
    const verifyDeadline = deadline;
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
        descendants.some((d) => d.pid === other.pid) &&
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

  /**
   * Recursively collect the transitive process tree under `rootPid`,
   * capturing each member's start-time identity at discovery (T02/T03).
   * A failed enumeration at any level aborts collection and reports the
   * error — never a silent empty tree.
   */
  private async collectTree(
    rootPid: number,
    deadline: number
  ): Promise<{
    members: DiscoveredMember[];
    discoveryError: string | null;
  }> {
    const members: DiscoveredMember[] = [];
    let frontier = [rootPid];
    const seen = new Set<number>([rootPid]);
    let discoveryError: string | null = null;

    for (let depth = 0; depth < MAX_TREE_DEPTH; depth += 1) {
      if (frontier.length === 0) break;
      if (this.now() >= deadline) {
        discoveryError =
          discoveryError ?? `discovery budget exhausted at depth ${depth}`;
        break;
      }
      const next: number[] = [];
      for (const parent of frontier) {
        let children: number[];
        try {
          children = await this.ops.listChildren(parent);
        } catch (err) {
          discoveryError = err instanceof Error ? err.message : String(err);
          continue;
        }
        for (const child of children) {
          if (seen.has(child)) continue; // defensive against table cycles
          seen.add(child);
          let startedAtIdentity: string | null = null;
          try {
            startedAtIdentity = await this.ops.readStartTimeIdentity(child);
          } catch {
            startedAtIdentity = null;
          }
          members.push({ pid: child, startedAtIdentity });
          next.push(child);
        }
      }
      frontier = next;
    }
    return { members, discoveryError };
  }

  /**
   * Async identity re-check for a discovered member (T03): true when the
   * pid's start identity no longer matches the discovery snapshot (PID
   * reuse) or can no longer be read — either way, never signal it.
   */
  private async identityChangedAsync(
    pid: number,
    snapshot: string | null
  ): Promise<boolean> {
    if (snapshot === null) {
      // Discovery captured no identity (platform limitation): membership in
      // the verified root's tree at discovery is the ownership evidence.
      return false;
    }
    try {
      const current = await this.ops.readStartTimeIdentity(pid);
      return current !== snapshot;
    } catch {
      return true; // unreadable now → do not signal
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === "function") t.unref();
  });
}
