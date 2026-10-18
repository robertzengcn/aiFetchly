// Settlement + deadline-expiry tests (yellow-pages plugin plan, PRD §11.8).
// H5 updates the cancel contract: the admission lease (running slot +
// duplicate-suppression fingerprint) is HELD until the spawn continuation
// actually exits (or the settle-grace window lapses), so a second browser
// can never start while the first job is still tearing down.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ToolJobRegistry,
  AdmissionSealedError,
  TOOL_JOB_SETTLE_GRACE_MS,
} from "@/service/ToolJobRegistry";

describe("ToolJobRegistry settlement", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes jobId on the spawn handle", async () => {
    const registry = new ToolJobRegistry();
    let seenId = "";
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (handle) => {
      seenId = handle.jobId;
      handle.resolve({ ok: true });
    });
    expect(seenId).toBe(jobId);
  });

  it("fires onSettled exactly once on resolve", async () => {
    const registry = new ToolJobRegistry();
    const settled = vi.fn();
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (handle) => {
      handle.onSettled(settled);
      handle.resolve(1);
    });
    expect(settled).toHaveBeenCalledTimes(1);
    expect(await registry.waitForSettled(jobId, 10)).toBe(true);
  });

  it("late onSettled registration after terminal state fires immediately", async () => {
    const registry = new ToolJobRegistry();
    const late = vi.fn();
    registry.start("t2", {}, { conversationId: "c", toolCallId: "tc2" }, async (handle) => {
      handle.resolve(2);
      // Registering after resolve: the callback must still fire once.
      handle.onSettled(late);
      expect(late).toHaveBeenCalledTimes(1);
    });
  });

  it("waitForSettled times out bounded for a stuck job", async () => {
    const registry = new ToolJobRegistry();
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async () => {
      await new Promise(() => undefined); // never settles
    });
    const outcome = registry.waitForSettled(jobId, 50);
    vi.advanceTimersByTime(80);
    await expect(outcome).resolves.toBe(false);
  });

  it("waitForSettled resolves true when the job settles while waiting", async () => {
    const registry = new ToolJobRegistry();
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, (handle) =>
      new Promise<unknown>(() => {
        setTimeout(() => handle.resolve("done"), 100);
      }) as Promise<unknown>
    );
    const outcome = registry.waitForSettled(jobId, 1_000);
    await vi.advanceTimersByTimeAsync(150);
    await expect(outcome).resolves.toBe(true);
  });
});

describe("ToolJobRegistry H5 deferred settlement on cancel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds onSettled until the spawn continuation exits after a cancel", async () => {
    const registry = new ToolJobRegistry();
    const settled = vi.fn();
    let resolver: ((v: unknown) => void) | undefined;
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (handle) => {
      handle.onSettled(settled);
      resolver = handle.resolve;
      await new Promise(() => undefined); // teardown unwinds on its own
    });
    registry.cancel(jobId);
    // Lease held: no settlement while teardown is unwinding.
    expect(settled).toHaveBeenCalledTimes(0);
    // Teardown finished → exactly one settlement.
    resolver?.("late");
    expect(settled).toHaveBeenCalledTimes(1);
    expect(await registry.waitForSettled(jobId, 10)).toBe(true);
    // Another late resolve must not double-fire.
    resolver?.("later");
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("releases the lease after the settle-grace window even when the spawn hangs", async () => {
    const registry = new ToolJobRegistry();
    const settled = vi.fn();
    let resolver: ((v: unknown) => void) | undefined;
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (handle) => {
      handle.onSettled(settled);
      resolver = handle.resolve;
      await new Promise(() => undefined); // hung tool ignores abort
    });
    registry.cancel(jobId);
    expect(settled).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(TOOL_JOB_SETTLE_GRACE_MS + 1);
    expect(settled).toHaveBeenCalledTimes(1);
    // A very late resolution must not double-fire after the grace settle.
    resolver?.("very-late");
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("keeps the admission slot occupied until the cancelled job settles", async () => {
    const registry = new ToolJobRegistry({ maxConcurrent: 1 });
    const spawnSpy = vi.fn();
    let resolver: ((v: unknown) => void) | undefined;
    registry.start("occupier", {}, { conversationId: "c", toolCallId: "t0" }, async (handle) => {
      resolver = handle.resolve;
      await new Promise(() => undefined);
    });
    // Drain the single slot anyway (the occupier holds it while resolving).
    resolver?.(null);
    expect(spawnSpy).toHaveBeenCalledTimes(0);
    // A second job now runs; cancel it and start a third while it unwinds.
    let secondResolver: ((v: unknown) => void) | undefined;
    const second = registry.start("second", {}, { conversationId: "c", toolCallId: "t1" }, async (handle) => {
      secondResolver = handle.resolve;
      await new Promise(() => undefined);
    });
    registry.cancel(second.jobId);
    const third = registry.start(
      "third",
      {},
      { conversationId: "c", toolCallId: "t2" },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- spawn marker
      async (_handle?: unknown) => {
        spawnSpy();
      }
    );
    // Lease held: the third job cannot run while the second is unwinding.
    expect(third.queued).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(0);
    // The second's continuation exits → slot freed → third spawns.
    secondResolver?.("done");
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it("duplicate suppression still matches a cancelled-unwinding job", async () => {
    const registry = new ToolJobRegistry();
    let resolver: ((v: unknown) => void) | undefined;
    const { jobIds } = { jobIds: [] as string[] };
    const started = registry.start(
      "mcp__x__server__scrape",
      {},
      { conversationId: "c", toolCallId: "tc" },
      async (handle) => {
        resolver = handle.resolve;
        await new Promise(() => undefined);
      },
      { fingerprint: "fp-1" }
    );
    jobIds.push(started.jobId);
    registry.cancel(started.jobId);
    // Still unwinding → the same fingerprint is refused.
    expect(
      registry.findActiveJobByFingerprint("c", "fp-1")
    ).toEqual({ jobId: started.jobId });
    resolver?.("done");
    // Settled → the fingerprint is free again.
    expect(registry.findActiveJobByFingerprint("c", "fp-1")).toBeNull();
  });
});

describe("ToolJobRegistry H5 admission seals", () => {
  it("refuses admission for tools under a sealed prefix", () => {
    const registry = new ToolJobRegistry();
    registry.sealAdmission("mcp__yplugins__");
    expect(() =>
      registry.start(
        "mcp__yplugins__browser__scrape",
        {},
        { conversationId: "c", toolCallId: "tc" },
        async () => undefined
      )
    ).toThrow(AdmissionSealedError);
    // Other tools are unaffected.
    const { jobId } = registry.start(
      "mcp__other__server__tool",
      {},
      { conversationId: "c", toolCallId: "tc" },
      async () => undefined
    );
    expect(jobId).toBeTruthy();
  });

  it("admission works again after the seal is released", () => {
    const registry = new ToolJobRegistry();
    registry.sealAdmission("mcp__yplugins__");
    registry.releaseAdmissionSeal("mcp__yplugins__");
    const { jobId } = registry.start(
      "mcp__yplugins__browser__scrape",
      {},
      { conversationId: "c", toolCallId: "tc" },
      async () => undefined
    );
    expect(jobId).toBeTruthy();
    expect(registry.isClosed()).toBe(false);
  });

  it("lists active (or unwinding) jobs under the prefix only", async () => {
    const registry = new ToolJobRegistry();
    const { jobId: pluginJob } = registry.start(
      "mcp__yplugins__browser__scrape",
      {},
      { conversationId: "c", toolCallId: "tc" },
      async (handle) => {
        registry.cancel(handle.jobId); // unwinding only
        await new Promise(() => undefined);
      }
    );
    const { jobId: otherJob } = registry.start(
      "mcp__other__server__tool",
      {},
      { conversationId: "c", toolCallId: "tc2" },
      async () => undefined
    );
    vi.useRealTimers();
    expect(registry.listActiveJobIdsByToolPrefix("mcp__yplugins__")).toEqual([
      pluginJob,
    ]);
    expect(
      registry.listActiveJobIdsByToolPrefix("mcp__other__")
    ).toContain(otherJob);
    vi.useFakeTimers();
  });

  it("shutdownAndAwaitCleanup resolves bounded when a spawn hangs and then clears state", async () => {
    vi.useRealTimers();
    const registry = new ToolJobRegistry();
    const settled = vi.fn();
    registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (handle) => {
      handle.onSettled(settled);
      await new Promise(() => undefined); // hung tool never resolves
    });
    const started = Date.now();
    await registry.shutdownAndAwaitCleanup(120);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(registry.isClosed()).toBe(true);
  });

  it("shutdownAndAwaitCleanup fires deferred settlements when continuations exit", async () => {
    vi.useRealTimers();
    const registry = new ToolJobRegistry();
    const settled = vi.fn();
    let resolver: ((v: unknown) => void) | undefined;
    registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (handle) => {
      handle.onSettled(settled);
      resolver = handle.resolve;
      await new Promise(() => undefined);
    });
    const promise = registry.shutdownAndAwaitCleanup(2_000);
    resolver?.("done");
    await promise;
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
