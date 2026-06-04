/**
 * Unit tests for ShellRateLimiter — concurrent, per-minute, and cooldown enforcement.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SkillExecutor } from "@/service/SkillExecutor";

describe("ShellRateLimiter", () => {
  beforeEach(() => {
    SkillExecutor.rateLimiter.reset();
  });

  it("allows first request", () => {
    const result = SkillExecutor.rateLimiter.check();
    expect(result.allowed).toBe(true);
  });

  it("blocks when concurrent limit is reached", () => {
    // Acquire max concurrent slots
    SkillExecutor.rateLimiter.acquire();
    SkillExecutor.rateLimiter.acquire();

    // Third concurrent should be blocked
    const result = SkillExecutor.rateLimiter.check();
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("concurrent");
    }
  });

  it("allows after a slot is released (respects cooldown)", async () => {
    SkillExecutor.rateLimiter.acquire();
    SkillExecutor.rateLimiter.acquire();

    // Release one slot
    SkillExecutor.rateLimiter.release();

    // Wait for cooldown to elapse (500ms)
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Should now be allowed
    const result = SkillExecutor.rateLimiter.check();
    expect(result.allowed).toBe(true);
  });

  it("blocks when per-minute limit is reached", () => {
    // Simulate maxPerMinute acquisitions (15)
    for (let i = 0; i < 15; i++) {
      SkillExecutor.rateLimiter.acquire();
    }
    // Release all so concurrent limit doesn't interfere
    for (let i = 0; i < 15; i++) {
      SkillExecutor.rateLimiter.release();
    }

    // 16th check should be blocked by per-minute limit
    const result = SkillExecutor.rateLimiter.check();
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("rate limit");
    }
  });

  it("blocks when cooldown has not elapsed", () => {
    SkillExecutor.rateLimiter.acquire();
    SkillExecutor.rateLimiter.release();

    // Immediately check again — cooldown is 500ms
    const result = SkillExecutor.rateLimiter.check();
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("cooldown");
    }
  });

  it("reset clears all state", () => {
    SkillExecutor.rateLimiter.acquire();
    SkillExecutor.rateLimiter.acquire();
    SkillExecutor.rateLimiter.reset();

    // Should be allowed after reset
    const result = SkillExecutor.rateLimiter.check();
    expect(result.allowed).toBe(true);
  });

  it("release does not go below zero", () => {
    SkillExecutor.rateLimiter.release();
    SkillExecutor.rateLimiter.release();

    // Should still work fine
    const result = SkillExecutor.rateLimiter.check();
    expect(result.allowed).toBe(true);
  });
});
