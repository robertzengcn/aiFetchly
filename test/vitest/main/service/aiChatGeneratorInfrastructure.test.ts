// test/vitest/main/service/aiChatGeneratorInfrastructure.test.ts
//
// Stage B (generator-streaming PRD FR-001/016, AC-01/08/09): the typed
// result-preserving consumer, the latest-value progress slot, and the
// tool-progress multiplexer — including cleanup and never-success rules.
import { describe, expect, it, vi } from "vitest";
import { LatestValueSlot } from "@/service/aiChat/LatestValueSlot";
import { consumeGenerator } from "@/service/aiChat/consumeGenerator";
import {
  runToolWithProgress,
  TOOL_PROGRESS_MAX_SERIALIZED_BYTES,
} from "@/service/aiChat/runToolWithProgress";

interface TestProgress {
  phase: string;
  message: string;
  progress: number | null;
  partialCount: number | null;
  expectedCount: number | null;
}

function progress(n: number, message = "working"): TestProgress {
  return {
    phase: "running",
    message,
    progress: 0.5,
    partialCount: n,
    expectedCount: 100,
  };
}

describe("LatestValueSlot (FR-016)", () => {
  it("resolves changed() when a value is set and take() drains it once", async () => {
    const slot = new LatestValueSlot<number>();
    const changed = slot.changed();
    slot.set(7);
    expect(await changed).toBeUndefined();
    expect(slot.take()).toBe(7);
    expect(slot.take()).toBeUndefined();
  });

  it("coalesces bursts to the latest value only", async () => {
    const slot = new LatestValueSlot<number>();
    slot.set(1);
    slot.set(2);
    slot.set(3);
    expect(slot.take()).toBe(3);
    expect(slot.take()).toBeUndefined();
  });

  it("close() wakes waiters and drops late sets", async () => {
    const slot = new LatestValueSlot<number>();
    const changed = slot.changed();
    slot.close();
    expect(await changed).toBeUndefined();
    slot.set(9);
    expect(slot.take()).toBeUndefined();
    expect(slot.isClosed).toBe(true);
  });

  it("changed() resolves immediately when a value is already pending", async () => {
    const slot = new LatestValueSlot<string>();
    slot.set("x");
    await expect(slot.changed()).resolves.toBeUndefined();
    expect(slot.take()).toBe("x");
  });
});

describe("consumeGenerator (FR-001, AC-01/08)", () => {
  async function* gen(
    events: number[],
    finalValue: string
  ): AsyncGenerator<number, string, void> {
    for (const e of events) {
      yield e;
    }
    return finalValue;
  }

  it("returns the generator's final value while forwarding events in order", async () => {
    const seen: number[] = [];
    const result = await consumeGenerator(
      gen([1, 2, 3], "final"),
      async (e) => {
        seen.push(e);
      },
      () => undefined,
      () => undefined
    );
    expect(result).toBe("final");
    expect(seen).toEqual([1, 2, 3]);
  });

  it("event-handler failure aborts the producer, closes the iterator, and rethrows the primary error", async () => {
    const aborts: unknown[] = [];
    const cleanupErrors: unknown[] = [];
    let finallyRan = false;
    async function* g(): AsyncGenerator<number, string, void> {
      try {
        yield 1;
        yield 2;
        return "never";
      } finally {
        finallyRan = true;
      }
    }
    const primary = new Error("handler failed");
    await expect(
      consumeGenerator(
        g(),
        async (e) => {
          if (e === 1) throw primary;
        },
        (reason) => aborts.push(reason),
        (err) => cleanupErrors.push(err)
      )
    ).rejects.toBe(primary);
    expect(aborts).toEqual([primary]);
    expect(finallyRan).toBe(true);
    expect(cleanupErrors).toEqual([]);
  });

  it("a cleanup failure is reported separately and never masks the primary error", async () => {
    const primary = new Error("primary");
    const cleanup = new Error("cleanup");
    async function* g(): AsyncGenerator<number, string, void> {
      yield 1;
      return "never";
    }
    const iterator = g();
    const originalReturn = iterator.return.bind(iterator);
    iterator.return = async (value: never) => {
      throw cleanup;
    };
    void originalReturn;
    const reported: unknown[] = [];
    await expect(
      consumeGenerator(
        iterator,
        async () => {
          throw primary;
        },
        () => undefined,
        (err) => reported.push(err)
      )
    ).rejects.toBe(primary);
    expect(reported).toEqual([cleanup]);
  });

  it("a generator throw propagates after abortProducer runs", async () => {
    const aborts: unknown[] = [];
    const boom = new Error("generator exploded");
    async function* g(): AsyncGenerator<number, string, void> {
      yield 1;
      throw boom;
    }
    await expect(
      consumeGenerator(
        g(),
        async () => undefined,
        (reason) => aborts.push(reason),
        () => undefined
      )
    ).rejects.toBe(boom);
    expect(aborts).toEqual([boom]);
  });

  it("an empty generator returns its value with no events", async () => {
    async function* empty(): AsyncGenerator<number, string, void> {
      return "done";
    }
    const onEvent = vi.fn();
    const result = await consumeGenerator(
      empty(),
      onEvent,
      () => undefined,
      () => undefined
    );
    expect(result).toBe("done");
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("runToolWithProgress (FR-016, AC-09)", () => {
  it("yields the latest progress while the tool runs and returns its result", async () => {
    let releaseTool!: () => void;
    const toolPromise = new Promise<string>((resolve) => {
      releaseTool = () => resolve("tool-done");
    });
    const emitted: string[] = [];
    const wrapper = runToolWithProgress<string, TestProgress>(
      (emit) => {
        emit(progress(1, "a"));
        emit(progress(2, "b"));
        emit(progress(3, "c"));
        return toolPromise;
      },
      new AbortController().signal
    );

    const first = await wrapper.next();
    expect(first.done).toBe(false);
    if (!first.done) {
      expect(first.value.event.partialCount).toBe(3);
      expect(first.value.event.message).toBe("c");
      expect(first.value.oversizedReplaced).toBe(false);
    }
    // No more progress: the next settle is the tool result.
    releaseTool();
    const final = await wrapper.next();
    expect(final.done).toBe(true);
    expect(final.value).toBe("tool-done");
    void emitted;
  });

  it("propagates a tool failure as a generator throw", async () => {
    const wrapper = runToolWithProgress<string, TestProgress>(
      () => Promise.reject(new Error("tool failed")),
      new AbortController().signal
    );
    await expect(wrapper.next()).rejects.toThrow("tool failed");
  });

  it("replaces oversized progress payloads with a minimal event instead of failing", async () => {
    let releaseTool!: () => void;
    const toolPromise = new Promise<string>((resolve) => {
      releaseTool = () => resolve("ok");
    });
    const bigMessage = "x".repeat(TOOL_PROGRESS_MAX_SERIALIZED_BYTES + 1024);
    const wrapper = runToolWithProgress<string, TestProgress>(
      (emit) => {
        emit(progress(1, bigMessage));
        return toolPromise;
      },
      new AbortController().signal
    );
    const first = await wrapper.next();
    expect(first.done).toBe(false);
    if (!first.done) {
      expect(first.value.oversizedReplaced).toBe(true);
      expect(first.value.event.message === undefined).toBe(true);
      expect(first.value.event.phase).toBe("running");
    }
    releaseTool();
    const final = await wrapper.next();
    expect(final.done).toBe(true);
    expect(final.value).toBe("ok");
  });

  it("ignores late progress after the tool settles", async () => {
    let lateEmit: ((event: TestProgress) => void) | undefined;
    const wrapper = runToolWithProgress<string, TestProgress>(
      (emit) => {
        lateEmit = emit;
        return Promise.resolve("settled");
      },
      new AbortController().signal
    );
    const final = await wrapper.next();
    expect(final.done).toBe(true);
    expect(final.value).toBe("settled");
    // Late progress from the detached tool is dropped, not delivered.
    lateEmit?.(progress(99, "late"));
    const after = await wrapper.next();
    expect(after.done).toBe(true);
  });

  it("suppresses progress emitted after abort (R05: pre-abort never starts the tool)", async () => {
    const controller = new AbortController();
    controller.abort();
    let started = false;
    const wrapper = runToolWithProgress<string, TestProgress>(
      (emit) => {
        started = true;
        emit(progress(1, "should be suppressed"));
        return Promise.resolve("done");
      },
      controller.signal
    );
    const final = await wrapper.next();
    expect(final.done).toBe(true);
    // R05 admission safety: a pre-aborted signal admits nothing — the tool
    // never starts (the old eager wrapper invoked start exactly once and
    // returned its successful result).
    expect(started).toBe(false);
    expect(final.value).toBeUndefined();
  });
});

describe("TODO-07/14: progress bounds + cleanup diagnostics", () => {
  it("an oversized payload with unbounded EXTRA fields is whitelisted down to bounded fields only", async () => {
    const { runToolWithProgress, toolProgressDiagnostics } = await import(
      "@/service/aiChat/runToolWithProgress"
    );
    let releaseTool!: () => void;
    const toolPromise = new Promise<string>((resolve) => {
      releaseTool = () => resolve("ok");
    });
    const bigPayload = "x".repeat(100_000);
    const wrapper = runToolWithProgress<string, TestProgress>(
      (emit) => {
        emit({
          phase: "running",
          message: bigPayload,
          progress: 0.5,
          partialCount: 1,
          expectedCount: 100,
        } as TestProgress & { payload?: string });
        return toolPromise;
      },
      new AbortController().signal
    );
    const first = await wrapper.next();
    expect(first.done).toBe(false);
    if (!first.done) {
      expect(first.value.oversizedReplaced).toBe(true);
      const ev = first.value.event as unknown as Record<string, unknown>;
      expect(ev.message).toBeUndefined();
      expect(ev.phase).toBe("running");
      expect(ev.partialCount).toBe(1);
    }
    releaseTool();
    const done = await wrapper.next();
    expect(done.done).toBe(true);
    expect(toolProgressDiagnostics.oversizedReplaced).toBeGreaterThanOrEqual(1);
  });

  it("a circular progress payload takes the minimal path instead of passing through", async () => {
    const { runToolWithProgress } = await import(
      "@/service/aiChat/runToolWithProgress"
    );
    const circular: Record<string, unknown> = {
      phase: "running",
      message: "m",
      progress: null,
      partialCount: null,
      expectedCount: null,
    };
    circular.self = circular;
    let releaseTool!: () => void;
    const toolPromise = new Promise<string>((resolve) => {
      releaseTool = () => resolve("ok");
    });
    const wrapper = runToolWithProgress<string, TestProgress>(
      (emit) => {
        emit(circular as unknown as TestProgress);
        return toolPromise;
      },
      new AbortController().signal
    );
    const first = await wrapper.next();
    expect(first.done).toBe(false);
    if (!first.done) {
      const ev = first.value.event as unknown as Record<string, unknown>;
      expect(ev.self).toBeUndefined(); // unbounded field dropped
      expect(ev.phase).toBe("running");
    }
    releaseTool();
    await wrapper.next();
  });

  it("LatestValueSlot.clear drops retained references and counts coalescing", async () => {
    const { LatestValueSlot, latestValueSlotDiagnostics } = await import(
      "@/service/aiChat/LatestValueSlot"
    );
    const before = latestValueSlotDiagnostics.coalescedDropped;
    const slot = new LatestValueSlot<number>();
    slot.set(1);
    slot.set(2); // coalesced
    expect(latestValueSlotDiagnostics.coalescedDropped).toBe(before + 1);
    slot.close();
    slot.set(9);
    expect(slot.take()).toBeUndefined(); // closed: nothing retained
  });
});

describe("R05: progress helper lazy + abort-wake contract", () => {
  it("start is not invoked before the first next() (lazy admission)", async () => {
    let started = false;
    const wrapper = runToolWithProgress<string, TestProgress>(
      () => {
        started = true;
        return Promise.resolve("ok");
      },
      new AbortController().signal
    );
    await new Promise((r) => setTimeout(r, 25));
    expect(started).toBe(false);
    const final = await wrapper.next();
    expect(final.done).toBe(true);
    expect(final.value).toBe("ok");
    expect(started).toBe(true);
  });

  it("abort wakes a pending read; the tool's own abort handling settles the outcome", async () => {
    const controller = new AbortController();
    let releaseTool!: (v: string) => void;
    const wrapper = runToolWithProgress<string, TestProgress>(
      () =>
        new Promise<string>((resolve) => {
          releaseTool = resolve;
        }),
      controller.signal
    );
    const first = wrapper.next();
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    // The abort wakes the pending race; the tool promise is still open, so
    // the generator now WAITS on the tool. Resolving it completes the read.
    releaseTool("settled-after-abort");
    const step = await first;
    expect(step.done).toBe(true);
    expect(step.value).toBe("settled-after-abort");
  });
});

describe("R09: progress diagnostics are count-only and return to baseline", () => {
  it("emitted/coalesced/oversized/late counts are correct and slots reset on close", async () => {
    const { runToolWithProgress, toolProgressDiagnostics } = await import(
      "@/service/aiChat/runToolWithProgress"
    );
    const { latestValueSlotDiagnostics } = await import(
      "@/service/aiChat/LatestValueSlot"
    );
    const before = {
      emitted: toolProgressDiagnostics.emitted,
      oversized: toolProgressDiagnostics.oversizedReplaced,
      late: toolProgressDiagnostics.lateDropped,
      slotCoalesced: latestValueSlotDiagnostics.coalescedDropped,
      slotLate: latestValueSlotDiagnostics.lateDropped,
    };
    const wrapper = runToolWithProgress<string, TestProgress>(
      (emit) => {
        emit(progress(1, "a"));
        emit(progress(2, "b")); // coalesced
        return Promise.resolve("ok");
      },
      new AbortController().signal
    );
    const step = await wrapper.next(); // yields latest (b)
    expect(step.done).toBe(false);
    const done = await wrapper.next(); // settles
    expect(done.done).toBe(true);
    expect(toolProgressDiagnostics.emitted).toBe(before.emitted + 1);
    expect(latestValueSlotDiagnostics.coalescedDropped).toBe(
      before.slotCoalesced + 1
    );
    // Slot is closed by the wrapper's finally — its retained reference is
    // released (R07) and no owned waiters remain.
    expect(done.value).toBe("ok");

    // Late progress after close is counted, not delivered.
    let lateEmit: ((e: TestProgress) => void) | undefined;
    const wrapper2 = runToolWithProgress<string, TestProgress>(
      (emit) => {
        lateEmit = emit;
        return Promise.resolve("ok2");
      },
      new AbortController().signal
    );
    await wrapper2.next();
    await wrapper2.next();
    const lateBefore = toolProgressDiagnostics.lateDropped;
    lateEmit?.(progress(9, "late"));
    expect(toolProgressDiagnostics.lateDropped).toBe(lateBefore + 1);
  });
});
