// src/service/AIChatLightweightTypes.ts
//
// Type system for routing bounded, text-only background AI workloads through
// the hosted AiFetchly server's virtual `small` model alias. See
// docs/prd/small-model-background-workloads-technical-design.md.
//
// This module MUST stay dependency-free of AiChatApi, the lightweight service,
// IPC, and Vue. It contains only types, the allowlisted workload IDs, and the
// frozen profile map. Callers cannot supply tools, tool_choice, images, or
// arbitrary temperature/output values through this contract — the router
// constructs the final completion request from the profile.
import type {
  OpenAIChatCompletionResponse,
  OpenAIChatMessage,
} from "@/api/aiChatApi";

/**
 * The four allowlisted lightweight workloads. A workload MUST be registered in
 * {@link LIGHTWEIGHT_PROFILES} before it can use the small-model route; the
 * exhaustive map makes TypeScript fail compilation if a new ID lacks a profile.
 */
export type AIChatLightweightWorkload =
  | "user_auto_dream"
  | "workspace_auto_dream"
  | "session_memory_summary"
  | "conversation_compact";

/**
 * Whether a workload's failure may touch the user's active conversation.
 * `optional_background` workloads must never fall back to the normal model.
 * `conversation_protection` (full compact) may fall back at most once.
 */
export type AIChatLightweightCriticality =
  | "optional_background"
  | "conversation_protection";

/** Per-workload normal-model fallback policy. */
export type AIChatLightweightFallbackPolicy = "never" | "normal_once";

/**
 * Frozen per-workload defaults. Individual services shall not repeat numeric
 * literals; they read their profile from {@link LIGHTWEIGHT_PROFILES}.
 */
export interface AIChatLightweightProfile {
  readonly workload: AIChatLightweightWorkload;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly criticality: AIChatLightweightCriticality;
  readonly fallback: AIChatLightweightFallbackPolicy;
  /**
   * Whether the workload requires discovered small-model capability metadata
   * before it may use the small route. Auto-dream and session summaries use a
   * conservative fallback context window; full compact requires a known,
   * valid context window because it sends large input.
   */
  readonly requiresDiscoveredSmallContext: boolean;
}

/**
 * Typed failure reason for the lightweight route. Deterministic and central:
 * workload call sites must never classify by message substring matching.
 *
 * `small_model_unavailable`: server returned 404 or a stable
 * `small_model_unavailable` error code for the alias.
 * `model_specific_overload`: a future typed server code identifying the small
 * route as overloaded (distinct from generic 5xx).
 * `context_overflow`: the small route rejected input as too large.
 * `rate_limit`: HTTP 429 with an authoritative retry delay.
 * `server_error`: HTTP 500/502/503/504 (generic — does not prove a normal
 * model will work).
 * `authentication` / `quota`: definitive, never retried, never fallen back.
 * `invalid_request`: HTTP 400/422 other (developer-visible).
 * `invalid_output`: non-empty but failed parser/secret/semantic validation.
 * `network_ambiguous` / `timeout_ambiguous`: the server may have completed a
 * billable request; never auto-resubmitted.
 * `cancelled`: caller aborted.
 * `persistence_failure`: DB transaction failed after valid model output; no
 * further model call.
 * `unknown`: unclassified.
 */
export type AIChatLightweightFailureReason =
  | "small_model_unavailable"
  | "model_specific_overload"
  | "context_overflow"
  | "rate_limit"
  | "server_error"
  | "authentication"
  | "quota"
  | "invalid_request"
  | "invalid_output"
  | "network_ambiguous"
  | "timeout_ambiguous"
  | "cancelled"
  | "persistence_failure"
  | "unknown";

/** Provider kind for observability — resolved centrally, never in the renderer. */
export type AIChatLightweightProviderKind =
  | "hosted"
  | "ollama"
  | "lm_studio"
  | "openai"
  | "openrouter"
  | "vllm"
  | "localai"
  | "custom";

/** The route the lightweight service selected for a completion. */
export type AIChatLightweightRoute =
  | "hosted_small"
  | "provider_normal"
  | "normal_fallback";

/**
 * Why a completion was routed away from the small alias without a small
 * attempt having failed. `capability_missing`: the workload requires
 * discovered small-model capability metadata (valid `available: true` plus a
 * positive-integer `context_size`) and the server did not provide it, so the
 * request went directly to the provider-normal route (tech-design §8.4,
 * §16.1). This is NOT a fallback and is not counted as one.
 */
export type AIChatLightweightRouteReason = "capability_missing";

/** Input to the lightweight completion operation. Text-only, no tools. */
export interface AIChatLightweightCompletionInput {
  readonly workload: AIChatLightweightWorkload;
  readonly messages: readonly OpenAIChatMessage[];
  /**
   * The model the caller would otherwise use (active conversation model or
   * provider default). Used for the normal/fallback path and preserved on
   * local/custom providers. Never the `small` alias.
   */
  readonly normalModel?: string;
  /** Manual invocation bypasses background scheduling cooldown (not fallback). */
  readonly manual: boolean;
  /** Caller cancellation signal, propagated to fetch. */
  readonly signal?: AbortSignal;
}

/** Result of a lightweight completion operation. */
export interface AIChatLightweightCompletionResult {
  readonly response: OpenAIChatCompletionResponse;
  readonly route: AIChatLightweightRoute;
  /** Real model returned by the accepted response, never the alias. */
  readonly resolvedModel: string;
  readonly providerKind: AIChatLightweightProviderKind;
  readonly attemptCount: number;
  readonly repairAttempted: boolean;
  readonly fallbackAttempted: boolean;
  readonly fallbackReason?: AIChatLightweightFailureReason;
  readonly retryReason?: AIChatLightweightFailureReason;
  /** Set when the route was chosen without a small attempt for a structural
   * reason (e.g. capability metadata missing) — never a fallback. */
  readonly routeReason?: AIChatLightweightRouteReason;
}

/**
 * Terminal outcome for a lightweight execution, for observability. Cooldown
 * skips are recorded without a server call. (Capability-absent compact is
 * handled in the compact service, which routes directly to the normal model
 * with route `provider_normal` — not a distinct outcome here.)
 */
export type AIChatLightweightOutcome =
  | "success"
  | "failed"
  | "cancelled"
  | "cooldown_skip";

/** Structured completion event emitted without prompt or output content. */
export interface AIChatLightweightCompletionEvent {
  readonly workload: AIChatLightweightWorkload;
  readonly providerKind: AIChatLightweightProviderKind;
  /** The selected route; absent on failed paths where no route completed. */
  readonly route?: AIChatLightweightRoute;
  /** Structural route decision (e.g. `capability_missing`) — never a fallback. */
  readonly routeReason?: AIChatLightweightRouteReason;
  readonly requestedAlias: "small" | null;
  readonly resolvedModel?: string;
  readonly contextWindow?: number;
  readonly inputTokenEstimate?: number;
  readonly outputTokens?: number;
  readonly attemptCount: number;
  readonly repairAttempted: boolean;
  readonly fallbackAttempted: boolean;
  readonly retryReason?: AIChatLightweightFailureReason;
  readonly fallbackReason?: AIChatLightweightFailureReason;
  readonly durationMs: number;
  readonly outcome: AIChatLightweightOutcome;
}

/**
 * Classified failure thrown by the lightweight service when a completion cannot
 * succeed. Carries the typed reason so callers (auto-dream, compact) can drive
 * domain-specific repair/fallback decisions without substring matching.
 */
export class AIChatLightweightFailure extends Error {
  readonly reason: AIChatLightweightFailureReason;
  readonly status?: number;
  readonly serverCode?: string;
  readonly retryAfterMs?: number;
  readonly definitive: boolean;

  constructor(input: {
    reason: AIChatLightweightFailureReason;
    message: string;
    status?: number;
    serverCode?: string;
    retryAfterMs?: number;
    /** Whether the failure proves no usable result was produced (safe next action known). */
    definitive?: boolean;
  }) {
    super(input.message);
    this.name = "AIChatLightweightFailure";
    this.reason = input.reason;
    this.status = input.status;
    this.serverCode = input.serverCode;
    this.retryAfterMs = input.retryAfterMs;
    this.definitive = input.definitive ?? true;
  }
}
