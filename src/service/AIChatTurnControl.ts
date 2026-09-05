import type { AIChatSafeBoundary } from "@/entityTypes/aiChatV2Types";

/**
 * Per-turn steering mailbox (message-queue technical design §10).
 *
 * The engine owns one AIChatTurnControl per active assistant turn. Steering
 * acceptance is two-phase so a turn completing mid-claim can never strand a
 * row in `steering`:
 *
 *   1. `reserve()` — synchronous, engine-side only; not visible to the loop.
 *   2. DB claim `queued -> steering` (queue service).
 *   3. `commit()` — makes the instruction visible to the loop's `consume()`.
 *
 * If the turn closes before commit, `commit()` returns false and the caller
 * restores the DB row. If the DB claim fails, the caller cancels the
 * reservation. The loop only ever drains committed instructions.
 *
 * `consume()` persists every instruction (via the injected `persist`
 * callback) BEFORE returning it to the loop, so unpersisted steering text
 * never enters model context (design §10.4).
 */

/** One steered instruction, sanitized before commit. */
export interface AIChatSteeringInstruction {
  readonly pendingMessageId: string;
  readonly clientRequestId: string;
  /** Display text persisted as the user transcript row content. */
  readonly displayContent: string;
  /** Model-facing text (mentions/pastes already resolved at enqueue). */
  readonly modelContent: string;
  readonly createdAt: string;
  /** Assistant message id of the turn being steered. */
  readonly targetAssistantMessageId: string;
}

export interface AIChatSteeringReservation {
  readonly reservationId: string;
  readonly targetAssistantMessageId: string;
  readonly pendingMessageId: string;
}

/** A drained, already-persisted batch of instructions in creation order. */
export interface AIChatSteeringBatch {
  readonly boundary: AIChatSafeBoundary;
  readonly instructions: readonly AIChatSteeringInstruction[];
}

/** Max instructions consumed at one boundary (PRD §13.4). */
const MAX_INSTRUCTIONS_PER_BOUNDARY = 10;

/** Raised when promoteSteeringToUserMessage fails inside consume(). */
export class AIChatSteeringPersistenceError extends Error {
  constructor(
    message: string,
    /** Instructions already persisted before the failure (stay applied). */
    readonly appliedInstructions: readonly AIChatSteeringInstruction[]
  ) {
    super(message);
    this.name = "AIChatSteeringPersistenceError";
  }
}

let reservationCounter = 0;
function nextReservationId(): string {
  reservationCounter += 1;
  return `steer-res-${reservationCounter}-${Date.now()}`;
}

export class AIChatTurnControl {
  private readonly reservations = new Map<
    string,
    { readonly pendingMessageId: string }
  >();
  private readonly committed: AIChatSteeringInstruction[] = [];
  private closed = false;

  constructor(
    /** Persists one instruction (atomic user-row + applied flip). */
    private readonly persist: (input: {
      readonly instruction: AIChatSteeringInstruction;
      readonly boundary: AIChatSafeBoundary;
    }) => Promise<unknown>,
    private readonly assistantMessageId: string
  ) {}

  get targetAssistantMessageId(): string {
    return this.assistantMessageId;
  }

  /** Phase 1: synchronously reserve the active turn for one pending id. */
  reserve(pendingMessageId: string): AIChatSteeringReservation | null {
    if (this.closed) return null;
    if (this.reservedPendingIds().has(pendingMessageId)) return null;
    const reservationId = nextReservationId();
    this.reservations.set(reservationId, { pendingMessageId });
    return {
      reservationId,
      targetAssistantMessageId: this.assistantMessageId,
      pendingMessageId,
    };
  }

  /**
   * Phase 3: make the instruction visible to the loop. Returns false when
   * the turn closed before the DB claim finished — the caller must restore
   * the row to `queued` in that case.
   */
  commit(
    reservation: AIChatSteeringReservation,
    instruction: AIChatSteeringInstruction
  ): boolean {
    if (this.closed) return false;
    if (!this.reservations.has(reservation.reservationId)) return false;
    this.reservations.delete(reservation.reservationId);
    this.committed.push(instruction);
    return true;
  }

  /** Drop an uncommitted reservation (DB claim failed). */
  cancelReservation(reservationId: string): void {
    this.reservations.delete(reservationId);
  }

  hasPending(): boolean {
    return !this.closed && this.committed.length > 0;
  }

  /**
   * Drain every committed instruction in creation order at a safe boundary.
   * Each instruction is persisted BEFORE it is returned; a persistence
   * failure aborts the batch — already-applied items stay applied, later
   * items remain committed (and are paused by terminal handling), and the
   * error propagates so the turn fails with STEERING_PERSISTENCE_FAILED.
   */
  async consume(
    boundary: AIChatSafeBoundary
  ): Promise<AIChatSteeringBatch | null> {
    if (this.closed || this.committed.length === 0) {
      return null;
    }
    const toDrain = this.committed.splice(
      0,
      MAX_INSTRUCTIONS_PER_BOUNDARY
    );
    const persisted: AIChatSteeringInstruction[] = [];
    for (const instruction of toDrain) {
      try {
        await this.persist({ instruction, boundary });
        persisted.push(instruction);
      } catch (err) {
        throw new AIChatSteeringPersistenceError(
          err instanceof Error ? err.message : String(err),
          persisted
        );
      }
    }
    return { boundary, instructions: persisted };
  }

  /** Close the mailbox: no further commits; pending commits are abandoned. */
  close(): void {
    this.closed = true;
    this.reservations.clear();
    this.committed.length = 0;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private reservedPendingIds(): Set<string> {
    const ids = new Set<string>();
    for (const entry of this.reservations.values()) {
      ids.add(entry.pendingMessageId);
    }
    for (const instruction of this.committed) {
      ids.add(instruction.pendingMessageId);
    }
    return ids;
  }
}
