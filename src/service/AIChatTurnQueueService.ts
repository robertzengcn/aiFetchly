import type {
  AIChatPendingCreateResult,
  AIChatPendingMessageEvent,
  AIChatPendingMessageView,
  ChatV2RuntimeStatus,
  ChatV2StreamRequest,
} from "@/entityTypes/aiChatV2Types";
import type {
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
  /** Builds the renderer-facing stream sink for queue-dispatched turns. */
  readonly streamSinkFactory: () => AIChatQueryEventSink;
  /** Interactive lease acquisition (scheduled-vs-queue mutual exclusion). */
  readonly tryAcquireLease: (input: {
    readonly conversationId: string;
  }) => AIChatQueueLease | null;
  readonly isAiEnabled: () => boolean;
  readonly isQueueEnabled: () => boolean;
  readonly isSteeringEnabled: () => boolean;
}

export type AIChatQueueErrorCode =
  | AIChatPendingModuleErrorCode
  | "AI_FEATURE_DISABLED"
  | "QUEUE_DISABLED"
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
 * Build the steering promoter the engine's turn mailbox uses: persists one
 * claimed instruction atomically (user row + applied flip) using the row's
 * current claim token. Lives here so the IPC layer can wire it into the
 * engine without the engine importing the Module.
 */
export function createSteeringPromoter(
  pendingModule: AIChatPendingMessageModule
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
  };
}

export class AIChatTurnQueueService {
  /** Per-conversation drain serialization chains (design §9.3). */
  private readonly drainChains = new Map<string, Promise<void>>();

  constructor(private readonly deps: AIChatTurnQueueServiceDeps) {}

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  /**
   * Route one ordinary renderer send (design §9.2). Every send — idle or
   * busy — becomes a durable pending row first, closing the renderer/main
   * status race. Returns the durable receipt the renderer may only treat as
   * queued once this resolves.
   */
  async submit(input: {
    readonly clientRequestId: string;
    readonly request: ChatV2StreamRequest;
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
    if (created.status === "queued" && runtimeStatus === "idle" && !queueHeld) {
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
      aiChatQueueCounters.incrementLabeled("ai_chat_queue_recovered_total", state);
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
        return;
      }

      let terminal: AIChatTurnTerminalEvent;
      try {
        const turnInputs = await this.deps.pendingModule.rebuildTurnInputs(row);
        terminal = await this.deps.engine.submitPersistedUserMessage({
          eventSink: this.deps.streamSinkFactory(),
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

      if (terminal.type === "completed") {
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
        return;
      }
      if (terminal.type === "conversation_busy") {
        // Another turn owns the conversation (legacy path race). Put the
        // row back; a later drain or resume picks it up.
        await model.releaseDispatchClaim(row.pendingMessageId, claimToken);
        return;
      }
      // cancelled | failed | paused_for_permission | paused_for_plan_question
      await this.holdQueue(conversationId, terminal.type);
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
