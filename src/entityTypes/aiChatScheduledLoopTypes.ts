/**
 * Pure TypeScript types for AI Chat V2 scheduled loops (`/loop <duration>
 * <prompt>`).
 *
 * Shared between main-process services, the renderer, and tests. Must not
 * import Electron, Vue, TypeORM, or services.
 *
 * Source: docs/prd/ai-chat-scheduled-loop-prd.md (§8, §10, §16),
 * docs/prd/ai-chat-scheduled-loop-technical-design.md (§6.1, §8, §18.2, §20).
 */

// ---------------------------------------------------------------------------
// Command classification (parser output)
// ---------------------------------------------------------------------------

/** Result of classifying a `/loop` command. */
export type AiLoopCommand =
  | { readonly type: "none" }
  | { readonly type: "goal_loop"; readonly maxIterations: number | null }
  | {
      readonly type: "scheduled_loop";
      readonly intervalMs: number;
      readonly prompt: string;
      readonly maxRuns: number;
      readonly maxLifetimeMs: number;
    }
  | {
      readonly type: "scheduled_loop_control";
      readonly operation: ScheduledLoopControlOperation;
    }
  | {
      readonly type: "invalid_loop";
      readonly code: ScheduledLoopParseErrorCode;
    };

/** Control operations for `/loop status|pause|resume|stop`. */
export type ScheduledLoopControlOperation =
  | "status"
  | "pause"
  | "resume"
  | "stop";

/** Parser-level error codes (subset of the full error contract). */
export type ScheduledLoopParseErrorCode =
  | "INVALID_LOOP_SYNTAX"
  | "INVALID_INTERVAL"
  | "INVALID_LOOP_LIMIT"
  | "PROMPT_REQUIRED";

/** A parsed duration token such as `5m` or `2h`. */
export interface ParsedDuration {
  readonly value: number;
  readonly unit: "m" | "h";
  readonly milliseconds: number;
}

// ---------------------------------------------------------------------------
// Renderer / API views
// ---------------------------------------------------------------------------

/** Durable lifecycle status of a scheduled loop. `running` is a renderer view
 * derived from an active task-run row, not a persisted schedule status. */
export type ScheduledLoopStatus =
  | "active"
  | "paused"
  | "running"
  | "expired"
  | "failed"
  | "stopped";

/** MVP misfire policy. `run_once` performs at most one catch-up after restart. */
export type ScheduledLoopMisfirePolicy = "skip" | "run_once";

/** MVP overlap policy. `coalesce` merges due occurrences into one pending run. */
export type ScheduledLoopOverlapPolicy = "coalesce";

/** Renderer request to create a scheduled loop. Bounds are pre-validated. */
export interface CreateScheduledLoopRequest {
  readonly conversationId?: string;
  readonly rawCommand: string;
  readonly prompt: string;
  readonly intervalMs: number;
  readonly maxRuns: number;
  readonly maxLifetimeMs: number;
  readonly model?: string;
  /**
   * Read-only built-in tools the user explicitly approved for unattended
   * execution. The backend re-validates each name against the scheduled
   * read-only policy before persisting; dangerous or unknown names are
   * rejected with BLOCKED_BY_POLICY (FR-16).
   */
  readonly allowedTools?: readonly string[];
  /**
   * When true (and allowedTools is non-empty), approved tools auto-run during
   * scheduled occurrences without an interactive prompt. Defaults to false.
   */
  readonly autoApproveTools?: boolean;
}

/** Renderer-safe schedule view (no raw tool output, secrets, or stacks). */
export interface ScheduledLoopView {
  readonly scheduleId: number;
  readonly taskId: number;
  readonly conversationId: string;
  readonly prompt: string;
  readonly status: ScheduledLoopStatus;
  readonly intervalMs: number;
  readonly maxRuns: number;
  readonly claimedRuns: number;
  readonly successfulRuns: number;
  readonly consecutiveFailures: number;
  readonly nextRunAt?: string;
  readonly expiresAt: string;
  readonly latestRunId?: number;
  readonly latestErrorCode?: string;
}

/** Response returned after creating a scheduled loop. */
export interface CreateScheduledLoopResponse {
  readonly conversationId: string;
  readonly commandMessageId: string;
  readonly resultMessageId: string;
  readonly loop: ScheduledLoopView;
}

/** Renderer request for a control operation. Only the conversation ID is
 * trusted; the backend resolves the one active chat-created schedule. */
export interface ScheduledLoopControlRequest {
  readonly conversationId: string;
  readonly operation: ScheduledLoopControlOperation;
}

/** Renderer request to stop the currently-running occurrence only. */
export interface StopScheduledLoopRunRequest {
  readonly conversationId: string;
}

// ---------------------------------------------------------------------------
// Conversation update broadcast (refresh hint only)
// ---------------------------------------------------------------------------

/** Narrow event broadcast after durable persistence of a scheduled turn.
 * Contains identifiers only — never prompt text, assistant content, tool
 * output, or secrets. The renderer reloads authoritative data. */
export interface ChatV2ConversationUpdatedEvent {
  readonly conversationId: string;
  readonly reason:
    | "scheduled_turn_completed"
    | "scheduled_turn_failed"
    | "scheduled_loop_state_changed";
  readonly scheduleId: number;
  readonly runId?: number;
  readonly userMessageId?: string;
  readonly assistantMessageId?: string;
  readonly occurredAt: string;
}

/**
 * Live scheduled-turn stream chunk broadcast to the renderer viewing the
 * originating conversation (technical-design §13.2, strict routing by
 * conversation + run id). The renderer appends these to an optimistic
 * assistant bubble only while that conversation is active and no interactive
 * stream is running; the persisted row (reloaded on the terminal
 * conversation-updated event) is always authoritative.
 */
export interface ChatV2ScheduledStreamEvent {
  readonly conversationId: string;
  readonly runId: number;
  readonly messageId: string;
  readonly kind: "token" | "done" | "error";
  readonly contentDelta?: string;
  readonly errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Error contract (stable machine-readable codes)
// ---------------------------------------------------------------------------

/** Stable error codes used by logs, APIs, and persisted run rows. User-facing
 * messages are localized separately at presentation time. */
export type ScheduledLoopErrorCode =
  | "INVALID_LOOP_SYNTAX"
  | "INVALID_INTERVAL"
  | "INVALID_LOOP_LIMIT"
  | "PROMPT_REQUIRED"
  | "LOOP_ALREADY_ACTIVE"
  | "CONVERSATION_REQUIRED"
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_MISMATCH"
  | "CONVERSATION_BUSY"
  | "AI_DISABLED"
  | "WORKSPACE_UNAVAILABLE"
  | "BLOCKED_BY_POLICY"
  | "RUN_TIMEOUT"
  | "REPEATED_RUN_FAILURE"
  | "SCHEDULE_EXPIRED"
  | "MAX_RUNS_REACHED"
  | "RUN_INTERRUPTED";

// ---------------------------------------------------------------------------
// Trusted scheduled turn context (technical-design §14.1)
// ---------------------------------------------------------------------------

/**
 * Trusted main-process turn context for a scheduled occurrence, supplied only
 * by main-process code (the runner) — never renderer input. Carries the stable
 * user/assistant message IDs and bounded identifiers the engine uses to persist
 * the scheduled turn idempotently. Because the renderer cannot forge this
 * object, it cannot forge schedule/run ownership metadata.
 */
export interface AIChatScheduledTurnContext {
  readonly source: "scheduled_loop";
  readonly taskId: number;
  readonly scheduleId: number;
  readonly runId: number;
  readonly occurrence: number;
  readonly scheduledFor: string;
  readonly catchUp: boolean;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
}

// ---------------------------------------------------------------------------
// Model-layer records (technical-design §10)
// ---------------------------------------------------------------------------

/** Input used to persistently create an interval schedule. */
export interface CreateIntervalScheduleRecord {
  readonly name: string;
  readonly taskId: number;
  readonly conversationId: string;
  readonly intervalMs: number;
  readonly anchorAt: Date;
  readonly nextRunAt: Date;
  readonly maxExecutionCount: number;
  readonly expiresAt: Date;
  readonly misfirePolicy: ScheduledLoopMisfirePolicy;
  readonly overlapPolicy: ScheduledLoopOverlapPolicy;
}

/** Input used to persistently create a chat-bound scheduled AI message task. */
export interface CreateChatScheduledTaskRecord {
  readonly name: string;
  readonly message: string;
  readonly conversationId: string;
  readonly model?: string;
  readonly allowedTools: readonly string[];
  readonly autoApproveTools: boolean;
  readonly maxToolCalls: number;
  readonly maxRuntimeMs: number;
  readonly maxContinueCalls: number;
  readonly sourceType: "chat_scheduled_loop";
}

/** Input for atomically claiming a due interval occurrence. */
export interface ClaimOccurrenceInput {
  readonly scheduleId: number;
  readonly now: Date;
}

/** Result of claiming a due interval occurrence. */
export type ClaimOccurrenceResult =
  | {
      readonly kind: "claimed";
      readonly runId: number;
      readonly occurrence: number;
      readonly catchUp: boolean;
      readonly idempotencyKey: string;
      readonly scheduledFor: Date;
      readonly coalescedCount: number;
    }
  | { readonly kind: "coalesced"; readonly coalescedCount: number }
  | { readonly kind: "not_due" }
  | {
      readonly kind: "expired";
      readonly reason: "SCHEDULE_EXPIRED" | "MAX_RUNS_REACHED";
    }
  | { readonly kind: "not_claimable"; readonly reason: string };

/** Input for updating schedule counters after a run result. */
export interface IntervalResultUpdate {
  readonly scheduleId: number;
  readonly success: boolean;
  readonly nextRunAt: Date;
  readonly terminalReason?: string;
  readonly terminalStatus?: "expired" | "failed" | "stopped";
  readonly coalescedDelta?: number;
}

/** Input for persistently creating a scheduled-loop occurrence run row. */
export interface CreateOccurrenceRecord {
  readonly taskId: number;
  readonly scheduleId: number;
  readonly conversationId: string;
  readonly occurrence: number;
  readonly scheduledFor: Date;
  readonly catchUp: boolean;
  readonly idempotencyKey: string;
}
