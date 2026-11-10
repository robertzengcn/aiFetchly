import { describe, expect, it, vi } from "vitest";

import {
  ManagedBrowserCacheWorkerClient,
  type CacheWorkerClientDeps,
} from "@/service/ManagedBrowserCacheWorkerClient";
import type { UtilityProcessLike } from "@/service/ManagedBrowserWorkerClient";
import type { ManagedBrowserCacheOutboundMessage } from "@/schemas/worker/managedBrowserCache";

/**
 * Cache maintenance worker client (design §13.9): fork-on-demand singleton,
 * requestId correlation, monotonic sequence, retryable crash (pending work
 * rejected with a safe error, next operation re-forks), and start timeouts.
 */

/** Test-driver surface layered on top of the UtilityProcessLike contract. */
interface FakeCacheWorkerProcess extends UtilityProcessLike {
  readonly posted: string[];
  readonly killed: { value: boolean };
  emit(event: "message" | "exit" | "error", arg: unknown): void;
  lastPosted(): Record<string, unknown> | null;
}

function makeFakeCacheWorkerProcess(): FakeCacheWorkerProcess {
  const posted: string[] = [];
  const killed = { value: false };
  const listeners = new Map<string, Array<(arg: unknown) => void>>();
  const fake = {
    posted,
    killed,
    postMessage: (message: unknown) => {
      posted.push(message as string);
    },
    kill: () => {
      killed.value = true;
      return true;
    },
    on: (event: string, listener: (arg: unknown) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? [];
      const index = list.indexOf(listener as (arg: unknown) => void);
      if (index >= 0) {
        list.splice(index, 1);
      }
    },
    emit: (event: string, arg: unknown) => {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener(arg);
      }
    },
    lastPosted: (): Record<string, unknown> | null => {
      if (posted.length === 0) {
        return null;
      }
      return JSON.parse(posted[posted.length - 1]) as Record<string, unknown>;
    },
  } as unknown as FakeCacheWorkerProcess;
  return fake;
}

interface Harness {
  client: ManagedBrowserCacheWorkerClient;
  workers: FakeCacheWorkerProcess[];
  forkCalls: () => number;
  /** Whether the fork emits WORKER_READY automatically (default: yes). */
  setAutoReady: (value: boolean) => void;
}

function makeHarness(autoReady = true): Harness {
  const workers: FakeCacheWorkerProcess[] = [];
  let forkCalls = 0;
  let emitReady = autoReady;
  const deps: CacheWorkerClientDeps = {
    fork: () => {
      forkCalls += 1;
      const worker = makeFakeCacheWorkerProcess();
      workers.push(worker);
      if (emitReady) {
        setTimeout(() => {
          worker.emit(
            "message",
            JSON.stringify({
              protocolVersion: 1,
              requestId: "evt-cache-worker-ready",
              sequence: 1,
              type: "WORKER_READY",
              workerPid: 9000 + forkCalls,
            })
          );
        }, 0);
      }
      return worker;
    },
    resolveEntryPath: () => "/fake/ManagedBrowserCacheWorker.js",
  };
  return {
    client: new ManagedBrowserCacheWorkerClient(deps),
    workers,
    forkCalls: () => forkCalls,
    setAutoReady: (value: boolean) => {
      emitReady = value;
    },
  };
}

function replyTo(
  worker: FakeCacheWorkerProcess,
  type: string,
  result: Record<string, unknown>
): void {
  const request = worker.lastPosted();
  if (!request) {
    throw new Error("nothing posted");
  }
  const message = {
    protocolVersion: 1,
    requestId: request.requestId,
    sequence: worker.posted.length + 1,
    type,
    result,
  } as unknown as ManagedBrowserCacheOutboundMessage;
  worker.emit("message", JSON.stringify(message));
}

async function lastPostedRequest(
  worker: FakeCacheWorkerProcess
): Promise<Record<string, unknown>> {
  await vi.waitFor(() => {
    if (!worker.lastPosted()) {
      throw new Error("no request posted yet");
    }
  });
  return worker.lastPosted() as Record<string, unknown>;
}

describe("ManagedBrowserCacheWorkerClient", () => {
  it("forks on demand, correlates the reply, and reuses the worker", async () => {
    const h = makeHarness();
    const scopePath = `/cache/managed-browser-cache/v1/${"a".repeat(24)}`;

    const first = h.client.scanScope({ scopePath });
    const worker = h.workers[0];
    const request = await lastPostedRequest(worker);
    expect(request.type).toBe("SCAN_SCOPE");
    // The client derives the managed root from the scope path.
    expect(request.managedRoot).toBe("/cache/managed-browser-cache/v1");
    expect(request.scopePath).toBe(scopePath);
    replyTo(worker, "SCAN_SCOPE_RESULT", {
      status: "ok",
      approximateBytes: 2048,
      fileCount: 7,
      durationBucket: "under_1s",
      truncated: false,
    });
    expect(await first).toEqual({ status: "ok", approximateBytes: 2048 });

    // Second call reuses the same live worker (no extra fork).
    const second = h.client.scanScope({ scopePath });
    await lastPostedRequest(worker);
    replyTo(worker, "SCAN_SCOPE_RESULT", {
      status: "ok",
      approximateBytes: 1,
      fileCount: 1,
      durationBucket: "under_1s",
      truncated: false,
    });
    expect(await second).toEqual({ status: "ok", approximateBytes: 1 });
    expect(h.workers).toHaveLength(1);
  });

  it("maps an error result into the module's safe error outcome", async () => {
    const h = makeHarness();
    const outcome = h.client.scanScope({
      scopePath: `/cache/managed-browser-cache/v1/${"b".repeat(24)}`,
    });
    const worker = h.workers[0];
    await lastPostedRequest(worker);
    replyTo(worker, "SCAN_SCOPE_RESULT", {
      status: "error",
      reasonCode: "cache_path_invalid",
    });
    expect(await outcome).toEqual({
      status: "error",
      reasonCode: "cache_path_invalid",
    });
  });

  it("derives the managed root for queued deletes (two levels up)", async () => {
    const h = makeHarness();
    const queuePath = `/cache/managed-browser-cache/v1/deleting/del-abcdef12`;
    const outcome = h.client.deleteQueuedScope({ queuePath });
    const worker = h.workers[0];
    const request = await lastPostedRequest(worker);
    expect(request.type).toBe("DELETE_QUEUED_SCOPE");
    expect(request.managedRoot).toBe("/cache/managed-browser-cache/v1");
    expect(request.queuePath).toBe(queuePath);
    replyTo(worker, "DELETE_QUEUED_SCOPE_RESULT", {
      status: "ok",
      approximateDeletedBytes: 4096,
      fileCount: 9,
      durationBucket: "under_5s",
    });
    expect(await outcome).toEqual({
      status: "ok",
      approximateDeletedBytes: 4096,
    });
  });

  it("rejects pending work on crash and re-forks on the next operation", async () => {
    const h = makeHarness();
    const scopePath = `/cache/managed-browser-cache/v1/${"c".repeat(24)}`;
    const crashed = h.client.scanScope({ scopePath });
    const firstWorker = h.workers[0];
    await lastPostedRequest(firstWorker);
    // Worker dies before answering.
    firstWorker.emit("exit", 1);
    expect(await crashed).toEqual({
      status: "error",
      reasonCode: "cache_maintenance_unavailable",
    });

    // The next operation transparently re-forks.
    const retried = h.client.scanScope({ scopePath });
    const secondWorker = h.workers[1];
    await lastPostedRequest(secondWorker);
    replyTo(secondWorker, "SCAN_SCOPE_RESULT", {
      status: "ok",
      approximateBytes: 10,
      fileCount: 1,
      durationBucket: "under_1s",
      truncated: false,
    });
    expect(await retried).toEqual({ status: "ok", approximateBytes: 10 });
    expect(h.workers).toHaveLength(2);
  });

  it("drops stale sequences and answers only with correlated replies", async () => {
    const h = makeHarness();
    const scopePath = `/cache/managed-browser-cache/v1/${"d".repeat(24)}`;
    const outcome = h.client.scanScope({ scopePath });
    const worker = h.workers[0];
    const request = await lastPostedRequest(worker);
    // A replayed (stale) sequence must be ignored even with a valid requestId.
    worker.emit(
      "message",
      JSON.stringify({
        protocolVersion: 1,
        requestId: request.requestId,
        sequence: 0,
        type: "SCAN_SCOPE_RESULT",
        result: {
          status: "ok",
          approximateBytes: 999,
          fileCount: 1,
          durationBucket: "under_1s",
          truncated: false,
        },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    // The outcome must still be pending — send the REAL reply now.
    replyTo(worker, "SCAN_SCOPE_RESULT", {
      status: "ok",
      approximateBytes: 5,
      fileCount: 1,
      durationBucket: "under_1s",
      truncated: false,
    });
    expect(await outcome).toEqual({ status: "ok", approximateBytes: 5 });
  });

  it("kills the worker after too many malformed messages", async () => {
    const h = makeHarness();
    // Trigger the fork; leave the request pending (it rejects on kill).
    const pending = h.client.scanScope({
      scopePath: `/cache/managed-browser-cache/v1/${"1".repeat(24)}`,
    });
    const worker = h.workers[0];
    await lastPostedRequest(worker);
    worker.emit("message", "not-json{");
    worker.emit("message", JSON.stringify({ type: "SCAN_SCOPE_RESULT" }));
    worker.emit("message", JSON.stringify({ garbage: true }));
    await vi.waitFor(() => expect(worker.killed.value).toBe(true));
    expect(await pending).toEqual({
      status: "error",
      reasonCode: "cache_maintenance_unavailable",
    });
  });

  it("reports unavailable when the worker never becomes ready", async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness(false);
      const outcome = h.client.scanScope({
        scopePath: `/cache/managed-browser-cache/v1/${"e".repeat(24)}`,
      });
      await vi.advanceTimersByTimeAsync(10_500);
      expect(await outcome).toEqual({
        status: "error",
        reasonCode: "cache_maintenance_unavailable",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shutdown awaits SHUTDOWN_ACK and kills the worker", async () => {
    const h = makeHarness();
    const scopePath = `/cache/managed-browser-cache/v1/${"f".repeat(24)}`;
    const warm = h.client.scanScope({ scopePath });
    const worker = h.workers[0];
    await lastPostedRequest(worker);
    replyTo(worker, "SCAN_SCOPE_RESULT", {
      status: "ok",
      approximateBytes: 1,
      fileCount: 1,
      durationBucket: "under_1s",
      truncated: false,
    });
    expect(await warm).toEqual({ status: "ok", approximateBytes: 1 });

    const stopping = h.client.shutdown();
    await vi.waitFor(() => expect(worker.lastPosted()?.type).toBe("SHUTDOWN"));
    const request = worker.lastPosted();
    if (!request) {
      throw new Error("unreachable");
    }
    worker.emit(
      "message",
      JSON.stringify({
        protocolVersion: 1,
        requestId: request.requestId,
        sequence: 99,
        type: "SHUTDOWN_ACK",
      })
    );
    await stopping;
    expect(worker.killed.value).toBe(true);
  });

  it("shutdown is a no-op without a live worker", async () => {
    const h = makeHarness();
    await expect(h.client.shutdown()).resolves.toBeUndefined();
    expect(h.workers).toHaveLength(0);
  });
});
