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

  it("suppresses progress emitted after abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const wrapper = runToolWithProgress<string, TestProgress>(
      (emit) => {
        emit(progress(1, "should be suppressed"));
        return Promise.resolve("done");
      },
      controller.signal
    );
    const final = await wrapper.next();
    expect(final.done).toBe(true);
    expect(final.value).toBe("done");
  });
});
