// src/service/AIChatRetryPolicy.ts
//
// Retry decision logic for the seven-layer recovery strategy
// (technical-design §6). Pure math: given a classified reason, an attempt
// counter, and a profile, decide whether to retry, fall back, or fail —
// and if retrying, how long to sleep. No service calls, no I/O.
import {
  isRetryableReason,
  type AIChatRecoveryReason,
} from "@/service/AIChatRecoveryTypes";

/** Recovery profile selects the policy's aggressiveness. */
export type AIChatRecoveryProfile = "foreground" | "background" | "persistent";

export interface AIChatRetryProfile {
  readonly profile: AIChatRecoveryProfile;
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

export interface AIChatRecoveryDefaults {
  readonly foreground: AIChatRetryProfile;
  readonly background: AIChatRetryProfile;
  readonly persistent: AIChatRetryProfile;
  /** Foreground profile gives up on overload after this many consecutive 529s. */
  readonly overloadFallbackThreshold: number;
  /** Persistent profile heartbeats every this many ms. */
  readonly persistentHeartbeatMs: number;
  /** Persistent profile hard cap (6h). */
  readonly persistentHardCapMs: number;
  /** Default context window when server doesn't report one. */
  readonly defaultContextWindowTokens: number;
  /** Default output-token escalation cap. */
  readonly maxOutputTokensCap: number;
}

export const AI_CHAT_RECOVERY_DEFAULTS: AIChatRecoveryDefaults = {
  foreground: {
    profile: "foreground",
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
    jitterRatio: 0.25,
  },
  background: {
    profile: "background",
    maxAttempts: 1,
    baseDelayMs: 2_000,
    maxDelayMs: 10_000,
    jitterRatio: 0.25,
  },
  persistent: {
    profile: "persistent",
    // Conceptually uncapped — see persistentHardCapMs. We keep a high
    // numeric ceiling so decide() math stays bounded per-call.
    maxAttempts: 1000,
    baseDelayMs: 5_000,
    maxDelayMs: 5 * 60_000,
    jitterRatio: 0.25,
  },
  overloadFallbackThreshold: 3,
  persistentHeartbeatMs: 30_000,
  persistentHardCapMs: 6 * 60 * 60_000,
  defaultContextWindowTokens: 128_000,
  maxOutputTokensCap: 65_536,
};

export type RetryDecision =
  | {
      readonly type: "retry";
      readonly attempt: number;
      readonly delayMs: number;
    }
  | { readonly type: "fallback" }
  | { readonly type: "fail" };

/** Input for AIChatRetryPolicy.decide(). */
export interface RetryDecisionInput {
  readonly reason: AIChatRecoveryReason;
  /** 1-based attempt that just failed. */
  readonly attempt: number;
  readonly profile: AIChatRecoveryProfile;
  readonly retryAfterMs?: number;
  readonly rateLimitResetMs?: number;
  readonly consecutiveOverloadCount?: number;
  readonly hasFallback?: boolean;
  readonly turnElapsedMs?: number;
}

/**
 * Computes retry/fallback/fail decisions and delay values. Stateless;
 * injectable `random` enables deterministic tests.
 */
export class AIChatRetryPolicy {
  private readonly defaults: AIChatRecoveryDefaults;
  private readonly random: () => number;

  constructor(
    defaults: AIChatRecoveryDefaults = AI_CHAT_RECOVERY_DEFAULTS,
    random: () => number = Math.random
  ) {
    this.defaults = defaults;
    this.random = random;
  }

  /** Resolve the profile config from its name. */
  profileOf(name: AIChatRecoveryProfile): AIChatRetryProfile {
    switch (name) {
      case "foreground":
        return this.defaults.foreground;
      case "background":
        return this.defaults.background;
      case "persistent":
        return this.defaults.persistent;
    }
  }

  /**
   * Decide what to do after a classified failure on a given attempt.
   * Never throws.
   */
  decide(input: RetryDecisionInput): RetryDecision {
    const { reason, attempt, profile, hasFallback, turnElapsedMs } = input;

    // Never retry non-retryable reasons.
    if (!isRetryableReason(reason)) {
      return { type: "fail" };
    }

    // Persistent profile: honour the hard cap.
    if (profile === "persistent") {
      const elapsed = turnElapsedMs ?? 0;
      if (elapsed >= this.defaults.persistentHardCapMs) {
        return { type: "fail" };
      }
      // Otherwise keep retrying under the cap.
      const delayMs = this.computeDelay(input);
      return { type: "retry", attempt: attempt + 1, delayMs };
    }

    const prof = this.profileOf(profile);

    // Overload escalation: foreground hands off to model fallback when
    // the consecutive-529 threshold is reached and a fallback exists.
    if (
      reason === "overload" &&
      profile === "foreground" &&
      (input.consecutiveOverloadCount ?? 0) >=
        this.defaults.overloadFallbackThreshold &&
      hasFallback
    ) {
      return { type: "fallback" };
    }

    // Model unavailable: retry only while attempts remain; if attempts are
    // exhausted and we have a fallback, hand off.
    if (
      reason === "model_unavailable" &&
      hasFallback &&
      attempt > prof.maxAttempts
    ) {
      return { type: "fallback" };
    }

    // maxAttempts = number of retries allowed (additional tries after the
    // initial failure). So we fail when attempt > maxAttempts.
    if (attempt > prof.maxAttempts) {
      if (
        hasFallback &&
        (reason === "overload" || reason === "model_unavailable")
      ) {
        return { type: "fallback" };
      }
      return { type: "fail" };
    }

    const delayMs = this.computeDelay(input);
    return { type: "retry", attempt: attempt + 1, delayMs };
  }

  /**
   * Compute the delay before the next attempt. Exponential backoff with
   * jitter, capped at profile.maxDelayMs. Retry-After header overrides
   * computed backoff when larger.
   */
  computeDelay(input: RetryDecisionInput): number {
    const prof = this.profileOf(input.profile);
    const attempt = Math.max(1, input.attempt);
    // Exponential backoff: base * 2^(attempt-1)
    const raw = prof.baseDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(raw, prof.maxDelayMs);
    // Jitter is applied to the capped value, then re-clamped so the
    // post-jitter result cannot exceed maxDelayMs.
    const jittered = Math.min(
      this.applyJitter(capped, prof.jitterRatio),
      prof.maxDelayMs
    );

    // Honor Retry-After / rate-limit reset when present; the larger of
    // server-required and jittered backoff wins so we never under-wait.
    const serverRequired = Math.max(
      input.retryAfterMs ?? 0,
      input.rateLimitResetMs ?? 0
    );
    if (serverRequired > 0) {
      return Math.max(serverRequired, jittered);
    }
    return jittered;
  }

  private applyJitter(delayMs: number, jitterRatio: number): number {
    if (jitterRatio <= 0) return delayMs;
    // Symmetric jitter in [1 - r, 1 + r] multiplied by delay.
    const r = this.random() * 2 - 1; // [-1, 1)
    const factor = 1 + r * jitterRatio;
    return Math.max(0, Math.round(delayMs * factor));
  }

  /** Convenience: the heartbeat interval for the persistent profile. */
  persistentHeartbeatMs(): number {
    return this.defaults.persistentHeartbeatMs;
  }

  /** Convenience: the hard cap for the persistent profile. */
  persistentHardCapMs(): number {
    return this.defaults.persistentHardCapMs;
  }
}
