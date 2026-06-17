// test/vitest/utilitycode/contextUsageUtil.test.ts
import { describe, it, expect } from "vitest";
import {
  computeContextPercent,
  resolveContextWindow,
  toneForPercent,
  DEFAULT_CONTEXT_WINDOW,
} from "@/views/components/aiChatV2/contextUsageUtil";

describe("resolveContextWindow", () => {
  it("returns the mapped window for a known model", () => {
    const map = new Map([["gpt-4o", 128000]]);
    expect(resolveContextWindow(map, "gpt-4o")).toBe(128000);
  });

  it("falls back to default when model is unknown", () => {
    const map = new Map([["gpt-4o", 128000]]);
    expect(resolveContextWindow(map, "unknown-model")).toBe(
      DEFAULT_CONTEXT_WINDOW
    );
  });

  it("falls back to default when no model provided", () => {
    expect(resolveContextWindow(new Map(), undefined)).toBe(
      DEFAULT_CONTEXT_WINDOW
    );
  });

  it("ignores non-positive stored windows", () => {
    const map = new Map([
      ["bad", 0],
      ["worse", -1],
    ]);
    expect(resolveContextWindow(map, "bad")).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow(map, "worse")).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe("computeContextPercent", () => {
  it("returns 0 when nothing has been used yet", () => {
    expect(
      computeContextPercent({
        modelContextWindows: new Map(),
        streamingEstimatedTokens: 0,
      })
    ).toBe(0);
  });

  it("computes percentage using the known model window", () => {
    const map = new Map([["gpt-4o", 128000]]);
    const pct = computeContextPercent({
      modelContextWindows: map,
      streamingEstimatedTokens: 64000,
      model: "gpt-4o",
    });
    expect(pct).toBe(50);
  });

  it("prefers streaming estimate over lastTotalTokens", () => {
    const map = new Map([["gpt-4o", 128000]]);
    const pct = computeContextPercent({
      modelContextWindows: map,
      lastTotalTokens: 10000,
      streamingEstimatedTokens: 32000,
      model: "gpt-4o",
    });
    expect(pct).toBe(25);
  });

  it("falls back to lastTotalTokens when estimate is 0", () => {
    const map = new Map([["gpt-4o", 128000]]);
    const pct = computeContextPercent({
      modelContextWindows: map,
      lastTotalTokens: 25600,
      streamingEstimatedTokens: 0,
      model: "gpt-4o",
    });
    expect(pct).toBe(20);
  });

  it("uses default window when model is unknown", () => {
    const pct = computeContextPercent({
      modelContextWindows: new Map(),
      streamingEstimatedTokens: DEFAULT_CONTEXT_WINDOW,
      model: "unknown",
    });
    expect(pct).toBe(100);
  });

  it("caps at 100 when usage exceeds window", () => {
    const map = new Map([["small", 1000]]);
    const pct = computeContextPercent({
      modelContextWindows: map,
      streamingEstimatedTokens: 5000,
      model: "small",
    });
    expect(pct).toBe(100);
  });

  it("treats negative estimate as 0", () => {
    const map = new Map([["m", 1000]]);
    const pct = computeContextPercent({
      modelContextWindows: map,
      streamingEstimatedTokens: -50,
      model: "m",
    });
    expect(pct).toBe(0);
  });
});

describe("toneForPercent", () => {
  it("returns low for under 50", () => {
    expect(toneForPercent(0)).toBe("low");
    expect(toneForPercent(49)).toBe("low");
  });

  it("returns mid for 50–79", () => {
    expect(toneForPercent(50)).toBe("mid");
    expect(toneForPercent(79)).toBe("mid");
  });

  it("returns high for 80–94", () => {
    expect(toneForPercent(80)).toBe("high");
    expect(toneForPercent(94)).toBe("high");
  });

  it("returns critical at 95 and above", () => {
    expect(toneForPercent(95)).toBe("critical");
    expect(toneForPercent(100)).toBe("critical");
  });

  it("clamps above 100 to critical", () => {
    expect(toneForPercent(150)).toBe("critical");
  });

  it("treats NaN as low", () => {
    expect(toneForPercent(Number.NaN)).toBe("low");
  });
});
