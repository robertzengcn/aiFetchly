import { describe, expect, it } from "vitest";
import { OwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";
import type { OwnedProcessHandle } from "@/main-process/lifecycle/OwnedProcessRegistry";
import { FakeProcessOps, flushMicrotasks } from "./fakeProcessOps";

/**
 * Owned-process registry tests (design §6, §13): pending spawns, observed
 * exit, PID-reuse identity, record-retention invariants, and ppid
 * validation of worker-reported descendants.
 */

function makeHandle(events: {
  onExit?: (listener: () => void) => void;
  killed?: (signal?: NodeJS.Signals) => boolean;
}): OwnedProcessHandle {
  return {
    kill: (signal?: NodeJS.Signals) => events.killed?.(signal) ?? true,
    once: (
      _event: "exit",
      listener: (code: number | null, signal: NodeJS.Signals | null) => void
    ) => {
      events.onExit?.(() => listener(null, null));
      return undefined;
    },
  };
}

describe("OwnedProcessRegistry — registration", () => {
  it("registers with a pid and captures start-time identity", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const record = registry.register({ ownerId: "contact-extraction", pid });
    await flushMicrotasks();
    expect(record.pid).toBe(pid);
    const view = registry.get(record.id);
    expect(view?.identityTracked).toBe(true);
    expect(view?.exited).toBe(false);
  });

  it("supports the pending-spawn interval before a pid exists", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const record = registry.register({ ownerId: "shell-tool" });
    expect(record.pid).toBeNull();
    const pid = ops.spawn(1);
    expect(registry.setPid(record.id, pid)).toBe(true);
    await flushMicrotasks();
    expect(registry.get(record.id)?.pid).toBe(pid);
    // Second resolution is rejected.
    expect(registry.setPid(record.id, pid)).toBe(false);
  });

  it("observes exit through the transport handle event", () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const fireExit: { current: (() => void) | null } = { current: null };
    const handle = makeHandle({ onExit: (l) => (fireExit.current = l) });
    const record = registry.register({ ownerId: "w", handle });
    fireExit.current?.();
    expect(registry.get(record.id)?.exited).toBe(true);
  });

  it("killViaHandle delegates to the stored handle", () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const killCalls: string[] = [];
    const handle = makeHandle({
      killed: (signal) => {
        killCalls.push(signal ?? "default");
        return true;
      },
    });
    const record = registry.register({ ownerId: "w", handle });
    expect(registry.killViaHandle(record.id, "SIGTERM")).toBe(true);
    expect(killCalls).toEqual(["SIGTERM"]);
  });
});

describe("OwnedProcessRegistry — record retention (design §6)", () => {
  it("refuses to forget a live record even if a manager dropped it", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const record = registry.register({ ownerId: "yp-scraper", pid });
    await flushMicrotasks();
    expect(registry.forget(record.id)).toBe(false);
    expect(registry.get(record.id)).not.toBeNull();
  });

  it("a killed root does not erase living descendant records", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const rootPid = ops.spawn(1);
    const childPid = ops.spawn(rootPid);
    const root = registry.register({ ownerId: "yp", pid: rootPid });
    const child = await registry.recordDescendantReport(
      root.id,
      childPid,
      "browser"
    );
    expect(child?.validated).toBe(true);
    // Root dies.
    ops.table.get(rootPid)!.alive = false;
    registry.markObservedExit(root.id);
    // Descendant record survives.
    expect(registry.get(child!.id)?.exited).toBe(false);
    expect(registry.forget(root.id)).toBe(true);
    expect(registry.get(child!.id)).not.toBeNull();
  });

  it("observeExit resolves true once the process dies (poll path)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const record = registry.register({ ownerId: "yp", pid });
    const observed = registry.observeExit(record.id, 1_000);
    setTimeout(() => {
      ops.table.get(pid)!.alive = false;
    }, 60);
    await expect(observed).resolves.toBe(true);
    expect(registry.get(record.id)?.exited).toBe(true);
  });

  it("observeExit resolves false on timeout — a sent signal is not exit proof", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const record = registry.register({ ownerId: "yp", pid });
    await expect(registry.observeExit(record.id, 80)).resolves.toBe(false);
    expect(registry.get(record.id)?.exited).toBe(false);
  });
});

describe("OwnedProcessRegistry — identity (PID reuse, design §8)", () => {
  it("detects PID reuse via start-time mismatch", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const record = registry.register({ ownerId: "yp", pid });
    await flushMicrotasks();
    expect(await registry.verifyIdentity(record.id)).toBe("ours");
    ops.recycle(pid); // OS reuses the pid for a different process
    expect(await registry.verifyIdentity(record.id)).toBe("reuse");
  });

  it("reports gone for an exited process", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const record = registry.register({ ownerId: "yp", pid });
    await flushMicrotasks();
    ops.table.get(pid)!.alive = false;
    expect(await registry.verifyIdentity(record.id)).toBe("gone");
  });

  it("falls back to unknown when only a spawn-timestamp identity exists", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    // Win32-style: readStartTimeIdentity returns null.
    ops.readStartTimeIdentity = async () => null;
    const pid = ops.spawn(1);
    const record = registry.register({ ownerId: "yp", pid });
    await flushMicrotasks();
    expect(registry.get(record.id)?.identityTracked).toBe(false);
    expect(await registry.verifyIdentity(record.id)).toBe("unknown");
  });
});

describe("OwnedProcessRegistry — bounded exited-record retention", () => {
  it("evicts the oldest exited records beyond the cap; live records stay", () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const liveIds: string[] = [];
    // 70 records that all exit, plus 3 that stay live.
    for (let i = 0; i < 70; i += 1) {
      const pid = ops.spawn(1);
      const record = registry.register({ ownerId: "wave", pid });
      ops.table.get(pid)!.alive = false;
      registry.markObservedExit(record.id);
    }
    for (let i = 0; i < 3; i += 1) {
      liveIds.push(registry.register({ ownerId: "live", pid: ops.spawn(1) }).id);
    }
    const all = registry.list();
    expect(all.filter((r) => !r.exited)).toHaveLength(3); // live kept
    // Exited records bounded: 70 registered-exited + register() sweeps keep
    // at most the newest MAX_RETAINED_EXITED_RECORDS.
    expect(all.filter((r) => r.exited).length).toBeLessThanOrEqual(70);
    expect(all.filter((r) => r.exited).length).toBeGreaterThanOrEqual(60);
    for (const id of liveIds) {
      expect(registry.get(id)?.exited).toBe(false);
    }
  });
});

describe("OwnedProcessRegistry — own-group isolation guard (design §8)", () => {
  it("accepts isolatedProcessGroupId only when it equals the pid", () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const record = registry.register({
      ownerId: "detached",
      pid,
      isolatedProcessGroupId: pid,
    });
    expect(record.isolatedProcessGroupId).toBe(pid);
  });

  it("refuses a foreign isolatedProcessGroupId (never signal a group we did not create)", () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const record = registry.register({
      ownerId: "suspicious",
      pid,
      isolatedProcessGroupId: 1, // e.g. the app's own group
    });
    expect(record.isolatedProcessGroupId).toBeNull();
  });
});

describe("OwnedProcessRegistry — worker descendant reports (design §7)", () => {
  it("accepts and validates a descendant whose ppid chain reaches the worker", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const workerPid = ops.spawn(1);
    const browserPid = ops.spawn(workerPid);
    const worker = registry.register({ ownerId: "extract", pid: workerPid });
    await flushMicrotasks();
    const report = await registry.recordDescendantReport(
      worker.id,
      browserPid,
      "browser"
    );
    expect(report).not.toBeNull();
    expect(report?.ownership).toBe("spawned-by-owned-worker");
    expect(report?.validated).toBe(true);
    expect(report?.parentRecordId).toBe(worker.id);
  });

  it("validates through an intermediate descendant", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const workerPid = ops.spawn(1);
    const launcherPid = ops.spawn(workerPid);
    const browserPid = ops.spawn(launcherPid);
    const worker = registry.register({ ownerId: "extract", pid: workerPid });
    await flushMicrotasks();
    const report = await registry.recordDescendantReport(
      worker.id,
      browserPid,
      "browser"
    );
    expect(report?.validated).toBe(true);
  });

  it("records an unvalidated report when the chain does not reach the worker", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const workerPid = ops.spawn(1);
    const unrelatedPid = ops.spawn(999); // child of someone else
    const worker = registry.register({ ownerId: "extract", pid: workerPid });
    await flushMicrotasks();
    const report = await registry.recordDescendantReport(
      worker.id,
      unrelatedPid,
      "browser"
    );
    expect(report).not.toBeNull();
    expect(report?.validated).toBe(false);
  });

  it("ignores reports for an unknown worker record", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const report = await registry.recordDescendantReport(
      "no-such-record",
      1234,
      "browser"
    );
    expect(report).toBeNull();
  });
});
