import { describe, expect, it } from "vitest";
import {
  OMITTED_REGION_MARKER,
  ToolResultPreviewService,
} from "@/service/toolResult/ToolResultPreviewService";
import { ToolResultBudgetService } from "@/service/toolResult/ToolResultBudgetService";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import { utf8ByteLength } from "@/service/ToolResultTextUtil";

/**
 * Preview and aggregate-budget tests.
 *
 * Two properties matter most and are easy to get wrong:
 *   - a preview must never IMPLY complete coverage (design §7.3),
 *   - aggregate pressure must be resolved by externalizing the LARGEST
 *     results first, and must never drop a result or invent argument history
 *     to make a request fit.
 */

const preview = new ToolResultPreviewService();
const budget = new ToolResultBudgetService();

describe("ToolResultPreviewService", () => {
  it("marks a small complete text preview as complete", () => {
    const result = preview.build({
      text: "short output",
      kind: "text",
      isComplete: true,
    });
    expect(result.text).toBe("short output");
    expect(result.previewComplete).toBe(true);
  });

  it("marks a truncated preview as incomplete and says how to read more", () => {
    const result = preview.build({
      text: "x".repeat(10_000),
      kind: "text",
      isComplete: false,
    });
    expect(result.previewComplete).toBe(false);
    expect(utf8ByteLength(result.text)).toBeLessThanOrEqual(
      TOOL_RESULT_CONFIG.previewMaxBytes + 200
    );
    expect(result.text).toMatch(/saved output reference/i);
  });

  it("shows head and tail with an explicit omitted-region marker", () => {
    const head = "HEAD-MARKER".repeat(50);
    const tail = "TAIL-MARKER".repeat(50);
    const result = preview.build({
      text: `${head}${"m".repeat(20_000)}${tail}`,
      kind: "head_tail",
      isComplete: false,
    });
    expect(result.text).toContain("HEAD-MARKER");
    expect(result.text).toContain("TAIL-MARKER");
    // Without the marker, head+tail would read as if it were continuous.
    expect(result.text).toContain(OMITTED_REGION_MARKER);
    expect(result.previewComplete).toBe(false);
  });

  it("summarizes record results with counts, field names, and whole records", () => {
    const records = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      name: `Business ${i}`,
      url: `https://example.com/${i}`,
    }));
    const result = preview.build({
      value: records,
      kind: "records",
      isComplete: true,
    });
    expect(result.recordCount).toBe(500);
    expect(result.fieldNames).toEqual(["id", "name", "url"]);
    expect(result.text).toContain("500 records");
    // Sampled records must be COMPLETE JSON objects, not a raw prefix.
    const sampleLine = result.text.split("\n")[1];
    expect(() => JSON.parse(sampleLine)).not.toThrow();
    expect(result.previewComplete).toBe(false);
  });

  it("marks a fully sampled record set as complete", () => {
    const result = preview.build({
      value: [{ id: 1 }, { id: 2 }],
      kind: "records",
      isComplete: true,
    });
    expect(result.previewComplete).toBe(true);
  });

  it("prefers complete records over a minified JSON prefix", () => {
    // Large enough that a raw text preview cannot show all of it.
    const value = {
      rows: Array.from({ length: 5000 }, (_, i) => ({
        i,
        blob: "x".repeat(60),
      })),
    };
    const recordForm = preview.build({
      value: value.rows,
      kind: "records",
      isComplete: true,
    });
    const textForm = preview.build({ value, kind: "text", isComplete: true });
    // The record preview is line-oriented and each sampled line is a whole
    // object; the text preview of the same object is one long unparseable line.
    expect(recordForm.text.split("\n").length).toBeGreaterThan(2);
    expect(textForm.previewComplete).toBe(false);
    expect(() => JSON.parse(recordForm.text.split("\n")[1])).not.toThrow();
  });

  it("summarizes unknown JSON shape without emitting invalid JSON", () => {
    const result = preview.build({
      value: { total: 42, name: "Acme", nested: { a: 1 }, list: [1, 2, 3] },
      kind: "records",
      isComplete: true,
    });
    expect(result.text).toContain("total");
    expect(result.text).toContain("Acme");
    // A bounded projection of a large object is NOT valid JSON, and must not
    // be presented as if it were.
    expect(() => JSON.parse(result.text)).toThrow();
  });

  it("reports an empty output explicitly rather than inventing an error", () => {
    const result = preview.build({ text: "", kind: "text", isComplete: true });
    expect(result.text).toBe("(empty output)");
    expect(result.previewComplete).toBe(true);
  });

  it("does not cut a multi-byte character in a text preview", () => {
    const result = preview.build({
      text: "漢".repeat(5000),
      kind: "text",
      isComplete: false,
    });
    expect(result.text).not.toContain("\ufffd");
  });
});

describe("ToolResultBudgetService — allocation", () => {
  it("computes the design's allocation formulas", () => {
    // C=8192, O=1024, M=ceil(0.1*8192)=820 => U=6348
    const allocation = budget.allocate({
      limits: { contextLimit: 8192, outputLimit: 4096 },
      outputReserve: 1024,
      fixedInputTokens: 1000,
    });
    expect(allocation.usableInputCapacity).toBe(6348);
    // B_results = min(floor(0.25*6348), 6348-1000) = min(1587, 5348) = 1587
    expect(allocation.resultsBudget).toBe(1587);
    // T_inline = min(2000, floor(0.1*6348)=634, 1587) = 634
    expect(allocation.perInlineResultTokens).toBe(634);
  });

  it("scales the allocation with the selected model (AC-08)", () => {
    const small = budget.allocate({
      limits: { contextLimit: 8_192, outputLimit: 4_096 },
      outputReserve: 1_024,
      fixedInputTokens: 1_000,
    });
    const large = budget.allocate({
      limits: { contextLimit: 128_000, outputLimit: 8_192 },
      outputReserve: 4_000,
      fixedInputTokens: 1_000,
    });
    expect(large.resultsBudget).toBeGreaterThan(small.resultsBudget);
    expect(large.perInlineResultTokens).toBe(TOOL_RESULT_CONFIG.inlineMaxTokens);
  });

  it("caps the output reservation at the model output limit", () => {
    const allocation = budget.allocate({
      limits: { contextLimit: 100_000, outputLimit: 1_000 },
      outputReserve: 50_000,
      fixedInputTokens: 0,
    });
    // M = 10000, U = 100000 - 1000 - 10000 = 89000
    expect(allocation.usableInputCapacity).toBe(89_000);
  });

  it("flags when fixed content alone exhausts capacity", () => {
    const allocation = budget.allocate({
      limits: { contextLimit: 8_192, outputLimit: 1_024 },
      outputReserve: 1_024,
      fixedInputTokens: 100_000,
    });
    expect(allocation.fixedContentExhaustsCapacity).toBe(true);
  });
});

describe("ToolResultBudgetService — aggregate reduction", () => {
  const limits = { contextLimit: 8_192, outputLimit: 4_096 };

  it("leaves small results alone when the budget is not exceeded", () => {
    const allocation = budget.allocate({ limits, outputReserve: 1_024, fixedInputTokens: 100 });
    const bodies = [
      { key: "a", content: "small result a", isReceipt: false },
      { key: "b", content: "small result b", isReceipt: false },
    ];
    const result = budget.reduce({ bodies, allocation, externalize: () => bodies[0] });
    expect(result.reducedAny).toBe(false);
    expect(result.errorCode).toBeUndefined();
  });

  it("externalizes the largest results first when the budget is exceeded (AC-03)", () => {
    // 20 medium results, each ~1000 tokens (1 token per byte accounting).
    const bodies = Array.from({ length: 20 }, (_, i) => ({
      key: `r${i}`,
      content: "z".repeat(1000),
      isReceipt: false,
    })) as Array<{ key: string; content: string; isReceipt: boolean }>;
    // Make one clearly the largest.
    bodies[7] = { key: "r7", content: "z".repeat(9000), isReceipt: false };

    const allocation = budget.allocate({
      limits,
      outputReserve: 1_024,
      fixedInputTokens: 500,
    });
    const externalized: string[] = [];
    const result = budget.reduce({
      bodies,
      allocation,
      externalize: (body) => {
        externalized.push(body.key);
        return { key: body.key, content: `receipt:${body.key}`, isReceipt: true };
      },
    });
    expect(result.reducedAny).toBe(true);
    expect(result.totalTokensAfter).toBeLessThanOrEqual(allocation.resultsBudget);
    expect(result.errorCode).toBeUndefined();
    // The biggest body is the first thing sacrificed.
    expect(externalized[0]).toBe("r7");
  });

  it("drops optional previews before externalizing whole results", () => {
    const allocation = budget.allocate({
      limits: { contextLimit: 20_000, outputLimit: 4_096 },
      outputReserve: 1_024,
      fixedInputTokens: 1_000,
    });
    // Sized so the body only fits if the optional preview is given up:
    // content(4000) + preview(2000) exceeds the budget, content(4000) alone
    // fits inside it.
    const bodies = [
      {
        key: "a",
        content: "x".repeat(4_000),
        isReceipt: true,
        preview: "p".repeat(2_000),
      },
    ];
    const externalized: string[] = [];
    const result = budget.reduce({
      bodies,
      allocation,
      externalize: (b) => {
        externalized.push(b.key);
        return b;
      },
    });
    // The preview is the cheapest thing to give up, so the body itself
    // survives and no result is externalized.
    expect(externalized).toHaveLength(0);
    expect(result.bodies[0].preview).toBeUndefined();
    expect(result.reducedAny).toBe(true);
  });

  it("never removes a result that is already a receipt", () => {
    const allocation = budget.allocate({
      limits: { contextLimit: 8_192, outputLimit: 1_024 },
      outputReserve: 1_024,
      fixedInputTokens: 6_000,
    });
    const bodies = [
      { key: "a", content: "r".repeat(1_000), isReceipt: true },
      { key: "b", content: "r".repeat(1_000), isReceipt: true },
    ];
    const result = budget.reduce({
      bodies,
      allocation,
      externalize: (b) => b,
    });
    // Mandatory pairing survives; the caller gets a truthful budget error.
    expect(result.bodies).toHaveLength(2);
    expect(result.errorCode).toBe("CONTEXT_REQUIRED_CONTENT_TOO_LARGE");
  });

  it("reports a capacity error instead of stripping results when fixed content is too large", () => {
    const allocation = budget.allocate({
      limits,
      outputReserve: 1_024,
      fixedInputTokens: 100_000,
    });
    const bodies = [{ key: "a", content: "small", isReceipt: false }];
    const result = budget.reduce({ bodies, allocation, externalize: (b) => b });
    expect(result.errorCode).toBe("CONTEXT_REQUIRED_CONTENT_TOO_LARGE");
    expect(result.bodies).toHaveLength(1);
  });

  it("treats a body above the inline byte ceiling as ineligible inline", () => {
    const allocation = budget.allocate({ limits, outputReserve: 1_024, fixedInputTokens: 0 });
    const small = { key: "a", content: "tiny", isReceipt: false };
    const huge = { key: "b", content: "z".repeat(TOOL_RESULT_CONFIG.inlineMaxBytes + 1), isReceipt: false };
    expect(budget.isEligibleInline(small, allocation)).toBe(true);
    expect(budget.isEligibleInline(huge, allocation)).toBe(false);
  });
});

describe("ToolResultBudgetService — transport ceiling", () => {
  it("accepts a request under the transport ceiling", () => {
    const result = budget.checkSerializedBody({
      messages: [{ content: "hello" }],
    });
    expect(result.ok).toBe(true);
  });

  it("reports REQUEST_BODY_TOO_LARGE rather than dropping content (AC-26)", () => {
    const result = budget.checkSerializedBody({
      messages: [{ content: "x".repeat(9 * 1024 * 1024) }],
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("REQUEST_BODY_TOO_LARGE");
  });

  it("counts tool definitions toward the body size", () => {
    const result = budget.checkSerializedBody({
      messages: [{ content: "hi" }],
      toolsJson: "y".repeat(1000),
      ceilingBytes: 500,
    });
    expect(result.ok).toBe(false);
  });
});
