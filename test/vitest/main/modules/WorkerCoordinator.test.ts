import { describe, it, expect } from "vitest";
import { WorkerCoordinator } from "@/modules/WorkerCoordinator";

describe("WorkerCoordinator (R4.7)", () => {
  it("allows acquiring up to the budget", async () => {
    const coord = WorkerCoordinator.createForTest(3);
    await coord.acquireBrowserSlot();
    await coord.acquireBrowserSlot();
    await coord.acquireBrowserSlot();
    expect(coord.activeCount).toBe(3);
  });

  it("blocks the (N+1)th acquire when budget is exhausted", async () => {
    const coord = WorkerCoordinator.createForTest(2);
    await coord.acquireBrowserSlot();
    await coord.acquireBrowserSlot();

    // The 3rd acquire should block (not resolve immediately)
    let resolved = false;
    const promise = coord
      .acquireBrowserSlot()
      .then(() => {
        resolved = true;
      });

    await Promise.resolve(); // let microtasks settle
    expect(resolved).toBe(false);
    expect(coord.queuedCount).toBe(1);

    // Release to unblock; clean up the pending promise
    coord.releaseBrowserSlot();
    await promise;
    expect(resolved).toBe(true);
  });

  it("transfers a released slot to the next queued waiter", async () => {
    const coord = WorkerCoordinator.createForTest(1);
    await coord.acquireBrowserSlot();

    let secondResolved = false;
    const second = coord
      .acquireBrowserSlot()
      .then(() => {
        secondResolved = true;
      });

    await Promise.resolve();
    expect(secondResolved).toBe(false);

    coord.releaseBrowserSlot(); // transfers to `second`
    await second;
    expect(secondResolved).toBe(true);
    // Slot transferred (not decremented) — count stays at 1
    expect(coord.activeCount).toBe(1);
  });

  it("decrements activeCount on release when no waiters", async () => {
    const coord = WorkerCoordinator.createForTest(3);
    await coord.acquireBrowserSlot();
    await coord.acquireBrowserSlot();
    expect(coord.activeCount).toBe(2);
    coord.releaseBrowserSlot();
    expect(coord.activeCount).toBe(1);
  });

  it("never goes below zero activeCount", () => {
    const coord = WorkerCoordinator.createForTest(2);
    coord.releaseBrowserSlot(); // release with nothing active
    expect(coord.activeCount).toBe(0);
  });
});
