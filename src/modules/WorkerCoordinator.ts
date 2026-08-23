import { log } from "@/modules/Logger";

/**
 * WorkerCoordinator — WS-4 R4.7.
 *
 * A process-wide singleton that caps the total number of concurrent
 * browser-bearing workers. Every manager that spawns a Puppeteer-driven worker
 * asks the coordinator for a slot BEFORE spawning; when the worker exits, it
 * releases the slot. This provides global backpressure — without it, N
 * independent managers could each launch their own Chrome, exhausting memory.
 *
 * The coordinator also tracks the budget for forced cleanup on crash/exit
 * (future: integrate with the before-quit handler to force-close all tracked
 * browsers).
 *
 * Design: a promise-queue. When at capacity, `acquireBrowserSlot` returns a
 * pending promise; `releaseBrowserSlot` resolves the next waiter (the slot
 * transfers directly — no polling, no race).
 */
export class WorkerCoordinator {
  private static instance: WorkerCoordinator | null = null;

  private activeBrowserWorkers = 0;
  private readonly maxBrowserWorkers: number;
  private waiters: Array<() => void> = [];

  private constructor(maxBrowserWorkers = 3) {
    this.maxBrowserWorkers = maxBrowserWorkers;
    log.info(
      `[WorkerCoordinator] Initialized (max browser-bearing workers: ${maxBrowserWorkers})`
    );
  }

  static getInstance(maxBrowserWorkers?: number): WorkerCoordinator {
    if (!WorkerCoordinator.instance) {
      WorkerCoordinator.instance = new WorkerCoordinator(maxBrowserWorkers);
    }
    return WorkerCoordinator.instance;
  }

  /** For tests only: create a fresh instance with a specific budget. */
  static createForTest(maxBrowserWorkers: number): WorkerCoordinator {
    return new WorkerCoordinator(maxBrowserWorkers);
  }

  /**
   * Acquire a browser-bearing-worker slot. Resolves immediately if under
   * budget; otherwise queues and resolves when a slot is released.
   */
  async acquireBrowserSlot(): Promise<void> {
    if (this.activeBrowserWorkers < this.maxBrowserWorkers) {
      this.activeBrowserWorkers++;
      return;
    }
    log.warn(
      `[WorkerCoordinator] Browser budget exhausted (${this.activeBrowserWorkers}/${this.maxBrowserWorkers}); queuing request`
    );
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * Release a browser-bearing-worker slot. If a queued waiter exists, the slot
   * transfers directly to them (activeBrowserWorkers stays the same); otherwise
   * the count decrements.
   */
  releaseBrowserSlot(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.activeBrowserWorkers = Math.max(0, this.activeBrowserWorkers - 1);
  }

  get activeCount(): number {
    return this.activeBrowserWorkers;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  get budget(): number {
    return this.maxBrowserWorkers;
  }
}
