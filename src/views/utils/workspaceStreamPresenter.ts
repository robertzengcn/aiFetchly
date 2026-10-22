import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatV2MessageMetadata } from "@/entityTypes/aiChatV2Types";
import type { ChatV2GeneratedImage } from "@/entityTypes/aiChatV2Types";
import type {
  ChatRunDetailEvent,
  ConversationRuntimeStatus,
} from "@/entityTypes/aiChatWorkspaceTypes";
import { toolFailureReason } from "@/views/components/aiChatWorkspace/toolExecutionProjection";

/**
 * Pure renderer-side presenter that reduces workspace detail events into the
 * selected conversation's message views (technical-design §12–§13).
 *
 * Design constraints implemented here:
 * - Token/reasoning deltas are buffered and flushed at most once per batch
 *   window (default 50 ms) with ONE reactive update per key per flush.
 * - Terminal, permission, question, tool, and error events flush immediately.
 * - Events whose conversation or run no longer match are ignored (stale).
 * - Duplicate sequence numbers per run are ignored.
 * - Buffering never mixes run ids or message ids.
 */

export type WorkspaceStreamStatus =
  | "idle"
  | "streaming"
  | "cancelled"
  | "error";

export interface RecoveryInfo {
  readonly layer: string;
  readonly reason: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly message?: string;
}

/** Transport-retry status (FR-REC-002): attempt/max/bounded delay. */
export interface RetryInfo {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs: number;
}

/** Live goal-loop state tracked from goal_* detail events (PRD §13.3). */
export interface GoalRunInfo {
  readonly goalId: string;
  readonly objective: string;
  readonly status: string;
  readonly iterationCount?: number;
}

export interface WorkspaceStreamState {
  readonly messages: ChatV2MessageView[];
  readonly activeAssistantMessageId: string | null;
  readonly streamStatus: WorkspaceStreamStatus;
  readonly errorMessage: string | null;
  readonly activeRunId: string | null;
  readonly runtimeStatus: ConversationRuntimeStatus;
  readonly recovery: RecoveryInfo | null;
  readonly retry: RetryInfo | null;
  readonly goal: GoalRunInfo | null;
  readonly pendingArtifactOpen: { artifactId: string } | null;
  readonly unflushedDeltaCount: number;
}

interface BufferedDelta {
  runId: string;
  messageId: string;
  channel: "content" | "reasoning";
  text: string;
}

export interface StreamPresenterOptions {
  /** Batch window in ms. Default 50 (PRD §12.3: 40–80 ms). */
  readonly batchMs?: number;
  /** Upper bound of buffered characters before an early flush. */
  readonly maxBufferedChars?: number;
  /** Injected scheduler (tests). Defaults to a 50 ms timer. */
  readonly scheduleFlush?: (fn: () => void, ms: number) => () => void;
  /**
   * Invoked ONLY when visible state actually mutates (flush, tool/plan/goal
   * events, terminal, seed, dispose) — never per buffered token. Lets the
   * store sync one reactive update per flush window (design §13).
   */
  readonly onMutate?: () => void;
  /**
   * Invoked once per engine `start` acknowledgement (FR-HIS-003) with the
   * raw chunk — carries historySelectionAccepted/Changed/RejectedIds so the
   * surface can clear exactly the context chips the backend accepted.
   */
  readonly onStartAck?: (chunk: Record<string, unknown>) => void;
  /**
   * Invoked once per LIVE tool_result chunk (FR-INT-003) — never for
   * seeded/persisted history — after sequence dedupe, so navigation results
   * route exactly once for the selected conversation.
   */
  readonly onLiveToolResult?: (chunk: Record<string, unknown>) => void;
}

const DEFAULT_BATCH_MS = 50;
const DEFAULT_MAX_BUFFERED_CHARS = 8_000;

function defaultScheduleFlush(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
}

/** Extract the chunk payload the coordinator wrapped (ChatV2StreamChunk). */
function chunkOf(event: ChatRunDetailEvent): Record<string, unknown> {
  return event.payload ?? {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Fresh base metadata so `source` stays concrete for the type checker. */
function m0Metadata(): { source: "chat-v2" } {
  return { source: "chat-v2" };
}

/**
 * Rows whose mounted presence is REQUIRED for user action (audit R6-02/03,
 * FR-PER-001..008): permission prompts awaiting a decision and pending
 * plan/question prompts. Identifiable solely from row metadata, so both
 * live rows and reseeded history rows classify identically.
 */
function isAwaitingDecisionRow(row: ChatV2MessageView): boolean {
  const metadata = row.metadata;
  if (!metadata) return false;
  if (metadata.toolResult?.needsPermissionPrompt === true) return true;
  if (metadata.planEventType === "plan_submitted") return true;
  if (metadata.questionView) return true;
  return false;
}

/**
 * Presenter instance — construct one per selected conversation subscription.
 * `dispose()` clears buffers without touching main-process run state.
 */
export function createWorkspaceStreamPresenter(
  options?: StreamPresenterOptions
): {
  /** Snapshot for reactive rendering (replaced immutably on change). */
  getState(): WorkspaceStreamState;
  /** Apply one detail event. Returns true when the event was consumed. */
  applyEvent(event: ChatRunDetailEvent): boolean;
  /** Seed persisted history (selection snapshot / older page prepend). */
  seedHistory(messages: ChatV2MessageView[]): void;
  /**
   * Seed authoritative goal state loaded from the backend (FR-CMD-006 /
   * review C4: live goal_state events alone miss goals created earlier or
   * in previous sessions).
   */
  setGoal(goal: GoalRunInfo | null): void;
  /**
   * Audit R6-01: hydrate the presenter's authoritative runtime facts from
   * ONE runtime snapshot (selection load). Overwrites the default idle
   * projection (status + active run identity) and pins restored
   * actionable rows so window eviction cannot lose them before the run
   * resumes.
   */
  hydrateRuntime(next: {
    runtimeStatus: ConversationRuntimeStatus;
    activeRunId: string | null;
  }): void;
  /** Prepend an older history page, preserving order. */
  prependHistory(messages: ChatV2MessageView[]): void;
  /** Optimistic user message shown while the run request is in flight. */
  appendLocalUserMessage(view: ChatV2MessageView): void;
  /**
   * Remove one row by id (a send accepted into the durable pending queue:
   * the pending bubble replaces the optimistic user row). Returns false
   * when no row with that id exists.
   */
  removeMessage(messageId: string): boolean;
  /**
   * Rewrite one row in place (permission grant/deny local presentation).
   * Returns false when no row with that id exists.
   */
  rewriteMessage(
    messageId: string,
    updater: (view: ChatV2MessageView) => ChatV2MessageView
  ): boolean;
  /** Consume a pending openImmediately artifact auto-open request. */
  consumePendingArtifactOpen(): { artifactId: string } | null;
  /**
   * Evict rows beyond a bounded window without resetting streaming.
   * Audit R4-04: the eviction END is direction-aware — ordinary
   * (streaming) growth keeps the NEWEST rows, while backward history
   * paging must keep the OLDEST rows so the just-requested range survives
   * a full window. The bound itself is never removed.
   */
  trimToWindow(
    maxRows: number,
    options?: { retain?: "oldest" | "newest" }
  ): void;
  /** Immediately flush buffered deltas (terminal path / selection change). */
  flush(): void;
  /** Drop buffers and reset streaming presentation (selection change). */
  dispose(): void;
} {
  const batchMs = options?.batchMs ?? DEFAULT_BATCH_MS;
  const maxBufferedChars =
    options?.maxBufferedChars ?? DEFAULT_MAX_BUFFERED_CHARS;
  const scheduleFlush = options?.scheduleFlush ?? defaultScheduleFlush;
  const notifyMutate = options?.onMutate;
  const startAckSink = options?.onStartAck;
  const liveToolResultSink = options?.onLiveToolResult;

  let messages: ChatV2MessageView[] = [];
  let activeAssistantMessageId: string | null = null;
  let streamStatus: WorkspaceStreamStatus = "idle";
  let errorMessage: string | null = null;
  let activeRunId: string | null = null;
  let runtimeStatus: ConversationRuntimeStatus = "idle";
  let recovery: RecoveryInfo | null = null;
  let retry: RetryInfo | null = null;
  let goal: GoalRunInfo | null = null;
  let pendingArtifactOpen: { artifactId: string } | null = null;

  let conversationId: string | null = null;
  const highestSequence = new Map<string, number>();
  const buffer: BufferedDelta[] = [];
  let cancelFlush: (() => void) | null = null;
  /**
   * Rows of the ACTIVE streaming turn (audit R5-01): the assistant answer
   * row plus the tool/plan rows appended while the run streams. History
   * window eviction must not destroy an in-flight response — later deltas
   * would recreate the row with empty content and lose the streamed
   * prefix. Cleared when the run reaches a terminal state, on seed, and on
   * dispose, so completed rows become ordinary evictable history again.
   */
  const pinnedRowIds = new Set<string>();
  /**
   * Authoritative accumulated text of the ACTIVE turn's delta-bearing rows
   * (audit R6-02/R6-03): content the turn's tokens/reasoning deltas must
   * survive row-state hazards the mounted window alone cannot guarantee.
   * Kept INDEPENDENT of the mounted row set because:
   * - assumption "a row created with `{content: ''`'" — after re-selection
   *   the persisted row is ADOPTED (`saved ` content, audit R6-02), and its
   *   protected status must not depend on the append/dedup early-return
   *   path that previously skipped pin registration;
   * - trimToWindow may evict even pinned rows once the pinned population
   *   alone overflows the bound (audit R6-03) — the NEXT delta must restore
   *   the full `prefix suffix` accumulation instead of recreating an empty
   *   row. Baselines are captured at adoption/creation; cleared per run
   *   terminal, on seed, and on dispose so content accumulation is turn-
   *   scoped and never grows unbounded across turns.
   */
  const activeTurnAccumulator = new Map<
    string,
    { content: string; reasoning: string }
  >();

  const state: WorkspaceStreamState = {
    get messages() {
      return messages;
    },
    get activeAssistantMessageId() {
      return activeAssistantMessageId;
    },
    get streamStatus() {
      return streamStatus;
    },
    get errorMessage() {
      return errorMessage;
    },
    get activeRunId() {
      return activeRunId;
    },
    get runtimeStatus() {
      return runtimeStatus;
    },
    get recovery() {
      return recovery;
    },
    get retry() {
      return retry;
    },
    get goal() {
      return goal;
    },
    get pendingArtifactOpen() {
      return pendingArtifactOpen;
    },
    get unflushedDeltaCount() {
      return buffer.length;
    },
  };

  /**
   * Audit R7-02 overflow definition: a turn's logical content population
   * may legitimately exceed the mounted-window policy (the bound is
   * authoritative). Multi-row work (batched delta flushes, terminal
   * re-materialization of registered rows) must mutate the row set as ONE
   * presentation step, then let the single bound re-establishment decide
   * which rows leave — per-append syncs would instead let each re-mounted
   * row evict its predecessor in a procession and lose the turn's
   * earliest content before the bound even sees the final population.
   */
  let suppressSync = false;

  function updateMessage(
    messageId: string,
    updater: (view: ChatV2MessageView) => ChatV2MessageView
  ): void {
    messages = messages.map((m) => (m.id === messageId ? updater(m) : m));
    if (!suppressSync) notifyMutate?.();
  }

  function appendMessage(
    view: ChatV2MessageView,
    options?: { pin?: boolean; silentSync?: boolean }
  ): void {
    // Idempotent append keyed by message id (duplicate terminal events).
    if (messages.some((m) => m.id === view.id)) return;
    // Active-turn rows (assistant answer, tool/plan cards) survive window
    // eviction while their run streams (audit R5-01). The optimistic user
    // row pins nothing — it is replaced or removed once the send is
    // accepted and must never block eviction of settled history. Pinning
    // is INDEPENDENT of sync suppression (audit R7-02): a batched append
    // still joins the active-turn protection.
    if (options?.pin ?? streamStatus === "streaming") {
      pinnedRowIds.add(view.id);
    }
    messages = [...messages, view];
    if (!options?.silentSync) notifyMutate?.();
  }

  function scheduleBufferedFlush(): void {
    if (cancelFlush) return;
    cancelFlush = scheduleFlush(() => {
      cancelFlush = null;
      flushNow();
    }, batchMs);
  }

  function bufferedCharCount(): number {
    return buffer.reduce((acc, d) => acc + d.text.length, 0);
  }

  function appendDelta(
    messageId: string,
    channel: BufferedDelta["channel"],
    text: string
  ): void {
    const runId = activeRunId ?? "(none)";
    // Audit R6-02/R6-03: every observable token/reasoning delta lands in
    // the turn accumulator the moment it is buffered (not at flush) so the
    // register always holds ALL content observed for this turn, regardless
    // of how the mounted row later suffers (dedupe adoption, eviction,
    // recreation).
    const accumulated = activeTurnAccumulator.get(messageId);
    if (accumulated) {
      if (channel === "content") accumulated.content += text;
      else accumulated.reasoning += text;
    }
    const last = buffer[buffer.length - 1];
    if (
      last &&
      last.messageId === messageId &&
      last.channel === channel &&
      last.runId === runId
    ) {
      buffer[buffer.length - 1] = { ...last, text: last.text + text };
    } else {
      buffer.push({ runId, messageId, channel, text });
    }
    if (bufferedCharCount() >= maxBufferedChars) {
      flushNow();
      return;
    }
    scheduleBufferedFlush();
  }

  /**
   * Audit R6-02/R6-03: re-materialize one evicted row from the turn
   * accumulator. When pruning dropped a registered content-bearing row
   * (the pinned population alone overflowed the bound) the next flush or
   * terminal must present `saved prefix suffix` again — not an empty
   * recreation. The row is re-appended at the tail (its run is still the
   * active one) and re-pinned.
   */
  function materializeFromAccumulator(
    messageId: string,
    options?: { silentSync?: boolean }
  ): void {
    const accumulated = activeTurnAccumulator.get(messageId);
    if (!accumulated) return;
    if (messages.some((m) => m.id === messageId)) return;
    appendMessage(
      {
        id: messageId,
        conversationId: conversationId ?? "",
        role: "assistant",
        content: accumulated.content,
        timestamp: new Date().toISOString(),
        messageType: MessageType.MESSAGE,
        metadata: {
          source: "chat-v2",
          ...(accumulated.reasoning
            ? {
                reasoning: {
                  content: accumulated.reasoning,
                  format: "plain_text" as const,
                  source: "server" as const,
                },
              }
            : {}),
        },
      },
      options?.silentSync ? { silentSync: true } : undefined
    );
  }

  function ensureAssistantView(messageId: string): void {
    const existing = messages.find((m) => m.id === messageId);
    if (existing) {
      activeAssistantMessageId = messageId;
      // Audit R6-02: a hydrated (history-reseeded) active answer row ADOPTS
      // the live view here — earlier code routed adoption through
      // appendMessage whose id-duplicate guard returned BEFORE pin
      // registration, so a resumed answer stayed un-protected and paging
      // destroyed its saved prefix. Pin the adopted row whenever its run
      // is streaming, independently of whether a new row is appended.
      // Idempotent: re-adopting the same row re-adds the same id.
      if (streamStatus === "streaming") {
        pinnedRowIds.add(messageId);
      }
      // Register the adoption baseline ONLY when absent: the first ensure
      // of the turn captures the observable `saved ` content so later
      // flushes keep applying against the full accumulation; repeated
      // ensures mid-turn must not reset the already-accumulated text.
      if (!activeTurnAccumulator.has(messageId)) {
        activeTurnAccumulator.set(messageId, {
          content: existing.content,
          reasoning: existing.metadata?.reasoning?.content ?? "",
        });
      }
      return;
    }
    activeAssistantMessageId = messageId;
    // Audit R7-02: an absent row may still own a SAVED accumulation — the
    // bound-authoritative final eviction pass ("the bound is authoritative;
    // the accumulator still re-materializes the content") deliberately lets
    // content-bearing rows leave the mounted window on the premise that the
    // turn accumulator survives. Recreating an empty row here erases that
    // premise: materialize the evicted row from its existing accumulation
    // first (text AND reasoning), and initialize empty content ONLY for a
    // genuinely new logical message. The accumulator population stays
    // turn-scoped (cleared on seed/dispose/run terminal), so it never grows
    // across turns; within one turn it is bounded by the turn's own
    // message population.
    materializeFromAccumulator(messageId);
    if (!messages.some((m) => m.id === messageId)) {
      // Fresh rows under review never carry prior content.
      activeTurnAccumulator.set(messageId, { content: "", reasoning: "" });
      appendMessage({
        id: messageId,
        conversationId: conversationId ?? "",
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        messageType: MessageType.MESSAGE,
        metadata: { source: "chat-v2" },
      });
    }
  }

  function applyChunk(runId: string, chunk: Record<string, unknown>): void {
    const eventType = str(chunk.eventType);
    const messageId = str(chunk.messageId);
    let bufferedOnly = true; // token/reasoning deltas mutate state at flush
    switch (eventType) {
      case "start": {
        bufferedOnly = false;
        streamStatus = "streaming";
        runtimeStatus = "running";
        errorMessage = null;
        if (messageId) ensureAssistantView(messageId);
        startAckSink?.(chunk);
        break;
      }
      case "token": {
        const delta = str(chunk.contentDelta) ?? "";
        if (delta) {
          // Real response data resolves any in-flight retry/recovery state.
          retry = null;
          recovery = null;
        }
        if (messageId && delta) {
          ensureAssistantView(messageId);
          appendDelta(messageId, "content", delta);
        }
        break;
      }
      case "reasoning_delta": {
        const delta = str(chunk.reasoningDelta) ?? "";
        if (messageId && delta) {
          ensureAssistantView(messageId);
          appendDelta(messageId, "reasoning", delta);
        }
        break;
      }
      case "tool_call": {
        flushNow();
        const toolCallId = str(chunk.toolCallId) ?? "";
        const metadata: ChatV2MessageMetadata = {
          source: "chat-v2",
          toolCallId,
          toolName: str(chunk.toolName),
          toolArguments:
            (chunk.toolArguments as Record<string, unknown> | undefined) ??
            undefined,
        };
        appendMessage({
          id: `tool-call-${toolCallId}`,
          conversationId: conversationId ?? "",
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
          messageType: MessageType.TOOL_CALL,
          metadata,
        });
        break;
      }
      case "tool_progress": {
        const toolCallId = str(chunk.toolCallId);
        if (!toolCallId) break;
        const validPhases = [
          "queued",
          "running",
          "fetching",
          "extracting",
          "finalizing",
        ] as const;
        const phaseValue = str(chunk.phase);
        const progress: NonNullable<ChatV2MessageMetadata["toolProgress"]> = {
          phase: validPhases.includes(
            phaseValue as (typeof validPhases)[number]
          )
            ? (phaseValue as (typeof validPhases)[number])
            : undefined,
          message: str(chunk.progressMessage),
          progress:
            typeof chunk.progressFraction === "number"
              ? chunk.progressFraction
              : null,
          partialCount:
            typeof chunk.partialCount === "number" ? chunk.partialCount : null,
          expectedCount:
            typeof chunk.expectedCount === "number"
              ? chunk.expectedCount
              : null,
          updatedAt:
            typeof chunk.progressTimestamp === "number"
              ? chunk.progressTimestamp
              : Date.now(),
        };
        updateMessage(`tool-call-${toolCallId}`, (m) => ({
          ...m,
          metadata: {
            ...(m.metadata ?? { source: "chat-v2" as const }),
            toolProgress: progress,
          },
        }));
        break;
      }
      case "tool_result": {
        flushNow();
        const toolCallId = str(chunk.toolCallId) ?? "";
        const artifact = chunk.artifact as
          | ChatV2MessageMetadata["artifact"]
          | undefined;
        const toolResult =
          (chunk.toolResult as Record<string, unknown> | undefined) ??
          undefined;
        const failed = toolResult?.success === false;
        const failureReason = failed ? toolFailureReason(toolResult) : undefined;
        const metadata: ChatV2MessageMetadata = {
          ...m0Metadata(),
          toolCallId,
          toolName: str(chunk.toolName),
          toolResult,
          // Mirror the legacy dock's derivation so the transcript
          // projection can classify rows without re-reading toolResult.
          toolResultStatus: failed ? "error" : "success",
          toolResultSummary:
            typeof toolResult?.summary === "string"
              ? toolResult.summary
              : // Steering-skipped tools carry a stable reason code instead
              // of a summary — surface it so the receipt explains the skip.
              typeof toolResult?.reason === "string"
              ? toolResult.reason
              : failureReason,
          success: !failed,
          ...(failureReason ? { error: failureReason } : {}),
          ...(typeof toolResult?.executionTimeMs === "number"
            ? { executionTimeMs: toolResult.executionTimeMs }
            : {}),
          ...(artifact ? { artifact } : {}),
        };
        // Permission-grant resume: the engine re-emits the tool result that
        // previously rendered as a permission prompt, so REPLACE the paused
        // message in place — the id-keyed append would silently drop it.
        const resumeToolId = str(chunk.replacesPermissionPromptForToolId);
        if (resumeToolId) {
          const pausedIdx = messages.findIndex(
            (m) =>
              m.messageType === MessageType.TOOL_RESULT &&
              m.metadata?.toolCallId === resumeToolId
          );
          if (pausedIdx !== -1) {
            const updated = [...messages];
            // REPLACE, not MERGE: the parked row was a permission prompt
            // ("Permission required" error, parked toolResult envelope).
            // Keeping those fields would keep rendering the old state, so
            // the resumed row carries only the fresh event metadata plus
            // the arguments block (which the event never re-sends).
            updated[pausedIdx] = {
              ...updated[pausedIdx],
              content: str(chunk.fullContent) ?? "",
              metadata: {
                ...(updated[pausedIdx].metadata?.toolArguments !== undefined
                  ? {
                      toolArguments:
                        updated[pausedIdx].metadata.toolArguments,
                    }
                  : {}),
                ...metadata,
                // `permissionResumed` is presentation-only: it tells the
                // transcript projection to keep the owning execution group
                // expanded so the just-approved output stays visible instead
                // of auto-collapsing the moment the result completes.
                permissionResumed: true,
              },
            };
            messages = updated;
            notifyMutate?.();
            if (artifact?.openImmediately === true) {
              pendingArtifactOpen = { artifactId: artifact.id };
            }
            break;
          }
        }
        appendMessage({
          id: `tool-result-${toolCallId}`,
          conversationId: conversationId ?? "",
          role: "assistant",
          content: str(chunk.fullContent) ?? "",
          timestamp: new Date().toISOString(),
          messageType: MessageType.TOOL_RESULT,
          metadata,
        });
        // FR-026: openImmediately artifacts auto-open the inspector preview.
        if (artifact?.openImmediately === true) {
          pendingArtifactOpen = { artifactId: artifact.id };
        }
        // FR-INT-003: live tool results reach the owning surface exactly
        // once (sequence-deduped, selected-conversation only, never history).
        liveToolResultSink?.(chunk);
        break;
      }
      case "ask_user_question":
      case "plan_state":
      case "plan_submitted":
      case "plan_approved":
      case "plan_rejected":
      case "plan_changes_requested":
      case "plan_blocked_tool": {
        flushNow();
        // The persisted contract has six planEventType values; a raw
        // plan_state transition carries only the state view.
        const planEventTypes = [
          "ask_user_question",
          "plan_submitted",
          "plan_approved",
          "plan_rejected",
          "plan_changes_requested",
          "plan_blocked_tool",
        ] as const;
        const metadata: ChatV2MessageMetadata = {
          source: "chat-v2",
          ...(planEventTypes.includes(
            eventType as (typeof planEventTypes)[number]
          )
            ? { planEventType: eventType as (typeof planEventTypes)[number] }
            : {}),
          planId: str(chunk.planId),
          questionView: chunk.question as ChatV2MessageMetadata["questionView"],
          planStateView:
            chunk.planState as ChatV2MessageMetadata["planStateView"],
        };
        appendMessage({
          id: `${eventType}-${runId}-${messages.length}`,
          conversationId: conversationId ?? "",
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
          messageType: MessageType.MESSAGE,
          metadata,
        });
        runtimeStatus =
          eventType === "ask_user_question" || eventType === "plan_submitted"
            ? "awaiting_user"
            : runtimeStatus;
        break;
      }
      case "retry_connect": {
        bufferedOnly = false;
        if (
          typeof chunk.retryAttempt === "number" &&
          typeof chunk.retryMaxAttempts === "number"
        ) {
          retry = {
            attempt: chunk.retryAttempt,
            maxAttempts: chunk.retryMaxAttempts,
            delayMs:
              typeof chunk.retryDelayMs === "number" ? chunk.retryDelayMs : 0,
          };
        }
        break;
      }
      case "recovery_status": {
        bufferedOnly = false;
        // The recovery layer supersedes the raw transport-retry line.
        retry = null;
        recovery = {
          layer: str(chunk.recoveryLayer) ?? "",
          reason: str(chunk.recoveryReason) ?? "",
          attempt:
            typeof chunk.recoveryAttempt === "number"
              ? chunk.recoveryAttempt
              : undefined,
          maxAttempts:
            typeof chunk.recoveryMaxAttempts === "number"
              ? chunk.recoveryMaxAttempts
              : undefined,
          message: str(chunk.recoveryMessage),
        };
        break;
      }
      case "usage_update": {
        if (messageId) {
          updateMessage(messageId, (m) => ({
            ...m,
            model: str(chunk.model) ?? m.model,
            tokensUsed:
              typeof chunk.totalTokens === "number"
                ? chunk.totalTokens
                : m.tokensUsed,
          }));
        }
        break;
      }
      case "goal_state": {
        bufferedOnly = false;
        const goalState = chunk.goalState as
          | {
              goalId?: string;
              objective?: string;
              status?: string;
              iterationCount?: number;
            }
          | undefined;
        if (goalState?.goalId) {
          goal = {
            goalId: goalState.goalId,
            objective: goalState.objective ?? goal?.objective ?? "",
            status: goalState.status ?? "running",
            iterationCount: goalState.iterationCount,
          };
        }
        break;
      }
      case "goal_iteration": {
        bufferedOnly = false;
        const iteration = chunk.goalIteration as
          | { iteration?: number; status?: string }
          | undefined;
        if (goal && typeof iteration?.iteration === "number") {
          goal = { ...goal, iterationCount: iteration.iteration };
        }
        break;
      }
      case "attention_cleared": {
        bufferedOnly = false;
        runtimeStatus = "running";
        break;
      }
      case "complete": {
        bufferedOnly = false;
        flushNow();
        const fullContent = str(chunk.fullContent);
        const images: ChatV2GeneratedImage[] | undefined = Array.isArray(
          chunk.images
        )
          ? chunk.images
          : undefined;
        if (messageId) {
          // Audit R5-01: final content is authoritative even when the row
          // is not (currently) mounted — a completion that arrives as the
          // first chunk after a re-selection must materialize the answer
          // instead of silently dropping it.
          if (
            fullContent !== undefined &&
            !messages.some((m) => m.id === messageId)
          ) {
            appendMessage({
              id: messageId,
              conversationId: conversationId ?? "",
              role: "assistant",
              content: fullContent,
              timestamp: new Date().toISOString(),
              messageType: MessageType.MESSAGE,
              metadata: {
                ...m0Metadata(),
                ...(images ? { generatedImages: images } : {}),
              },
            });
          }
          updateMessage(messageId, (m) => ({
            ...m,
            content: fullContent ?? m.content,
            model: str(chunk.model) ?? m.model,
            tokensUsed:
              typeof chunk.totalTokens === "number"
                ? chunk.totalTokens
                : m.tokensUsed,
            ...(images
              ? {
                  metadata: {
                    ...m.metadata,
                    source: m.metadata?.source ?? "chat-v2",
                    generatedImages: images,
                  },
                }
              : {}),
          }));
        }
        streamStatus = "idle";
        runtimeStatus = "idle";
        activeAssistantMessageId = null;
        errorMessage = null;
        retry = null;
        recovery = null;
        // The turn's rows become ordinary evictable history again. Audit
        // R6-02/R6-03: clear the turn accumulation with them — a completion
        // carries the authoritative content, so stale accumulation must
        // never overwrite later-persisted rows on a subsequent turn.
        pinnedRowIds.clear();
        activeTurnAccumulator.clear();
        break;
      }
      case "error": {
        bufferedOnly = false;
        flushNow();
        // Audit R6-02/R6-03: a turn that ended in error with no further
        // fullContent still owes its accumulated rows to the display —
        // materialize evicted registered rows BEFORE the pins/accumulator
        // retire, so paged-back saved text survives cancellation as well.
        // Audit R7-02: the re-materialization mutates the row set as ONE
        // presentation step; the post-loop bound re-establishment decides
        // the survivors (per-append syncs would evict every re-mounted
        // row's predecessor in a procession and lose the earliest content).
        suppressSync = true;
        try {
          for (const registeredId of [...activeTurnAccumulator.keys()]) {
            materializeFromAccumulator(registeredId, { silentSync: true });
          }
        } finally {
          suppressSync = false;
        }
        activeTurnAccumulator.clear();
        streamStatus = "error";
        runtimeStatus = "idle";
        errorMessage = str(chunk.errorMessage) ?? "Unknown error";
        // Stage A §3.3 (FR-006): a required-persistence failure names the
        // affected tool call — mark its card failed ("not run" / "result
        // not saved") instead of leaving it running or completed.
        const persistCode = str(chunk.errorCode);
        const persistToolCallId = str(chunk.toolCallId);
        if (
          (persistCode === "tool_call_persist_failed" ||
            persistCode === "tool_result_persist_failed") &&
          persistToolCallId
        ) {
          updateMessage(`tool-call-${persistToolCallId}`, (m) => ({
            ...m,
            metadata: {
              ...(m.metadata ?? { source: "chat-v2" as const }),
              toolPersistFailure: persistCode,
              toolResultStatus: "error",
            },
          }));
        }
        retry = null;
        pinnedRowIds.clear();
        break;
      }
      case "cancelled": {
        bufferedOnly = false;
        flushNow();
        // Audit R6-02/R6-03: same terminal materialization as the error
        // path — cancelled turns still keep their accumulated text on the
        // display instead of silently dropping the evicted prefix.
        // Audit R7-02: same one-step re-materialization discipline.
        suppressSync = true;
        try {
          for (const registeredId of [...activeTurnAccumulator.keys()]) {
            materializeFromAccumulator(registeredId, { silentSync: true });
          }
        } finally {
          suppressSync = false;
        }
        activeTurnAccumulator.clear();
        streamStatus = "cancelled";
        runtimeStatus = "idle";
        retry = null;
        pinnedRowIds.clear();
        break;
      }
      default:
        // Unknown event types are ignored deterministically.
        break;
    }
    // Every case except a pure token/reasoning buffer append mutated
    // visible state (status fields, rows, or projections).
    if (!bufferedOnly) {
      notifyMutate?.();
    }
  }

  function flushNow(): void {
    if (cancelFlush) {
      cancelFlush();
      cancelFlush = null;
    }
    if (buffer.length === 0) return;
    notifyMutate?.(); // one reactive update per flush window (design §13)
    const pending = buffer.splice(0, buffer.length);
    // One reactive update per message per flush.
    const byMessage = new Map<string, { content: string; reasoning: string }>();
    for (const delta of pending) {
      const entry = byMessage.get(delta.messageId) ?? {
        content: "",
        reasoning: "",
      };
      if (delta.channel === "content") entry.content += delta.text;
      else entry.reasoning += delta.text;
      byMessage.set(delta.messageId, entry);
    }
    // Audit R7-02: the flush mutates the row set as ONE presentation step —
    // per-entry syncs would re-arm the mount bound per re-materialized row
    // and churn the turn's earliest content before the mount bound saw the
    // final population. One sync opens the window (above), one closes it.
    suppressSync = true;
    try {
      for (const [messageId, entry] of byMessage) {
        // Audit R6-02/R6-03: the accumulator is the authoritative content for
        // registered (active-turn) rows. If the row fell out of the mounted
        // window (dedupe adoption hazard, pinned-population overflow), the
        // flush RESTORES the full observed accumulation instead of appending
        // onto a recreated empty row — `saved prefix suffix`, `prefix suffix`
        // etc. survive whichever row-state hazard hit the turn.
        materializeFromAccumulator(messageId, { silentSync: true });
        const accumulated = activeTurnAccumulator.get(messageId);
        updateMessage(messageId, (m) => {
          if (accumulated) {
            // Full cumulative text observed for the turn so far — includes
            // this flush's pending deltas (the accumulator advanced at
            // appendDelta, before the batch window closed).
            return {
              ...m,
              content: entry.content ? accumulated.content : m.content,
              metadata: accumulated.reasoning
                ? {
                    ...(m.metadata ?? { source: "chat-v2" as const }),
                    reasoning: {
                      content: accumulated.reasoning,
                      format: "plain_text" as const,
                      source: "server" as const,
                    },
                  }
                : m.metadata,
            };
          }
          // Unregistered deltas (turn already retired between buffer and
          // flush) keep the legacy incremental presentation.
          const reasoningBefore = m.metadata?.reasoning?.content ?? "";
          return {
            ...m,
            content: entry.content ? m.content + entry.content : m.content,
            metadata: entry.reasoning
              ? {
                  ...(m.metadata ?? { source: "chat-v2" as const }),
                  reasoning: {
                    content: reasoningBefore + entry.reasoning,
                    format: "plain_text" as const,
                    source: "server" as const,
                  },
                }
              : m.metadata,
          };
        });
      }
    } finally {
      suppressSync = false;
    }
    notifyMutate?.();
  }

  return {
    getState: () => state,
    applyEvent(event: ChatRunDetailEvent): boolean {
      // Stale-event rejection (design §18.4): wrong conversation or a run
      // that is not the active compatible run for this view. A brand-new
      // run's OPENING event may take over the view (e.g. the user sent a
      // follow-up message); late content from the previous run cannot.
      if (conversationId !== null && event.conversationId !== conversationId) {
        return false;
      }
      if (activeRunId !== null && event.runId !== activeRunId) {
        const isOpening =
          event.eventType === "start" || event.eventType === "queued";
        if (!isOpening) return false;
        recovery = null;
        errorMessage = null;
      }
      const seen = highestSequence.get(event.runId);
      if (seen !== undefined && event.sequence <= seen) {
        return false; // duplicate or out-of-order
      }
      highestSequence.set(event.runId, event.sequence);
      if (conversationId === null) {
        conversationId = event.conversationId;
      }
      activeRunId = event.runId;
      // Mid-run liveness re-arm (audit R05): after a presentation reset
      // (selection switch away and back) the first NON-terminal chunk for
      // the still-running run proves the turn is live — re-attach the view
      // instead of leaving a falsely idle snapshot on which "a run id
      // appeared while idle" could be misread as a late completion. Opening
      // and terminal events already set the status fields themselves.
      const resumedMidRun =
        event.eventType !== "start" &&
        event.eventType !== "queued" &&
        event.eventType !== "complete" &&
        event.eventType !== "error" &&
        event.eventType !== "cancelled" &&
        streamStatus === "idle";
      if (resumedMidRun) {
        streamStatus = "streaming";
        runtimeStatus = "running";
      }
      applyChunk(event.runId, chunkOf(event));
      if (resumedMidRun) {
        // Buffered token mutations signal on their own flush window; the
        // re-arm itself is visible state and must reach the store now.
        notifyMutate?.();
      }
      return true;
    },
    setGoal(nextGoal: GoalRunInfo | null): void {
      goal = nextGoal;
      notifyMutate?.();
    },
    seedHistory(seeded: ChatV2MessageView[]): void {
      flushNow();
      conversationId = seeded[0]?.conversationId ?? conversationId;
      messages = [...seeded];
      activeAssistantMessageId = null;
      streamStatus = "idle";
      errorMessage = null;
      runtimeStatus = "idle";
      // Seeded history is a fresh authoritative snapshot — a retry banner
      // from the previous live stream must not survive it (review C8).
      retry = null;
      recovery = null;
      // A fresh snapshot re-mounts authoritative rows — the previous (or
      // stale) active-turn pins never apply to it, and the previous turn's
      // accumulation must not inject content into reseeded rows (audit
      // R6-02: the next resume re-registers its baseline from the snapshot).
      pinnedRowIds.clear();
      activeTurnAccumulator.clear();
    },
    prependHistory(older: ChatV2MessageView[]): void {
      flushNow();
      const existingIds = new Set(messages.map((m) => m.id));
      const deduped = older.filter((m) => !existingIds.has(m.id));
      messages = [...deduped, ...messages];
    },
    /** Optimistic user message shown while the run request is in flight. */
    appendLocalUserMessage(view: ChatV2MessageView): void {
      // The prompt row never pins (it is removed/replaced on acceptance and
      // must never block eviction of settled history — audit R5-01 scope).
      appendMessage(view, { pin: false });
    },
    /**
     * Remove one row by id (a send accepted into the durable pending queue:
     * the pending bubble replaces the optimistic user row). Returns false
     * when no row with that id exists.
     */
    removeMessage(messageId: string): boolean {
      const exists = messages.some((m) => m.id === messageId);
      if (exists) {
        flushNow();
        messages = messages.filter((m) => m.id !== messageId);
        // Audit R6-03 hygiene: pin protection never outlives the row.
        pinnedRowIds.delete(messageId);
      }
      return exists;
    },
    /**
     * Rewrite one row in place (permission grant/deny local presentation —
     * design §15.5). Returns false when no row with that id exists, so the
     * caller can distinguish a no-op from an applied rewrite.
     */
    rewriteMessage(
      messageId: string,
      updater: (view: ChatV2MessageView) => ChatV2MessageView
    ): boolean {
      const exists = messages.some((m) => m.id === messageId);
      if (exists) {
        updateMessage(messageId, updater);
      }
      return exists;
    },
    /**
     * Evict rows beyond the bounded window WITHOUT resetting streaming
     * presentation (design §12.2). Evicted rows are reloadable: forward
     * eviction keeps the newest rows (live direction), while backward
     * history paging keeps the OLDEST rows so the just-requested page
     * survives — the newest end is recoverable through the live stream and
     * the selection snapshot (audit R4-04). The row bound is never removed.
     *
     * Audit R6-03: BOTH directions respect the active-turn protection
     * (pinned rows, the streamed assistant answer, rows whose registered
     * accumulator carries content). Eviction order inside a direction:
     *   pass 1 — unprotected rows from the evict end first;
     *   pass 2 — pinned rows that carry neither streamed content nor a
     *            pending decision (compact completed tool/plan rows) —
     *            needed once the pinned population alone overflows the
     *            bound, which would otherwise force an unbounded mount;
     *   pass 3 — remaining protected rows (the bound is authoritative;
     *            accumulated content still survives through the turn
     *            accumulator, so the NEXT delta/terminal re-materializes
     *            the full text).
      * Evicted pin bookkeeping is pruned so protection never lingers on
     * unmounted rows.
     */
    trimToWindow(
      maxRows: number,
      options?: { retain?: "oldest" | "newest" }
    ): void {
      const retain = options?.retain ?? "newest";
      if (messages.length <= maxRows) return;
      const overflow = messages.length - maxRows;
      const protectIds = new Set(pinnedRowIds);
      if (activeAssistantMessageId) protectIds.add(activeAssistantMessageId);
      for (const contentId of activeTurnAccumulator.keys()) {
        protectIds.add(contentId);
      }
      // Protection classes, evaluated once per row per call:
      //   none      — unprotected settled history (evicts first);
      //   pinned    — pinned turn rows that are neither the streamed
      //               answer nor content/action-bearing (completed tool/
      //               plan receipts — compact second);
      //   protected — actionable or content-bearing rows (permission
      //               prompts, pending plan/question rows, the answer the
      //               accumulator protects): evict only after 1+2 and only
      //               actionable ones first;
      //   (final pass evicts ANY remaining row — the bound is authoritative
      //   and the accumulator still preserves content through hazards).
      const classOf = (row: ChatV2MessageView): "none" | "pinned" | "protected" => {
        if (!protectIds.has(row.id)) return "none";
        const isAnswer = row.id === activeAssistantMessageId;
        const contentBearing = activeTurnAccumulator.has(row.id);
        return isAnswer || contentBearing || isAwaitingDecisionRow(row)
          ? "protected"
          : "pinned";
      };
      const isAnswerOrContent = (row: ChatV2MessageView): boolean =>
        row.id === activeAssistantMessageId ||
        activeTurnAccumulator.has(row.id);
      // Evict candidates in direction order (oldest-first for the live
      // direction, newest-first for backward paging).
      const victims: ChatV2MessageView[] =
        retain === "newest" ? [...messages] : [...messages].reverse();
      const dropped = new Set<string>();
      const consider = (
        predicate: (row: ChatV2MessageView) => boolean
      ): void => {
        for (const row of victims) {
          if (dropped.size >= overflow) return;
          if (dropped.has(row.id)) continue;
          if (predicate(row)) dropped.add(row.id);
        }
      };
      consider((row) => classOf(row) === "none");
      if (dropped.size < overflow) {
        consider((row) => classOf(row) === "pinned");
      }
      if (dropped.size < overflow) {
        // Compact actionable yet non-content rows before touching the
        // answer/history content the accumulator protects (audit R6-03:
        // "preserve current response and actionable decisions" – decisions
        // stay reachable while their run streams).
        consider(
          (row) => classOf(row) === "protected" && !isAnswerOrContent(row)
        );
      }
      if (dropped.size < overflow) {
        // Bound is authoritative; the accumulator still re-materializes
        // the content on the next flush/terminal.
        consider(() => true);
      }
      if (dropped.size === 0) return;
      messages = messages.filter((m) => !dropped.has(m.id));
      // Bound/retire pin bookkeeping (audit R6-03): protection never
      // outlives the mounted row it referred to.
      for (const id of dropped) {
        pinnedRowIds.delete(id);
      }
    },
    /**
     * Audit R6-01: hydrate the presenter from ONE authoritative runtime
     * snapshot (the selection snapshot's persisted run facts). Prior
     * behavior stored `runtimeStatus`/`activeRunId` on the store refs and
     * then let `syncFromPresenter()` overwrite them with the presenter's
     * default idle state — returning to a quiet running conversation showed
     * `{ status: 'idle', run: null }` until another engine event repaired
     * the projection. Hydration is idempotent: later synchronizations with
     * a hydrated presenter read the same authoritative state; events that
     * arrive after seeding replay over it with newer facts.
     */
    hydrateRuntime(next: {
      runtimeStatus: ConversationRuntimeStatus;
      activeRunId: string | null;
    }): void {
      runtimeStatus = next.runtimeStatus;
      activeRunId = next.activeRunId ?? activeRunId;
      // Presentation mapping mirror of sendMessage acceptance semantics:
      // a running run presents streaming; queued/waiting/terminal keep the
      // (idle) stream presentation while runtimeStatus carries the state.
      streamStatus = next.runtimeStatus === "running" ? "streaming" : "idle";
      // Audit R6-02: an authoritative waiting/running snapshot must keep
      // its actionable rows protected from the FIRST invocation of window
      // eviction — a quiet engine may never emit the event that would
      // otherwise register them lazily. Pin permission prompts (parked
      // tool results awaiting a decision) and pending plan/question rows;
      // a running run also pins its last persisted assistant answer so a
      // resumed stream adopts (`saved `) content protection immediately.
      // Terminal snapshot states skip registration: their turns are over,
      // rows are ordinary evictable history again, and no terminal event
      // would ever arrive to retire the pins.
      if (
        next.runtimeStatus === "running" ||
        next.runtimeStatus === "queued" ||
        next.runtimeStatus === "awaiting_permission" ||
        next.runtimeStatus === "awaiting_user"
      ) {
        for (const row of messages) {
          if (isAwaitingDecisionRow(row)) {
            pinnedRowIds.add(row.id);
          } else if (
            next.runtimeStatus === "running" &&
            row.role === "assistant" &&
            row.messageType === MessageType.MESSAGE
          ) {
            pinnedRowIds.add(row.id);
          }
        }
      }
      notifyMutate?.();
    },
    flush(): void {
      flushNow();
    },
    /** Consume a pending auto-open request (FR-026). */
    consumePendingArtifactOpen(): { artifactId: string } | null {
      const pending = pendingArtifactOpen;
      pendingArtifactOpen = null;
      return pending;
    },
    dispose(): void {
      if (cancelFlush) {
        cancelFlush();
        cancelFlush = null;
      }
      notifyMutate?.();
      buffer.length = 0;
      highestSequence.clear();
      // Old-conversation rows must never render for the next selection.
      messages = [];
      conversationId = null;
      activeRunId = null;
      activeAssistantMessageId = null;
      pinnedRowIds.clear();
      activeTurnAccumulator.clear();
      // Review C8: transient retry/recovery banners never outlive their run.
      retry = null;
      recovery = null;
      streamStatus = "idle";
      errorMessage = null;
      runtimeStatus = "idle";
      recovery = null;
      goal = null;
      pendingArtifactOpen = null;
    },
  };
}
