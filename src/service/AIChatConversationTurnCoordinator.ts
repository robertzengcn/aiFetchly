import type { ScheduledLoopErrorCode } from "@/entityTypes/aiChatScheduledLoopTypes";

/**
 * Per-conversation turn mutex shared by interactive Chat V2 and scheduled loops.
 *
 * Enforces the same-conversation invariant that interactive and scheduled turns
 * never execute concurrently (FR-7, technical-design §15). Turns in different
 * conversations may run concurrently. Leases are in-memory only and disappear at
 * process restart; durable run state is recovered from the database.
 */

/** Who owns a conversation turn. Interactive turns take priority over scheduled. */
export type ConversationTurnOwner = "interactive" | "scheduled";

/** A granted lease. `release()` is idempotent and safe to call in `finally`. */
export interface ConversationTurnLease {
  readonly conversationId: string;
  readonly owner: ConversationTurnOwner;
  readonly ownerId: string;
  readonly leaseId: number;
  release(): void;
}

/** Error raised when a lease cannot be acquired within the wait budget. */
export class ConversationTurnBusyError extends Error {
  readonly code: ScheduledLoopErrorCode;
  constructor(code: ScheduledLoopErrorCode = "CONVERSATION_BUSY") {
    super(code);
    this.name = "ConversationTurnBusyError";
    this.code = code;
  }
}

export interface AcquireConversationTurnInput {
  readonly conversationId: string;
  readonly owner: ConversationTurnOwner;
  readonly ownerId: string;
  /** Maximum time to wait for a busy conversation before failing. 0 = try only. */
  readonly waitMs: number;
  /** Optional abort signal; an aborted wait is removed immediately. */
  readonly signal?: AbortSignal;
}

interface Waiter {
  readonly conversationId: string;
  readonly owner: ConversationTurnOwner;
  readonly ownerId: string;
  readonly leaseId: number;
  readonly enqueuedAt: number;
  readonly signal?: AbortSignal;
  readonly timer: NodeJS.Timeout;
  resolve: (lease: ConversationTurnLease) => void;
  reject: (err: unknown) => void;
}

interface ActiveLease {
  readonly conversationId: string;
  readonly owner: ConversationTurnOwner;
  readonly ownerId: string;
  readonly leaseId: number;
}

/** Interactive turns sort before scheduled turns when granting the next lease. */
const OWNER_PRIORITY: Readonly<Record<ConversationTurnOwner, number>> = {
  interactive: 0,
  scheduled: 1,
};

export class AIChatConversationTurnCoordinator {
  private static instance: AIChatConversationTurnCoordinator | null = null;

  private readonly active = new Map<string, ActiveLease>();
  private readonly queues = new Map<string, Waiter[]>();
  private leaseCounter = 0;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): AIChatConversationTurnCoordinator {
    if (!AIChatConversationTurnCoordinator.instance) {
      AIChatConversationTurnCoordinator.instance =
        new AIChatConversationTurnCoordinator();
    }
    return AIChatConversationTurnCoordinator.instance;
  }

  /** Try to acquire a lease without waiting. Returns the lease or null if busy. */
  tryAcquire(
    input: Omit<AcquireConversationTurnInput, "waitMs">
  ): ConversationTurnLease | null {
    if (this.active.has(input.conversationId)) return null;
    return this.grant(input.conversationId, input.owner, input.ownerId);
  }

  /**
   * Acquire a lease, waiting up to `waitMs` for a busy conversation. Resolves
   * with the lease, or rejects with ConversationTurnBusyError on timeout/abort.
   */
  acquire(input: AcquireConversationTurnInput): Promise<ConversationTurnLease> {
    const immediate = this.tryAcquire(input);
    if (immediate) return Promise.resolve(immediate);

    if (input.waitMs <= 0) {
      return Promise.reject(new ConversationTurnBusyError());
    }

    return new Promise<ConversationTurnLease>((resolve, reject) => {
      const leaseId = this.nextLeaseId();
      const timer = setTimeout(() => {
        this.removeWaiter(input.conversationId, leaseId);
        reject(new ConversationTurnBusyError());
      }, input.waitMs);

      const waiter: Waiter = {
        conversationId: input.conversationId,
        owner: input.owner,
        ownerId: input.ownerId,
        leaseId,
        enqueuedAt: Date.now(),
        signal: input.signal,
        timer,
        resolve,
        reject,
      };

      const queue = this.queues.get(input.conversationId) ?? [];
      queue.push(waiter);
      this.queues.set(input.conversationId, queue);

      if (input.signal) {
        const onAbort = (): void => {
          clearTimeout(waiter.timer);
          this.removeWaiter(input.conversationId, leaseId);
          reject(new ConversationTurnBusyError());
        };
        if (input.signal.aborted) {
          onAbort();
        } else {
          input.signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    });
  }

  /** Whether a conversation currently has an active lease. */
  isBusy(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  /** Clear all in-memory leases and waiters. Intended for tests/restart. */
  resetForTesting(): void {
    this.active.clear();
    this.queues.clear();
  }

  private grant(
    conversationId: string,
    owner: ConversationTurnOwner,
    ownerId: string
  ): ConversationTurnLease {
    const leaseId = this.nextLeaseId();
    const lease: ActiveLease = { conversationId, owner, ownerId, leaseId };
    this.active.set(conversationId, lease);
    let released = false;
    return {
      conversationId,
      owner,
      ownerId,
      leaseId,
      release: (): void => {
        if (released) return;
        released = true;
        this.release(conversationId, leaseId);
      },
    };
  }

  private release(conversationId: string, leaseId: number): void {
    const current = this.active.get(conversationId);
    if (!current || current.leaseId !== leaseId) return;
    this.active.delete(conversationId);
    this.grantNext(conversationId);
  }

  private grantNext(conversationId: string): void {
    const queue = this.queues.get(conversationId);
    if (!queue || queue.length === 0) return;
    // Pick by owner priority (interactive first), then FIFO by enqueue order.
    queue.sort((a, b) => {
      const p = OWNER_PRIORITY[a.owner] - OWNER_PRIORITY[b.owner];
      if (p !== 0) return p;
      return a.enqueuedAt - b.enqueuedAt;
    });
    const next = queue.shift();
    if (!next) return;
    if (queue.length === 0) this.queues.delete(conversationId);
    clearTimeout(next.timer);
    // Install the active lease under the waiter's own leaseId so its idempotent
    // release matches the recorded lease.
    this.active.set(conversationId, {
      conversationId,
      owner: next.owner,
      ownerId: next.ownerId,
      leaseId: next.leaseId,
    });
    let released = false;
    const publicLease: ConversationTurnLease = {
      conversationId,
      owner: next.owner,
      ownerId: next.ownerId,
      leaseId: next.leaseId,
      release: (): void => {
        if (released) return;
        released = true;
        this.release(conversationId, next.leaseId);
      },
    };
    next.resolve(publicLease);
  }

  private removeWaiter(conversationId: string, leaseId: number): void {
    const queue = this.queues.get(conversationId);
    if (!queue) return;
    const idx = queue.findIndex((w) => w.leaseId === leaseId);
    if (idx === -1) return;
    queue.splice(idx, 1);
    if (queue.length === 0) this.queues.delete(conversationId);
  }

  private nextLeaseId(): number {
    this.leaseCounter += 1;
    return this.leaseCounter;
  }
}
