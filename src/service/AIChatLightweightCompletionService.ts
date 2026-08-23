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
} from "@/api/aiChatApi";
import { log } from "@/modules/Logger";
import {
  isSmallModelRoutingEnabled,
  resetSmallModelRoutingCache,
} from "@/config/aiLightweightRouting";
import { getLightweightProfile } from "@/service/AIChatLightweightProfiles";
import {
  AIChatLightweightFailure,
  type AIChatLightweightCompletionInput,
  type AIChatLightweightCompletionResult,
  type AIChatLightweightFailureReason,
  type AIChatLightweightOutcome,
  type AIChatLightweightProviderKind,
  type AIChatLightweightRoute,
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

    const { outcome, metrics } = await this.runStateMachine(input, profile);

    if (outcome.kind === "cooldown_skip") {
      this.emitEvent(
        input,
        "cooldown_skip",
        undefined,
        undefined,
        startedAt,
        metrics
      );
      throw new AIChatLightweightFailure({
        reason: "small_model_unavailable",
        message: `Lightweight workload ${input.workload} skipped (cooldown).`,
        definitive: true,
      });
    }
    if (outcome.kind === "failed") {
      this.emitEvent(input, "failed", undefined, undefined, startedAt, {
        ...metrics,
        fallbackReason: outcome.failure.reason,
      });
      throw outcome.failure;
    }

    this.emitEvent(
      input,
      "success",
      outcome.response,
      outcome.route,
      startedAt,
      metrics
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
  }> {
    const resolution = await this.deps.resolveProvider();

    // Cooldown applies to background (non-manual) executions only.
    if (!input.manual && this.isInCooldown(input.workload)) {
      return {
        outcome: { kind: "cooldown_skip" },
        metrics: EMPTY_METRICS,
      };
    }

    // Kill switch off, or local/custom provider: provider-normal path, no
    // small-specific retry/cooldown/fallback. This is NOT a fallback.
    if (!this.enabled || resolution.kind !== "hosted") {
      const result = await this.runNormalRoute(input, profile, resolution);
      if ("failure" in result) {
        return {
          outcome: { kind: "failed", failure: result.failure },
          metrics: { ...EMPTY_METRICS, attemptCount: 1 },
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
        metrics: { ...EMPTY_METRICS, attemptCount: 1 },
      };
    }

    // Hosted + enabled: attempt the small route.
    try {
      const response = await this.attemptSmall(input, profile);
      this.clearCooldown(input.workload);
      return {
        outcome: {
          kind: "success",
          response,
          route: "hosted_small",
          providerKind: resolution.providerKind,
          resolvedModel: this.extractModel(response),
        },
        metrics: { ...EMPTY_METRICS, attemptCount: 1 },
      };
    } catch (error) {
      const classified = classifyLightweightFailure(error, input.signal);
      // Optional: one same-route retry for rate_limit / server_error.
      if (isSameRouteRetryable(classified.reason)) {
        try {
          await this.sleepWithAbort(this.retryDelay(classified), input.signal);
        } catch (sleepErr) {
          const cancelled = classifyLightweightFailure(sleepErr, input.signal);
          return {
            outcome: { kind: "failed", failure: this.toFailure(cancelled) },
            metrics: EMPTY_METRICS,
          };
        }
        try {
          const response = await this.attemptSmall(input, profile);
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
              ...EMPTY_METRICS,
              attemptCount: 2,
              retryReason: classified.reason,
            },
          };
        } catch (retryError) {
          const retryClassified = classifyLightweightFailure(
            retryError,
            input.signal
          );
          return this.handleSmallFailure(input, profile, retryClassified);
        }
      }
      return this.handleSmallFailure(input, profile, classified);
    }
  }

  /**
   * Handle a small-route failure: cooldown bookkeeping and (for compact only)
   * the one allowed normal-model fallback.
   */
  private async handleSmallFailure(
    input: AIChatLightweightCompletionInput,
    profile: ReturnType<typeof getLightweightProfile>,
    classified: ReturnType<typeof classifyLightweightFailure>
  ): Promise<{
    outcome: LightweightAttemptOutcome;
    metrics: LightweightAttemptMetrics;
  }> {
    // Cooldown bookkeeping.
    if (classified.reason === "small_model_unavailable") {
      this.openConfigCooldown(input.workload, classified.reason);
    } else if (this.isTransient(classified.reason)) {
      this.recordTransient(input.workload, classified.reason);
    }

    // Ambiguous failures are terminal: no retry, no fallback.
    if (!classified.definitive) {
      return {
        outcome: { kind: "failed", failure: this.toFailure(classified) },
        metrics: EMPTY_METRICS,
      };
    }

    // Normal-model fallback: compact only, and only for allowed reasons.
    if (
      profile.fallback === "normal_once" &&
      allowsNormalFallback(classified.reason)
    ) {
      const resolution = await this.deps.resolveProvider();
      const result = await this.runNormalRoute(input, profile, resolution);
      if ("failure" in result) {
        // Fallback itself failed — return the original reason so attribution
        // stays clear, but the fallback's failure is what the user sees.
        return {
          outcome: { kind: "failed", failure: this.toFailure(classified) },
          metrics: {
            ...EMPTY_METRICS,
            attemptCount: 1,
            fallbackAttempted: true,
            fallbackReason: classified.reason,
          },
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
        metrics: {
          ...EMPTY_METRICS,
          attemptCount: 1,
          fallbackAttempted: true,
          fallbackReason: classified.reason,
        },
      };
    }

    return {
      outcome: { kind: "failed", failure: this.toFailure(classified) },
      metrics: EMPTY_METRICS,
    };
  }

  /** Build and send the hosted small-alias request. */
  private async attemptSmall(
    input: AIChatLightweightCompletionInput,
    profile: ReturnType<typeof getLightweightProfile>
  ): Promise<OpenAIChatCompletionResponse> {
    input.signal?.throwIfAborted();
    const request: OpenAIChatCompletionRequest = {
      messages: [...input.messages],
      model: SMALL_MODEL_ALIAS,
      temperature: profile.temperature,
      max_tokens: profile.maxOutputTokens,
      stream: false,
    };
    return this.deps.completeHosted(request, input.signal);
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
    outcome: AIChatLightweightOutcome,
    response: OpenAIChatCompletionResponse | undefined,
    route: AIChatLightweightRoute | undefined,
    startedAt: number,
    metrics: {
      attemptCount: number;
      repairAttempted: boolean;
      fallbackAttempted: boolean;
      retryReason?: AIChatLightweightFailureReason;
      fallbackReason?: AIChatLightweightFailureReason;
    }
  ): void {
    // No prompt or output content is logged.
    log.info(
      "[ai-lightweight]",
      JSON.stringify({
        workload: input.workload,
        route,
        resolvedModel: response?.model,
        attemptCount: metrics.attemptCount,
        repairAttempted: metrics.repairAttempted,
        fallbackAttempted: metrics.fallbackAttempted,
        retryReason: metrics.retryReason,
        fallbackReason: metrics.fallbackReason,
        durationMs: Date.now() - startedAt,
        outcome,
      })
    );
  }

  /** Exposed for the factory: reset all cooldowns on provider/DB switch. */
  resetCooldowns(): void {
    this.cooldowns.clear();
  }
}

export { resetSmallModelRoutingCache };
export { CONSERVATIVE_FALLBACK_CONTEXT };
