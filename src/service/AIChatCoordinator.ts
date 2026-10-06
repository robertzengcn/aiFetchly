import { AIChatEventRouter } from "@/service/AIChatEventRouter";
import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";
import { AIChatRunEventAdapter } from "@/service/AIChatRunEventAdapter";
import { createChatV2StreamSink } from "@/service/aiChatV2StreamSink";
import { userSafeError } from "@/service/AIChatErrorMapper";
import { AIChatV2EventBroadcaster } from "@/service/AIChatV2EventBroadcaster";
import { AIChatConversationTurnCoordinator } from "@/service/AIChatConversationTurnCoordinator";
import type {
  AIChatPendingClaim,
  AIChatQuerySubmitInput,
} from "@/service/AIChatQueryEngine";
import { AIChatPlanModule } from "@/modules/AIChatPlanModule";
import type { AskUserQuestionAnswer } from "@/entityTypes/aiChatPlanTypes";
import type {
  AIChatQueryEventSink,
  AIChatSegmentOutcome,
  AIChatTurnLifecycleListener,
} from "@/service/AIChatQueryEvents";
import type { AIChatQueueTurnDispatch } from "@/service/AIChatTurnQueueService";
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { AIChatConversationModel } from "@/model/AIChatConversation.model";
import type { StartChatRunRequestPayload } from "@/schemas/ipc/aiChatWorkspace";
import { normalizeChatV2UploadedFiles } from "@/main-process/communication/ai-chat-v2-ipc";
import type { ChatV2UploadedAttachment } from "@/entityTypes/aiChatV2Types";
import type {
  ChatRunStatus,
  ConversationRuntimeStatus,
  ConversationSummaryEvent,
  StartChatRunResponse,
} from "@/entityTypes/aiChatWorkspaceTypes";
import type {
  ChatV2RuntimeStatus,
  ChatV2StreamChunk,
  ChatV2StreamRequest,
} from "@/entityTypes/aiChatV2Types";

/** Structural engine view the coordinator depends on (DI-friendly). */
export interface CoordinatorEngine {
  /** Outcome-returning entry (generator-streaming PRD FR-022, Stage A1). */
  runTurn(input: AIChatQuerySubmitInput): Promise<AIChatSegmentOutcome>;
  /** Queue-drained turns execute through the same owner (Stage A §3.4). */
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
    readonly lifecycle?: AIChatTurnLifecycleListener;
    readonly ownerNotifiesTerminal?: boolean;
    /** TODO-05: durable-run gate (see AIChatQuerySubmitInput). */
    readonly onSegmentDurable?: (
      conversationId: string,
      outcome: "completed" | "cancelled" | "failed"
    ) => Promise<void>;
  }): Promise<AIChatSegmentOutcome>;
  /** Stage A §3.5 (FR-010/024): owner-driven resume seam. */
  claimPendingPermission(
    conversationId: string,
    toolId: string
  ): AIChatPendingClaim;
  claimPendingQuestion(
    conversationId: string,
    questionId: string
  ): AIChatPendingClaim;
  cancelClaimed(conversationId: string): boolean;
  resumeClaimed(
    claim: Extract<AIChatPendingClaim, { status: "claimed" }>,
    options?: {
      readonly eventSink?: AIChatQueryEventSink;
      readonly lifecycle?: AIChatTurnLifecycleListener;
      /** TODO-05: durable-run gate (see AIChatQuerySubmitInput). */
      readonly onSegmentDurable?: (
        conversationId: string,
        outcome: "completed" | "cancelled" | "failed"
      ) => Promise<void>;
    }
  ): Promise<AIChatSegmentOutcome>;
  stopActiveTurn(conversationId?: string): void;
  getConversationRuntimeStatus(conversationId: string): ChatV2RuntimeStatus;
}

export interface AIChatCoordinatorDeps {
  readonly engine: CoordinatorEngine;
  readonly runModule: AIChatRunModule;
  readonly conversationModule: AIChatConversationModule;
  readonly router: AIChatEventRouter;
  readonly scheduler: AIChatExecutionScheduler;
  readonly turnCoordinator: AIChatConversationTurnCoordinator;
  /** AI enablement gate — checked before any AI work executes. */
  readonly canUseChat: () => { ok: true } | { ok: false; message: string };
  /**
   * Cross-path terminal notification (chat-first shell / message-queue
   * unification): invoked once per run terminal so the durable pending queue
   * can re-drain rows queued behind this turn (completed) or hold them
   * (cancelled/failed). Optional so non-production wiring stays untouched.
   */
  readonly onRunTerminal?: (
    conversationId: string,
    status: ChatRunStatus
  ) => void;
  /**
   * Busy-conversation send delegation (message-queue PRD §9.2): when the
   * conversation already has a live/running turn, a new send is routed into
   * the durable pending queue instead of being rejected. Returns the
   * pending-row run marker, or null when the queue declined (limit, gate) so
   * the caller keeps the legacy rejection.
   */
  readonly busySubmit?: (
    request: StartChatRunRequestPayload
  ) => Promise<{ pendingRunId: string } | null>;
}

interface LiveRunState {
  readonly runId: string;
  readonly conversationId: string;
  status: ChatRunStatus;
  readonly workspaceKey: string | null;
  cancelRequested: boolean;
  terminalChunk: ChatV2StreamChunk | null;
  /**
   * True once executeDispatch has returned (normal terminal OR parked pause).
   * Terminal chunks arriving afterwards belong to the parked turn's follow-up
   * (permission-grant resume, deny-stop cancel) and are settled detached via
   * settleDetachedTerminal instead of the held terminalChunk slot.
   */
  dispatchSettled: boolean;
  /**
   * Diagnostic captured when the engine segment ended WITHOUT a classified
   * outcome (FR-022 / AC-17): the run is finalized failed with
   * errorCode "unclassified_segment_exit" instead of defaulting to completed.
   */
  unclassifiedExitSummary: string | null;
  /**
   * Stage A §3.5 (FR-005): the run's event adapter lives in run context (not
   * a per-dispatch local), so resumed segments continue the SAME monotonic
   * sequence instead of restarting at 1.
   */
  adapter: AIChatRunEventAdapter;
  /**
   * Stage A §3.4 (FR-004): queue-drained turn input. Present only when this
   * run executes a durable pending row via dispatchQueuedTurn.
   */
  queueDispatch?: AIChatQueueTurnDispatch;
  /**
   * Stage A §3.4: resolves dispatchQueuedTurn's returned promise exactly once
   * when the segment settles (terminal or parked outcome).
   */
  completion?: {
    resolved: boolean;
    resolve(outcome: AIChatSegmentOutcome): void;
  };
  /**
   * Stage A §3.5 (FR-024): a claimed permission/plan-question resume waiting
   * for (or holding) scheduler capacity. Its continuation runs inside
   * executeDispatch, observed by this owner.
   */
  resumeClaim?: Extract<AIChatPendingClaim, { status: "claimed" }>;
}

const CLIENT_REQUEST_CACHE_MAX = 200;

/**
 * Main-process execution owner for the redesigned chat workspace
 * (technical-design §7.3): validates, persists a durable run envelope,
 * schedules bounded execution, adapts engine events with run identity,
 * persists terminal state BEFORE broadcasting summary hints, and keeps runs
 * alive across renderer reloads and selection changes.
 */
export class AIChatCoordinator {
  private readonly liveRuns = new Map<string, LiveRunState>();
  private readonly runIndex = new Map<string, string>();
  private readonly startRequests = new Map<
    string,
    StartChatRunRequestPayload
  >();
  private readonly clientRequestCache = new Map<string, StartChatRunResponse>();
  /** Cached unread flag so non-completion summaries never clear it wrongly. */
  private readonly liveUnread = new Map<string, boolean>();

  constructor(private readonly deps: AIChatCoordinatorDeps) {}

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  /**
   * Accept a run: gate AI use, dedupe by clientRequestId, persist the run
   * envelope (queued), submit to the scheduler, and return the accepted id.
   */
  async startRun(
    request: StartChatRunRequestPayload
  ): Promise<
    | { ok: true; response: StartChatRunResponse }
    | { ok: false; message: string }
  > {
    // AI enablement gate FIRST — before any AI work executes (PRD decision 19).
    const gate = this.deps.canUseChat();
    if (!gate.ok) {
      return { ok: false, message: gate.message };
    }

    const cached = this.clientRequestCache.get(request.clientRequestId);
    if (cached) {
      return { ok: true, response: cached }; // send-button retry safety
    }

    // One live run per conversation (PRD §19.4 / turn-coordinator
    // semantics): a second send before the first resolves would overwrite
    // the live slot and strand run B as permanently queued. Route it into
    // the durable pending queue instead (message-queue PRD §9.2: every busy
    // send becomes a pending row — the bubble is the rendered surface and
    // the queue drains FIFO at the turn terminal).
    const engineBusy =
      this.deps.engine.getConversationRuntimeStatus(request.conversationId) !==
      "idle";
    if (this.liveRuns.has(request.conversationId) || engineBusy) {
      const delegated = this.deps.busySubmit
        ? await this.deps.busySubmit(request)
        : null;
      if (delegated) {
        const queuedResponse: StartChatRunResponse = {
          conversationId: request.conversationId,
          runId: delegated.pendingRunId,
          status: "queued",
          acceptedAt: new Date().toISOString(),
        };
        this.rememberClientRequest(request.clientRequestId, queuedResponse);
        return { ok: true, response: queuedResponse };
      }
      return {
        ok: false,
        message:
          "A run is already active for this conversation. Wait for it to finish or stop it first.",
      };
    }

    const run = await this.deps.runModule.createRun({
      conversationId: request.conversationId,
      owner: "interactive",
      resourceClass: request.resourceClass ?? "general",
    });

    // Attachment normalization is shared with the legacy stream path so both
    // surfaces enforce identical bounds (mime allowlist, image byte caps).
    const uploadedFiles: ChatV2UploadedAttachment[] | undefined =
      request.uploadedFiles
        ? normalizeChatV2UploadedFiles(request.uploadedFiles)
        : undefined;

    const context = await this.resolveConversationContext(
      request.conversationId
    );
    this.liveRuns.set(request.conversationId, {
      runId: run.runId,
      conversationId: request.conversationId,
      status: "queued",
      workspaceKey: context.workspaceKey,
      cancelRequested: false,
      terminalChunk: null,
      dispatchSettled: false,
      unclassifiedExitSummary: null,
      adapter: new AIChatRunEventAdapter(run.runId, request.conversationId),
    });
    this.runIndex.set(run.runId, request.conversationId);
    this.startRequests.set(run.runId, {
      ...request,
      uploadedFiles:
        uploadedFiles && uploadedFiles.length > 0 ? uploadedFiles : undefined,
    });
    this.liveUnread.set(request.conversationId, context.unread);

    // User-message projection update (preview + generated title once).
    await this.deps.conversationModule.recordMessagePersisted({
      conversationId: request.conversationId,
      isResult: false,
      previewText: request.message,
      generatedTitle: request.message,
      timestamp: new Date(),
    });

    this.deps.scheduler.submit({
      runId: run.runId,
      conversationId: request.conversationId,
      owner: "interactive",
      resourceClass: request.resourceClass ?? "general",
    });
    void this.broadcastRunSummary(request.conversationId, "run_queued");

    const response: StartChatRunResponse = {
      conversationId: request.conversationId,
      runId: run.runId,
      status: "queued",
      acceptedAt: new Date().toISOString(),
    };
    this.rememberClientRequest(request.clientRequestId, response);

    // Dispatch immediately when capacity exists.
    this.pump();
    const liveStatus = this.liveRuns.get(request.conversationId)?.status;
    return {
      ok: true,
      response: {
        ...response,
        status: liveStatus === "running" ? "running" : "queued",
      },
    };
  }

  // -------------------------------------------------------------------------
  // Queue-drained turns (Stage A §3.4)
  // -------------------------------------------------------------------------

  /**
   * Execute one drained pending row as a coordinator-owned run (FR-004/005):
   * the drained turn gets a durable run identity, the same scheduler, lease,
   * run context/adapter, and finalization path as a direct send. The queue
   * keeps FIFO/steering/hold policy only and receives the segment outcome
   * through the returned promise — no synthetic run IDs ever reach the
   * workspace detail stream.
   */
  async dispatchQueuedTurn(
    input: AIChatQueueTurnDispatch
  ): Promise<AIChatSegmentOutcome> {
    // A live run or engine turn already owns the conversation (drain raced a
    // direct send): report busy so the queue re-claims the row.
    const engineBusy =
      this.deps.engine.getConversationRuntimeStatus(input.conversationId) !==
      "idle";
    if (this.liveRuns.has(input.conversationId) || engineBusy) {
      return {
        type: "conversation_busy",
        conversationId: input.conversationId,
      };
    }

    const context = await this.resolveConversationContext(
      input.conversationId
    );
    const run = await this.deps.runModule.createRun({
      conversationId: input.conversationId,
      owner: "interactive",
      resourceClass: "general",
    });
    const completion: NonNullable<LiveRunState["completion"]> = {
      resolved: false,
      resolve: () => undefined,
    };
    const settled = new Promise<AIChatSegmentOutcome>((resolve) => {
      completion.resolve = (outcome) => {
        if (completion.resolved) return;
        completion.resolved = true;
        resolve(outcome);
      };
    });
    this.liveRuns.set(input.conversationId, {
      runId: run.runId,
      conversationId: input.conversationId,
      status: "queued",
      workspaceKey: context.workspaceKey,
      cancelRequested: false,
      terminalChunk: null,
      dispatchSettled: false,
      unclassifiedExitSummary: null,
      adapter: new AIChatRunEventAdapter(run.runId, input.conversationId),
      queueDispatch: input,
      completion,
    });
    this.runIndex.set(run.runId, input.conversationId);
    this.liveUnread.set(input.conversationId, context.unread);

    this.deps.scheduler.submit({
      runId: run.runId,
      conversationId: input.conversationId,
      owner: "interactive",
      resourceClass: "general",
    });
    void this.broadcastRunSummary(input.conversationId, "run_queued");
    this.pump();
    return settled;
  }

  // -------------------------------------------------------------------------
  // Resume through the run owner (Stage A §3.5)
  // -------------------------------------------------------------------------

  /** Whether this coordinator owns a live run for the conversation. */
  ownsConversation(conversationId: string): boolean {
    return this.liveRuns.has(conversationId);
  }

  /**
   * Re-enter a paused run through its owner (FR-010/024): the pending action
   * is claimed immediately (idempotently), the run shows queued while it
   * waits for scheduler capacity, the lease is reacquired before any tool or
   * model work, and the continuation's outcome is observed like any other
   * segment — including another pause. Stop while queued for capacity cancels
   * the claim and finalizes cancelled without starting the approved tool.
   */
  async resumeRun(input: {
    readonly conversationId: string;
    readonly runId?: string;
    readonly action:
      | { readonly kind: "permission"; readonly toolId: string }
      | {
          readonly kind: "answer";
          readonly questionId: string;
          readonly answers: AskUserQuestionAnswer[];
        };
  }): Promise<{ ok: boolean; error?: string }> {
    const live = this.liveRuns.get(input.conversationId);
    if (!live) {
      return {
        ok: false,
        error: "No live run owns this conversation.",
      };
    }
    if (input.runId && live.runId !== input.runId) {
      return { ok: false, error: "Run mismatch for the pending action." };
    }

    // Persist the plan answer BEFORE claiming (existing semantics): a failed
    // answer write leaves the pending action intact for a retry.
    if (input.action.kind === "answer") {
      try {
        await new AIChatPlanModule().answerQuestion({
          conversationId: input.conversationId,
          questionId: input.action.questionId,
          answers: input.action.answers,
        });
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const claim =
      input.action.kind === "permission"
        ? this.deps.engine.claimPendingPermission(
            input.conversationId,
            input.action.toolId
          )
        : this.deps.engine.claimPendingQuestion(
            input.conversationId,
            input.action.questionId
          );
    if (claim.status === "already_claimed") {
      return { ok: true }; // idempotent duplicate approval
    }
    if (claim.status === "not_found") {
      return {
        ok: false,
        error: "No pending action for this run (stale or already consumed).",
      };
    }

    live.status = "queued";
    live.resumeClaim = claim;
    live.cancelRequested = false;
    try {
      await this.deps.runModule.transition(live.runId, "queued");
    } catch (err) {
      console.warn(
        "[ai-chat-workspace] resume queued transition failed for run",
        live.runId,
        err
      );
    }
    this.deps.scheduler.submit({
      runId: live.runId,
      conversationId: input.conversationId,
      owner: "interactive",
      resourceClass: "general",
    });
    void this.broadcastRunSummary(input.conversationId, "run_queued");
    this.pump();
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------
  /**
   * Cancel one queued or active run. Idempotent: cancelling a terminal run
   * is a no-op. Queued cancellation removes the entry without starting work;
   * active cancellation asks the engine to abort (its `cancelled` terminal
   * event completes the durable transition).
   */
  async cancelRun(input: {
    conversationId: string;
    runId?: string;
  }): Promise<{ cancelled: boolean }> {
    const conversationId = input.runId
      ? this.runIndex.get(input.runId) ?? input.conversationId
      : input.conversationId;
    const live = this.liveRuns.get(conversationId);
    if (!live) {
      // Queue-owned turn (durable pending queue drained outside the
      // coordinator): no run envelope exists here, but the engine turn is
      // stoppable — its `cancelled` terminal makes the queue hold the
      // remaining rows (FR-14 durable pause).
      const queueStatus =
        this.deps.engine.getConversationRuntimeStatus(conversationId);
      if (
        queueStatus === "running" ||
        queueStatus === "awaiting_permission" ||
        queueStatus === "awaiting_user"
      ) {
        this.deps.engine.stopActiveTurn(conversationId);
        return { cancelled: true };
      }
      return { cancelled: false };
    }

    if (this.deps.scheduler.isQueued(live.runId)) {
      this.deps.scheduler.cancelQueued(live.runId);
      // A claimed resume waiting for capacity is cancelled with its slot:
      // the approved tool never starts (FR-024).
      this.deps.engine.cancelClaimed(conversationId);
      live.resumeClaim = undefined;
      await this.deps.runModule.transition(live.runId, "cancelled");
      this.finalizeAfterTerminal(conversationId, "cancelled");
      this.deps.router.sendDetailEvent(
        live.adapter.wrap({
          eventType: "cancelled",
          conversationId,
          fullContent: "",
        })
      );
      // A cancelled queue-drained turn never dispatched: settle its outcome
      // so the queue stops waiting and holds its rows (FR-023).
      live.completion?.resolve({
        type: "cancelled",
        conversationId,
        assistantMessageId: live.queueDispatch?.assistantMessageId ?? "",
      });
      return { cancelled: true };
    }

    if (this.deps.scheduler.isActive(live.runId)) {
      live.cancelRequested = true;
      this.deps.engine.stopActiveTurn(conversationId);
      return { cancelled: true };
    }

    // Parked (paused) run: dispatch already returned, so the scheduler no
    // longer tracks it. The engine reports awaiting_permission/awaiting_user
    // while a turn is parked on a permission card or plan question. This is
    // the deny-a-permission-prompt / skip-a-question path: the owner
    // finalizes cancelled directly (Stage A §3.5) — a claimed-but-undispatched
    // resume is cancelled without ever starting the approved tool.
    const engineStatus =
      this.deps.engine.getConversationRuntimeStatus(conversationId);
    if (
      engineStatus === "awaiting_permission" ||
      engineStatus === "awaiting_user"
    ) {
      live.cancelRequested = true;
      this.deps.engine.cancelClaimed(conversationId);
      live.resumeClaim = undefined;
      this.deps.engine.stopActiveTurn(conversationId);
      try {
        await this.deps.runModule.transition(live.runId, "cancelled");
      } catch (err) {
        console.warn(
          "[ai-chat-workspace] parked-cancel transition failed for run",
          live.runId,
          err
        );
      }
      this.finalizeAfterTerminal(conversationId, "cancelled");
      this.deps.router.sendDetailEvent(
        live.adapter.wrap({
          eventType: "cancelled",
          conversationId,
          fullContent: "",
        })
      );
      live.completion?.resolve({
        type: "cancelled",
        conversationId,
        assistantMessageId: live.queueDispatch?.assistantMessageId ?? "",
      });
      return { cancelled: true };
    }

    return { cancelled: false };
  }

  // -------------------------------------------------------------------------
  // Selection / sidebar support
  // -------------------------------------------------------------------------

  setSelectedConversation(conversationId: string | null): void {
    this.deps.scheduler.setSelectedConversation(conversationId);
  }

  /** Live runtime lookup for the sidebar projection (design §16.1). */
  getLiveRuntime(conversationId: string): {
    runtimeStatus: ConversationRuntimeStatus;
    activeRunId: string | null;
  } | null {
    const live = this.liveRuns.get(conversationId);
    if (!live) return null;
    return { runtimeStatus: live.status, activeRunId: live.runId };
  }

  /** Track read-marker state so summary events never clear unread wrongly. */
  markReadLive(conversationId: string): void {
    this.liveUnread.set(conversationId, false);
  }

  /** Startup reconciliation (§19.4) — abandoned runs become `interrupted`. */
  async reconcileOnStartup(reason: string): Promise<number> {
    return this.deps.runModule.reconcileInterruptedRuns(reason);
  }

  // -------------------------------------------------------------------------
  // Dispatch + execution
  // -------------------------------------------------------------------------

  private pump(): void {
    this.deps.scheduler.pump((dispatch) => {
      void this.executeDispatch(dispatch.runId, dispatch.conversationId);
    });
  }

  private async executeDispatch(
    runId: string,
    conversationId: string
  ): Promise<void> {
    const live = this.liveRuns.get(conversationId);
    if (!live || live.runId !== runId) {
      // Stale dispatch target (e.g. cancelled between pump and execute, or a
      // claimed resume whose run was finalized by a racing Stop): cancel any
      // orphaned engine claim so a later duplicate approval is rejected
      // instead of silently acknowledged ("already claimed") without running.
      this.deps.engine.cancelClaimed(conversationId);
      this.startRequests.delete(runId);
      this.runIndex.delete(runId);
      this.deps.scheduler.complete(runId);
      return;
    }

    // Same-conversation turn coordination at dispatch time (design §10.3).
    const lease = this.deps.turnCoordinator.tryAcquire({
      conversationId,
      owner: "interactive",
      ownerId: runId,
    });
    if (!lease) {
      // Lease lost: the slot returns with its original enqueue time; a pump
      // lets a now-eligible run take the freed capacity instead of waiting
      // for the next unrelated dispatch.
      this.deps.scheduler.requeue(runId);
      this.pump();
      return;
    }

    // Visible to try AND catch (Stage A §3.4 queue-turn completion).
    const completion = live.completion;
    // Reset per-segment state: a resumed segment reuses this live entry, so
    // the previous park's settled/diagnostic flags must not leak into it.
    live.dispatchSettled = false;
    live.terminalChunk = null;
    live.unclassifiedExitSummary = null;
    try {
      await this.deps.runModule.transition(runId, "running");
      live.status = "running";
      void this.broadcastRunSummary(conversationId, "run_started");

      // Stage A §3.5 (FR-005): the adapter lives in run context so resumed
      // segments continue the same monotonic sequence.
      const adapter = live.adapter;
      const resumeClaim = live.resumeClaim;
      live.resumeClaim = undefined;
      let outcome: AIChatSegmentOutcome;
      try {
        const lifecycle = this.createLifecycleListener(live);
        const eventSink = this.createRunSink(live, adapter);
        // TODO-05 (FR-023): the durable-run gate the engine awaits between
        // its durable message writes and its post-terminal side effects.
        // Terminal→terminal transitions are no-ops under the model's EXPECTED
        // guards, so executeDispatch's own final transition stays safe.
        const onSegmentDurable = (
          gatedConversationId: string,
          terminal: "completed" | "cancelled" | "failed"
        ): Promise<void> =>
          this.deps.runModule
            .transition(runId, terminal, this.terminalPatchFor(live))
            .then(() => undefined)
            .catch((transitionErr: unknown) => {
              console.warn(
                "[ai-chat-workspace] durable-gate transition failed for run",
                runId,
                gatedConversationId,
                transitionErr
              );
              // The engine's message writes are the primary durability; a
              // failed run-row write must not swallow the terminal outcome —
              // executeDispatch retries the transition and records the error.
            });
        if (resumeClaim) {
          // Stage A §3.5 (FR-024): the claimed continuation runs inside the
          // dispatch — lease and capacity are already held at this point —
          // and its outcome is observed, never fire-and-forget.
          outcome = await this.deps.engine.resumeClaimed(resumeClaim, {
            eventSink,
            lifecycle,
            onSegmentDurable,
          });
        } else if (live.queueDispatch) {
          outcome = await this.deps.engine.submitPersistedUserMessage({
            eventSink,
            request: live.queueDispatch.request,
            savedUser: live.queueDispatch.savedUser,
            modelContent: live.queueDispatch.modelContent,
            ...(live.queueDispatch.contentParts !== undefined
              ? { contentParts: live.queueDispatch.contentParts }
              : {}),
            assistantMessageId: live.queueDispatch.assistantMessageId,
            lifecycle,
            ownerNotifiesTerminal: true,
            onSegmentDurable,
          });
        } else {
          outcome = await this.deps.engine.runTurn({
            request: this.buildEngineRequest(live),
            eventSink,
            lifecycle,
            ownerNotifiesTerminal: true,
            onSegmentDurable,
          });
        }
      } catch (err) {
        // FR-022 / AC-17: a segment that ends without a classified outcome
        // (engine threw) is recorded as failed with a diagnostic — never
        // completed. The renderer still learns via a synthesized error event.
        const message = err instanceof Error ? err.message : String(err);
        outcome = {
          type: "failed",
          conversationId,
          assistantMessageId: "",
        };
        if (!live.terminalChunk) {
          live.terminalChunk = {
            eventType: "error",
            conversationId,
            // Renderer-safe text: engine-thrown messages may wrap provider
            // output; every other error path sanitizes via userSafeError.
            errorMessage: userSafeError(err),
          };
        }
        live.unclassifiedExitSummary = message.slice(0, 500);
      }

      // Paused outcomes park the run (FR-009): waiting state comes from the
      // explicit segment outcome, not from a sampled engine status and not
      // from the absence of a terminal event. The lifecycle listener's
      // onAwaiting (FR-021) usually transitioned already — this branch is
      // the safety net for engines that park without a listener.
      if (
        outcome.type === "paused_for_permission" ||
        outcome.type === "paused_for_plan_question"
      ) {
        const parked: ChatRunStatus =
          outcome.type === "paused_for_permission"
            ? "awaiting_permission"
            : "awaiting_user";
        // The lifecycle listener may have transitioned already (FR-021);
        // defeat TS's assignment-based narrowing — the listener runs async
        // relative to this branch.
        // TODO-06: wait for any in-flight lifecycle write before this
        // branch's own transition so durable order matches memory order.
        await (
          (live as { lifecycleTransitions?: Promise<void> })
            .lifecycleTransitions ?? Promise.resolve()
        ).catch(() => undefined);
        const alreadyParked =
          (live.status as ChatRunStatus) === parked;
        live.status = parked;
        live.dispatchSettled = true;
        if (!alreadyParked) {
          try {
            await this.deps.runModule.transition(runId, parked);
          } catch (err) {
            console.warn(
              "[ai-chat-workspace] pause transition failed for run",
              runId,
              err
            );
          }
          void this.broadcastRunSummary(
            conversationId,
            parked === "awaiting_permission"
              ? "permission_required"
              : "user_input_required"
          );
        }
        // Keep the live entry: the parked turn's eventual terminal
        // (permission-grant resume or deny-stop cancel) routes through
        // settleDetachedTerminal. The finally block below still releases
        // the lease and scheduler capacity — the run is parked, not
        // executing. The queue learns the paused outcome now so it holds
        // its remaining rows (FR-009).
        completion?.resolve(outcome);
        return;
      }

      const finalStatus = this.statusForOutcome(outcome);
      const terminal = live.terminalChunk;
      let errorSummary: string | null = null;
      let errorCode: string | undefined;
      if (outcome.type === "failed" && live.unclassifiedExitSummary) {
        errorSummary = live.unclassifiedExitSummary;
        errorCode = "unclassified_segment_exit";
      } else if (outcome.type === "conversation_busy") {
        errorSummary = "Conversation became busy before this run dispatched.";
      } else if (
        terminal?.eventType === "error" &&
        terminal.errorMessage
      ) {
        errorSummary = terminal.errorMessage.slice(0, 500);
      }
      // Persist terminal state BEFORE routing the terminal detail event or
      // the summary hint (design §5.3 persistence-precedes-terminal-hints).
      await this.deps.runModule.transition(runId, finalStatus, {
        errorSummary,
        ...(errorCode ? { errorCode } : {}),
      });
      if (
        (finalStatus === "completed" || finalStatus === "cancelled") &&
        terminal?.fullContent
      ) {
        await this.deps.conversationModule.recordMessagePersisted({
          conversationId,
          isResult: finalStatus === "completed",
          previewText: terminal.fullContent,
          timestamp: new Date(),
        });
      }
      if (terminal) {
        this.deps.router.sendDetailEvent(adapter.wrap(terminal));
      }
      this.finalizeAfterTerminal(conversationId, finalStatus);
      // The queue re-drains/holds only after durable finalization (FR-023).
      completion?.resolve(outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await this.deps.runModule.transition(runId, "failed", {
          errorCode: "execution_error",
          errorSummary: message.slice(0, 500),
        });
      } catch (transitionErr) {
        console.error(
          "[ai-chat-workspace] terminal transition failed for run",
          runId,
          transitionErr
        );
      }
      this.finalizeAfterTerminal(conversationId, "failed");
      completion?.resolve({
        type: "failed",
        conversationId,
        assistantMessageId: live.queueDispatch?.assistantMessageId ?? "",
      });
    } finally {
      // TODO-06: the dispatch holds its lease until the last lifecycle-state
      // write settles — memory and storage agree before capacity frees.
      const pending = (live as { lifecycleTransitions?: Promise<void> })
        .lifecycleTransitions;
      const releaseCapacity = (): void => {
        lease.release();
        this.deps.scheduler.complete(runId);
        this.pump();
      };
      if (pending) {
        void pending.catch(() => undefined).then(releaseCapacity);
      } else {
        releaseCapacity();
      }
    }
  }

  /**
   * Derive the durable run status from the explicit segment outcome only
   * (generator-streaming PRD FR-022). Completion is never inferred from the
   * absence of a terminal event; an unexpected busy outcome (admission race)
   * fails the run honestly rather than reporting success.
   */
  /** Error summary for the durable terminal write (shared with final branch). */
  private terminalPatchFor(live: LiveRunState): {
    errorSummary: string | null;
  } {
    const terminal = live.terminalChunk;
    if (terminal?.eventType === "error" && terminal.errorMessage) {
      return { errorSummary: terminal.errorMessage.slice(0, 500) };
    }
    return { errorSummary: null };
  }

  private statusForOutcome(outcome: AIChatSegmentOutcome): ChatRunStatus {
    switch (outcome.type) {
      case "completed":
      case "cancelled":
      case "failed":
        return outcome.type;
      case "paused_for_permission":
        return "awaiting_permission";
      case "paused_for_plan_question":
        return "awaiting_user";
      case "conversation_busy":
        // The coordinator admitted this run; an engine-side busy outcome
        // means the admission raced another owner's turn — never success.
        return "failed";
    }
  }

  /**
   * Run-owned sink: maps engine events to chunks, wraps them with run
   * identity, routes detail events, and holds terminal chunks until the
   * durable terminal transition commits. Waiting/resume transitions arrive
   * through the lifecycle listener (Stage A §3.2, FR-021) — not by sampling
   * engine status on chunks.
   */
  private createRunSink(
    live: LiveRunState,
    adapter: AIChatRunEventAdapter
  ): AIChatQueryEventSink {
    // Stage A §3.4: queue-drained turns keep their legacy V2-broadcaster
    // emissions (other surfaces still subscribe there) — forwarded from the
    // run sink alongside the workspace detail stream.
    const legacyBroadcaster = live.queueDispatch
      ? AIChatV2EventBroadcaster.getInstance()
      : null;
    const handleChunk = (chunk: ChatV2StreamChunk): void => {
      if (legacyBroadcaster) {
        if (isTerminalChunk(chunk)) {
          legacyBroadcaster.emitStreamComplete(chunk);
        } else {
          legacyBroadcaster.emitStreamChunk(chunk);
        }
      }
      if (isTerminalChunk(chunk)) {
        // Stage A §3.5: every resume continuation runs INSIDE a dispatch, so
        // a terminal arriving while no dispatch is live is a late straggler
        // (e.g. the engine's deny-stop emit racing an owner-finalized
        // cancellation). Drop it with a diagnostic — never apply it.
        if (live.dispatchSettled) {
          console.warn(
            "[ai-chat-workspace] dropping terminal chunk outside a live dispatch",
            { conversationId: live.conversationId, runId: live.runId }
          );
          return;
        }
        live.terminalChunk = chunk; // routed after the durable transition
        return;
      }
      this.deps.router.sendDetailEvent(adapter.wrap(chunk));
    };
    return createChatV2StreamSink({
      sendChunk: handleChunk,
      sendComplete: handleChunk,
    });
  }

  /**
   * Stage A §3.2 (FR-021): explicit lifecycle notifications replace sampled
   * engine status. The engine calls onAwaiting exactly once when it parks
   * the turn and onResumed exactly once when a claimed resume starts
   * executing. Synchronous, non-throwing: persist the durable run
   * transition FIRST, then broadcast the summary hint (FR-023).
   */
  private createLifecycleListener(
    live: LiveRunState
  ): AIChatTurnLifecycleListener {
    // TODO-06 (FR-021): run-owned transition serialization — every waiting/
    // resumed write chains onto the previous one, so a fast pause→resume
    // sequence cannot interleave durable rows, and a failed write surfaces a
    // classified error instead of silently leaving storage "running" while
    // memory says "parked".
    let transitionChain: Promise<void> = Promise.resolve();
    const transitionThenBroadcast = (
      status: ChatRunStatus,
      reason: ConversationSummaryEvent["reason"]
    ): void => {
      transitionChain = transitionChain
        .then(() => this.deps.runModule.transition(live.runId, status))
        .then(() => {
          void this.broadcastRunSummary(live.conversationId, reason);
        })
        .catch((err: unknown) => {
          console.error(
            "[ai-chat-workspace] lifecycle transition FAILED for run",
            live.runId,
            status,
            err
          );
          // Failure is explicit, never silent: mark the in-memory state back
          // to the last durably-known status so the next summary tells the
          // truth (storage is the authority; restart reconciliation fixes
          // the row).
          live.status = "running";
          void this.broadcastRunSummary(live.conversationId, "run_started");
        });
    };
    // Exposed for executeDispatch: the dispatch must not release capacity
    // while a waiting/resumed transition is still in flight (TODO-06).
    (live as { lifecycleTransitions?: Promise<void> }).lifecycleTransitions =
      transitionChain;
    return {
      onAwaiting: (event) => {
        const parked: ChatRunStatus =
          event.kind === "permission"
            ? "awaiting_permission"
            : "awaiting_user";
        if (live.status === parked) return;
        live.status = parked;
        transitionThenBroadcast(
          parked,
          event.kind === "permission"
            ? "permission_required"
            : "user_input_required"
        );
      },
      onResumed: (event) => {
        void event;
        if (live.status === "running") return;
        live.status = "running";
        transitionThenBroadcast("running", "run_started");
      },
    };
  }

  private buildEngineRequest(live: LiveRunState): ChatV2StreamRequest {
    const request = this.startRequests.get(live.runId);
    if (!request) {
      // Should not happen — startRun always registers the payload first.
      return { conversationId: live.conversationId, message: "" };
    }
    return {
      conversationId: request.conversationId,
      message: request.message,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      systemPrompt: request.systemPrompt,
      mode: request.mode,
      showReasoning: request.showReasoning,
      reasoning: request.reasoning,
      toolApprovalMode: request.toolApprovalMode,
      uploadedFiles: request.uploadedFiles,
      generatedImageReferences: request.generatedImageReferences,
    };
  }

  private async resolveConversationContext(
    conversationId: string
  ): Promise<{ workspaceKey: string | null; unread: boolean }> {
    // Two point lookups — building the entire sidebar per send would cost
    // O(all conversations + all runs) on every message.
    try {
      const projection =
        await this.deps.conversationModule.getConversationProjection(
          conversationId
        );
      if (!projection) {
        return { workspaceKey: null, unread: false };
      }
      const workspaceKey =
        await this.deps.conversationModule.getWorkspaceKeyForConversation(
          conversationId
        );
      return {
        workspaceKey: workspaceKey ?? projection.workspaceKey ?? null,
        unread: AIChatConversationModel.isUnread(projection),
      };
    } catch {
      return { workspaceKey: null, unread: false };
    }
  }

  private rememberClientRequest(
    clientRequestId: string,
    response: StartChatRunResponse
  ): void {
    if (this.clientRequestCache.size >= CLIENT_REQUEST_CACHE_MAX) {
      const oldest = this.clientRequestCache.keys().next().value;
      if (oldest !== undefined) this.clientRequestCache.delete(oldest);
    }
    this.clientRequestCache.set(clientRequestId, response);
  }

  private finalizeAfterTerminal(
    conversationId: string,
    status: ChatRunStatus
  ): void {
    const live = this.liveRuns.get(conversationId);
    if (status === "completed") {
      this.liveUnread.set(conversationId, true);
    }
    if (live) {
      this.startRequests.delete(live.runId);
      this.runIndex.delete(live.runId); // bounded lifetime maps
    }
    // Remove the live entry BEFORE broadcasting so the terminal summary
    // reports `idle` (+ unread on completion) instead of a stuck running
    // state (design §8.6).
    this.liveRuns.delete(conversationId);
    // Cross-path terminal notification: the durable pending queue re-drains
    // or holds rows queued behind this (coordinator-run) turn.
    this.deps.onRunTerminal?.(conversationId, status);
    const reason: ConversationSummaryEvent["reason"] =
      status === "completed"
        ? "run_completed"
        : status === "failed"
        ? "run_failed"
        : status === "cancelled"
        ? "run_cancelled"
        : "run_interrupted";
    void this.broadcastRunSummary(conversationId, reason);
  }

  private async broadcastRunSummary(
    conversationId: string,
    reason: ConversationSummaryEvent["reason"]
  ): Promise<void> {
    const live = this.liveRuns.get(conversationId);
    const runtimeStatus: ConversationRuntimeStatus = live
      ? live.status
      : "idle";
    const attention =
      runtimeStatus === "awaiting_permission"
        ? ("permission" as const)
        : runtimeStatus === "awaiting_user"
        ? ("user_input" as const)
        : ("none" as const);
    // A conversation created via the renderer's New-chat button enters the
    // sidebar with an EMPTY title and only learns the projection's generated
    // title (design §8.6) through these broadcasts — nothing else refreshes
    // the store mid-session. Titles are sidebar-visible data (bootstrap sends
    // them too), so this stays within the status-metadata-only contract.
    // The lookup must never block the status broadcast itself.
    let title: string | undefined;
    try {
      const projection =
        await this.deps.conversationModule.getConversationProjection(
          conversationId
        );
      if (projection?.title) {
        title = projection.title;
      }
    } catch (err) {
      console.warn("[ai-chat-workspace] summary title lookup failed:", err);
    }
    this.deps.router.broadcastSummary({
      conversationId,
      workspaceKey: live?.workspaceKey ?? null,
      runtimeStatus,
      attention,
      unread: this.liveUnread.get(conversationId) ?? false,
      lastActivityAt: new Date().toISOString(),
      runId: live?.runId,
      ...(title !== undefined ? { title } : {}),
      reason,
    });
  }
}

function isTerminalChunk(chunk: ChatV2StreamChunk): boolean {
  return (
    chunk.eventType === "complete" ||
    chunk.eventType === "error" ||
    chunk.eventType === "cancelled"
  );
}
