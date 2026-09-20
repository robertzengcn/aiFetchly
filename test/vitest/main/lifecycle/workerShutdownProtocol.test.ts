import { describe, expect, it, vi } from "vitest";
import {
  inferShutdownTransport,
  requestWorkerShutdown,
} from "@/main-process/lifecycle/workerShutdownProtocol";
import { OwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";
import { FakeProcessOps } from "./fakeProcessOps";
import {
  installWorkerShutdownResponder,
  parseShutdownRequest,
} from "@/childprocess/lib/workerShutdownResponder";

/**
 * §7 generic protocol tests (design §7): transport inference, parent request
 * with observed exit, worker-side responder (ack ordering, closing flag,
 * bounded watchdog), and end-to-end parent<->responder over a fake transport.
 */

describe("inferShutdownTransport", () => {
  it("prefers postMessage (UtilityProcess)", () => {
    const sent: unknown[] = [];
    const t = inferShutdownTransport({
      pid: 1,
      postMessage: (m: unknown) => sent.push(m),
      kill: () => true,
    } as never);
    expect(t).not.toBeNull();
    t!({ x: 1 });
    expect(sent).toEqual([{ x: 1 }]);
  });

  it("uses send (ipc ChildProcess) when postMessage absent", () => {
    const t = inferShutdownTransport({
      pid: 2,
      send: () => true,
      kill: () => true,
    } as never);
    expect(t).not.toBeNull();
    expect(t!({ ok: true })).toBe(true);
  });

  it("returns null when neither transport exists", () => {
    expect(inferShutdownTransport({ pid: 3, kill: () => true } as never)).toBeNull();
  });

  it("a throwing transport reports failure instead of throwing", () => {
    const t = inferShutdownTransport({
      pid: 4,
      send: () => {
        throw new Error("closed");
      },
      kill: () => true,
    } as never);
    expect(t!({})).toBe(false);
  });
});

describe("requestWorkerShutdown (parent side)", () => {
  it("sends the §7 message and resolves exited on natural exit", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const worker = {
      pid,
      send: (m: unknown) => {
        // Simulate the worker exiting shortly after receiving the request.
        const msg = m as { type: string };
        if (msg.type === "shutdown") {
          setTimeout(() => {
            ops.table.get(pid)!.alive = false;
          }, 30);
        }
        return true;
      },
      kill: () => true,
    };
    registry.register({ ownerId: "unit-worker", pid, handle: worker as never });
    const result = await requestWorkerShutdown(
      "unit-worker",
      worker as never,
      registry,
      2_000
    );
    expect(result).toEqual({ ownerId: "unit-worker", requested: true, exited: true });
  });

  it("resolves exited=false when the worker ignores the request (force phase owns it)", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const worker = {
      pid,
      send: () => true, // receives but never exits
      kill: () => true,
    };
    registry.register({ ownerId: "stubborn", pid, handle: worker as never });
    const result = await requestWorkerShutdown(
      "stubborn",
      worker as never,
      registry,
      150
    );
    expect(result.exited).toBe(false);
    expect(result.requested).toBe(true);
  });

  it("requested=false when the record is unknown to the registry", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const worker = { pid: 999, send: () => true, kill: () => true };
    const result = await requestWorkerShutdown(
      "ghost",
      worker as never,
      registry,
      100
    );
    expect(result.requested).toBe(false);
  });
});

describe("parseShutdownRequest", () => {
  it("accepts a well-formed request", () => {
    expect(
      parseShutdownRequest({ type: "shutdown", requestId: "r1", remainingMs: 500 })
    ).toEqual({ requestId: "r1", remainingMs: 500 });
  });

  it("rejects missing requestId, wrong type, bad budget", () => {
    expect(parseShutdownRequest({ type: "shutdown" })).toBeNull();
    expect(parseShutdownRequest({ type: "other", requestId: "r" })).toBeNull();
    expect(
      parseShutdownRequest({ type: "shutdown", requestId: "r", remainingMs: -1 })
    ).toBeNull();
    expect(parseShutdownRequest(null)).toBeNull();
  });
});

describe("installWorkerShutdownResponder (worker side)", () => {
  function makeHarness(closeOwnedResources?: () => Promise<void>): {
    sent: unknown[];
    exits: number[];
    responder: ReturnType<typeof installWorkerShutdownResponder>;
    fireWatchdog: () => void;
  } {
    const sent: unknown[] = [];
    const exits: number[] = [];
    let watchdogFn: (() => void) | null = null;
    const responder = installWorkerShutdownResponder({
      send: (m) => sent.push(m),
      closeOwnedResources,
      setTimeoutFn: ((fn: () => void) => {
        watchdogFn = fn;
        return 0 as never;
      }) as unknown as typeof setTimeout,
      exit: (code) => exits.push(code),
    });
    return {
      sent,
      exits,
      responder,
      fireWatchdog: () => watchdogFn?.(),
    };
  }

  it("acks with the requestId, closes resources, then exits", async () => {
    const order: string[] = [];
    const h = makeHarness(async () => {
      order.push("close");
    });
    const handled = h.responder.handle({
      type: "shutdown",
      requestId: "req-1",
      remainingMs: 800,
    });
    expect(handled).toBe(true);
    expect(h.responder.isShuttingDown()).toBe(true);
    expect(h.sent[0]).toEqual({ type: "shutdown-ack", requestId: "req-1" });
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(["close"]);
    await new Promise((r) => setImmediate(r));
    expect(h.exits).toContain(0);
  });

  it("without closeOwnedResources it exits promptly", async () => {
    const h = makeHarness();
    h.responder.handle({ type: "shutdown", requestId: "r" });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(h.exits).toContain(0);
  });

  it("a failing close still exits (best-effort)", async () => {
    const h = makeHarness(async () => {
      throw new Error("browser close failed");
    });
    h.responder.handle({ type: "shutdown", requestId: "r" });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(h.exits).toContain(0);
  });

  it("the watchdog force-exits when graceful close hangs", async () => {
    let never: () => void = () => undefined;
    const h = makeHarness(
      () => new Promise<void>((resolve) => (never = resolve))
    );
    h.responder.handle({ type: "shutdown", requestId: "r" });
    h.fireWatchdog();
    expect(h.exits).toContain(0);
    void never;
  });

  it("non-shutdown messages are not handled", () => {
    const h = makeHarness();
    expect(h.responder.handle({ type: "extract-contact" })).toBe(false);
    expect(h.responder.isShuttingDown()).toBe(false);
    expect(h.sent).toHaveLength(0);
  });
});

describe("parent <-> responder over a fake transport", () => {
  it("full round trip: parent request -> responder ack + exit -> observed", async () => {
    const ops = new FakeProcessOps();
    const registry = new OwnedProcessRegistry(ops);
    const pid = ops.spawn(1);
    const sent: unknown[] = [];
    const responder = installWorkerShutdownResponder({
      send: (m) => sent.push(m),
      exit: () => {
        ops.table.get(pid)!.alive = false;
      },
    });
    const worker = {
      pid,
      send: (m: unknown) => {
        responder.handle(m);
        return true;
      },
      kill: () => true,
    };
    registry.register({ ownerId: "roundtrip", pid, handle: worker as never });
    const result = await requestWorkerShutdown(
      "roundtrip",
      worker as never,
      registry,
      1_000
    );
    expect(result.exited).toBe(true);
    const ack = sent.find(
      (m) => (m as { type?: string }).type === "shutdown-ack"
    );
    expect(ack).toBeDefined();
  });
});
