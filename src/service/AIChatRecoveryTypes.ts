// src/service/AIChatRecoveryTypes.ts
//
// Type system for the AI Chat V2 seven-layer recovery strategy.
// See docs/prd/ai-chat-seven-layer-recovery-strategy.md and
// docs/prd/ai-chat-seven-layer-recovery-technical-design.md.
//
// This file MUST stay dependency-free of AiChatApi, AIChatQueryLoop, IPC,
// Vue, and any code that imports them. It contains only types, constants,
// the AIChatRecoverableError class, and small pure helpers. This prevents
// circular imports (technical-design §20.1).

/**
 * The seven recovery layers, ordered from lowest (transport) to highest
 * (unattended persistent retry). Used as the discriminator on recovery
 * status events and persisted metadata.
 */
export type AIChatRecoveryLayer =
  | "api_retry"
  | "overload_retry"
  | "output_token_recovery"
  | "reactive_compact"
  | "context_collapse_drain"
  | "model_fallback"
  | "persistent_retry";

/**
 * Classified recovery reason. Drives retryability decisions in
 * AIChatRetryPolicy and layer selection in AIChatRecoveryCoordinator.
 */
export type AIChatRecoveryReason =
  | "network"
  | "timeout"
  | "rate_limit"
  | "overload"
  | "server_error"
  | "output_limit"
  | "context_overflow"
  | "media_overflow"
  | "model_unavailable"
  | "auth"
  | "quota"
  | "cancelled"
  | "non_recoverable";

/** Reasons that must never be retried. */
export const NON_RETRYABLE_REASONS: ReadonlySet<AIChatRecoveryReason> =
  new Set<AIChatRecoveryReason>([
    "auth",
    "quota",
    "cancelled",
    "non_recoverable",
  ]);

/** Returns true when a reason is ever retryable. */
export function isRetryableReason(
  reason: AIChatRecoveryReason
): boolean {
  return !NON_RETRYABLE_REASONS.has(reason);
}

/** Constructor input for AIChatRecoverableError. */
export interface AIChatRecoverableErrorDetails {
  readonly reason: AIChatRecoveryReason;
  readonly message: string;
  readonly status?: number;
  /** Parsed Retry-After header value in milliseconds, when present. */
  readonly retryAfterMs?: number;
  /** Parsed provider rate-limit reset header in milliseconds, when present. */
  readonly rateLimitResetMs?: number;
  /** Truncated response body text (max ~8KB) for classification context. */
  readonly responseBody?: string;
  /** Lowercased header map snapshot, when available. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Original thrown value, when this error was created from a catch. */
  readonly originalError?: unknown;
}

/**
 * Typed error thrown by the API layer when a recoverable failure has been
 * classified, and by the loop/coordinator when surfacing a classified
 * failure upward. Replaces ad-hoc `new Error("Server returned 502")`
 * patterns at recovery boundaries.
 */
export class AIChatRecoverableError extends Error {
  readonly reason: AIChatRecoveryReason;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly rateLimitResetMs?: number;
  readonly responseBody?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly originalError?: unknown;

  constructor(details: AIChatRecoverableErrorDetails) {
    super(details.message);
    this.name = "AIChatRecoverableError";
    this.reason = details.reason;
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
    this.rateLimitResetMs = details.rateLimitResetMs;
    this.responseBody = details.responseBody;
    this.headers = details.headers;
    this.originalError = details.originalError;
    // Restore prototype chain across transpile targets.
    Object.setPrototypeOf(this, AIChatRecoverableError.prototype);
  }
}

/** True when the given value is an AIChatRecoverableError instance. */
export function isAIChatRecoverableError(
  value: unknown
): value is AIChatRecoverableError {
  return (
    value instanceof AIChatRecoverableError &&
    value.name === "AIChatRecoverableError"
  );
}

/** A single recorded recovery attempt within a turn. */
export interface AIChatRecoveryAttemptRecord {
  readonly layer: AIChatRecoveryLayer;
  readonly reason: AIChatRecoveryReason;
  readonly attempt: number;
  readonly delayMs?: number;
  readonly model?: string;
  readonly at: number;
}

/**
 * Per-turn mutable recovery state. Created at the start of a turn by
 * createRecoveryAttemptState() and mutated by the recovery coordinator
 * and the loop. Cleared at terminal complete/cancelled/error.
 */
export interface AIChatRecoveryAttemptState {
  readonly turnStartedAt: number;
  originalModel?: string;
  currentModel?: string;
  maxTokensOverride?: number;
  outputEscalationAttempted: boolean;
  outputContinuationCount: number;
  reactiveCompactAttempted: boolean;
  contextDrainAttempted: boolean;
  consecutiveOverloadCount: number;
  persistentStartedAt?: number;
  sideEffectBoundaryCrossed: boolean;
  records: AIChatRecoveryAttemptRecord[];
}

/** Factory that creates a fresh per-turn recovery state. */
export function createRecoveryAttemptState(
  model?: string
): AIChatRecoveryAttemptState {
  return {
    turnStartedAt: Date.now(),
    originalModel: model,
    currentModel: model,
    outputEscalationAttempted: false,
    outputContinuationCount: 0,
    reactiveCompactAttempted: false,
    contextDrainAttempted: false,
    consecutiveOverloadCount: 0,
    sideEffectBoundaryCrossed: false,
    records: [],
  };
}

/**
 * Append an attempt record to a state and return the updated state.
 * Immutable-friendly: returns a new state object with an extended records
 * array, leaving the original state's array untouched.
 */
export function recordRecoveryAttempt(
  state: AIChatRecoveryAttemptState,
  record: Omit<AIChatRecoveryAttemptRecord, "at"> & { at?: number }
): AIChatRecoveryAttemptState {
  const full: AIChatRecoveryAttemptRecord = {
    at: record.at ?? Date.now(),
    layer: record.layer,
    reason: record.reason,
    attempt: record.attempt,
    delayMs: record.delayMs,
    model: record.model,
  };
  return {
    ...state,
    records: [...state.records, full],
  };
}

/** Fields persisted on the final assistant message row. */
export interface ChatV2RecoveryMetadata {
  layersUsed: AIChatRecoveryLayer[];
  attempts: number;
  originalModel?: string;
  finalModel?: string;
  outputEscalated?: boolean;
  outputContinuationCount?: number;
  contextCompacted?: boolean;
  contextDrained?: boolean;
  fallbackModel?: string;
}

/** Build a ChatV2RecoveryMetadata snapshot from a terminal state. */
export function buildRecoveryMetadata(
  state: AIChatRecoveryAttemptState
): ChatV2RecoveryMetadata {
  const layers = new Set<AIChatRecoveryAttemptRecord["layer"]>();
  for (const r of state.records) {
    layers.add(r.layer);
  }
  return {
    layersUsed: Array.from(layers),
    attempts: state.records.length,
    originalModel: state.originalModel,
    finalModel: state.currentModel,
    outputEscalated: state.outputEscalationAttempted,
    outputContinuationCount: state.outputContinuationCount,
    contextCompacted: state.reactiveCompactAttempted,
    contextDrained: state.contextDrainAttempted,
    fallbackModel:
      state.currentModel && state.currentModel !== state.originalModel
        ? state.currentModel
        : undefined,
  };
}

/**
 * Structured log helper. Redacts message content and tool arguments by
 * design — never log user text. Only metadata that is safe for logs.
 */
export function logRecoveryEvent(input: {
  readonly conversationId: string;
  readonly assistantMessageId: string;
  readonly layer: AIChatRecoveryLayer;
  readonly reason: AIChatRecoveryReason;
  readonly attempt: number;
  readonly delayMs?: number;
  readonly model?: string;
  readonly fallbackModel?: string;
  readonly outcome?:
    | "retrying"
    | "fallback"
    | "recovered"
    | "failed";
}): void {
  // Intentionally minimal. No message text, no tool args, no API keys,
  // no raw server bodies.
  console.info(
    "[ai-chat-recovery]",
    JSON.stringify({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      layer: input.layer,
      reason: input.reason,
      attempt: input.attempt,
      delayMs: input.delayMs,
      model: input.model,
      fallbackModel: input.fallbackModel,
      outcome: input.outcome,
    })
  );
}
