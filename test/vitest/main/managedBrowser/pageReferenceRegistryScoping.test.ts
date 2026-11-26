import { describe, expect, it } from "vitest";
import { PageReferenceRegistry } from "@/childprocess/managed-browser/PageReferenceRegistry";
import type { ExecutorElementHandle } from "@/childprocess/managed-browser/BrowserActionExecutor";

/** PRD D-FR-15a: per-observation scoping, pinning, and bounded eviction. */

function fakeElement(): ExecutorElementHandle {
  return {
    async click(): Promise<void> {},
    async type(): Promise<void> {},
    async select(): Promise<string[]> {
      return [];
    },
    async hover(): Promise<void> {},
    async scrollIntoView(): Promise<void> {},
    async isIntersectingViewport(): Promise<boolean> {
      return true;
    },
    async evaluate<T>(): Promise<T> {
      return undefined as unknown as T;
    },
    dispose(): Promise<void> {
      return Promise.resolve();
    },
  } as unknown as ExecutorElementHandle;
}

function registerBatch(
  registry: PageReferenceRegistry<ExecutorElementHandle>,
  count: number,
): string[] {
  const refs: string[] = [];
  for (let i = 0; i < count; i++) {
    refs.push(
      registry.register({ element: fakeElement(), role: "button", name: `b${i}` }),
    );
  }
  return refs;
}

describe("PageReferenceRegistry observation scoping (D-FR-15a)", () => {
  it("files refs under the open observation epoch and commits it", () => {
    const registry = new PageReferenceRegistry<ExecutorElementHandle>(3);
    registry.beginObservation("obs-1");
    const refs = registerBatch(registry, 3);
    registry.commitObservation("obs-1");
    expect(registry.observationCount).toBe(1);
    for (const ref of refs) {
      expect(registry.lookup(ref, 3).status).toBe("ok");
    }
  });

  it("keeps a pinned observation alive past the TTL and expires it after unpin", () => {
    let now = 0;
    const registry = new PageReferenceRegistry<ExecutorElementHandle>(3, () => now);
    registry.beginObservation("obs-1");
    const refs = registerBatch(registry, 2);
    registry.commitObservation("obs-1");
    registry.pinObservation("obs-1");

    now = 10 * 60_000; // 10 minutes later — far past the 60 s TTL.
    expect(registry.lookup(refs[0]!, 3).status).toBe("ok");

    expect(registry.unpinObservation("obs-1")).toBe(true);
    // TTL restarts from unpin, so the refs are still alive right after.
    expect(registry.lookup(refs[0]!, 3).status).toBe("ok");
    now += 61_000;
    registry.expire();
    // Whole-observation expiry: the ref is gone (expired or evicted).
    expect(["expired", "unknown_ref"]).toContain(
      registry.lookup(refs[0]!, 3).status
    );
  });

  it("keeps a pending (uncommitted) observation alive like a pinned one", () => {
    let now = 0;
    const registry = new PageReferenceRegistry<ExecutorElementHandle>(3, () => now);
    registry.beginObservation("obs-pending");
    const refs = registerBatch(registry, 2);
    now = 10 * 60_000;
    // Still open (a decision/approval is pending on it).
    expect(registry.lookup(refs[0]!, 3).status).toBe("ok");
    registry.commitObservation("obs-pending");
    expect(registry.lookup(refs[0]!, 3).status).toBe("ok");
  });

  it("evicts whole observations only, never part of one", () => {
    const registry = new PageReferenceRegistry<ExecutorElementHandle>(3);
    registry.beginObservation("obs-old");
    const oldRefs = registerBatch(registry, 2);
    registry.commitObservation("obs-old");
    registry.beginObservation("obs-new");
    const newRefs = registerBatch(registry, 2);
    registry.commitObservation("obs-new");
    registry.beginObservation("obs-newer");
    const newerRefs = registerBatch(registry, 2);
    registry.commitObservation("obs-newer");

    // Max 2 committed unpinned observations: the oldest is evicted WHOLE.
    registry.expire();
    for (const ref of oldRefs) {
      expect(registry.lookup(ref, 3).status).toBe("unknown_ref");
    }
    for (const ref of [...newRefs, ...newerRefs]) {
      expect(registry.lookup(ref, 3).status).toBe("ok");
    }
  });

  it("never evicts a pinned observation for bound enforcement", () => {
    const registry = new PageReferenceRegistry<ExecutorElementHandle>(3);
    registry.beginObservation("obs-pinned");
    const pinnedRefs = registerBatch(registry, 2);
    registry.commitObservation("obs-pinned");
    registry.pinObservation("obs-pinned");

    for (let i = 0; i < 4; i++) {
      const id = `obs-fill-${i}`;
      registry.beginObservation(id);
      registerBatch(registry, 2);
      registry.commitObservation(id);
    }
    registry.expire();
    expect(registry.isPinned("obs-pinned")).toBe(true);
    for (const ref of pinnedRefs) {
      expect(registry.lookup(ref, 3).status).toBe("ok");
    }
  });

  it("reset still disposes every observation on navigation", () => {
    const registry = new PageReferenceRegistry<ExecutorElementHandle>(3);
    registry.beginObservation("obs-1");
    const refs = registerBatch(registry, 2);
    registry.commitObservation("obs-1");
    registry.reset(4);
    expect(registry.observationCount).toBe(0);
    expect(registry.lookup(refs[0]!, 4).status).toBe("unknown_ref");
  });
});

// ---------------------------------------------------------------------------
// F08: pinned-safe eviction and safe saturation
// ---------------------------------------------------------------------------

describe("PageReferenceRegistry F08 eviction safety", () => {
  it("evicts only unpinned committed entries — pinned refs survive", () => {
    // Capacity 4: one pinned observation (2 refs) + one committed (2 refs).
    const registry = new PageReferenceRegistry<ExecutorElementHandle>(3, Date.now, 4);
    registry.beginObservation("pinned-obs");
    const pinnedRefs = registerBatch(registry, 2);
    registry.commitObservation("pinned-obs");
    registry.pinObservation("pinned-obs");

    registry.beginObservation("free-obs");
    const freeRefs = registerBatch(registry, 2);
    registry.commitObservation("free-obs");

    // Registering MORE must evict from the unpinned observation, never the
    // pinned one.
    const extra = registry.register({ element: fakeElement(), role: "button", name: "extra" });
    expect(registry.lookup(extra).status).toBe("ok");
    for (const ref of pinnedRefs) {
      expect(registry.lookup(ref).status).toBe("ok");
    }
    // At least one of the free-obs refs was sacrificed.
    const survivingFree = freeRefs.filter((ref) => registry.lookup(ref).status === "ok");
    expect(survivingFree.length).toBeLessThan(freeRefs.length);
  });

  it("pending (uncommitted) observations are never eviction victims", () => {
    const registry = new PageReferenceRegistry<ExecutorElementHandle>(3, Date.now, 3);
    registry.beginObservation("pending-obs");
    const pendingRefs = registerBatch(registry, 2);
    // A committed observation fills the last slot.
    registry.beginObservation("committed-obs");
    const committedRef = registerBatch(registry, 1);
    registry.commitObservation("committed-obs");

    // Over capacity: the COMMITTED ref is the only legal victim.
    const extra = registry.register({ element: fakeElement(), role: "button", name: "extra" });
    expect(registry.lookup(extra).status).toBe("ok");
    for (const ref of pendingRefs) {
      expect(registry.lookup(ref).status).toBe("ok");
    }
    expect(registry.lookup(committedRef[0]!).status).toBe("unknown_ref");
  });

  it("fails SAFELY when every entry is pinned or pending", () => {
    const registry = new PageReferenceRegistry<ExecutorElementHandle>(3, Date.now, 2);
    registry.beginObservation("pinned-obs");
    registerBatch(registry, 1);
    registry.commitObservation("pinned-obs");
    registry.pinObservation("pinned-obs");
    registry.beginObservation("pending-obs");
    registerBatch(registry, 1);

    expect(() =>
      registry.register({ element: fakeElement(), role: "button", name: "overflow" })
    ).toThrowError(/saturated/);
  });
});
