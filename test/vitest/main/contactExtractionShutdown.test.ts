import { describe, expect, it, vi } from "vitest";
import {
  reconcileInterruptedWork,
  shutdownContactWorker,
  type ProtocolWorkerLike,
} from "@/main-process/communication/contactExtractionShutdown";
import type { OwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";
import type { OwnedProcessRecordView } from "@/main-process/lifecycle/OwnedProcessRegistry";
import type { FailDeps } from "@/main-process/communication/contactExtractionRecovery";

/**
 * §7 parent-side protocol tests (design §7 / T3) + FR-06 reconciliation error
 * path (T6): send-first ordering, observed-exit semantics, kill fallback, and
 * never-throw reconciliation.
 */

function makeRegistry(exits: {
  natural: boolean;
  afterKill: boolean;
}): {
  registry: OwnedProcessRegistry;
  observes: Array<{ id: string; timeoutMs: number }>;
} {
  const observes: Array<{ id: string; timeoutMs: number }> = [];
  const registry = {
    observeExit: vi.fn(async (id: string, timeoutMs: number) => {
      observes.push({ id, timeoutMs });
      // First observe = natural-exit window; second = post-kill verify.
      const callIndex = observes.length - 1;
      if (callIndex === 0) return exits.natural;
      return exits.afterKill;
    }),
  } as unknown as OwnedProcessRegistry;
  return { registry, observes };
}

function makeWorker(): {
  worker: ProtocolWorkerLike;
  sent: unknown[];
  kills: number;
} {
  const sent: unknown[] = [];
  const kills = { count: 0 };
  const worker = {
    pid: 4242,
    send: (m: unknown) => {
      sent.push(m);
      return true;
    },
    kill: (_signal?: NodeJS.Signals) => {
      kills.count += 1;
      return true;
    },
  };
  return { worker, sent, get kills() { return kills.count; } } as never;
}

const RECORD = { id: "rec-1", pid: 4242 } as OwnedProcessRecordView;

const DEPS = (registry: OwnedProcessRegistry) => ({
  registry,
  newRequestId: () => "req-fixed",
  warn: () => undefined,
  info: () => undefined,
});

describe("shutdownContactWorker (§7 parent protocol)", () => {
  it("sends the shutdown-request FIRST with requestId + budget, before any wait", async () => {
    const { registry, observes } = makeRegistry({ natural: true, afterKill: true });
    const w = makeWorker();
    const exited = await shutdownContactWorker(w.worker, RECORD, 2_000, DEPS(registry));
    expect(exited).toBe(true);
    // Protocol message shape (§7).
    expect(w.sent[0]).toEqual({
      type: "shutdown",
      requestId: "req-fixed",
      reason: "app-shutdown",
      remainingMs: 2_000,
    });
    // Natural exit observed within the full budget; no kill needed.
    expect(w.kills).toBe(0);
    expect(observes[0]).toEqual({ id: "rec-1", timeoutMs: 2_000 });
  });

  it("falls back to kill + bounded re-verify when the worker ignores the protocol", async () => {
    const { registry, observes } = makeRegistry({ natural: false, afterKill: true });
    const w = makeWorker();
    const exited = await shutdownContactWorker(w.worker, RECORD, 2_000, DEPS(registry));
    expect(exited).toBe(true);
    expect(w.kills).toBe(1);
    // Re-verify is bounded to a 1s slice of the budget.
    expect(observes[1]!.timeoutMs).toBe(1_000);
  });

  it("reports false (force phase will verify) when even the kill does not land", async () => {
    const { registry } = makeRegistry({ natural: false, afterKill: false });
    const warnings: string[] = [];
    const w = makeWorker();
    const exited = await shutdownContactWorker(w.worker, RECORD, 2_000, {
      ...DEPS(registry),
      warn: (m) => warnings.push(m),
    });
    expect(exited).toBe(false);
    expect(warnings.join(" ")).toContain("force-phase will verify");
  });

  it("a send failure never aborts the sequence (kill + verify still run)", async () => {
    const { registry } = makeRegistry({ natural: false, afterKill: true });
    const sent: unknown[] = [];
    const worker = {
      pid: 1,
      send: () => {
        throw new Error("channel closed");
      },
      kill: () => true,
    };
    void sent;
    const exited = await shutdownContactWorker(worker, RECORD, 500, DEPS(registry));
    expect(exited).toBe(true);
  });

  it("zero budget skips observation waits entirely (force phase owns it)", async () => {
    const { registry, observes } = makeRegistry({ natural: true, afterKill: true });
    const w = makeWorker();
    const exited = await shutdownContactWorker(w.worker, RECORD, 0, DEPS(registry));
    expect(exited).toBe(true);
    expect(observes).toHaveLength(0);
    expect(w.sent[0]).toMatchObject({ remainingMs: 0 });
  });

  it("no registry record: protocol still sent, kill still attempted", async () => {
    const { registry, observes } = makeRegistry({ natural: true, afterKill: true });
    const w = makeWorker();
    const exited = await shutdownContactWorker(w.worker, undefined, 2_000, DEPS(registry));
    expect(exited).toBe(true);
    expect(observes).toHaveLength(0);
    expect(w.sent).toHaveLength(1);
  });
});

describe("reconcileInterruptedWork (FR-06, never throws)", () => {
  it("maps in-flight ids to failed via the deps", async () => {
    const deps: FailDeps = {
      getInFlightResultIds: async () => [7, 8],
      batchUpdateStatus: async () => undefined,
    };
    const ids = await reconcileInterruptedWork(deps, "reason", () => undefined);
    expect(ids).toEqual([7, 8]);
  });

  it("a throwing reconciliation is logged and returns [] (worker stop proceeds)", async () => {
    const deps: FailDeps = {
      getInFlightResultIds: async () => {
        throw new Error("db gone");
      },
      batchUpdateStatus: async () => undefined,
    };
    const warnings: string[] = [];
    const ids = await reconcileInterruptedWork(deps, "reason", (m) =>
      warnings.push(m)
    );
    expect(ids).toEqual([]);
    expect(warnings.join(" ")).toContain("reconciliation failed");
  });
});
