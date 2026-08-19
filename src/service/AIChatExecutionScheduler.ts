import type {
  ChatRunOwner,
  ChatRunResourceClass,
} from "@/entityTypes/aiChatWorkspaceTypes";

/**
 * Bounded, fair admission scheduler for chat workspace execution
 * (technical-design §10, PRD §19).
 *
 * The concurrency limit is a LOGICAL execution scheduler — a slot does not
 * allocate a process. The scheduler owns admission and fairness only; it
 * never touches conversation data and never persists anything directly.
 */

/** Base priority tiers (lower dispatches first). */
enum BasePriority {
  SelectedInteractive = 0,
  OtherInteractive = 1,
  GoalOrAgent = 2,
  Scheduled = 3,
  Maintenance = 4,
}

/** Multiplier separating tiers so aging cannot accidentally reorder within a step. */
const PRIORITY_SCALE = 10;

/**
 * Maximum aging boost. Any run aged to the cap beats a freshly queued run up
 * to four tiers above it, preventing scheduled/background starvation
 * (design §10.2) while interactive work stays preferred while fresh.
 */
const MAX_AGE_BOOST = PRIORITY_SCALE * 4;

/** Waiting time per aging step (ms). Configurable for tests. */
const DEFAULT_AGING_STEP_MS = 30_000;

export const DEFAULT_GENERAL_CAPACITY = 3;
export const MIN_GENERAL_CAPACITY = 1;
export const MAX_GENERAL_CAPACITY = 3;

/** Fixed first-release resource-class capacities (design §10.1). */
const FIXED_CAPACITIES: Record<ChatRunResourceClass, number> = {
  general: DEFAULT_GENERAL_CAPACITY,
  browser: 1,
  cpu: 2,
  artifact_batch: 3,
};

export interface SchedulerSubmitInput {
  readonly runId: string;
  readonly conversationId: string;
  readonly owner: ChatRunOwner;
  readonly resourceClass?: ChatRunResourceClass;
}

export interface SchedulerDispatch {
  readonly runId: string;
  readonly conversationId: string;
  readonly owner: ChatRunOwner;
  readonly resourceClass: ChatRunResourceClass;
}

export interface SchedulerStats {
  readonly queued: number;
  readonly active: number;
  readonly activeByClass: Record<ChatRunResourceClass, number>;
  readonly generalCapacity: number;
}

interface QueueEntry {
  readonly runId: string;
  readonly conversationId: string;
  readonly owner: ChatRunOwner;
  readonly resourceClass: ChatRunResourceClass;
  readonly enqueuedAt: number;
}

interface ActiveAssignment {
  readonly runId: string;
  readonly conversationId: string;
  readonly resourceClass: ChatRunResourceClass;
}

function basePriorityFor(
  owner: ChatRunOwner,
  isSelectedConversation: boolean
): number {
  if (owner === "interactive") {
    return isSelectedConversation
      ? BasePriority.SelectedInteractive
      : BasePriority.OtherInteractive;
  }
  if (owner === "goal" || owner === "agent") return BasePriority.GoalOrAgent;
  if (owner === "scheduled") return BasePriority.Scheduled;
  return BasePriority.Maintenance;
}

/**
 * Logical scheduler with per-resource-class bounded capacity, weighted aging
 * fairness, queued/running cancellation, and per-conversation eligibility.
 */
export class AIChatExecutionScheduler {
  private readonly queue: QueueEntry[] = [];
  private readonly active = new Map<string, ActiveAssignment>();
  private readonly generalCapacity: number;
  private readonly agingStepMs: number;
  private readonly now: () => number;
  private selectedConversationId: string | null = null;

  constructor(options?: {
    generalCapacity?: number;
    agingStepMs?: number;
    now?: () => number;
  }) {
    const requested = options?.generalCapacity ?? DEFAULT_GENERAL_CAPACITY;
    this.generalCapacity = Math.min(
      MAX_GENERAL_CAPACITY,
      Math.max(MIN_GENERAL_CAPACITY, requested)
    );
    this.agingStepMs = options?.agingStepMs ?? DEFAULT_AGING_STEP_MS;
    this.now = options?.now ?? (() => Date.now());
  }

  /** Accept a run into the queue. It receives its run id before admission. */
  submit(input: SchedulerSubmitInput): void {
    if (this.queue.some((e) => e.runId === input.runId)) return;
    if (this.active.has(input.runId)) return;
    this.queue.push({
      runId: input.runId,
      conversationId: input.conversationId,
      owner: input.owner,
      resourceClass: input.resourceClass ?? "general",
      enqueuedAt: this.now(),
    });
  }

  /** Track which conversation the (single) application window selects. */
  setSelectedConversation(conversationId: string | null): void {
    this.selectedConversationId = conversationId;
  }

  /**
   * Dispatch every run that fits capacity and conversation eligibility.
   * `onDispatch` runs synchronously; the caller must eventually call
   * {@link complete} (or {@link requeue} when the turn lease is lost).
   */
  pump(onDispatch: (dispatch: SchedulerDispatch) => void): void {
    // Keep dispatching while a slot frees up and an eligible entry exists.
    for (;;) {
      const entry = this.pickNext();
      if (!entry) return;
      this.queue.splice(this.queue.indexOf(entry), 1);
      this.active.set(entry.runId, {
        runId: entry.runId,
        conversationId: entry.conversationId,
        resourceClass: entry.resourceClass,
      });
      onDispatch({
        runId: entry.runId,
        conversationId: entry.conversationId,
        owner: entry.owner,
        resourceClass: entry.resourceClass,
      });
    }
  }

  /** Release capacity for a finished run. Safe to call twice. */
  complete(runId: string): void {
    this.active.delete(runId);
  }

  /**
   * Return a dispatched slot without changing the run id or losing its
   * original enqueue time (design §10.3 — turn-lease race lost).
   */
  requeue(runId: string): void {
    const assignment = this.active.get(runId);
    if (!assignment) return;
    this.active.delete(runId);
    this.queue.push({
      runId,
      conversationId: assignment.conversationId,
      owner: "interactive",
      resourceClass: assignment.resourceClass,
      enqueuedAt: this.now(),
    });
  }

  /**
   * Cancel a queued run without starting work. Returns true when a queue
   * entry was removed; active runs are cancelled through the coordinator.
   */
  cancelQueued(runId: string): boolean {
    const idx = this.queue.findIndex((e) => e.runId === runId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    return true;
  }

  isQueued(runId: string): boolean {
    return this.queue.some((e) => e.runId === runId);
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  queueDepth(): number {
    return this.queue.length;
  }

  stats(): SchedulerStats {
    const activeByClass: Record<ChatRunResourceClass, number> = {
      general: 0,
      browser: 0,
      cpu: 0,
      artifact_batch: 0,
    };
    for (const assignment of this.active.values()) {
      activeByClass[assignment.resourceClass] += 1;
    }
    return {
      queued: this.queue.length,
      active: this.active.size,
      activeByClass,
      generalCapacity: this.generalCapacity,
    };
  }

  /** Effective priority: tier (scaled) minus bounded aging boost (lower first). */
  private effectivePriority(entry: QueueEntry): number {
    const base = basePriorityFor(
      entry.owner,
      entry.conversationId === this.selectedConversationId
    );
    const waited = this.now() - entry.enqueuedAt;
    const steps = Math.floor(Math.max(0, waited) / this.agingStepMs);
    const ageBoost = Math.min(steps * PRIORITY_SCALE, MAX_AGE_BOOST);
    return base * PRIORITY_SCALE - ageBoost;
  }

  /**
   * Next dispatchable entry: highest effective priority that fits a free
   * slot for its class AND whose conversation has no active assignment.
   */
  private pickNext(): QueueEntry | null {
    const activeByClass: Record<ChatRunResourceClass, number> = {
      general: 0,
      browser: 0,
      cpu: 0,
      artifact_batch: 0,
    };
    const busyConversations = new Set<string>();
    for (const assignment of this.active.values()) {
      activeByClass[assignment.resourceClass] += 1;
      busyConversations.add(assignment.conversationId);
    }
    let best: QueueEntry | null = null;
    let bestPriority = Number.POSITIVE_INFINITY;
    for (const entry of this.queue) {
      const capacity =
        entry.resourceClass === "general"
          ? this.generalCapacity
          : FIXED_CAPACITIES[entry.resourceClass];
      if (activeByClass[entry.resourceClass] >= capacity) continue;
      if (busyConversations.has(entry.conversationId)) continue;
      const priority = this.effectivePriority(entry);
      if (
        priority < bestPriority ||
        (priority === bestPriority &&
          best !== null &&
          (entry.enqueuedAt < best.enqueuedAt ||
            (entry.enqueuedAt === best.enqueuedAt &&
              entry.runId < best.runId)))
      ) {
        best = entry;
        bestPriority = priority;
      }
    }
    return best;
  }
}
