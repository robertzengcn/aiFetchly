// Settlement + deadline-expiry tests (yellow-pages plugin plan, PRD §11.8).
// H5 updates the cancel contract: the admission lease (running slot +
// duplicate-suppression fingerprint) is HELD until the spawn continuation
// actually exits (or the settle-grace window lapses), so a second browser
// can never start while the first job is still tearing down.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ToolJobRegistry,
  ToolConversationConcurrencyError,
  AdmissionSealedError,
  TOOL_JOB_SETTLE_GRACE_MS,
  type ToolJobSpawnHandle,
} from "@/service/ToolJobRegistry";

/** Test-only narrowing: the settle-path mutations exercised in B04 specs. */
type ToolJobSpawnHandleForTest = Pick<ToolJobSpawnHandle, "resolve" | "reject">;

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

  it("quarantines the job when the settle-grace window lapses without proof of cleanup (B04)", async () => {
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
    // B04: grace lapse is a CLEANUP FAILURE, not a success — no settlement,
    // explicit verdict, ownership retained (the job keeps unwinding status).
    expect(settled).toHaveBeenCalledTimes(0);
    expect(registry.getCleanupOutcome(jobId)).toBe("grace-lapsed");
    expect(registry.isJobActive(jobId)).toBe(true);
    // A very late resolution proves quiescence only now: the lease is then
    // released exactly once, but the recorded failure verdict stands.
    resolver?.("very-late");
    expect(settled).toHaveBeenCalledTimes(1);
    expect(registry.getCleanupOutcome(jobId)).toBe("grace-lapsed");
    expect(await registry.waitForSettled(jobId, 10)).toBe(true);
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

describe("ToolJobRegistry B04 idempotent settlement + cleanup quarantine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  function eventuallyRun(
    registry: ToolJobRegistry,
    marker: { called: boolean }
  ): { queued: boolean; jobId: string } {
    return registry.start(
      "replacement",
      {},
      { conversationId: "c", toolCallId: "next" },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_handle) => {
        marker.called = true;
        await new Promise(() => undefined);
      }
    );
  }

  it("a duplicate resolve after another job claimed the slot cannot free a second slot", () => {
    const registry = new ToolJobRegistry({ maxConcurrent: 1 });
    let first: ToolJobSpawnHandleForTest | undefined;
    registry.start("a", {}, { conversationId: "c", toolCallId: "t0" }, async (handle) => {
      first = handle;
      await new Promise(() => undefined);
    });
    first?.resolve("real"); // A settles; the single slot is released.
    // B now legitimately owns the slot and never settles on its own.
    registry.start(
      "b",
      {},
      { conversationId: "c", toolCallId: "t1" },
      async () => {
        await new Promise(() => undefined);
      }
    );
    const third = eventuallyRun(registry, { called: false });
    expect(third.queued).toBe(true);
    // Re-fire A's resolve (stale duplicate path): the old double-release bug
    // would decrement capacity again and let the third job start while B
    // still holds the only slot.
    first?.resolve("duplicate");
    expect(registry.getStatus(third.jobId).status).toBe("queued");
  });

  it("duplicate resolve does not overwrite the recorded result", () => {
    const registry = new ToolJobRegistry();
    let second: ToolJobSpawnHandleForTest | undefined;
    const secondJob = registry.start(
      "t2",
      {},
      { conversationId: "c", toolCallId: "t1" },
      async (handle) => {
        second = handle;
        await new Promise(() => undefined);
      }
    );
    second?.resolve("first-wins");
    second?.resolve("corrupted");
    second?.reject(new Error("late reject"));
    const snapshot = registry.getStatus(secondJob.jobId);
    expect(snapshot.status).toBe("completed");
    expect(snapshot.result).toBe("first-wins");
    expect(snapshot.error).toBeNull();
  });

  it("resolve-then-reject leaves the settled result and terminal state unchanged", () => {
    const registry = new ToolJobRegistry();
    let handle: ToolJobSpawnHandleForTest | undefined;
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (h) => {
      handle = h;
      await new Promise(() => undefined);
    });
    handle?.resolve("kept");
    handle?.reject(new Error("must be ignored"));
    const snapshot = registry.getStatus(jobId);
    expect(snapshot.status).toBe("completed");
    expect(snapshot.result).toBe("kept");
    expect(snapshot.error).toBeNull();
  });

  it("late progress and partial updates after settlement are ignored", () => {
    const registry = new ToolJobRegistry();
    let handle: ToolJobSpawnHandleForTest | undefined;
    const { jobId } = registry.start("t", {}, { conversationId: "c", toolCallId: "tc" }, async (h) => {
      handle = h;
      await new Promise(() => undefined);
    });
    handle?.resolve("done");
    registry.updateProgress(jobId, {
      phase: "finalizing",
      message: "late",
      progress: 100,
      partialCount: null,
      expectedCount: null,
    });
    registry.updatePartial(jobId, { data: { late: true }, collectedCount: 1, expectedCount: 1 });
    const snapshot = registry.getStatus(jobId);
    expect(snapshot.progress).toBeNull();
    expect(snapshot.partial).toBeNull();
  });

  it("a never-settling cancelled job blocks replacement/admission until quiescence is proven", () => {
    const registry = new ToolJobRegistry({ maxConcurrent: 1 });
    let second: ToolJobSpawnHandleForTest | undefined;
    const secondJob = registry.start(
      "mcp__yplugins__server__scrape",
      {},
      { conversationId: "c", toolCallId: "t1" },
      async (handle) => {
        second = handle;
        await new Promise(() => undefined);
      },
      { fingerprint: "fp-replace" }
    );
    registry.cancel(secondJob.jobId);
    vi.advanceTimersByTime(TOOL_JOB_SETTLE_GRACE_MS + 1);
    // Quarantine retained BOTH the capacity slot and the fingerprint lease.
    expect(registry.getCleanupOutcome(secondJob.jobId)).toBe("grace-lapsed");
    expect(registry.findActiveJobByFingerprint("c", "fp-replace")).toEqual({
      jobId: secondJob.jobId,
    });
    const replacement = eventuallyRun(registry, { called: false });
    expect(replacement.queued).toBe(true);
    // A stray continuation exiting later proves quiescence and frees the
    // slot — the queued replacement can then start.
    second?.resolve("late-exit");
    expect(registry.getStatus(replacement.jobId).status).toBe("running");
  });

  it("stale eviction is the last-resort release for a quarantined job's slot", () => {
    const registry = new ToolJobRegistry({
      maxConcurrent: 1,
      staleAfterMs: 100,
    });
    let hung: ToolJobSpawnHandleForTest | undefined;
    const job = registry.start("t", {}, { conversationId: "c", toolCallId: "t0" }, async (handle) => {
      hung = handle;
      await new Promise(() => undefined);
    });
    registry.cancel(job.jobId);
    vi.advanceTimersByTime(TOOL_JOB_SETTLE_GRACE_MS + 1);
    expect(registry.getCleanupOutcome(job.jobId)).toBe("grace-lapsed");
    // The continuation NEVER exits: eviction releases the retained slot so
    // the capacity budget cannot leak forever.
    vi.advanceTimersByTime(150);
    expect(registry.evictStale()).toBe(1);
    const freed = eventuallyRun(registry, { called: false });
    expect(registry.getStatus(freed.jobId).status).toBe("running");
    void hung;
  });
});

describe("G01 per-conversation tool concurrency admission", () => {
  it("refuses a second different-args job for the same conversation+tool when limit=1", () => {
    const registry = new ToolJobRegistry({ maxConcurrent: 4 });
    registry.start(
      "mcp__scrapy__scraper__scrape",
      { query: "a" },
      { conversationId: "c1", toolCallId: "t1" },
      () => new Promise(() => undefined),
      { conversationConcurrencyLimit: 1 }
    );
    expect(() =>
      registry.start(
        "mcp__scrapy__scraper__scrape",
        { query: "DIFFERENT" },
        { conversationId: "c1", toolCallId: "t2" },
        async () => 1,
        { conversationConcurrencyLimit: 1 }
      )
    ).toThrow(ToolConversationConcurrencyError);
  });

  it("other tools and other conversations keep their own admission budget", () => {
    const registry = new ToolJobRegistry({ maxConcurrent: 4 });
    registry.start(
      "mcp__scrapy__scraper__scrape",
      {},
      { conversationId: "c1", toolCallId: "t1" },
      () => new Promise(() => undefined),
      { conversationConcurrencyLimit: 1 }
    );
    // Different tool, same conversation → allowed.
    const otherTool = registry.start(
      "mcp__scrapy__scraper__list",
      {},
      { conversationId: "c1", toolCallId: "t2" },
      async () => 1,
      { conversationConcurrencyLimit: 1 }
    );
    expect(otherTool.queued).toBe(false);
    // Same tool, different conversation → allowed.
    const otherConv = registry.start(
      "mcp__scrapy__scraper__scrape",
      {},
      { conversationId: "c2", toolCallId: "t3" },
      async () => 1,
      { conversationConcurrencyLimit: 1 }
    );
    expect(otherConv.queued).toBe(false);
  });

  it("admission re-opens once the conflicting job settles", async () => {
    const registry = new ToolJobRegistry({ maxConcurrent: 4 });
    const first = registry.start(
      "toolX",
      {},
      { conversationId: "c1", toolCallId: "t1" },
      (handle) =>
        new Promise<string>((resolve) => {
          setTimeout(() => handle.resolve("done"), 25);
        }),
      { conversationConcurrencyLimit: 1 }
    );
    expect(() =>
      registry.start(
        "toolX",
        { different: true },
        { conversationId: "c1", toolCallId: "t2" },
        async () => 1,
        { conversationConcurrencyLimit: 1 }
      )
    ).toThrow(ToolConversationConcurrencyError);
    await registry.waitForSettled(first.jobId, 5_000);
    const reopened = registry.start(
      "toolX",
      { different: true },
      { conversationId: "c1", toolCallId: "t2" },
      async (handle) => {
        handle.resolve("done");
        return 1;
      },
      { conversationConcurrencyLimit: 1 }
    );
    expect(reopened.queued).toBe(false);
    await registry.waitForSettled(reopened.jobId, 5_000);
  });

  it("counts queued jobs as active (global slots do not bypass the tool limit)", () => {
    const registry = new ToolJobRegistry({ maxConcurrent: 1 });
    const first = registry.start(
      "toolY",
      {},
      { conversationId: "c1", toolCallId: "t1" },
      () => new Promise(() => undefined),
      { conversationConcurrencyLimit: 2 }
    );
    expect(first.queued).toBe(false);
    // Fills the single global slot; second job is QUEUED but counts as active.
    const second = registry.start(
      "toolY",
      {},
      { conversationId: "c1", toolCallId: "t2" },
      async () => 1,
      { conversationConcurrencyLimit: 2 }
    );
    expect(second.queued).toBe(true);
    expect(() =>
      registry.start(
        "toolY",
        {},
        { conversationId: "c1", toolCallId: "t3" },
        async () => 1,
        { conversationConcurrencyLimit: 2 }
      )
    ).toThrow(ToolConversationConcurrencyError);
    registry.cancel(first.jobId);
    registry.cancel(second.jobId);
  });
});
