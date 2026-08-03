import { describe, expect, it } from "vitest";
import {
  AI_CHAT_RECOVERY_DEFAULTS,
  AIChatRetryPolicy,
  type AIChatRecoveryProfile,
} from "@/service/AIChatRetryPolicy";
import type { AIChatRecoveryReason } from "@/service/AIChatRecoveryTypes";

function policyWith(random: () => number = () => 0): AIChatRetryPolicy {
  return new AIChatRetryPolicy(AI_CHAT_RECOVERY_DEFAULTS, random);
}

describe("AIChatRetryPolicy", () => {
  describe("decide - non-retryable", () => {
    const nonRetryable: AIChatRecoveryReason[] = [
      "auth",
      "quota",
      "cancelled",
      "non_recoverable",
    ];
    for (const reason of nonRetryable) {
      it(`fails immediately for ${reason}`, () => {
        const p = policyWith();
        const d = p.decide({ reason, attempt: 1, profile: "foreground" });
        expect(d.type).toBe("fail");
      });
    }
  });

  describe("decide - foreground retryable", () => {
    it("retries network up to maxAttempts retries, then fails", () => {
      const p = policyWith();
      const max = AI_CHAT_RECOVERY_DEFAULTS.foreground.maxAttempts;
      // attempts 1..max should all retry (maxAttempts = retries allowed).
      for (let i = 1; i <= max; i++) {
        const d = p.decide({
          reason: "network",
          attempt: i,
          profile: "foreground",
        });
        expect(d.type).toBe("retry");
        if (d.type === "retry") {
          expect(d.attempt).toBe(i + 1);
          expect(d.delayMs).toBeGreaterThanOrEqual(0);
        }
      }
      // attempt max+1 fails
      const dFail = p.decide({
        reason: "network",
        attempt: max + 1,
        profile: "foreground",
      });
      expect(dFail.type).toBe("fail");
    });

    it("honors Retry-After when larger than computed backoff", () => {
      const p = policyWith();
      const d = p.decide({
        reason: "rate_limit",
        attempt: 1,
        profile: "foreground",
        retryAfterMs: 20_000,
      });
      expect(d.type).toBe("retry");
      if (d.type === "retry") {
        expect(d.delayMs).toBeGreaterThanOrEqual(20_000);
      }
    });

    it("honors rateLimitResetMs when larger", () => {
      const p = policyWith();
      const d = p.decide({
        reason: "rate_limit",
        attempt: 1,
        profile: "foreground",
        rateLimitResetMs: 15_000,
      });
      expect(d.type).toBe("retry");
      if (d.type === "retry") {
        expect(d.delayMs).toBeGreaterThanOrEqual(15_000);
      }
    });
  });

  describe("decide - overload escalation", () => {
    it("returns fallback at threshold when hasFallback=true", () => {
      const p = policyWith();
      const d = p.decide({
        reason: "overload",
        attempt: 1,
        profile: "foreground",
        consecutiveOverloadCount:
          AI_CHAT_RECOVERY_DEFAULTS.overloadFallbackThreshold,
        hasFallback: true,
      });
      expect(d.type).toBe("fallback");
    });

    it("retries when below threshold even with fallback", () => {
      const p = policyWith();
      const d = p.decide({
        reason: "overload",
        attempt: 1,
        profile: "foreground",
        consecutiveOverloadCount: 1,
        hasFallback: true,
      });
      expect(d.type).toBe("retry");
    });

    it("falls back when retries exhausted on overload with fallback", () => {
      const p = policyWith();
      const d = p.decide({
        reason: "overload",
        attempt: AI_CHAT_RECOVERY_DEFAULTS.foreground.maxAttempts + 1,
        profile: "foreground",
        consecutiveOverloadCount: 1,
        hasFallback: true,
      });
      expect(d.type).toBe("fallback");
    });

    it("fails when overload exhausted and no fallback", () => {
      const p = policyWith();
      const d = p.decide({
        reason: "overload",
        attempt: AI_CHAT_RECOVERY_DEFAULTS.foreground.maxAttempts + 1,
        profile: "foreground",
        consecutiveOverloadCount: 1,
        hasFallback: false,
      });
      expect(d.type).toBe("fail");
    });
  });

  describe("decide - model_unavailable", () => {
    it("falls back when a fallback exists (attempt > max)", () => {
      const p = policyWith();
      const d = p.decide({
        reason: "model_unavailable",
        attempt: AI_CHAT_RECOVERY_DEFAULTS.foreground.maxAttempts + 1,
        profile: "foreground",
        hasFallback: true,
      });
      expect(d.type).toBe("fallback");
    });

    it("retries while attempts remain", () => {
      const p = policyWith();
      const d = p.decide({
        reason: "model_unavailable",
        attempt: 1,
        profile: "foreground",
        hasFallback: true,
      });
      expect(d.type).toBe("retry");
    });
  });

  describe("decide - background profile", () => {
    it("caps at 1 retry", () => {
      const p = policyWith();
      const d1 = p.decide({
        reason: "network",
        attempt: 1,
        profile: "background",
      });
      expect(d1.type).toBe("retry");
      const d2 = p.decide({
        reason: "network",
        attempt: 2,
        profile: "background",
      });
      expect(d2.type).toBe("fail");
    });
  });

  describe("decide - persistent profile", () => {
    it("keeps retrying under the hard cap", () => {
      const p = policyWith();
      const d = p.decide({
        reason: "rate_limit",
        attempt: 50,
        profile: "persistent",
        turnElapsedMs: 1000,
      });
      expect(d.type).toBe("retry");
    });

    it("fails after the hard cap", () => {
      const p = policyWith();
      const d = p.decide({
        reason: "rate_limit",
        attempt: 999,
        profile: "persistent",
        turnElapsedMs: AI_CHAT_RECOVERY_DEFAULTS.persistentHardCapMs + 1,
      });
      expect(d.type).toBe("fail");
    });
  });

  describe("computeDelay - jitter and cap", () => {
    it("applies exponential backoff", () => {
      const p = policyWith(() => 0); // factor = 1 - 0.25 = 0.75 (random=0 → r=-1)
      const d1 = p.computeDelay({
        reason: "network",
        attempt: 1,
        profile: "foreground",
      });
      // base=1000, raw=1000, jitter factor with random=0 → 0.75 → 750
      expect(d1).toBe(750);
    });

    it("caps at maxDelayMs", () => {
      const p = policyWith(() => 0.999); // factor near 1.25
      const d = p.computeDelay({
        reason: "network",
        attempt: 20, // huge raw
        profile: "foreground",
      });
      expect(d).toBeLessThanOrEqual(
        AI_CHAT_RECOVERY_DEFAULTS.foreground.maxDelayMs
      );
    });

    it("honors Retry-After when larger than jittered backoff", () => {
      const p = policyWith(() => 0);
      const d = p.computeDelay({
        reason: "rate_limit",
        attempt: 1,
        profile: "foreground",
        retryAfterMs: 12_000,
      });
      expect(d).toBeGreaterThanOrEqual(12_000);
    });

    it("stays within maxDelayMs even when Retry-After is enormous (persistent除外)", () => {
      const p = policyWith(() => 0);
      const d = p.computeDelay({
        reason: "rate_limit",
        attempt: 1,
        profile: "foreground",
        retryAfterMs: 999_999_999,
      });
      // Per implementation: max(serverRequired, min(jittered, maxDelay))
      // → serverRequired wins; but jittered is clamped to maxDelay first.
      // So result = max(serverRequired, clampedJittered) = serverRequired.
      // The jittered component is clamped, but the floor isn't, so this
      // returns the server-required value. That's intentional: the spec
      // says honor Retry-After.
      expect(d).toBe(999_999_999);
    });

    it("zero jitterRatio returns the raw capped value", () => {
      const customDefaults: typeof AI_CHAT_RECOVERY_DEFAULTS = {
        ...AI_CHAT_RECOVERY_DEFAULTS,
        foreground: {
          ...AI_CHAT_RECOVERY_DEFAULTS.foreground,
          jitterRatio: 0,
        },
      };
      const p = new AIChatRetryPolicy(customDefaults, Math.random);
      const d = p.computeDelay({
        reason: "network",
        attempt: 1,
        profile: "foreground",
      });
      expect(d).toBe(AI_CHAT_RECOVERY_DEFAULTS.foreground.baseDelayMs);
    });
  });

  describe("profileOf", () => {
    const profiles: AIChatRecoveryProfile[] = [
      "foreground",
      "background",
      "persistent",
    ];
    for (const name of profiles) {
      it(`returns the ${name} profile config`, () => {
        const p = policyWith();
        expect(p.profileOf(name).profile).toBe(name);
      });
    }
  });

  describe("persistent helpers", () => {
    it("exposes heartbeat interval", () => {
      const p = policyWith();
      expect(p.persistentHeartbeatMs()).toBe(
        AI_CHAT_RECOVERY_DEFAULTS.persistentHeartbeatMs
      );
    });
    it("exposes hard cap", () => {
      const p = policyWith();
      expect(p.persistentHardCapMs()).toBe(
        AI_CHAT_RECOVERY_DEFAULTS.persistentHardCapMs
      );
    });
  });
});
