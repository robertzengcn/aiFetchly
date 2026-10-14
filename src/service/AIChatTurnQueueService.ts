import type {
  AIChatPendingCreateResult,
  AIChatPendingMessageEvent,
  AIChatPendingMessageView,
  ChatV2RuntimeStatus,
  ChatV2StreamRequest,
} from "@/entityTypes/aiChatV2Types";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
  AIChatTurnTerminalEvent,
} from "@/service/AIChatQueryEvents";
import type {
  AIChatSteeringInstruction,
  AIChatSteeringReservation,
} from "@/service/AIChatTurnControl";
import {
  AIChatPendingMessageModule,
  type AIChatPendingModuleErrorCode,
} from "@/modules/AIChatPendingMessageModule";
import { log } from "@/modules/Logger";
import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";
import { getConfirmedBatchReferenceRegistry } from "@/service/ConfirmedBatchReferenceRegistry";
import type { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";

/**
 * Main-process queue orchestration (message-queue technical design §9).
 * Submission routing, serialized FIFO drain, queue hold/resume, steering
 * acceptance, and restart recovery. All durable state lives in the pending
 * Module; this service owns in-memory serialization only.
 */

/** Structural slice of AIChatQueryEngine the queue service needs. */
export interface AIChatTurnQueueEngine {
  getConversationRuntimeStatus(conversationId: string): ChatV2RuntimeStatus;
  submitPersistedUserMessage(input: {
    readonly eventSink: AIChatQueryEventSink;
    readonly request: ChatV2StreamRequest;
    readonly savedUser: {
      readonly messageId: string;
      readonly conversationId: string;
    };
    readonly modelContent: string;
    readonly contentParts?: unknown;
    readonly assistantMessageId?: string;
  }): Promise<AIChatTurnTerminalEvent>;
  reserveSteering(
    conversationId: string,
    pendingMessageId: string
  ): AIChatSteeringReservation | null;
  cancelSteeringReservation(
    conversationId: string,
    reservation: AIChatSteeringReservation
  ): void;
  commitSteering(
    conversationId: string,
    reservation: AIChatSteeringReservation,
    instruction: AIChatSteeringInstruction
  ): boolean;
  stopActiveTurn(conversationId?: string): void;
}

/** Broadcast sink for pending lifecycle events. */
export interface AIChatPendingEventSink {
  emit(event: AIChatPendingMessageEvent): void;
}

/** Conversation turn lease (structural slice of the coordinator lease). */
export interface AIChatQueueLease {
  release(): void;
}

export interface AIChatTurnQueueServiceDeps {
  readonly engine: AIChatTurnQueueEngine;
  readonly pendingModule: AIChatPendingMessageModule;
  readonly eventSink: AIChatPendingEventSink;
  /**
   * Builds the renderer-facing stream sink for queue-dispatched turns.
   * B06: receives the bridge's durable run id + conversation so detail
   * envelopes carry the REAL run identity (not a synthetic pending-queue
   * counter) — Activity identity and live event identity must agree, and
   * selection/reselection can reconstruct the active durable run id.
   */
  readonly streamSinkFactory: (identity?: {
    readonly runId: string;
    readonly conversationId: string;
  }) => AIChatQueryEventSink;
  /**
   * B06: bounded sidebar summary hook (allowlisted reasons only — never
   * transcript/tool bodies). Wired in production to the workspace summary
   * broadcast so background pending/waiting/terminal changes update the
   * inactive row's sidebar without leaking private detail.
   */
  readonly summarySink?: (input: {
    readonly conversationId: string;
    readonly runId: string | null;
    readonly reason:
      | "run_queued"
      | "run_started"
      | "permission_required"
      | "user_input_required"
      | "run_completed"
      | "run_failed"
      | "run_cancelled";
  }) => void;
  /** Interactive lease acquisition (scheduled-vs-queue mutual exclusion). */
  readonly tryAcquireLease: (input: {
    readonly conversationId: string;
  }) => AIChatQueueLease | null;
  readonly isAiEnabled: () => boolean;
  readonly isQueueEnabled: () => boolean;
  readonly isSteeringEnabled: () => boolean;
  /**
   * T1 (AD-002/003): mints the durable run envelope at the scheduling
   * claim (sourceId = pendingMessageId) and persists the terminal mapping.
   * Optional so non-production wiring keeps the pre-bridge behavior.
   * B02: when the bridge composes the global scheduler, `admitted` is
   * false while capacity is full — the queue must release its claim
   * WITHOUT error and re-drain on capacity-free notification.
   */
  readonly dispatchBridge?: {
    schedule(candidate: {
      readonly pendingMessageId: string;
      readonly conversationId: string;
      readonly resourceClass:
        | "general"
        | "browser"
        | "cpu"
        | "artifact_batch";
    }): Promise<{ runId: string; admitted: boolean } | null>;
    finishRun(
      runId: string | null,
      status: "completed" | "failed" | "cancelled" | "interrupted"
    ): Promise<void>;
    /**
     * B05 strict variant: false when terminal persistence failed — the
     * queue must not publish terminal events or advance on false.
     */
    finishRunStrict?(
      runId: string | null,
      status: "completed" | "failed" | "cancelled" | "interrupted"
    ): Promise<boolean>;
    /** conversation_busy release: running -> queued for the next claim. */
    releaseToQueued?(runId: string | null): Promise<void>;
    /** Parked (permission/plan) run: running -> awaiting_*. */
    parkRun?(runId: string | null): Promise<void>;
    /** B04: park with the correct waiting family (permission vs question). */
    parkRunWaiting?(
      runId: string | null,
      waiting: "awaiting_permission" | "awaiting_user"
    ): Promise<void>;
    /** Re-admit a deferred envelope after capacity frees (B02). */
    admitDeferred?(runId: string | null): Promise<boolean>;
    /** Remove a deferred envelope from admission (cancel path, B02). */
    cancelDeferred?(runId: string | null): void;
  };
  /**
   * B02: shared global execution scheduler (AD-002/004). When present, the
   * bridge composes it (see dispatchBridge.admitted); this service tracks
   * capacity-deferred conversations and re-drains them when any terminal
   * frees a slot. Absent = legacy immediate-dispatch behavior (tests).
   */
  readonly scheduler?: AIChatExecutionScheduler | null;
}

export type AIChatQueueErrorCode =
  | AIChatPendingModuleErrorCode
  | "AI_FEATURE_DISABLED"
  | "QUEUE_DISABLED"
  | "INVALID_REQUEST"
  | "STEERING_DISABLED"
  | "TURN_NOT_STEERABLE"
  | "STEERING_COMMIT_RACE";

export class AIChatTurnQueueError extends Error {
  readonly code: AIChatQueueErrorCode;
  constructor(code: AIChatQueueErrorCode, message: string) {
    super(message);
    this.name = "AIChatTurnQueueError";
    this.code = code;
  }
}

/**
 * B05: durable-terminal gate. The engine emits terminal sink events
 * (`complete`/`cancelled`/`error`) DURING submitPersistedUserMessage —
 * before the queue persists the run terminal. This gate buffers those
 * terminal publications while streaming non-terminal chunks immediately;
 * the queue flushes only AFTER the run transition commits, so terminal
 * callbacks always observe a persisted terminal row. On persistence
 * failure the gate drops the terminal (no successful publication) and the
 * queue holds instead of silently advancing.
 */
export class AIChatTerminalGate implements AIChatQueryEventSink {
  private readonly downstream: AIChatQueryEventSink;
  private readonly buffered: AIChatQueryEvent[] = [];
  private released = false;

  constructor(downstream: AIChatQueryEventSink) {
    this.downstream = downstream;
  }

  emit(event: AIChatQueryEvent): void {
    if (this.released) {
      this.downstream.emit(event);
      return;
    }
    if (
      event.type === "complete" ||
      event.type === "cancelled" ||
      event.type === "error"
    ) {
      this.buffered.push(event);
      return;
    }
    this.downstream.emit(event);
  }

  get flushable(): Promise<void> | undefined {
    return this.downstream.flush?.();
  }

  async flush(): Promise<void> {
    this.released = true;
    for (const event of this.buffered) {
      this.downstream.emit(event);
    }
    this.buffered.length = 0;
    await this.downstream.flush?.();
  }

  drop(): void {
    // Persistence failed: terminal callbacks must NOT observe success.
    this.released = true;
    this.buffered.length = 0;
  }
}

/**
 * Build the steering promoter the engine's turn mailbox uses: persists one
 * claimed instruction atomically (user row + applied flip) using the row's
 * current claim token. Lives here so the IPC layer can wire it into the
 * engine without the engine importing the Module. `onApplied` is invoked
 * after a successful promote so the wiring can broadcast the pending
 * lifecycle event — without it the renderer's steering bubble never clears.
 */
export function createSteeringPromoter(
  pendingModule: AIChatPendingMessageModule,
  onApplied?: (input: {
    readonly conversationId: string;
    readonly pendingMessageId: string;
    /** Promoted row view (sentMessageId bound) for delivered-row appends. */
    readonly view?: AIChatPendingMessageView;
  }) => void
): (input: {
  readonly instruction: AIChatSteeringInstruction;
  readonly boundary: import("@/entityTypes/aiChatV2Types").AIChatSafeBoundary;
}) => Promise<void> {
  return async ({ instruction, boundary }) => {
    const row = await pendingModule
      .getModel()
      .getByPendingMessageId(instruction.pendingMessageId);
    if (!row || !row.claimToken) {
      throw new Error(
        `Steering row ${instruction.pendingMessageId} lost its claim before persistence.`
      );
    }
    const transactionStartedAt = Date.now();
    await pendingModule.promoteSteeringToUserMessage({
      pendingMessageId: instruction.pendingMessageId,
      claimToken: row.claimToken,
      boundary,
      targetAssistantMessageId: instruction.targetAssistantMessageId,
    });
    aiChatQueueCounters.observeTiming(
      "pending_db_transaction_ms",
      Date.now() - transactionStartedAt
    );
    aiChatQueueCounters.increment("ai_chat_steering_applied_total");
    const clickStartedAt = Date.parse(instruction.createdAt);
    if (!Number.isNaN(clickStartedAt)) {
      aiChatQueueCounters.observeTiming(
        "steer_click_to_boundary_ms",
        Date.now() - clickStartedAt
      );
    }
    // The promoted view carries the persisted sentMessageId — without it the
    // applied event cannot drive the delivered-row append and the steered
    // message vanishes from live transcripts until a history reload.
    const view = await pendingModule
      .getView(instruction.pendingMessageId)
      .catch(() => null);
    onApplied?.({
      conversationId: row.conversationId,
      pendingMessageId: instruction.pendingMessageId,
      ...(view ? { view } : {}),
    });
  };
}

export class AIChatTurnQueueService {
  /** Per-conversation drain serialization chains (design §9.3). */
  private readonly drainChains = new Map<string, Promise<void>>();
  /**
   * B02: conversations whose dispatch was deferred for global capacity.
   * Re-drained when any terminal frees a slot (finish/park/busy-release).
   * Steering-consumed rows never enter here (steer() bypasses the bridge
   * and scheduler entirely — they never become runs).
   */
  private readonly schedulerDeferred = new Set<string>();
  /**
   * B04: parked-run continuation mapping. When a dispatch parks on
   * permission/question, the engine turn continues OUTSIDE the queue
   * (fire-and-forget resume); its later terminal arrives via
   * notifyExternalTurnTerminal, which must settle THIS run envelope
   * (not a new one) and release lease/capacity exactly once.
   */
  private readonly parkedRuns = new Map<
    string,
    { runId: string; pendingMessageId: string }
  >();

  constructor(private readonly deps: AIChatTurnQueueServiceDeps) {}

  /**
   * B02: wake capacity-deferred conversations after a slot frees. Called
   * after every terminal/park/busy-release path (bridge.finishRun already
   * released the scheduler slot). Each re-drain re-attempts admission;
   * still-full conversations re-defer with scheduling age preserved (the
   * scheduler queue entry keeps its original enqueue time).
   */
  private drainSchedulerWaiters(exceptConversation?: string): void {
    if (this.schedulerDeferred.size === 0) return;
    const waiters = [...this.schedulerDeferred];
    this.schedulerDeferred.clear();
    for (const conversationId of waiters) {
      if (conversationId === exceptConversation) {
        // The completing conversation drains itself through its own
        // terminal path (scheduleDrain/holdQueue); re-adding would loop.
        continue;
      }
      this.scheduleDrain(conversationId);
    }
  }

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  /**
   * Route one ordinary renderer send (design §9.2). Every send — idle or
   * busy — becomes a durable pending row first, closing the renderer/main
   * status race. Returns the durable receipt the renderer may only treat as
   * queued once this resolves.
   *
   * `forceQueue` (coordinator busy-send delegation): never auto-dispatch —
   * the coordinator owns the live turn, and its terminal notification drains
   * or holds the row. Without it, a row submitted while the engine briefly
   * reports idle (e.g. transport-retry backoff inside the live turn) would
   * dispatch immediately and jump the queue.
   */
  async submit(input: {
    readonly clientRequestId: string;
    readonly request: ChatV2StreamRequest;
    readonly forceQueue?: boolean;
  }): Promise<AIChatPendingCreateResult> {
    if (!this.deps.isQueueEnabled()) {
      throw new AIChatTurnQueueError(
        "QUEUE_DISABLED",
        "The message queue feature is disabled."
      );
    }
    if (!this.deps.isAiEnabled()) {
      throw new AIChatTurnQueueError(
        "AI_FEATURE_DISABLED",
        "AI features are not enabled on this plan."
      );
    }

    const runtimeStatus = this.deps.engine.getConversationRuntimeStatus(
      input.request.conversationId ?? ""
    );
    // Queue hold: when the conversation's queue was paused (stop/error/
    // recovery), a new message joins the paused queue instead of draining.
    const existing = await this.deps.pendingModule.listViews(
      input.request.conversationId ?? ""
    );
    const queueHeld =
      runtimeStatus === "idle" &&
      existing.some(
        (view) => view.status === "paused" || view.status === "failed"
      );

    const created = await this.deps.pendingModule.createPendingMessage({
      clientRequestId: input.clientRequestId,
      request: input.request,
      ...(queueHeld ? { createAsPaused: true } : {}),
    });

    aiChatQueueCounters.increment("ai_chat_pending_created_total");
    const view = await this.deps.pendingModule.getView(
      created.pendingMessageId,
      runtimeStatus
    );
    if (view) {
      this.emitEvent(view, created.status);
    }

    let disposition: AIChatPendingCreateResult["disposition"] =
      created.status === "paused" ? "paused" : "queued";
    if (
      created.status === "queued" &&
      runtimeStatus === "idle" &&
      !queueHeld &&
      !input.forceQueue
    ) {
      this.scheduleDrain(created.conversationId);
      disposition = "dispatch_scheduled";
    }
    return {
      conversationId: created.conversationId,
      disposition,
      pendingMessage: view as AIChatPendingMessageView,
    };
  }

  // -------------------------------------------------------------------------
  // Steering acceptance (design §10.3)
  // -------------------------------------------------------------------------

  async steer(input: {
    readonly conversationId: string;
    readonly pendingMessageId: string;
  }): Promise<AIChatPendingMessageView> {
    if (!this.deps.isQueueEnabled() || !this.deps.isSteeringEnabled()) {
      throw new AIChatTurnQueueError(
        "STEERING_DISABLED",
        "Steering is disabled."
      );
    }
    if (!this.deps.isAiEnabled()) {
      throw new AIChatTurnQueueError(
        "AI_FEATURE_DISABLED",
        "AI features are not enabled on this plan."
      );
    }
    aiChatQueueCounters.increment("ai_chat_steering_requested_total");
    const runtimeStatus = this.deps.engine.getConversationRuntimeStatus(
      input.conversationId
    );
    if (runtimeStatus !== "running") {
      aiChatQueueCounters.incrementLabeled(
        "ai_chat_steering_rejected_total",
        "turn_not_running"
      );
      throw new AIChatTurnQueueError(
        "TURN_NOT_STEERABLE",
        "The conversation has no running response to steer."
      );
    }

    const row = await this.deps.pendingModule
      .getModel()
      .getByPendingMessageId(input.pendingMessageId);
    if (!row) {
      throw new AIChatTurnQueueError(
        "PENDING_NOT_FOUND",
        "Unknown pending message."
      );
    }
    if (row.conversationId !== input.conversationId) {
      throw new AIChatTurnQueueError(
        "CONVERSATION_MISMATCH",
        "Pending message belongs to a different conversation."
      );
    }
    if (row.status !== "queued") {
      throw new AIChatTurnQueueError(
        "PENDING_NOT_CLAIMABLE",
        "The message is no longer queued."
      );
    }

    // Phase 1: synchronous reservation on the active turn.
    const reservation = this.deps.engine.reserveSteering(
      input.conversationId,
      input.pendingMessageId
    );
    if (!reservation) {
      throw new AIChatTurnQueueError(
        "TURN_NOT_STEERABLE",
        "The active response cannot be steered right now."
      );
    }

    // Phase 2: conditional DB claim queued -> steering.
    const claim = await this.deps.pendingModule.claimForSteering({
      pendingMessageId: input.pendingMessageId,
      conversationId: input.conversationId,
      targetAssistantMessageId: reservation.targetAssistantMessageId,
    });
    if (!claim.ok) {
      this.deps.engine.cancelSteeringReservation(
        input.conversationId,
        reservation
      );
      throw new AIChatTurnQueueError(
        "PENDING_NOT_CLAIMABLE",
        "Another action claimed this message first."
      );
    }

    // Phase 3: commit into the mailbox. If the turn closed in between,
    // restore the row so it can still deliver as a normal message.
    const instruction: AIChatSteeringInstruction = {
      pendingMessageId: row.pendingMessageId,
      clientRequestId: row.clientRequestId,
      displayContent: row.content,
      modelContent: row.modelContent,
      createdAt: new Date().toISOString(),
      targetAssistantMessageId: reservation.targetAssistantMessageId,
    };
    const committed = this.deps.engine.commitSteering(
      input.conversationId,
      reservation,
      instruction
    );
    if (!committed) {
      aiChatQueueCounters.incrementLabeled(
        "ai_chat_steering_rejected_total",
        "turn_finished_first"
      );
      await this.deps.pendingModule
        .getModel()
        .restoreSteeringToQueued(
          input.pendingMessageId,
          claim.row.claimToken ?? ""
        );
      const latest = await this.deps.pendingModule.getView(
        input.pendingMessageId
      );
      this.emitEvent(latest ?? this.viewFromRow(claim.row), "queued");
      throw new AIChatTurnQueueError(
        "TURN_NOT_STEERABLE",
        "The response finished before steering could be applied. The message stays queued."
      );
    }

    const view = await this.deps.pendingModule.getView(
      input.pendingMessageId,
      runtimeStatus
    );
    if (view) {
      this.emitEvent(view, "steering");
    }
    return view as AIChatPendingMessageView;
  }

  // -------------------------------------------------------------------------
  // Cancel / resume / list / clear / recovery
  // -------------------------------------------------------------------------

  async cancel(input: {
    readonly conversationId: string;
    readonly pendingMessageId: string;
  }): Promise<AIChatPendingMessageView> {
    const view = await this.deps.pendingModule.cancelPending(input);
    this.emitEvent(view, "cancelled");
    return view;
  }

  async resumeConversation(conversationId: string): Promise<void> {
    const model = this.deps.pendingModule.getModel();
    const resumed = await model.resumeConversation(conversationId);
    if (resumed > 0) {
      const views = await this.deps.pendingModule.listViews(conversationId);
      for (const view of views) {
        if (view.status === "queued") {
          this.emitEvent(view, "queued");
        }
      }
      this.scheduleDrain(conversationId);
    }
  }

  /**
   * Cross-path terminal notification (chat-first shell unification): the
   * workspace coordinator runs turns outside this queue, so its terminal is
   * reported here. A completed terminal re-drains rows queued behind that
   * turn (design §9.3 — the terminal re-drain contract); cancelled/failed
   * terminals hold the queue exactly like a queue-owned turn terminal would
   * (FR-14 durable pause). No-ops when the conversation has no pending rows.
   *
   * B04: when this conversation parked a queue-dispatched run (permission /
   * plan question), the resumed turn's terminal settles THAT envelope here —
   * without this, Activity/reconstruction shows `awaiting_user` forever
   * after the actual execution ended. Exactly one terminal per parked run;
   * lease/capacity were already released at park time.
   */
  async notifyExternalTurnTerminal(
    conversationId: string,
    outcome: "completed" | "cancelled" | "failed"
  ): Promise<void> {
    const parked = this.parkedRuns.get(conversationId);
    if (parked) {
      this.parkedRuns.delete(conversationId);
      await this.deps.dispatchBridge?.finishRun(parked.runId, outcome);
      // B06: background summary — parked run settled (bounded, no bodies).
      this.deps.summarySink?.({
        conversationId,
        runId: parked.runId,
        reason:
          outcome === "completed"
            ? "run_completed"
            : outcome === "cancelled"
              ? "run_cancelled"
              : "run_failed",
      });
      this.drainSchedulerWaiters(conversationId);
    }
    const rows = await this.deps.pendingModule.listViews(conversationId);
    if (rows.length === 0) return;
    if (outcome === "completed") {
      this.scheduleDrain(conversationId);
      return;
    }
    await this.holdQueue(conversationId, outcome);
  }

  async list(conversationId: string): Promise<AIChatPendingMessageView[]> {
    const runtimeStatus =
      this.deps.engine.getConversationRuntimeStatus(conversationId);
    return await this.deps.pendingModule.listViews(
      conversationId,
      runtimeStatus
    );
  }

  /** Startup reconciliation (design §16.1) — never auto-runs work. */
  async recoverOnStartup(): Promise<void> {
    const recoveryModel = this.deps.pendingModule.getModel();
    const before = await recoveryModel.listNonTerminalAll();
    const beforeByStatus = new Set(before.map((row) => row.status));
    await this.deps.pendingModule.recoverOnStartup();
    // Labeled recovery totals per PRE-recovery state (design §19.2).
    for (const state of beforeByStatus) {
      aiChatQueueCounters.incrementLabeled(
        "ai_chat_queue_recovered_total",
        state
      );
    }
    const model = this.deps.pendingModule.getModel();
    const rows = await model.listNonTerminalAll();
    const byConversation = new Set(rows.map((row) => row.conversationId));
    for (const conversationId of byConversation) {
      const views = await this.list(conversationId);
      for (const view of views) {
        this.emitEvent(view, view.status, "recovered_after_restart");
      }
    }
    log.info(
      `[ai-chat-queue] startup recovery done conversations=${byConversation.size} nonterminal=${rows.length}`
    );
  }

  /** Clear one conversation: stop runtime, drop pending rows + bytes. */
  async clearConversation(conversationId: string): Promise<void> {
    this.deps.engine.stopActiveTurn(conversationId);
    // B04: settle a parked envelope as cancelled so it never stays stale
    // `awaiting_*` after its rows are dropped.
    const parked = this.parkedRuns.get(conversationId);
    if (parked) {
      this.parkedRuns.delete(conversationId);
      await this.deps.dispatchBridge?.finishRun(parked.runId, "cancelled");
    }
    this.schedulerDeferred.delete(conversationId);
    const views = await this.deps.pendingModule.listViews(conversationId);
    await this.deps.pendingModule.clearConversation(conversationId);
    for (const view of views) {
      this.emitEvent({ ...view, status: "cancelled" }, "cancelled");
    }
  }

  /** Clear every conversation with pending work (clear-all / DB switch). */
  async clearAll(): Promise<void> {
    const rows = await this.deps.pendingModule.getModel().listNonTerminalAll();
    const conversations = [...new Set(rows.map((r) => r.conversationId))];
    for (const conversationId of conversations) {
      await this.clearConversation(conversationId);
    }
    this.drainChains.clear();
  }

  // -------------------------------------------------------------------------
  // Drain (design §9.3)
  // -------------------------------------------------------------------------

  /** Serialize drains per conversation and fire-and-forget. */
  private scheduleDrain(conversationId: string): void {
    const prior = this.drainChains.get(conversationId) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => this.drainConversation(conversationId))
      .catch((err: unknown) => {
        log.error(`[ai-chat-queue] drain failed conv=${conversationId}:`, err);
      })
      .finally(() => {
        // Remove the chain entry when this is the tail and it finished.
        if (this.drainChains.get(conversationId) === next) {
          this.drainChains.delete(conversationId);
        }
      });
    this.drainChains.set(conversationId, next);
  }

  private async drainConversation(conversationId: string): Promise<void> {
    if (!this.deps.isQueueEnabled() || !this.deps.isAiEnabled()) {
      // Entitlement dropped: hold the queue durably, keep rows visible.
      const paused = await this.deps.pendingModule
        .getModel()
        .pauseConversationQueued(conversationId, "AI_FEATURE_DISABLED");
      if (paused > 0) {
        log.warn(
          `[ai-chat-queue] dispatch blocked (AI disabled) conv=${conversationId} paused=${paused}`
        );
      }
      return;
    }

    if (
      this.deps.engine.getConversationRuntimeStatus(conversationId) !== "idle"
    ) {
      return; // A turn owns the conversation; its terminal will re-drain.
    }

    const model = this.deps.pendingModule.getModel();
    const claim = await model.claimOldestForDispatch(conversationId);
    if (!claim.ok) {
      return;
    }
    const row = claim.row;
    const claimToken = row.claimToken ?? "";

    // Deterministic assistant id lets the renderer bind its parked turn
    // renderer to THIS dispatch via the pending event (design §14.3).
    const assistantMessageId = `assistant-pending-${row.pendingMessageId}`;
    this.emitEvent(
      {
        ...this.viewFromRow(row),
        activeAssistantMessageId: assistantMessageId,
      },
      "dispatching"
    );

    const drainStartedAt = Date.now();
    const enqueueStartedAt = row.createdAt
      ? new Date(row.createdAt).getTime()
      : NaN;

    const lease = this.deps.tryAcquireLease({ conversationId });
    if (!lease) {
      await model.releaseDispatchClaim(row.pendingMessageId, claimToken);
      log.info(
        `[ai-chat-queue] lease busy — released claim conv=${conversationId}`
      );
      return;
    }

    // T1 (AD-002): the run envelope is minted at the scheduling claim, AFTER
    // the claim + lease and BEFORE any provider work. A null envelope is a
    // pre-turn failure: release the claim — no engine call, no orphan run.
    // B02: the bridge composes global scheduler admission. `admitted=false`
    // means capacity is full — the envelope stays queued with its original
    // enqueue time (age preserved); release the dispatch claim WITHOUT
    // error and re-drain on capacity-free notification. Steering-consumed
    // rows never reach here (steer() bypasses bridge+scheduler entirely).
    const bridgeResult = await this.deps.dispatchBridge?.schedule({
      pendingMessageId: row.pendingMessageId,
      conversationId,
      resourceClass: "general",
    });
    if (this.deps.dispatchBridge && bridgeResult === null) {
      await model.releaseDispatchClaim(row.pendingMessageId, claimToken, {
        code: "RUN_ENVELOPE_FAILED",
        message: "Could not mint the run envelope for this dispatch.",
      });
      const view = await this.deps.pendingModule.getView(row.pendingMessageId);
      if (view) {
        this.emitEvent(view, "failed");
      }
      lease.release();
      return;
    }
    if (bridgeResult && !bridgeResult.admitted) {
      // B02 deferred: capacity full. Keep the scheduler queue entry (age
      // preserved), release the DB claim back to queued WITHOUT error, and
      // remember to re-drain when any terminal frees a slot. Zero provider
      // calls on this path (admission precedes promotion AND execution).
      await model.releaseDispatchClaim(row.pendingMessageId, claimToken);
      this.schedulerDeferred.add(conversationId);
      // B06: background summary — still queued for capacity (bounded).
      this.deps.summarySink?.({
        conversationId,
        runId: bridgeResult.runId,
        reason: "run_queued",
      });
      const queuedView = await this.deps.pendingModule.getView(
        row.pendingMessageId
      );
      if (queuedView) {
        this.emitEvent(queuedView, "queued");
      }
      aiChatQueueCounters.increment("ai_chat_pending_deferred_total");
      log.info(
        `[ai-chat-queue] scheduler deferred conv=${conversationId} run=${bridgeResult.runId}`
      );
      lease.release();
      return;
    }
    const bridgeRunId = bridgeResult
      ? { runId: bridgeResult.runId }
      : undefined;
    // B06: background summary — execution admitted (bounded, no bodies).
    this.deps.summarySink?.({
      conversationId,
      runId: bridgeRunId?.runId ?? null,
      reason: "run_started",
    });

    try {
      let savedUser;
      try {
        const transactionStartedAt = Date.now();
        savedUser = await this.deps.pendingModule.promoteDispatchToUserMessage({
          pendingMessageId: row.pendingMessageId,
          claimToken,
        });
        aiChatQueueCounters.observeTiming(
          "pending_db_transaction_ms",
          Date.now() - transactionStartedAt
        );
        aiChatQueueCounters.increment("ai_chat_pending_dispatched_total");
        if (!Number.isNaN(enqueueStartedAt)) {
          aiChatQueueCounters.observeTiming(
            "enqueue_to_dispatch_ms",
            Date.now() - enqueueStartedAt
          );
        }
      } catch (err) {
        aiChatQueueCounters.increment("ai_chat_pending_failed_total");
        // Pre-turn failure: recoverable — pause, keep visible (FR-14).
        // B04: the envelope was already admitted to running above, so settle
        // it terminally (failed) instead of leaving a stale `running` row —
        // recoverable intent stays on the pending row (released claim).
        await this.deps.dispatchBridge?.finishRun(
          bridgeRunId?.runId ?? null,
          "failed"
        );
        // B06: background summary — pre-turn failure (bounded).
        this.deps.summarySink?.({
          conversationId,
          runId: bridgeRunId?.runId ?? null,
          reason: "run_failed",
        });
        await model.releaseDispatchClaim(row.pendingMessageId, claimToken, {
          code: "DISPATCH_PROMOTE_FAILED",
          message: err instanceof Error ? err.message : String(err),
        });
        const view = await this.deps.pendingModule.getView(
          row.pendingMessageId
        );
        if (view) {
          this.emitEvent(view, "failed");
        }
        log.error(
          `[ai-chat-queue] promote failed conv=${conversationId}:`,
          err
        );
        this.drainSchedulerWaiters(conversationId);
        return;
      }

      // Delivery event at PROMOTE time (message-queue §7): the row is
      // persisted-and-sent NOW, so surfaces can swap the bubble for the
      // transcript user row BEFORE the turn streams — a completion-only
      // append would land the user's message after its answer, and failure
      // paths would never deliver it at all. The re-fetched view carries
      // the persisted sentMessageId the renderer binds to.
      const promoted = await this.deps.pendingModule.getView(
        row.pendingMessageId
      );
      if (promoted) {
        this.emitEvent(promoted, "sent");
      }

      let terminal: AIChatTurnTerminalEvent;
      // B05: buffer terminal sink publication behind durable persistence.
      // Non-terminal chunks stream immediately; complete/cancelled/error sink
      // events flush only after the run transition commits below.
      // B06: the sink carries the REAL durable run id so live detail events
      // and the Activity envelope agree (selection can reconstruct it).
      const streamIdentity = bridgeRunId
        ? { runId: bridgeRunId.runId, conversationId }
        : undefined;
      const terminalGate = new AIChatTerminalGate(
        this.deps.streamSinkFactory(streamIdentity)
      );
      try {
        const turnInputs = await this.deps.pendingModule.rebuildTurnInputs(row);
        // Codex P1: stage the user-confirmed batch at DISPATCH — the row's
        // own turn is about to run, so the entry can be consumed only by it
        // (a receive-time entry would have been eaten by the running turn
        // or cleared at its terminal).
        if (turnInputs.confirmedBatchReferences) {
          getConfirmedBatchReferenceRegistry().stage(
            conversationId,
            turnInputs.confirmedBatchReferences
          );
        }
        terminal = await this.deps.engine.submitPersistedUserMessage({
          eventSink: terminalGate,
          request: turnInputs.request,
          savedUser,
          modelContent: row.modelContent,
          assistantMessageId,
          ...(turnInputs.contentParts
            ? { contentParts: turnInputs.contentParts }
            : {}),
        });
      } catch (err) {
        log.error(
          `[ai-chat-queue] dispatch turn failed conv=${conversationId}:`,
          err
        );
        aiChatQueueCounters.increment("ai_chat_pending_failed_total");
        terminal = {
          type: "failed",
          conversationId,
          assistantMessageId: "",
        };
      }

      // T1 (AD-002): persist the run terminal BEFORE the drain's side
      // effects settle (the pending row's own transitions stay authoritative
      // for queue behavior; the envelope records the execution outcome).
      // B02: finishRun releases the global scheduler slot; wake deferred
      // conversations on every terminal path below.
      // B05: terminal sink events buffered in terminalGate flush ONLY after
      // the strict run transition commits. On persistence failure the gate
      // drops the terminal (no successful publication) and the queue holds
      // for explicit reconciliation instead of silently advancing.
      const bridge = this.deps.dispatchBridge;
      const persistTerminal = async (
        status: "completed" | "failed" | "cancelled" | "interrupted"
      ): Promise<boolean> => {
        if (bridge?.finishRunStrict) {
          return await bridge.finishRunStrict(
            bridgeRunId?.runId ?? null,
            status
          );
        }
        await bridge?.finishRun(bridgeRunId?.runId ?? null, status);
        return true;
      };
      const reconcilePersistenceFailure = async (): Promise<void> => {
        terminalGate.drop();
        aiChatQueueCounters.increment("ai_chat_pending_failed_total");
        log.error(
          `[ai-chat-queue] run terminal persistence failed conv=${conversationId} run=${bridgeRunId?.runId ?? "none"} — holding for reconciliation (no terminal publication, no advance)`
        );
        // B06: background summary — persistence failure (bounded).
        this.deps.summarySink?.({
          conversationId,
          runId: bridgeRunId?.runId ?? null,
          reason: "run_failed",
        });
        await model.releaseDispatchClaim(row.pendingMessageId, claimToken, {
          code: "RUN_TERMINAL_PERSIST_FAILED",
          message:
            "The execution finished but its durable terminal could not be saved. Retry after recovery.",
        });
        const view = await this.deps.pendingModule.getView(
          row.pendingMessageId
        );
        if (view) {
          this.emitEvent(view, "failed");
        }
        this.drainSchedulerWaiters(conversationId);
      };
      if (terminal.type === "completed") {
        if (!(await persistTerminal("completed"))) {
          await reconcilePersistenceFailure();
          return;
        }
        await terminalGate.flush();
        // B06: background summary — terminal success (bounded, no bodies).
        this.deps.summarySink?.({
          conversationId,
          runId: bridgeRunId?.runId ?? null,
          reason: "run_completed",
        });
        const done = await this.deps.pendingModule.getView(
          row.pendingMessageId
        );
        if (done) {
          this.emitEvent(done, "sent");
        }
        aiChatQueueCounters.observeTiming(
          "drain_duration_ms",
          Date.now() - drainStartedAt
        );
        // FR-10/11: schedule exactly one next drain.
        this.scheduleDrain(conversationId);
        this.drainSchedulerWaiters(conversationId);
        return;
      }
      if (terminal.type === "conversation_busy") {
        // Another turn owns the conversation (legacy path race). Put the
        // row back; a later drain or resume picks it up. The envelope was
        // minted for THIS claim — release it to queued so the next claim
        // can reuse it idempotently (scheduler requeue preserves age).
        await bridge?.releaseToQueued?.(bridgeRunId?.runId ?? null);
        await model.releaseDispatchClaim(row.pendingMessageId, claimToken);
        this.drainSchedulerWaiters(conversationId);
        return;
      }
      if (
        terminal.type === "paused_for_permission" ||
        terminal.type === "paused_for_plan_question"
      ) {
        // Parked turns keep their envelope in the waiting family (§9.1) so
        // the resume path continues the SAME run. parkRun releases global
        // capacity (the run is waiting, not executing) and waiters drain.
        // B04: use the correct waiting status (permission vs question) and
        // retain the run/pending continuation mapping so the resumed turn's
        // later terminal (via notifyExternalTurnTerminal) settles THIS
        // envelope instead of leaving it stale.
        const waiting =
          terminal.type === "paused_for_permission"
            ? ("awaiting_permission" as const)
            : ("awaiting_user" as const);
        const bridgeRunIdValue = bridgeRunId?.runId ?? null;
        if (bridge?.parkRunWaiting) {
          await bridge.parkRunWaiting(bridgeRunIdValue, waiting);
        } else {
          await bridge?.parkRun?.(bridgeRunIdValue);
        }
        if (bridgeRunIdValue) {
          this.parkedRuns.set(conversationId, {
            runId: bridgeRunIdValue,
            pendingMessageId: row.pendingMessageId,
          });
        }
        // B06: background attention summary — parked on permission/question
        // updates the INACTIVE row's sidebar without private detail.
        this.deps.summarySink?.({
          conversationId,
          runId: bridgeRunIdValue,
          reason:
            waiting === "awaiting_permission"
              ? "permission_required"
              : "user_input_required",
        });
        await this.holdQueue(conversationId, terminal.type);
        this.drainSchedulerWaiters(conversationId);
        return;
      }
      // cancelled | failed
      const failedStatus =
        terminal.type === "cancelled" ? "cancelled" : "failed";
      if (!(await persistTerminal(failedStatus))) {
        await reconcilePersistenceFailure();
        return;
      }
      await terminalGate.flush();
      // B06: background summary — terminal failure/cancel (bounded).
      this.deps.summarySink?.({
        conversationId,
        runId: bridgeRunId?.runId ?? null,
        reason:
          failedStatus === "cancelled" ? "run_cancelled" : "run_failed",
      });
      await this.holdQueue(conversationId, terminal.type);
      this.drainSchedulerWaiters(conversationId);
    } finally {
      lease.release();
    }
  }

  /** Durable hold: queued rows -> paused; unapplied steering -> paused. */
  private async holdQueue(
    conversationId: string,
    reason:
      | "cancelled"
      | "failed"
      | "paused_for_permission"
      | "paused_for_plan_question"
  ): Promise<void> {
    const model = this.deps.pendingModule.getModel();
    const reasonCode =
      reason === "cancelled"
        ? "user_stopped"
        : reason === "failed"
        ? "turn_failed"
        : reason === "paused_for_permission"
        ? "awaiting_permission"
        : "awaiting_plan_answer";
    const pausedQueued = await model.pauseConversationQueued(
      conversationId,
      reasonCode
    );
    const pausedSteering = await model.pauseSteeringRows(
      conversationId,
      reasonCode
    );
    if (pausedQueued + pausedSteering > 0) {
      aiChatQueueCounters.increment(
        "ai_chat_pending_paused_total",
        pausedQueued + pausedSteering
      );
      const views = await this.deps.pendingModule.listViews(conversationId);
      for (const view of views) {
        if (view.status === "paused") {
          this.emitEvent(view, "paused", reasonCode);
        }
      }
      log.info(
        `[ai-chat-queue] held conv=${conversationId} reason=${reasonCode} queued=${pausedQueued} steering=${pausedSteering}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private emitEvent(
    view: AIChatPendingMessageView,
    status: AIChatPendingMessageEvent["status"],
    reasonCode?: string
  ): void {
    this.deps.eventSink.emit({
      conversationId: view.conversationId,
      pendingMessageId: view.pendingMessageId,
      status,
      occurredAt: new Date().toISOString(),
      pendingMessage: { ...view, status },
      ...(reasonCode ? { reasonCode } : {}),
    });
  }

  private viewFromRow(
    row: Parameters<AIChatPendingMessageModule["toView"]>[0]
  ): AIChatPendingMessageView {
    return this.deps.pendingModule.toView(row);
  }
}
