import { describe, expect, it } from "vitest";
import { toolResultSearchInputSchema } from "@/schemas/toolResult";
import { clampToolResultSearchArgs } from "@/service/agentTools/toolResultSearchTool";

const outputId = "out_" + "a".repeat(32);

function parsedMax(args: Record<string, unknown>): number | undefined {
  const clamped = clampToolResultSearchArgs(args);
  const parsed = toolResultSearchInputSchema.safeParse(clamped);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return undefined;
  return parsed.data.max_matches;
}

describe("clampToolResultSearchArgs", () => {
  it("caps the 30 and 50 match counts that were rejected in chat", () => {
    expect(
      parsedMax({
        output_id: outputId,
        query: "subject",
        max_matches: 50,
      })
    ).toBe(20);
    expect(
      parsedMax({
        output_id: outputId,
        query: "fromName",
        max_matches: 30,
      })
    ).toBe(20);
  });

  it("keeps an in-range count and omits a missing count", () => {
    expect(
      parsedMax({
        output_id: outputId,
        query: "classification",
        max_matches: 10,
      })
    ).toBe(10);
    expect(
      parsedMax({
        output_id: outputId,
        query: "classification",
      })
    ).toBeUndefined();
  });

  it("accepts a numeric string and floors a fractional count before capping", () => {
    expect(
      parsedMax({
        output_id: outputId,
        query: "subject",
        max_matches: "30",
      })
    ).toBe(20);
    expect(
      parsedMax({
        output_id: outputId,
        query: "subject",
        max_matches: 1.9,
      })
    ).toBe(1);
  });

  it("still rejects an empty query", () => {
    const parsed = toolResultSearchInputSchema.safeParse(
      clampToolResultSearchArgs({
        output_id: outputId,
        query: "",
        max_matches: 50,
      })
    );
    expect(parsed.success).toBe(false);
  });
});
