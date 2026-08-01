import { describe, expect, it } from "vitest";
import {
  ToolPromptBudgetService,
  estimateToolTokens,
} from "@/service/ToolPromptBudgetService";
import type { OpenAITool } from "@/api/aiChatApi";

function tool(name: string, descSize = 100): OpenAITool {
  return {
    type: "function",
    function: {
      name,
      description: "x".repeat(descSize),
      parameters: { type: "object", properties: {} },
    },
  };
}

describe("estimateToolTokens", () => {
  it("estimates tokens from JSON length at ~4 chars/token", () => {
    const t = tool("a", 400);
    // JSON length > 400 (wrapping fields); tokens = ceil(len/4)
    const expected = Math.ceil(JSON.stringify(t).length / 4);
    expect(estimateToolTokens(t)).toBe(expected);
  });

  it("returns at least 1", () => {
    expect(estimateToolTokens(tool("a", 0))).toBeGreaterThanOrEqual(1);
  });
});

describe("ToolPromptBudgetService.resolveMode", () => {
  const svc = new ToolPromptBudgetService();

  it("off -> standard regardless of size", () => {
    const d = svc.resolveMode({
      configuredMode: "off",
      deferredEstimatedTokens: 999_999,
      contextWindowTokens: 8000,
    });
    expect(d.mode).toBe("standard");
    expect(d.configuredMode).toBe("off");
  });

  it("on -> deferred regardless of size", () => {
    const d = svc.resolveMode({
      configuredMode: "on",
      deferredEstimatedTokens: 0,
      contextWindowTokens: 8000,
    });
    expect(d.mode).toBe("deferred");
    expect(d.configuredMode).toBe("on");
  });

  it("auto -> deferred when deferred payload crosses the threshold", () => {
    const d = svc.resolveMode({
      configuredMode: "auto",
      deferredEstimatedTokens: 2000,
      contextWindowTokens: 10_000,
      thresholdPercent: 10,
    });
    // threshold = 1000; 2000 >= 1000 -> deferred
    expect(d.mode).toBe("deferred");
    expect(d.thresholdTokens).toBe(1000);
    expect(d.contextWindowTokens).toBe(10_000);
  });

  it("auto -> standard when deferred payload is below the threshold", () => {
    const d = svc.resolveMode({
      configuredMode: "auto",
      deferredEstimatedTokens: 500,
      contextWindowTokens: 10_000,
      thresholdPercent: 10,
    });
    expect(d.mode).toBe("standard");
  });

  it("auto uses fallback context window when none provided", () => {
    const small = svc.resolveMode({
      configuredMode: "auto",
      deferredEstimatedTokens: 100,
    });
    expect(small.mode).toBe("standard");
    const large = svc.resolveMode({
      configuredMode: "auto",
      deferredEstimatedTokens: 100_000,
    });
    expect(large.mode).toBe("deferred");
  });

  it("includes a human-readable reason", () => {
    const d = svc.resolveMode({
      configuredMode: "auto",
      deferredEstimatedTokens: 2000,
      contextWindowTokens: 10_000,
      thresholdPercent: 10,
    });
    expect(typeof d.reason).toBe("string");
    expect(d.reason.length).toBeGreaterThan(0);
  });
});
