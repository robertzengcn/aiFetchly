import { describe, expect, it } from "vitest";
import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";

function makeRun(n: number): { runId: string; conversationId: string } {
  return { runId: `run-${n}`, conversationId: `conv-${n}` };
}

describe("AIChatExecutionScheduler", () => {
  it("admits up to the general capacity and queues the rest", () => {
    const scheduler = new AIChatExecutionScheduler();
    const dispatched: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const run = makeRun(i);
      scheduler.submit({ ...run, owner: "interactive" });
    }
    scheduler.pump((d) => dispatched.push(d.runId));

    expect(dispatched).toHaveLength(3); // default capacity 3
    expect(scheduler.stats().active).toBe(3);
    expect(scheduler.queueDepth()).toBe(2);

    // Completing one run admits exactly one queued run.
    scheduler.complete(dispatched[0]);
    expect(scheduler.stats().active).toBe(2);
    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched).toHaveLength(4);
    expect(scheduler.isActive(dispatched[0])).toBe(false);
  });

  it("clamps configured general capacity into the 1–3 product range", () => {
    expect(new AIChatExecutionScheduler({ generalCapacity: 99 }).stats().generalCapacity).toBe(3);
    expect(new AIChatExecutionScheduler({ generalCapacity: 0 }).stats().generalCapacity).toBe(1);
    expect(new AIChatExecutionScheduler({ generalCapacity: 2 }).stats().generalCapacity).toBe(2);
  });

  it("never dispatches two runs for the same conversation concurrently", () => {
    const scheduler = new AIChatExecutionScheduler();
    const dispatched: string[] = [];
    scheduler.submit({ runId: "a1", conversationId: "conv-a", owner: "interactive" });
    scheduler.submit({ runId: "a2", conversationId: "conv-a", owner: "interactive" });
    scheduler.submit({ runId: "b1", conversationId: "conv-b", owner: "interactive" });

    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched).toEqual(["a1", "b1"]);
    expect(scheduler.isQueued("a2")).toBe(true);

    scheduler.complete("a1");
    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched).toEqual(["a1", "b1", "a2"]);
  });

  it("prefers the selected conversation's interactive run", () => {
    const scheduler = new AIChatExecutionScheduler();
    scheduler.submit({ runId: "r1", conversationId: "conv-1", owner: "interactive" });
    scheduler.submit({ runId: "r2", conversationId: "conv-2", owner: "interactive" });
    scheduler.submit({ runId: "r3", conversationId: "conv-3", owner: "interactive" });
    scheduler.setSelectedConversation("conv-3");

    const dispatched: string[] = [];
    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched[0]).toBe("r3");
  });

  it("aging prevents scheduled starvation against fresh interactive work", () => {
    let clock = 1_000_000;
    const scheduler = new AIChatExecutionScheduler({
      agingStepMs: 10_000,
      now: () => clock,
    });
    // Scheduled run waits a very long time.
    scheduler.submit({ runId: "sched-1", conversationId: "conv-s", owner: "scheduled" });
    clock += 10_000 * 100; // 100 aging steps — far past the boost cap

    // Fresh interactive work arrives afterwards.
    scheduler.submit({ runId: "inter-1", conversationId: "conv-i", owner: "interactive" });

    const dispatched: string[] = [];
    scheduler.pump((d) => dispatched.push(d.runId));
    // Capacity 3 admits both, so check ORDER: the aged scheduled run first.
    expect(dispatched[0]).toBe("sched-1");
  });

  it("fresh interactive still beats fresh scheduled (interactive priority)", () => {
    const scheduler = new AIChatExecutionScheduler();
    scheduler.submit({ runId: "sched-1", conversationId: "conv-s", owner: "scheduled" });
    scheduler.submit({ runId: "inter-1", conversationId: "conv-i", owner: "interactive" });

    const dispatched: string[] = [];
    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched[0]).toBe("inter-1");
  });

  it("cancelling a queued run removes it without starting a worker", () => {
    const scheduler = new AIChatExecutionScheduler();
    for (let i = 1; i <= 4; i += 1) {
      const run = makeRun(i);
      scheduler.submit({ ...run, owner: "interactive" });
    }
    const dispatched: string[] = [];
    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched).toHaveLength(3);

    const queuedRun = "run-4";
    expect(scheduler.cancelQueued(queuedRun)).toBe(true);
    expect(scheduler.isQueued(queuedRun)).toBe(false);
    expect(scheduler.cancelQueued(queuedRun)).toBe(false); // idempotent
    scheduler.complete(dispatched[0]);
    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched).toHaveLength(3); // nothing left to admit
  });

  it("requeue returns the slot without changing the run id", () => {
    const scheduler = new AIChatExecutionScheduler();
    for (let i = 1; i <= 4; i += 1) {
      const run = makeRun(i);
      scheduler.submit({ ...run, owner: "interactive" });
    }
    const dispatched: string[] = [];
    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched).toHaveLength(3);

    // Turn lease lost for run-1: slot returns, run requeued with same id.
    scheduler.requeue("run-1");
    expect(scheduler.isActive("run-1")).toBe(false);
    expect(scheduler.isQueued("run-1")).toBe(true);

    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched).toContain("run-1");
    expect(dispatched).toHaveLength(4);
  });

  it("tracks per-class capacity for browser runs", () => {
    const scheduler = new AIChatExecutionScheduler();
    scheduler.submit({ runId: "b1", conversationId: "conv-b1", owner: "agent", resourceClass: "browser" });
    scheduler.submit({ runId: "b2", conversationId: "conv-b2", owner: "agent", resourceClass: "browser" });

    const dispatched: string[] = [];
    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched).toEqual(["b1"]); // browser capacity 1
    expect(scheduler.stats().activeByClass.browser).toBe(1);

    scheduler.complete("b1");
    scheduler.pump((d) => dispatched.push(d.runId));
    expect(dispatched).toEqual(["b1", "b2"]);
  });
});
