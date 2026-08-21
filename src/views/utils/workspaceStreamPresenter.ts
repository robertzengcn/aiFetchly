import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatV2MessageMetadata } from "@/entityTypes/aiChatV2Types";
import type {
  ChatRunDetailEvent,
  ConversationRuntimeStatus,
} from "@/entityTypes/aiChatWorkspaceTypes";

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
  /** Prepend an older history page, preserving order. */
  prependHistory(messages: ChatV2MessageView[]): void;
  /** Optimistic user message shown while the run request is in flight. */
  appendLocalUserMessage(view: ChatV2MessageView): void;
  /** Consume a pending openImmediately artifact auto-open request. */
  consumePendingArtifactOpen(): { artifactId: string } | null;
  /** Evict oldest rows beyond a bounded window without resetting streaming. */
  trimToWindow(maxRows: number): void;
  /** Immediately flush buffered deltas (terminal path / selection change). */
  flush(): void;
  /** Drop buffers and reset streaming presentation (selection change). */
  dispose(): void;
} {
  const batchMs = options?.batchMs ?? DEFAULT_BATCH_MS;
  const maxBufferedChars =
    options?.maxBufferedChars ?? DEFAULT_MAX_BUFFERED_CHARS;
  const scheduleFlush = options?.scheduleFlush ?? defaultScheduleFlush;

  let messages: ChatV2MessageView[] = [];
  let activeAssistantMessageId: string | null = null;
  let streamStatus: WorkspaceStreamStatus = "idle";
  let errorMessage: string | null = null;
  let activeRunId: string | null = null;
  let runtimeStatus: ConversationRuntimeStatus = "idle";
  let recovery: RecoveryInfo | null = null;
  let goal: GoalRunInfo | null = null;
  let pendingArtifactOpen: { artifactId: string } | null = null;

  let conversationId: string | null = null;
  const highestSequence = new Map<string, number>();
  const buffer: BufferedDelta[] = [];
  let cancelFlush: (() => void) | null = null;

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

  function updateMessage(
    messageId: string,
    updater: (view: ChatV2MessageView) => ChatV2MessageView
  ): void {
    messages = messages.map((m) => (m.id === messageId ? updater(m) : m));
  }

  function appendMessage(view: ChatV2MessageView): void {
    // Idempotent append keyed by message id (duplicate terminal events).
    if (messages.some((m) => m.id === view.id)) return;
    messages = [...messages, view];
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

  function ensureAssistantView(messageId: string): void {
    if (
      activeAssistantMessageId === messageId &&
      messages.some((m) => m.id === messageId)
    ) {
      return;
    }
    activeAssistantMessageId = messageId;
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

  function applyChunk(runId: string, chunk: Record<string, unknown>): void {
    const eventType = str(chunk.eventType);
    const messageId = str(chunk.messageId);
    switch (eventType) {
      case "start": {
        streamStatus = "streaming";
        runtimeStatus = "running";
        errorMessage = null;
        if (messageId) ensureAssistantView(messageId);
        break;
      }
      case "token": {
        const delta = str(chunk.contentDelta) ?? "";
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
        appendMessage({
          id: `tool-result-${toolCallId}`,
          conversationId: conversationId ?? "",
          role: "assistant",
          content: str(chunk.fullContent) ?? "",
          timestamp: new Date().toISOString(),
          messageType: MessageType.TOOL_RESULT,
          metadata: {
            ...(m0Metadata()),
            toolCallId,
            toolName: str(chunk.toolName),
            toolResult:
              (chunk.toolResult as Record<string, unknown> | undefined) ??
              undefined,
            ...(artifact ? { artifact } : {}),
          },
        });
        // FR-026: openImmediately artifacts auto-open the inspector preview.
        if (artifact?.openImmediately === true) {
          pendingArtifactOpen = { artifactId: artifact.id };
        }
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
      case "recovery_status": {
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
        const goalState = chunk.goalState as
          | { goalId?: string; objective?: string; status?: string; iterationCount?: number }
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
        const iteration = chunk.goalIteration as
          | { iteration?: number; status?: string }
          | undefined;
        if (goal && typeof iteration?.iteration === "number") {
          goal = { ...goal, iterationCount: iteration.iteration };
        }
        break;
      }
      case "attention_cleared": {
        runtimeStatus = "running";
        break;
      }
      case "complete": {
        flushNow();
        const fullContent = str(chunk.fullContent);
        if (messageId) {
          updateMessage(messageId, (m) => ({
            ...m,
            content: fullContent ?? m.content,
            model: str(chunk.model) ?? m.model,
            tokensUsed:
              typeof chunk.totalTokens === "number"
                ? chunk.totalTokens
                : m.tokensUsed,
          }));
        }
        streamStatus = "idle";
        runtimeStatus = "idle";
        activeAssistantMessageId = null;
        errorMessage = null;
        break;
      }
      case "error": {
        flushNow();
        streamStatus = "error";
        runtimeStatus = "idle";
        errorMessage = str(chunk.errorMessage) ?? "Unknown error";
        break;
      }
      case "cancelled": {
        flushNow();
        streamStatus = "cancelled";
        runtimeStatus = "idle";
        break;
      }
      default:
        // Unknown event types are ignored deterministically.
        break;
    }
  }

  function flushNow(): void {
    if (cancelFlush) {
      cancelFlush();
      cancelFlush = null;
    }
    if (buffer.length === 0) return;
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
    for (const [messageId, entry] of byMessage) {
      updateMessage(messageId, (m) => {
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
      applyChunk(event.runId, chunkOf(event));
      return true;
    },
    seedHistory(seeded: ChatV2MessageView[]): void {
      flushNow();
      conversationId = seeded[0]?.conversationId ?? conversationId;
      messages = [...seeded];
      activeAssistantMessageId = null;
      streamStatus = "idle";
      errorMessage = null;
      runtimeStatus = "idle";
    },
    prependHistory(older: ChatV2MessageView[]): void {
      flushNow();
      const existingIds = new Set(messages.map((m) => m.id));
      const deduped = older.filter((m) => !existingIds.has(m.id));
      messages = [...deduped, ...messages];
    },
    /** Optimistic user message shown while the run request is in flight. */
    appendLocalUserMessage(view: ChatV2MessageView): void {
      appendMessage(view);
    },
    /**
     * Evict the oldest rows beyond the bounded window WITHOUT resetting
     * streaming presentation (design §12.2). Evicted rows are reloadable
     * through the history cursor.
     */
    trimToWindow(maxRows: number): void {
      if (messages.length <= maxRows) return;
      messages = messages.slice(messages.length - maxRows);
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
      buffer.length = 0;
      highestSequence.clear();
      // Old-conversation rows must never render for the next selection.
      messages = [];
      conversationId = null;
      activeRunId = null;
      activeAssistantMessageId = null;
      streamStatus = "idle";
      errorMessage = null;
      runtimeStatus = "idle";
      recovery = null;
      goal = null;
      pendingArtifactOpen = null;
    },
  };
}
