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
  | { readonly type: "invalid_loop"; readonly code: ScheduledLoopParseErrorCode };

/** Control operations for `/loop status|pause|resume|stop`. */
export type ScheduledLoopControlOperation = "status" | "pause" | "resume" | "stop";

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
