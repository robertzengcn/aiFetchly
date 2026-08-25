// src/service/AIChatLightweightCompletionService.ts
//
// Central, provider-aware lightweight completion operation. Owns completion-
// route policy and attempt control: provider selection, the kill switch,
// retries, cooldown, compact fallback, cancellation, and structured logging.
//
// Workload services remain responsible for domain behavior (selecting
// sources, building prompts, validating output, committing results). This
// service owns ONLY completion-route policy and attempt control. It keeps no
// mutable current-request fields (concurrency-safe).
//
// Hard invariants (tech-design §11):
//   1. attemptCount <= 2 for optional workloads (attempt 2 is a safe same-route
//      retry only).
//   2. A normal-model fallback occurs at most once and only for
//      conversation_compact.
//   3. Ambiguous failures produce no further model request.
//   4. Cancellation is checked before every retry, repair, fallback, and
//      persistence step.
//   5. Persistence failure never invokes a model again.
//   6. The general chat recovery/fallback chain is not entered by this service.
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAISmallModelCapability,
} from "@/api/aiChatApi";
import { log } from "@/modules/Logger";
import {
  isSmallModelRoutingEnabled,
  resetSmallModelRoutingCache,
} from "@/config/aiLightweightRouting";
import { getLightweightProfile } from "@/service/AIChatLightweightProfiles";
import {
  AIChatLightweightFailure,
  type AIChatLightweightCompletionEvent,
  type AIChatLightweightCompletionInput,
  type AIChatLightweightCompletionResult,
  type AIChatLightweightFailureReason,
  type AIChatLightweightOutcome,
  type AIChatLightweightProviderKind,
  type AIChatLightweightRoute,
  type AIChatLightweightRouteReason,
} from "@/service/AIChatLightweightTypes";
import {
  allowsNormalFallback,
  classifyLightweightFailure,
  isSameRouteRetryable,
} from "@/service/AIChatLightweightFailureClassifier";

/** The canonical hosted small-model alias. Server matching is case-insensitive. */
export const SMALL_MODEL_ALIAS = "small";

/** Conservative 32k context assumed for bounded workloads when metadata is
 *  absent. The budget helper (AIChatPromptBudget) owns the canonical value; this
 *  service does not use it directly. Kept here only for the export below until
 *  callers migrate to the budget helper's constant. */
const CONSERVATIVE_FALLBACK_CONTEXT = 32_000;

/** One background cooldown threshold: three consecutive transient failures. */
const TRANSIENT_FAILURE_THRESHOLD = 3;
/** Six-hour cooldown for a missing/invalid small-model configuration. */
const CONFIG_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** One-hour cooldown for repeated transient failures. */
const TRANSIENT_COOLDOWN_MS = 60 * 60 * 1000;

/** Maximum delay actually slept before a safe same-route retry. */
const MAX_RETRY_SLEEP_MS = 10_000;
/** Generic 5xx backoff (no authoritative Retry-After). Capped by MAX_RETRY_SLEEP_MS. */
const GENERIC_5XX_BACKOFF_MS = 2_000;

/**
 * A small-model capability is usable only when the server reports the route
 * available with a valid positive-integer context window. Anything else
 * (absent metadata, `available: false`, malformed `context_size`) makes the
 * small route ineligible for workloads that require discovered context
 * (tech-design §8.4, §16.1).
 */
function isUsableSmallCapability(
  capability: OpenAISmallModelCapability | null | undefined
): capability is OpenAISmallModelCapability {
  if (!capability || capability.available !== true) {
    return false;
  }
  const contextSize = capability.context_size;
  return (
    typeof contextSize === "number" &&
    Number.isInteger(contextSize) &&
    contextSize > 0
  );
}

/**
 * Terminal outcome of a single lightweight attempt-state-machine run. Carried
 * out of {@link runStateMachine} alongside the {@link LightweightAttemptMetrics}
 * so the caller can emit an accurate event without a side-effecting callback.
 */
type LightweightAttemptOutcome =
  | {
      kind: "success";
      response: OpenAIChatCompletionResponse;
      route: AIChatLightweightRoute;
      providerKind: AIChatLightweightProviderKind;
      resolvedModel: string;
      /** Structural route decision (e.g. capability_missing), never a fallback. */
      routeReason?: AIChatLightweightRouteReason;
    }
  | { kind: "cooldown_skip" }
  | { kind: "failed"; failure: AIChatLightweightFailure };

/**
 * Per-attempt metrics threaded out of the state machine: attempt count and
 * whether a retry / repair / fallback happened. Empty for paths that did not
 * reach a network attempt (cooldown skip, pre-request cancellation).
 */
interface LightweightAttemptMetrics {
  readonly attemptCount: number;
  readonly repairAttempted: boolean;
  readonly fallbackAttempted: boolean;
  readonly retryReason?: AIChatLightweightFailureReason;
  readonly fallbackReason?: AIChatLightweightFailureReason;
}

/** Zero-metrics baseline; specific paths spread into it to set their fields. */
const EMPTY_METRICS: LightweightAttemptMetrics = {
  attemptCount: 0,
  repairAttempted: false,
  fallbackAttempted: false,
};

/**
 * Provider resolution result the service consumes. Injected so tests can drive
 * hosted vs local without the real resolver.
 */
export interface LightweightProviderResolution {
  readonly kind: "hosted" | "local";
  readonly providerKind: AIChatLightweightProviderKind;
}

/**
 * Boundary dependencies injected by the factory. `completeHosted` and
 * `completeLocal` are thin wrappers over AiChatApi's hosted/local completion
 * paths; `resolveProvider` over AIProviderResolver. Hosted AI entitlement
 * (Token/USER_AI_ENABLED) is NOT re-checked here — it is enforced downstream
 * by AiChatApi.openAIChatCompletion -> resolveForChat(), which throws a
 * hosted-subscription denial before any network call. Keeping these injectable
 * makes the policy unit-testable and lets worker processes route hosted
 * completion through the existing authenticated path.
 */
export interface AIChatLightweightCompletionDeps {
  /** Resolve the active provider kind (hosted vs local/custom). */
  resolveProvider(): Promise<LightweightProviderResolution>;
  /** Hosted non-streaming completion (HttpClient path). Forwards signal. */
  completeHosted(
    request: OpenAIChatCompletionRequest,
    signal?: AbortSignal
  ): Promise<OpenAIChatCompletionResponse>;
  /** Local/custom non-streaming completion (preserves real/default model). */
  completeLocal(
    request: OpenAIChatCompletionRequest,
    signal?: AbortSignal
  ): Promise<OpenAIChatCompletionResponse>;
  /**
   * Resolve the hosted small-model capability metadata (`GET /v1/models`).
   * Consulted ONLY for workloads whose profile requires discovered small
   * context (full compact): absent/invalid/unavailable metadata routes the
   * request directly to the provider-normal path with route reason
   * `capability_missing` — no small request, not a fallback
   * (tech-design §8.4, §16.1). Optional so tests and providers without a
   * catalog can omit it; an omitted resolver counts as missing capability.
   */
  getSmallModelCapability?(): Promise<OpenAISmallModelCapability | null>;
}

/** Process-local cooldown state keyed by workload. */
interface LightweightCooldownState {
  consecutiveTransientFailures: number;
  cooldownUntil?: number;
  reason?: AIChatLightweightFailureReason;
}

/**
 * Central lightweight completion router. One process-wide singleton
 * (via the factory) shared across user auto-dream, workspace auto-dream, and
 * compact services so one workload's route-level failure can cool down for
 * the others.
 */
export class AIChatLightweightCompletionService {
  private readonly cooldowns = new Map<
    AIChatLightweightCompletionInput["workload"],
    LightweightCooldownState
  >();
  private readonly enabled: boolean;

  constructor(private readonly deps: AIChatLightweightCompletionDeps) {
    // Read the kill switch once at construction; changes require a restart.
    this.enabled = isSmallModelRoutingEnabled();
  }

  /** Whether the kill switch has small-model routing enabled. */
  isRoutingEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Execute a lightweight completion. Throws {@link AIChatLightweightFailure}
   * on terminal failure; returns a typed result on success. Never enters the
   * general chat recovery/fallback chain.
   */
  async complete(
    input: AIChatLightweightCompletionInput
  ): Promise<AIChatLightweightCompletionResult> {
    const profile = getLightweightProfile(input.workload);
    const startedAt = Date.now();

    const { outcome, metrics, providerKind } = await this.runStateMachine(
      input,
      profile
    );

    if (outcome.kind === "cooldown_skip") {
      this.emitEvent(input, providerKind, undefined, undefined, startedAt, {
        ...metrics,
        outcome: "cooldown_skip",
      });
      throw new AIChatLightweightFailure({
        reason: "small_model_unavailable",
        message: `Lightweight workload ${input.workload} skipped (cooldown).`,
        definitive: true,
      });
    }
    if (outcome.kind === "failed") {
      this.emitEvent(input, providerKind, undefined, undefined, startedAt, {
        ...metrics,
        outcome: "failed",
        fallbackReason: outcome.failure.reason,
      });
      throw outcome.failure;
    }

    this.emitEvent(
      input,
      providerKind,
      outcome.response,
      outcome.route,
      startedAt,
      {
        ...metrics,
        outcome: "success",
        ...(outcome.routeReason ? { routeReason: outcome.routeReason } : {}),
      }
    );
    return {
      response: outcome.response,
      route: outcome.route,
      resolvedModel: outcome.resolvedModel,
      providerKind: outcome.providerKind,
      attemptCount: metrics.attemptCount,
      repairAttempted: metrics.repairAttempted,
      fallbackAttempted: metrics.fallbackAttempted,
      fallbackReason: metrics.fallbackReason,
      retryReason: metrics.retryReason,
      ...(outcome.routeReason ? { routeReason: outcome.routeReason } : {}),
    };
  }

  /**
   * Core attempt state machine. Returns the terminal outcome plus the
   * accumulated attempt/repair/fallback metrics for that path. The metrics
   * are returned (not threaded via a side-effecting callback) so the data
   * flow is explicit and the compiler guarantees every path reports.
   */
  private async runStateMachine(
    input: AIChatLightweightCompletionInput,
    profile: ReturnType<typeof getLightweightProfile>
  ): Promise<{
    outcome: LightweightAttemptOutcome;
    metrics: LightweightAttemptMetrics;
    providerKind: AIChatLightweightProviderKind;
  }> {
    const resolution = await this.deps.resolveProvider();
    const r = await this.runStateMachineResolved(input, profile, resolution);
    return { ...r, providerKind: resolution.providerKind };
  }

  /**
   * The state machine proper, run against an already-resolved provider so the
   * provider is resolved exactly once per logical completion (re-resolving in
   * the fallback path could observe a mid-flight provider switch).
   */
  private async runStateMachineResolved(
    input: AIChatLightweightCompletionInput,
    profile: ReturnType<typeof getLightweightProfile>,
    resolution: LightweightProviderResolution
  ): Promise<{
    outcome: LightweightAttemptOutcome;
    metrics: LightweightAttemptMetrics;
  }> {
    // Base metrics seeded with the caller's repair flag so a domain-level
    // repair request is recorded as `repairAttempted: true` (SMBW-009).
    const base: LightweightAttemptMetrics = {
      ...EMPTY_METRICS,
      repairAttempted: input.repairAttempted === true,
    };
    // Cooldown applies to background (non-manual) executions only.
    if (!input.manual && this.isInCooldown(input.workload)) {
      return {
        outcome: { kind: "cooldown_skip" },
        metrics: base,
      };
    }

    // Kill switch off, local/custom provider, OR caller-forced normal route
    // (full compact's one-time fallback restart): provider-normal path, no
    // small-specific retry/cooldown/fallback. This is NOT a fallback.
    if (
      !this.enabled ||
      resolution.kind !== "hosted" ||
      input.forceNormalRoute === true
    ) {
      const result = await this.runNormalRoute(input, profile, resolution);
      if ("failure" in result) {
        return {
          outcome: { kind: "failed", failure: result.failure },
          metrics: { ...base, attemptCount: 1 },
        };
      }
      return {
        outcome: {
          kind: "success",
          response: result.response,
          route: "provider_normal",
          providerKind: resolution.providerKind,
          resolvedModel: result.resolvedModel,
        },
        metrics: { ...base, attemptCount: 1 },
      };
    }

    // Hosted + enabled: for workloads that require discovered small-model
    // capability metadata (full compact), gate the small route on a valid,
    // available capability. Absent/malformed/unavailable metadata routes
    // DIRECTLY to the provider-normal path with route reason
    // `capability_missing` — no small request is made, nothing failed, so
    // this is not a fallback and opens no cooldown (tech-design §8.4, §16.1).
    let capability: OpenAISmallModelCapability | null = null;
    if (profile.requiresDiscoveredSmallContext) {
      capability = await this.resolveCapabilitySafely();
      if (!isUsableSmallCapability(capability)) {
        const result = await this.runNormalRoute(input, profile, resolution);
        if ("failure" in result) {
          return {
            outcome: { kind: "failed", failure: result.failure },
            metrics: { ...base, attemptCount: 1 },
          };
        }
        return {
          outcome: {
            kind: "success",
            response: result.response,
            route: "provider_normal",
            providerKind: resolution.providerKind,
            resolvedModel: result.resolvedModel,
            routeReason: "capability_missing",
          },
          metrics: { ...base, attemptCount: 1 },
        };
      }
    }

    // Hosted + enabled: attempt the small route.
    try {
      const response = await this.attemptSmall(input, profile, capability);
      this.clearCooldown(input.workload);
      return {
        outcome: {
          kind: "success",
          response,
          route: "hosted_small",
          providerKind: resolution.providerKind,
          resolvedModel: this.extractModel(response),
        },
        metrics: { ...base, attemptCount: 1 },
      };
    } catch (error) {
      const classified = classifyLightweightFailure(error, input.signal);
      // Optional: one same-route retry for rate_limit / server_error, UNLESS
      // the caller suppressed it to leave budget for a domain-level JSON
      // repair so the logical run (first completion + repair) stays ≤2
      // requests (SMBW-009, tech-design §9.4).
      if (
        input.allowSameRouteRetry !== false &&
        isSameRouteRetryable(classified.reason)
      ) {
        try {
          await this.sleepWithAbort(this.retryDelay(classified), input.signal);
        } catch (sleepErr) {
          const cancelled = classifyLightweightFailure(sleepErr, input.signal);
          return {
            outcome: { kind: "failed", failure: this.toFailure(cancelled) },
            metrics: { ...base, attemptCount: 1 },
          };
        }
        try {
          const response = await this.attemptSmall(input, profile, capability);
          this.clearCooldown(input.workload);
          return {
            outcome: {
              kind: "success",
              response,
              route: "hosted_small",
              providerKind: resolution.providerKind,
              resolvedModel: this.extractModel(response),
            },
            metrics: {
              ...base,
              attemptCount: 2,
              retryReason: classified.reason,
            },
          };
        } catch (retryError) {
          const retryClassified = classifyLightweightFailure(
            retryError,
            input.signal
          );
          return this.handleSmallFailure(
            input,
            profile,
            resolution,
            retryClassified,
            2
          );
        }
      }
      return this.handleSmallFailure(input, profile, resolution, classified, 1);
    }
  }

  /**
   * Handle a small-route failure: cooldown bookkeeping and (for compact only)
   * the one allowed normal-model fallback. `priorAttempts` is the number of
   * network attempts already made in this logical completion (1 after the
   * initial small request, 2 after a same-route retry) so the emitted attempt
   * count never reports zero after a network request (SMBW-012).
   */
  private async handleSmallFailure(
    input: AIChatLightweightCompletionInput,
    profile: ReturnType<typeof getLightweightProfile>,
    resolution: LightweightProviderResolution,
    classified: ReturnType<typeof classifyLightweightFailure>,
    priorAttempts: number
  ): Promise<{
    outcome: LightweightAttemptOutcome;
    metrics: LightweightAttemptMetrics;
  }> {
    this.applyCooldownBookkeeping(input, classified.reason);

    const failMetrics: LightweightAttemptMetrics = {
      ...EMPTY_METRICS,
      attemptCount: priorAttempts,
      repairAttempted: input.repairAttempted === true,
    };
    // Ambiguous failures are terminal: no retry, no fallback.
    if (!classified.definitive) {
      return {
        outcome: { kind: "failed", failure: this.toFailure(classified) },
        metrics: failMetrics,
      };
    }

    // Normal-model fallback: compact only, only for allowed reasons, and only
    // when the caller has not suppressed it for this sub-request. A caller
    // that issues multiple completions per logical unit (full compact's
    // map+merge) suppresses per-chunk fallback and owns the single allowed
    // fallback at its orchestration boundary (SMBW-004, tech-design §16.3).
    if (
      profile.fallback === "normal_once" &&
      input.allowNormalFallback !== false &&
      allowsNormalFallback(classified.reason)
    ) {
      return this.attemptNormalFallback(
        input,
        profile,
        resolution,
        classified,
        priorAttempts
      );
    }

    return {
      outcome: { kind: "failed", failure: this.toFailure(classified) },
      metrics: failMetrics,
    };
  }

  /**
   * Cooldown bookkeeping for a classified small-route failure. A missing/invalid
   * small-model configuration opens a six-hour cooldown; three consecutive
   * transient failures open a one-hour cooldown. Authentication, quota,
   * cancellation, invalid-output, and persistence failures do not increment
   * the transient counter (tech-design §12).
   */
  private applyCooldownBookkeeping(
    input: AIChatLightweightCompletionInput,
    reason: AIChatLightweightFailureReason
  ): void {
    if (reason === "small_model_unavailable") {
      this.openConfigCooldown(input.workload, reason);
    } else if (this.isTransient(reason)) {
      this.recordTransient(input.workload, reason);
    }
  }

  /**
   * The one allowed normal-model fallback for conversation_compact. Reuses the
   * resolution from the top of this logical completion (a mid-flight provider
   * switch must not change the fallback target). Returns the original reason
   * on fallback failure so attribution stays clear. The total attempt count
   * includes the small attempts that preceded the fallback (SMBW-012).
   */
  private async attemptNormalFallback(
    input: AIChatLightweightCompletionInput,
    profile: ReturnType<typeof getLightweightProfile>,
    resolution: LightweightProviderResolution,
    classified: ReturnType<typeof classifyLightweightFailure>,
    priorAttempts: number
  ): Promise<{
    outcome: LightweightAttemptOutcome;
    metrics: LightweightAttemptMetrics;
  }> {
    const result = await this.runNormalRoute(input, profile, resolution);
    const fallbackMetrics: LightweightAttemptMetrics = {
      ...EMPTY_METRICS,
      attemptCount: priorAttempts + 1,
      repairAttempted: input.repairAttempted === true,
      fallbackAttempted: true,
      fallbackReason: classified.reason,
    };
    if ("failure" in result) {
      return {
        outcome: { kind: "failed", failure: this.toFailure(classified) },
        metrics: fallbackMetrics,
      };
    }
    return {
      outcome: {
        kind: "success",
        response: result.response,
        route: "normal_fallback",
        providerKind: resolution.providerKind,
        resolvedModel: result.resolvedModel,
      },
      metrics: fallbackMetrics,
    };
  }

  /**
   * Resolve the hosted small-model capability without ever throwing: a
   * resolver failure (catalog fetch error, injection absent) is equivalent to
   * missing metadata — route normal, never crash a background workload.
   */
  private async resolveCapabilitySafely(): Promise<OpenAISmallModelCapability | null> {
    if (!this.deps.getSmallModelCapability) return null;
    try {
      return await this.deps.getSmallModelCapability();
    } catch {
      return null;
    }
  }

  /** Build and send the hosted small-alias request. */
  private async attemptSmall(
    input: AIChatLightweightCompletionInput,
    profile: ReturnType<typeof getLightweightProfile>,
    capability?: OpenAISmallModelCapability | null
  ): Promise<OpenAIChatCompletionResponse> {
    input.signal?.throwIfAborted();
    const request: OpenAIChatCompletionRequest = {
      messages: [...input.messages],
      model: SMALL_MODEL_ALIAS,
      temperature: profile.temperature,
      max_tokens: this.smallMaxOutputTokens(profile, capability),
      stream: false,
    };
    return this.deps.completeHosted(request, input.signal);
  }

  /**
   * Effective output cap for the small route: the profile's default bounded by
   * the discovered small-model maximum output when one is reported
   * (SMBW-001: a valid capability's reported limits are honored).
   */
  private smallMaxOutputTokens(
    profile: ReturnType<typeof getLightweightProfile>,
    capability?: OpenAISmallModelCapability | null
  ): number {
    const discovered = capability?.max_tokens;
    if (
      typeof discovered === "number" &&
      Number.isInteger(discovered) &&
      discovered > 0
    ) {
      return Math.min(profile.maxOutputTokens, discovered);
    }
    return profile.maxOutputTokens;
  }

  /**
   * Provider-normal (or fallback) path: preserves a requested real model or
   * uses the configured provider default. Never sends the alias.
   */
  private async runNormalRoute(
    input: AIChatLightweightCompletionInput,
    profile: ReturnType<typeof getLightweightProfile>,
    resolution: LightweightProviderResolution
  ): Promise<
    | { response: OpenAIChatCompletionResponse; resolvedModel: string }
    | { failure: AIChatLightweightFailure }
  > {
    input.signal?.throwIfAborted();
    const request: OpenAIChatCompletionRequest = {
      messages: [...input.messages],
      temperature: profile.temperature,
      max_tokens: profile.maxOutputTokens,
      stream: false,
      ...(input.normalModel ? { model: input.normalModel } : {}),
    };
    try {
      const response =
        resolution.kind === "hosted"
          ? await this.deps.completeHosted(request, input.signal)
          : await this.deps.completeLocal(request, input.signal);
      return { response, resolvedModel: this.extractModel(response) };
    } catch (error) {
      const classified = classifyLightweightFailure(error, input.signal);
      return { failure: this.toFailure(classified) };
    }
  }

  // --- Cooldown ---------------------------------------------------------------

  private isInCooldown(
    workload: AIChatLightweightCompletionInput["workload"]
  ): boolean {
    const state = this.cooldowns.get(workload);
    if (!state?.cooldownUntil) return false;
    if (Date.now() >= state.cooldownUntil) {
      // Expired — clear so a probe may run.
      this.cooldowns.set(workload, {
        consecutiveTransientFailures: 0,
      });
      return false;
    }
    return true;
  }

  private openConfigCooldown(
    workload: AIChatLightweightCompletionInput["workload"],
    reason: AIChatLightweightFailureReason
  ): void {
    this.cooldowns.set(workload, {
      consecutiveTransientFailures: 0,
      cooldownUntil: Date.now() + CONFIG_COOLDOWN_MS,
      reason,
    });
  }

  private recordTransient(
    workload: AIChatLightweightCompletionInput["workload"],
    reason: AIChatLightweightFailureReason
  ): void {
    const prev = this.cooldowns.get(workload) ?? {
      consecutiveTransientFailures: 0,
    };
    const next = prev.consecutiveTransientFailures + 1;
    if (next >= TRANSIENT_FAILURE_THRESHOLD) {
      this.cooldowns.set(workload, {
        consecutiveTransientFailures: next,
        cooldownUntil: Date.now() + TRANSIENT_COOLDOWN_MS,
        reason,
      });
    } else {
      this.cooldowns.set(workload, {
        consecutiveTransientFailures: next,
        cooldownUntil: prev.cooldownUntil,
        reason,
      });
    }
  }

  private clearCooldown(
    workload: AIChatLightweightCompletionInput["workload"]
  ): void {
    this.cooldowns.delete(workload);
  }

  /** Exposed for tests: inspect cooldown state without timers. */
  getCooldownState(workload: AIChatLightweightCompletionInput["workload"]): {
    consecutiveTransientFailures: number;
    cooldownUntil?: number;
    reason?: AIChatLightweightFailureReason;
  } | null {
    const s = this.cooldowns.get(workload);
    return s ? { ...s } : null;
  }

  // --- Helpers ----------------------------------------------------------------

  private isTransient(reason: AIChatLightweightFailureReason): boolean {
    return (
      reason === "rate_limit" ||
      reason === "server_error" ||
      reason === "network_ambiguous" ||
      reason === "timeout_ambiguous"
    );
  }

  private toFailure(
    classified: ReturnType<typeof classifyLightweightFailure>
  ): AIChatLightweightFailure {
    return new AIChatLightweightFailure({
      reason: classified.reason,
      message: classified.message,
      status: classified.status,
      serverCode: classified.serverCode,
      retryAfterMs: classified.retryAfterMs,
      definitive: classified.definitive,
    });
  }

  private extractModel(response: OpenAIChatCompletionResponse): string {
    return response.model ?? SMALL_MODEL_ALIAS;
  }

  private retryDelay(
    classified: ReturnType<typeof classifyLightweightFailure>
  ): number {
    if (classified.retryAfterMs && classified.retryAfterMs > 0) {
      return Math.min(classified.retryAfterMs, MAX_RETRY_SLEEP_MS);
    }
    // Generic 5xx backoff (no authoritative Retry-After). Capped by
    // MAX_RETRY_SLEEP_MS so a misbehaving server can't stall a background
    // job for minutes.
    return Math.min(GENERIC_5XX_BACKOFF_MS, MAX_RETRY_SLEEP_MS);
  }

  private async sleepWithAbort(
    ms: number,
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
    signal?.throwIfAborted();
  }

  private emitEvent(
    input: AIChatLightweightCompletionInput,
    providerKind: AIChatLightweightProviderKind,
    response: OpenAIChatCompletionResponse | undefined,
    route: AIChatLightweightRoute | undefined,
    startedAt: number,
    fields: LightweightAttemptMetrics & {
      outcome: AIChatLightweightOutcome;
      routeReason?: AIChatLightweightRouteReason;
    }
  ): void {
    // Construct the typed event so the interface is the single source of
    // truth for the log shape. No prompt or output content is logged.
    const event: AIChatLightweightCompletionEvent = {
      workload: input.workload,
      providerKind,
      ...(route ? { route } : {}),
      ...(fields.routeReason ? { routeReason: fields.routeReason } : {}),
      requestedAlias:
        route === "hosted_small" || route === "normal_fallback"
          ? "small"
          : null,
      ...(response?.model ? { resolvedModel: response.model } : {}),
      ...(response?.usage?.completion_tokens !== undefined
        ? { outputTokens: response.usage.completion_tokens }
        : {}),
      attemptCount: fields.attemptCount,
      repairAttempted: fields.repairAttempted,
      fallbackAttempted: fields.fallbackAttempted,
      ...(fields.retryReason ? { retryReason: fields.retryReason } : {}),
      ...(fields.fallbackReason
        ? { fallbackReason: fields.fallbackReason }
        : {}),
      durationMs: Date.now() - startedAt,
      outcome: fields.outcome,
    };
    log.info("[ai-lightweight]", JSON.stringify(event));
  }

  /** Exposed for the factory: reset all cooldowns on provider/DB switch. */
  resetCooldowns(): void {
    this.cooldowns.clear();
  }
}

export { resetSmallModelRoutingCache };
export { CONSERVATIVE_FALLBACK_CONTEXT };
