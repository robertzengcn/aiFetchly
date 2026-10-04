import { describe, expect, it } from "vitest";
import {
  TOOL_RESULT_CONFIG,
  TOOL_RESULT_DEFAULTS,
  TOOL_RESULT_FLAGS,
  TOOL_RESULT_POLICY_VERSION,
  resolveToolResultConfig,
} from "@/config/toolResultConfig";
import {
  boundString,
  boundUntrustedValue,
  countTextTokens,
  fitsUtf8Bytes,
  truncateAtLineBoundary,
  truncateUtf8Safe,
  utf8ByteLength,
} from "@/service/ToolResultTextUtil";

/**
 * Config validation and the shared counting/truncation helpers.
 *
 * The rejection (not clamping) behaviour matters: an override that is silently
 * clamped could still WIDEN a ceiling relative to what the operator intended,
 * and a bad deployment should be loud rather than quietly permissive.
 */
describe("toolResultConfig", () => {
  it("mirrors the PRD defaults table", () => {
    expect(TOOL_RESULT_CONFIG.inlineMaxBytes).toBe(16 * 1024);
    expect(TOOL_RESULT_CONFIG.previewMaxBytes).toBe(2 * 1024);
    expect(TOOL_RESULT_CONFIG.readMaxBytes).toBe(8 * 1024);
    expect(TOOL_RESULT_CONFIG.receiptMaxBytes).toBe(4 * 1024);
    expect(TOOL_RESULT_CONFIG.artifactMaxBytes).toBe(64 * 1024 * 1024);
    expect(TOOL_RESULT_CONFIG.conversationQuotaBytes).toBe(1024 * 1024 * 1024);
    expect(TOOL_RESULT_CONFIG.profileQuotaBytes).toBe(5 * 1024 * 1024 * 1024);
    expect(TOOL_RESULT_CONFIG.minimumFreeDiskBytes).toBe(128 * 1024 * 1024);
    expect(TOOL_RESULT_CONFIG.retrievalMaxCalls).toBe(32);
    expect(TOOL_RESULT_CONFIG.retrievalMaxTokensPerTurn).toBe(32_000);
    expect(TOOL_RESULT_CONFIG.uiReadMaxBytes).toBe(32 * 1024);
    expect(TOOL_RESULT_CONFIG.orphanGraceHours).toBe(24);
  });

  it("uses powers of 1024 for KiB/MiB, not 1000", () => {
    expect(TOOL_RESULT_CONFIG.inlineMaxBytes).toBe(16384);
    expect(TOOL_RESULT_CONFIG.artifactMaxBytes).toBe(67_108_864);
  });

  it("accepts a valid override", () => {
    const { config, rejectedKeys } = resolveToolResultConfig({
      inlineMaxBytes: 4096,
    });
    expect(config.inlineMaxBytes).toBe(4096);
    expect(rejectedKeys).toEqual([]);
  });

  it("rejects a non-positive or non-integer override rather than clamping", () => {
    const { config, rejectedKeys } = resolveToolResultConfig({
      inlineMaxBytes: 0,
      previewMaxBytes: -5,
      readMaxBytes: 1.5,
      artifactMaxBytes: Number.NaN,
    });
    // Every bad value falls back to the documented default.
    expect(config.inlineMaxBytes).toBe(TOOL_RESULT_DEFAULTS.inlineMaxBytes);
    expect(config.previewMaxBytes).toBe(TOOL_RESULT_DEFAULTS.previewMaxBytes);
    expect(config.readMaxBytes).toBe(TOOL_RESULT_DEFAULTS.readMaxBytes);
    expect(config.artifactMaxBytes).toBe(TOOL_RESULT_DEFAULTS.artifactMaxBytes);
    expect(rejectedKeys).toHaveLength(4);
  });

  it("bounds fractions to (0, 1]", () => {
    expect(resolveToolResultConfig({ resultInputFraction: 0 }).config.resultInputFraction)
      .toBe(TOOL_RESULT_DEFAULTS.resultInputFraction);
    expect(resolveToolResultConfig({ resultInputFraction: 1.5 }).config.resultInputFraction)
      .toBe(TOOL_RESULT_DEFAULTS.resultInputFraction);
    expect(resolveToolResultConfig({ resultInputFraction: 0.5 }).config.resultInputFraction)
      .toBe(0.5);
    expect(resolveToolResultConfig({ resultInputFraction: 1 }).config.resultInputFraction)
      .toBe(1);
  });

  it("ignores undefined overrides", () => {
    const { config, rejectedKeys } = resolveToolResultConfig({
      inlineMaxBytes: undefined,
    });
    expect(config.inlineMaxBytes).toBe(TOOL_RESULT_DEFAULTS.inlineMaxBytes);
    expect(rejectedKeys).toEqual([]);
  });

  it("keeps a policy version so stale projections can be invalidated", () => {
    expect(TOOL_RESULT_POLICY_VERSION).toMatch(/^tool-result-policy-v/);
  });

  it("names three independent, fail-closed rollout flags", () => {
    expect(TOOL_RESULT_FLAGS.capture).toBe("ai_tool_output_capture_enabled");
    expect(TOOL_RESULT_FLAGS.modelRefs).toBe("ai_tool_output_model_refs_enabled");
    expect(TOOL_RESULT_FLAGS.ui).toBe("ai_tool_output_ui_enabled");
  });
});

describe("ToolResultTextUtil", () => {
  it("truncates without splitting a surrogate pair (AC-06)", () => {
    const value = "a".repeat(10) + "🎉" + "b".repeat(10);
    // Cut in the middle of the emoji's 4-byte sequence.
    const cut = truncateUtf8Safe(value, 12);
    expect(cut).not.toContain("\ufffd");
    expect(cut.endsWith("a".repeat(2))).toBe(true);
  });

  it("never exceeds the requested byte budget", () => {
    const value = "漢".repeat(1000);
    for (const budget of [1, 2, 3, 7, 64, 999]) {
      expect(utf8ByteLength(truncateUtf8Safe(value, budget))).toBeLessThanOrEqual(budget);
    }
  });

  it("returns short values unchanged", () => {
    expect(truncateUtf8Safe("short", 1000)).toBe("short");
    expect(truncateUtf8Safe("", 10)).toBe("");
  });

  it("prefers a nearby line boundary for a text preview", () => {
    // Two complete short lines, then a very long one. Truncating at 120 bytes
    // lands inside the long line, but the boundary before it is within reach,
    // so the preview should stop at the end of the second line instead of
    // cutting the third record in half.
    const value = `${"a".repeat(50)}\n${"b".repeat(50)}\n${"c".repeat(500)}`;
    const cut = truncateAtLineBoundary(value, 120);
    expect(cut).toBe(`${"a".repeat(50)}\n${"b".repeat(50)}`);
  });

  it("keeps a full-width preview when a single line is very long", () => {
    const value = "z".repeat(10_000);
    // No newline within reach, so the preview must still use its allowance
    // rather than collapsing to nothing.
    expect(utf8ByteLength(truncateAtLineBoundary(value, 100))).toBeGreaterThan(50);
  });

  it("counts one token per UTF-8 byte, never bytes/4", () => {
    // 4 ASCII chars would be 1 token under the naive heuristic; the design
    // deliberately charges 4 so a request that fits locally also fits at the
    // provider.
    expect(countTextTokens("abcd")).toBe(4);
    expect(countTextTokens("abcd", 4)).toBe(8);
    // CJK is under-counted by bytes/4 and must not be here.
    expect(countTextTokens("你好")).toBe(6);
  });

  it("reports whether text fits a byte budget", () => {
    expect(fitsUtf8Bytes("abc", 3)).toBe(true);
    expect(fitsUtf8Bytes("abc", 2)).toBe(false);
  });

  it("bounds an untrusted string", () => {
    expect(boundString("x".repeat(100), 10)).toHaveLength(10);
    expect(boundString("short", 10)).toBe("short");
  });

  it("bounds keys, array items, and strings of an untrusted object", () => {
    const shaped = boundUntrustedValue(
      {
        keep: "ok",
        longKeyValue: "y".repeat(500),
        list: Array.from({ length: 200 }, (_, i) => i),
        deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } },
      },
      { maxKeys: 10, maxArrayItems: 5, maxStringChars: 20 }
    ) as Record<string, unknown>;
    expect(shaped.keep).toBe("ok");
    expect(String(shaped.longKeyValue).length).toBeLessThanOrEqual(21);
    expect((shaped.list as unknown[]).length).toBeLessThanOrEqual(6);
    // Bounded items carry an explicit marker rather than a silent truncation.
    expect(String((shaped.list as unknown[]).at(-1))).toMatch(/more/);
    expect(JSON.stringify(shaped)).toContain("max_depth");
  });

  it("does not invoke getters or toJSON when shaping a value", () => {
    let invoked = false;
    const value = {
      plain: 1,
      get trap(): string {
        invoked = true;
        return "nope";
      },
    };
    const shaped = boundUntrustedValue(value, {
      maxKeys: 10,
      maxArrayItems: 5,
      maxStringChars: 20,
    });
    expect(invoked).toBe(false);
    expect(shaped).toHaveProperty("plain", 1);
  });

  it("replaces unsupported values with a marker instead of expanding them", () => {
    const shaped = boundUntrustedValue(
      { fn: () => 1, sym: Symbol("s"), big: BigInt(1) },
      { maxKeys: 10, maxArrayItems: 5, maxStringChars: 20 }
    ) as Record<string, unknown>;
    expect(shaped.fn).toBe("[function]");
    expect(shaped.sym).toBe("[symbol]");
    expect(shaped.big).toBe("[bigint]");
  });

  it("marks a non-plain object rather than walking it", () => {
    class Custom {
      value = 1;
    }
    const shaped = boundUntrustedValue(
      { custom: new Custom() },
      { maxKeys: 10, maxArrayItems: 5, maxStringChars: 20 }
    ) as Record<string, unknown>;
    expect(shaped.custom).toBe("[unsupported]");
  });
});
