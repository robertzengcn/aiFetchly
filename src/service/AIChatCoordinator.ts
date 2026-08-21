import { AIChatEventRouter } from "@/service/AIChatEventRouter";
import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";
import { AIChatRunEventAdapter } from "@/service/AIChatRunEventAdapter";
import { createChatV2StreamSink } from "@/service/aiChatV2StreamSink";
import { AIChatConversationTurnCoordinator } from "@/service/AIChatConversationTurnCoordinator";
import type { AIChatQuerySubmitInput } from "@/service/AIChatQueryEngine";
import type { AIChatQueryEventSink } from "@/service/AIChatQueryEvents";
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
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
  submitMessage(input: AIChatQuerySubmitInput): Promise<void>;
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
}

interface LiveRunState {
  readonly runId: string;
  readonly conversationId: string;
  status: ChatRunStatus;
  readonly workspaceKey: string | null;
  cancelRequested: boolean;
  terminalChunk: ChatV2StreamChunk | null;
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

    const run = await this.deps.runModule.createRun({
      conversationId: request.conversationId,
      owner: "interactive",
      resourceClass: request.resourceClass ?? "general",
    });

    // Attachment normalization is shared with the legacy stream path so both
    // surfaces enforce identical bounds (mime allowlist, image byte caps).
    const uploadedFiles: ChatV2UploadedAttachment[] | undefined = request
      .uploadedFiles
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
    this.broadcastRunSummary(request.conversationId, "run_queued");

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
    if (!live) return { cancelled: false };

    if (this.deps.scheduler.isQueued(live.runId)) {
      this.deps.scheduler.cancelQueued(live.runId);
      await this.deps.runModule.transition(live.runId, "cancelled");
      this.finalizeAfterTerminal(conversationId, "cancelled");
      return { cancelled: true };
    }

    if (this.deps.scheduler.isActive(live.runId)) {
      live.cancelRequested = true;
      this.deps.engine.stopActiveTurn(conversationId);
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
      // Stale dispatch target (e.g. cancelled between pump and execute).
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
      this.deps.scheduler.requeue(runId);
      return;
    }

    try {
      await this.deps.runModule.transition(runId, "running");
      live.status = "running";
      this.broadcastRunSummary(conversationId, "run_started");

      const adapter = new AIChatRunEventAdapter(runId, conversationId);
      await this.deps.engine.submitMessage({
        request: this.buildEngineRequest(live),
        eventSink: this.createRunSink(live, adapter),
      });

      const terminal = live.terminalChunk;
      let finalStatus: ChatRunStatus = live.cancelRequested
        ? "cancelled"
        : "completed";
      let errorSummary: string | null = null;
      if (terminal) {
        const hint = AIChatRunEventAdapter.statusHintFor(terminal.eventType);
        if (hint) finalStatus = hint;
        if (terminal.eventType === "error" && terminal.errorMessage) {
          errorSummary = terminal.errorMessage.slice(0, 500);
        }
      }
      // Persist terminal state BEFORE routing the terminal detail event or
      // the summary hint (design §5.3 persistence-precedes-terminal-hints).
      await this.deps.runModule.transition(runId, finalStatus, {
        errorSummary,
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
    } finally {
      lease.release();
      this.deps.scheduler.complete(runId);
      this.pump();
    }
  }

  /**
   * Run-owned sink: maps engine events to chunks, wraps them with run
   * identity, routes detail events, and samples engine runtime status on
   * non-token chunks to observe permission/question pauses (which the engine
   * exposes as state, not sink events).
   */
  private createRunSink(
    live: LiveRunState,
    adapter: AIChatRunEventAdapter
  ): AIChatQueryEventSink {
    const handleChunk = (chunk: ChatV2StreamChunk): void => {
      if (isTerminalChunk(chunk)) {
        live.terminalChunk = chunk; // routed after the durable transition
        return;
      }
      this.deps.router.sendDetailEvent(adapter.wrap(chunk));
      this.sampleEngineStatus(live);
    };
    return createChatV2StreamSink({
      sendChunk: handleChunk,
      sendComplete: handleChunk,
    });
  }

  /** Detect awaiting/resume transitions the engine exposes as state. */
  private sampleEngineStatus(live: LiveRunState): void {
    const mapped = mapEngineStatus(
      this.deps.engine.getConversationRuntimeStatus(live.conversationId)
    );
    if (!mapped || mapped === live.status) return;
    live.status = mapped;
    const reason: ConversationSummaryEvent["reason"] =
      mapped === "awaiting_permission"
        ? "permission_required"
        : mapped === "awaiting_user"
        ? "user_input_required"
        : "run_started";
    void this.deps.runModule
      .transition(live.runId, mapped)
      .catch((err) =>
        console.warn("[ai-chat-workspace] waiting transition failed:", err)
      );
    this.broadcastRunSummary(live.conversationId, reason);
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
    };
  }

  private async resolveConversationContext(
    conversationId: string
  ): Promise<{ workspaceKey: string | null; unread: boolean }> {
    try {
      const sidebar = await this.deps.conversationModule.getWorkspaceSidebar(
        () => null,
        conversationId
      );
      const all = [
        ...sidebar.unassigned,
        ...sidebar.workspaces.flatMap((w) => w.conversations),
      ];
      const row = all.find((c) => c.conversationId === conversationId);
      return {
        workspaceKey: row?.workspaceKey ?? null,
        unread: row?.unread ?? false,
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
    }
    // Remove the live entry BEFORE broadcasting so the terminal summary
    // reports `idle` (+ unread on completion) instead of a stuck running
    // state (design §8.6).
    this.liveRuns.delete(conversationId);
    const reason: ConversationSummaryEvent["reason"] =
      status === "completed"
        ? "run_completed"
        : status === "failed"
        ? "run_failed"
        : status === "cancelled"
        ? "run_cancelled"
        : "run_interrupted";
    this.broadcastRunSummary(conversationId, reason);
  }

  private broadcastRunSummary(
    conversationId: string,
    reason: ConversationSummaryEvent["reason"]
  ): void {
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
    this.deps.router.broadcastSummary({
      conversationId,
      workspaceKey: live?.workspaceKey ?? null,
      runtimeStatus,
      attention,
      unread: this.liveUnread.get(conversationId) ?? false,
      lastActivityAt: new Date().toISOString(),
      runId: live?.runId,
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

function mapEngineStatus(status: ChatV2RuntimeStatus): ChatRunStatus | null {
  switch (status) {
    case "running":
      return "running";
    case "awaiting_permission":
      return "awaiting_permission";
    case "awaiting_user":
      return "awaiting_user";
    default:
      return null;
  }
}
