import { describe, expect, it } from "vitest";
import { ToolJobRegistry } from "@/service/ToolJobRegistry";
import {
  WorkerCoordinator,
  BrowserSlotShutdownError,
} from "@/modules/WorkerCoordinator";

/**
 * T06 (2026-09-21 audit, AC-05): accepting exit must block starts, retries,
 * and queued slot transfers in the SAME TICK — not only at the next spawn.
 */

function neverSpawn(): Promise<unknown> {
  return new Promise(() => undefined);
}

describe("ToolJobRegistry closed flag (T06)", () => {
  it("start() refuses jobs after shutdown() seals the registry", () => {
    const registry = new ToolJobRegistry({ maxConcurrent: 1 });
    registry.shutdown();
    expect(registry.isClosed()).toBe(true);
    expect(() =>
      registry.start(
        "tool",
        {},
        { conversationId: "c", toolCallId: "t" },
        neverSpawn
      )
    ).toThrow(/closed/);
  });

  it("queued jobs admitted BEFORE shutdown are cancelled (not silently dropped)", async () => {
    const registry = new ToolJobRegistry({ maxConcurrent: 1 });
    const first = registry.start(
      "tool",
      {},
      { conversationId: "c", toolCallId: "t1" },
      neverSpawn
    );
    const queued = registry.start(
      "tool",
      {},
      { conversationId: "c", toolCallId: "t2" },
      neverSpawn
    );
    expect(queued.queued).toBe(true);
    // Capture live statuses BEFORE shutdown() relabels active jobs, then
    // verify the seal + cancel-relabel + deferred-clear contract.
    const firstStatus = registry.getStatus(first.jobId).status;
    const queuedStatus = registry.getStatus(queued.jobId).status;
    registry.shutdown();
    expect(["queued", "running"]).toContain(firstStatus);
    expect(queuedStatus).toBe("queued");
    // H5: plain shutdown() seals the registry and relabels every active job
    // 'cancelled' synchronously — nothing is silently dropped — but it does
    // NOT clear the map: state is cleared only by shutdownAndAwaitCleanup
    // after the bounded cleanup wait (see ToolJobRegistry.shutdown).
    expect(registry.getStatus(first.jobId).status).toBe("cancelled");
    expect(registry.getStatus(queued.jobId).status).toBe("cancelled");
    await registry.shutdownAndAwaitCleanup(50);
    expect(registry.getStatus(first.jobId).status).toBe("not_found");
    expect(() =>
      registry.start(
        "tool",
        {},
        { conversationId: "c", toolCallId: "t3" },
        neverSpawn
      )
    ).toThrow(/closed/);
  });
});

describe("WorkerCoordinator slot freeze (T06)", () => {
  // WorkerCoordinator is a singleton: one ordered lifecycle test avoids
  // cross-test frozen-state bleed.
  it("queued waiters reject at freeze; post-freeze acquisitions refuse (typed)", async () => {
    const coordinator = WorkerCoordinator.getInstance(1);
    await coordinator.acquireBrowserSlot(); // budget exhausted now
    const queued = coordinator.acquireBrowserSlot();
    coordinator.freezeForShutdown();
    await expect(queued).rejects.toThrow(BrowserSlotShutdownError);
    // Post-freeze acquisitions reject immediately with the same typed error.
    await expect(coordinator.acquireBrowserSlot()).rejects.toThrow(
      BrowserSlotShutdownError
    );
  });
});
