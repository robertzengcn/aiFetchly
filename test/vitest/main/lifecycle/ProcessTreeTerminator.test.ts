import { describe, expect, it } from "vitest";
import { OwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";
import { ProcessTreeTerminator } from "@/main-process/lifecycle/ProcessTreeTerminator";
import { createDefaultProcessOps } from "@/main-process/lifecycle/processOps";
import { spawn } from "child_process";
import { FakeProcessOps, flushMicrotasks } from "./fakeProcessOps";

/**
 * Process-tree terminator tests (design §8, §13): graceful-exit success,
 * verified force-stop, PID-reuse protection, unvalidated-descendant
 * protection, permission failures, surviving descendants, plus REAL
 * process verification (AC-04/06/07/14 flavor).
 */

const FULL_BUDGET = () => 5_000;

describe("ProcessTreeTerminator — simulated table", () => {
  it("already-exited processes are success after verification (no signals)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const record = registry.register({ ownerId: "yp", pid });
    await flushMicrotasks();
    ops.table.get(pid)!.alive = false;
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(summary.forcedCount).toBe(0);
    expect(summary.verificationFailures).toEqual([]);
    expect(ops.signalCalls).toHaveLength(0);
    expect(registry.get(record.id)).toBeNull(); // forgotten after verified exit
  });

  it("force-stops a live root and its discovered descendants (AC-04)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const rootPid = ops.spawn(1);
    const childA = ops.spawn(rootPid);
    const childB = ops.spawn(rootPid);
    const unrelated = ops.spawn(1); // AC-07: never touched
    const record = registry.register({ ownerId: "yp", pid: rootPid });
    await flushMicrotasks();
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(summary.verificationFailures).toEqual([]);
    expect(summary.forcedCount).toBeGreaterThanOrEqual(1);
    expect(ops.isAlive(rootPid)).toBe(false);
    expect(ops.isAlive(childA)).toBe(false);
    expect(ops.isAlive(childB)).toBe(false);
    expect(ops.isAlive(unrelated)).toBe(true); // AC-07
    expect(ops.signalCalls.some((c) => c.pid === unrelated)).toBe(false);
    expect(registry.get(record.id)).toBeNull();
  });

  it("a surviving descendant of an already-dead root is still terminated", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const rootPid = ops.spawn(1);
    const browserPid = ops.spawn(rootPid);
    const root = registry.register({ ownerId: "extract", pid: rootPid });
    await flushMicrotasks();
    const browser = await registry.recordDescendantReport(
      root.id,
      browserPid,
      "browser"
    );
    expect(browser?.validated).toBe(true);
    // Root died gracefully; the browser lives on.
    ops.table.get(rootPid)!.alive = false;
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(summary.verificationFailures).toEqual([]);
    expect(ops.isAlive(browserPid)).toBe(false);
  });

  it("never signals a reused PID (AC-07) and treats the record as exited", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const record = registry.register({ ownerId: "yp", pid });
    await flushMicrotasks();
    ops.recycle(pid); // the OS gave the pid to an unrelated process
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(summary.forcedCount).toBe(0);
    expect(summary.verificationFailures).toEqual([]);
    expect(ops.signalCalls).toHaveLength(0); // never signaled
    expect(ops.isAlive(pid)).toBe(true); // the unrelated process survives
    expect(registry.get(record.id)).toBeNull();
  });

  it("never force-kills an unvalidated worker report (ambiguous ownership)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const workerPid = ops.spawn(1);
    const worker = registry.register({ ownerId: "extract", pid: workerPid });
    await flushMicrotasks();
    const unrelatedPid = ops.spawn(999);
    const report = await registry.recordDescendantReport(
      worker.id,
      unrelatedPid,
      "browser"
    );
    expect(report?.validated).toBe(false);
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    // The unvalidated pid survives untouched but is reported honestly.
    expect(ops.isAlive(unrelatedPid)).toBe(true);
    expect(summary.verificationFailures.length).toBeGreaterThan(0);
    expect(summary.verificationFailures[0]).toContain("unvalidated");
  });

  it("permission failure surfaces as a verification failure, siblings continue", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const deniedPid = ops.spawn(1);
    const okPid = ops.spawn(1);
    ops.epermPids.add(deniedPid);
    registry.register({ ownerId: "denied", pid: deniedPid });
    registry.register({ ownerId: "ok", pid: okPid });
    await flushMicrotasks();
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(ops.isAlive(deniedPid)).toBe(true);
    expect(ops.isAlive(okPid)).toBe(false);
    expect(summary.verificationFailures.length).toBeGreaterThan(0);
  });

  it("an unkillable process is reported as a verification failure (AC-06 negative)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const immunePid = ops.spawn(1);
    ops.immunePids.add(immunePid);
    const record = registry.register({ ownerId: "hung", pid: immunePid });
    await flushMicrotasks();
    // Default clock: the 250ms remaining budget bounds the verify loop.
    const terminator = new ProcessTreeTerminator(registry, ops);
    const summary = await terminator.terminateAll(() => 250);
    expect(ops.isAlive(immunePid)).toBe(true);
    expect(summary.verificationFailures.length).toBeGreaterThan(0);
    expect(summary.verificationFailures[0]).toContain("still alive");
    // Record retained (not forgotten) — cleanup is honestly incomplete.
    expect(registry.get(record.id)).not.toBeNull();
  });

  it("isolated process groups are signaled as a group on posix", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const rootPid = ops.spawn(1);
    // Children share the root's group (as with detached launch).
    const childPid = ops.spawn(rootPid, { pgid: rootPid });
    const record = registry.register({
      ownerId: "shell-tool",
      pid: rootPid,
      isolatedProcessGroupId: rootPid,
    });
    await flushMicrotasks();
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    await terminator.terminateAll(FULL_BUDGET);
    const groupCall = ops.signalCalls.find((c) => c.group);
    expect(groupCall).toBeDefined();
    expect(groupCall?.pid).toBe(rootPid);
    expect(ops.isAlive(childPid)).toBe(false);
    expect(ops.isAlive(rootPid)).toBe(false);
    expect(registry.get(record.id)).toBeNull();
  });

  it("windows uses awaited taskkill /PID /T /F", async () => {
    const ops = new FakeProcessOps();
    ops.platform = "win32";
    const registry = new OwnedProcessRegistry(ops);
    const rootPid = ops.spawn(1);
    const childPid = ops.spawn(rootPid);
    const record = registry.register({ ownerId: "yp", pid: rootPid });
    await flushMicrotasks();
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(ops.taskkillCalls).toEqual([rootPid]);
    expect(summary.verificationFailures).toEqual([]);
    expect(ops.isAlive(rootPid)).toBe(false);
    expect(ops.isAlive(childPid)).toBe(false); // /T walked the tree
    expect(registry.get(record.id)).toBeNull();
  });

  it("a pending spawn without a pid is killed via its handle", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const realPid = ops.spawn(1);
    let killed = false;
    const exitListeners: Array<() => void> = [];
    registry.register({
      ownerId: "w",
      handle: {
        kill: () => {
          killed = true;
          ops.table.get(realPid)!.alive = false;
          for (const fire of exitListeners) fire();
          return true;
        },
        once: (
          _event: "exit",
          listener: (code: number | null, signal: NodeJS.Signals | null) => void
        ) => {
          exitListeners.push(() => listener(null, null));
          return undefined;
        },
      },
    });
    const terminator = new ProcessTreeTerminator(registry, ops);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(killed).toBe(true);
    expect(summary.verificationFailures).toEqual([]);
  });
});

describe("ProcessTreeTerminator — 2026-09-21 audit regressions (T02–T04)", () => {
  it("kills and verifies the COMPLETE transitive tree, 3+ levels deep (T02)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const rootPid = ops.spawn(1);
    const childPid = ops.spawn(rootPid);
    const grandChildPid = ops.spawn(childPid);
    const greatGrandPid = ops.spawn(grandChildPid);
    registry.register({ ownerId: "deep", pid: rootPid });
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(summary.verificationFailures).toEqual([]);
    expect(ops.isAlive(rootPid)).toBe(false);
    expect(ops.isAlive(childPid)).toBe(false);
    expect(ops.isAlive(grandChildPid)).toBe(false);
    expect(ops.isAlive(greatGrandPid)).toBe(false);
  });

  it("grandchild survival is a verification failure, not silent success (T02)", async () => {
    const ops = new FakeProcessOps();
    // SIGKILL-immune grandchild under a killable child.
    const registry = new OwnedProcessRegistry(ops);
    const rootPid = ops.spawn(1);
    const childPid = ops.spawn(rootPid);
    const grandPid = ops.spawn(childPid);
    ops.immunePids.add(grandPid);
    registry.register({ ownerId: "leak", pid: rootPid });
    const terminator = new ProcessTreeTerminator(registry, ops);
    const summary = await terminator.terminateAll(() => 400);
    expect(summary.verificationFailures.length).toBeGreaterThan(0);
    expect(summary.verificationFailures[0]).toContain("still alive");
    expect(ops.isAlive(grandPid)).toBe(true);
  });

  it("never signals a descendant whose PID was reused after discovery (T03)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const rootPid = ops.spawn(1);
    const childPid = ops.spawn(rootPid);
    registry.register({ ownerId: "reuse-guard", pid: rootPid });
    // Simulate reuse between discovery and signal: recycle the child AFTER
    // discovery captured its identity. We hook signal to recycle on first call.
    let firstSignal = true;
    const originalSignal = ops.signal.bind(ops);
    ops.signal = (pid: number, sig: NodeJS.Signals) => {
      if (firstSignal) {
        firstSignal = false;
        // Root signaled; recycle the child BEFORE the descendant loop runs.
        ops.recycle(childPid);
      }
      return originalSignal(pid, sig);
    };
    // Real clock: the verify loop must terminate against the budget even
    // though the recycled (unrelated) pid legitimately stays alive.
    const terminator = new ProcessTreeTerminator(registry, ops);
    const summary = await terminator.terminateAll(() => 300);
    // The recycled (unrelated) pid must NOT be signaled and must survive.
    expect(ops.isAlive(childPid)).toBe(true);
    expect(summary.verificationFailures.some((f) => f.includes("PID reuse"))).toBe(true);
  });

  it("a pending-spawn record with no resolvable kill is RETAINED and reported, never silently discarded (T04)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const record = registry.register({ ownerId: "ghost-spawn" }); // no pid, no handle
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(summary.verificationFailures.length).toBeGreaterThan(0);
    expect(summary.verificationFailures[0]).toContain("incomplete cleanup");
    // The record is retained for honest post-mortem inspection.
    expect(registry.get(record.id)?.exited).toBe(false);
  });

  it("a pending-spawn whose handle kill fails (throwing kill) is retained as a failure (T04)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const record = registry.register({
      ownerId: "bad-handle",
      handle: {
        kill: () => {
          throw new Error("kill broken");
        },
        once: () => undefined,
      },
    });
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(summary.verificationFailures[0]).toContain("handle kill failed");
    expect(registry.get(record.id)?.exited).toBe(false);
  });

  it("a discovery failure is reported instead of producing an empty tree (T02)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const rootPid = ops.spawn(1);
    ops.spawn(rootPid); // a child exists
    registry.register({ ownerId: "enum-fail", pid: rootPid });
    ops.listChildren = async () => {
      throw new Error("pgrep unavailable");
    };
    const terminator = new ProcessTreeTerminator(registry, ops, () => 0);
    const summary = await terminator.terminateAll(FULL_BUDGET);
    expect(
      summary.verificationFailures.some((f) => f.includes("discovery failed"))
    ).toBe(true);
  });
});

describe("ProcessTreeTerminator — real processes (linux integration)", () => {
  /**
   * Independent-observer flavor of AC-14: real OS processes verified dead
   * via kill(pid, 0) probes that this test performs itself (not through the
   * registry's ops).
   */
  function isPidAlive(pid: number | undefined): boolean {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it(
    "terminates a real spawned tree: root + sleep descendants",
    { timeout: 15_000 },
    async () => {
      if (process.platform === "win32") return; // posix-only integration
      const root = spawn("sh", ["-c", "sleep 12 & sleep 12"], {
        stdio: "ignore",
      });
      const ops = createDefaultProcessOps();
      const registry = new OwnedProcessRegistry(ops);
      const record = registry.register({ ownerId: "test-tree", pid: root.pid });
      // Give sh a moment to fork the sleeps.
      await new Promise((r) => setTimeout(r, 400));
      const children = await registry.listChildPids(record.id);
      expect(children.length).toBeGreaterThanOrEqual(2);

      const terminator = new ProcessTreeTerminator(registry, ops);
      const summary = await terminator.terminateAll(() => 5_000);

      expect(summary.verificationFailures).toEqual([]);
      // Independent verification.
      expect(isPidAlive(root.pid)).toBe(false);
      for (const pid of children) {
        expect(isPidAlive(pid)).toBe(false);
      }
    }
  );

  it(
    "terminates a real detached process group",
    { timeout: 15_000 },
    async () => {
      if (process.platform === "win32") return;
      const root = spawn("sh", ["-c", "sleep 12"], {
        stdio: "ignore",
        detached: true, // own process group = its pid
      });
      const ops = createDefaultProcessOps();
      const registry = new OwnedProcessRegistry(ops);
      const record = registry.register({
        ownerId: "test-group",
        pid: root.pid,
        isolatedProcessGroupId: root.pid,
      });
      await new Promise((r) => setTimeout(r, 300));

      const terminator = new ProcessTreeTerminator(registry, ops);
      const summary = await terminator.terminateAll(() => 5_000);

      expect(summary.verificationFailures).toEqual([]);
      expect(isPidAlive(root.pid)).toBe(false);
      expect(registry.get(record.id)).toBeNull();
    }
  );
});
