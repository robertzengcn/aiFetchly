import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";

/**
 * Shared global execution scheduler singleton (B02, AD-002/004).
 *
 * The workspace coordinator (interactive runs) and the durable pending queue
 * (queue-backed ordinary sends) must admit through the SAME scheduler
 * instance — otherwise ordinary interactive work bypasses resource limits and
 * fairness relative to other owners. Both `ai-chat-workspace-ipc.ts` (which
 * owns the coordinator) and `ai-chat-v2-ipc.ts` (which owns the queue
 * service) resolve the scheduler here instead of constructing their own.
 */
let sharedScheduler: AIChatExecutionScheduler | null = null;

export function getSharedExecutionScheduler(): AIChatExecutionScheduler {
  if (!sharedScheduler) {
    sharedScheduler = new AIChatExecutionScheduler();
  }
  return sharedScheduler;
}

/** Test seam: replace the singleton (tests must reset after use). */
export function setSharedExecutionSchedulerForTests(
  scheduler: AIChatExecutionScheduler | null
): void {
  sharedScheduler = scheduler;
}
