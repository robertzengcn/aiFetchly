import { describe, expect, it } from "vitest";
import { normalizeEmailServiceIds } from "@/service/outboundEmail/resolveOutboundSender";

describe("normalizeEmailServiceIds", () => {
  it("accepts a number array", () => {
    expect(normalizeEmailServiceIds([3, 7, 3])).toEqual([3, 7]);
  });

  it("wraps a single number", () => {
    expect(normalizeEmailServiceIds(5)).toEqual([5]);
  });

  it("coerces numeric strings and drops invalid values", () => {
    expect(normalizeEmailServiceIds(["2", "x", "0", "-1", "2"])).toEqual([2]);
  });

  it("splits a comma-separated string", () => {
    expect(normalizeEmailServiceIds("4, 8")).toEqual([4, 8]);
  });

  it("returns an empty list for missing input", () => {
    expect(normalizeEmailServiceIds(undefined)).toEqual([]);
    expect(normalizeEmailServiceIds(null)).toEqual([]);
    expect(normalizeEmailServiceIds("")).toEqual([]);
  });
});
