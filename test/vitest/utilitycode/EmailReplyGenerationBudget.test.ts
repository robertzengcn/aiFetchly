import { describe, it, expect } from "vitest";
import { clampReplyMaxTokens } from "@/service/emailReply/EmailReplyGenerationBudget";

/**
 * G01/FR-027: the capability clamp narrows the configured output budget
 * against the provider-reported max output tokens, but NEVER widens it and
 * NEVER clamps to an unusable 0. The regression this catches: a model that
 * reports a small `max_tokens` either silently truncates every reply (no
 * clamp) or gets a 0-token request the provider rejects (clamp to 0).
 */
describe("clampReplyMaxTokens (FR-027)", () => {
  const CONFIGURED = 1500;

  it("narrows to the provider cap when the cap is smaller", () => {
    expect(clampReplyMaxTokens(CONFIGURED, 800)).toBe(800);
    expect(clampReplyMaxTokens(CONFIGURED, 1)).toBe(1);
  });

  it("does NOT widen beyond the configured budget when the cap is larger", () => {
    expect(clampReplyMaxTokens(CONFIGURED, 3000)).toBe(CONFIGURED);
    expect(clampReplyMaxTokens(CONFIGURED, 1_000_000)).toBe(CONFIGURED);
  });

  it("falls back to the configured budget when the cap is unknown (undefined)", () => {
    expect(clampReplyMaxTokens(CONFIGURED, undefined)).toBe(CONFIGURED);
  });

  it("falls back to the configured budget when the cap is unusable (0, negative, NaN, Infinity)", () => {
    expect(clampReplyMaxTokens(CONFIGURED, 0)).toBe(CONFIGURED);
    expect(clampReplyMaxTokens(CONFIGURED, -5)).toBe(CONFIGURED);
    expect(clampReplyMaxTokens(CONFIGURED, Number.NaN)).toBe(CONFIGURED);
    expect(clampReplyMaxTokens(CONFIGURED, Number.POSITIVE_INFINITY)).toBe(
      CONFIGURED
    );
    expect(clampReplyMaxTokens(CONFIGURED, Number.NEGATIVE_INFINITY)).toBe(
      CONFIGURED
    );
  });

  it("floors a fractional cap to an integer", () => {
    expect(clampReplyMaxTokens(CONFIGURED, 800.9)).toBe(800);
    expect(clampReplyMaxTokens(CONFIGURED, 999.1)).toBe(999);
  });

  it("never returns 0 — a tiny cap yields at least 1 so the request is not rejected outright", () => {
    expect(clampReplyMaxTokens(CONFIGURED, 0.5)).toBe(1);
  });

  it("preserves a configured budget smaller than the cap (configured is the floor of the narrowing)", () => {
    // An operator who deliberately configured maxTokens=400 keeps 400 even if
    // the model reports 8192 — the configured value is the ceiling, not a
    // starting point to widen from.
    expect(clampReplyMaxTokens(400, 8192)).toBe(400);
    expect(clampReplyMaxTokens(400, undefined)).toBe(400);
  });
});
