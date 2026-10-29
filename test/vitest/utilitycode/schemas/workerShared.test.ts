import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  parseWorkerMessage,
  parseWorkerMessageOrNull,
} from "@/schemas/worker/_shared";

// A small representative schema (mirrors the per-worker discriminatedUnion).
const testSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), id: z.number() }),
  z.object({ type: z.literal("shutdown") }),
]);

describe("parseWorkerMessage (R4.6 shared helper)", () => {
  it("returns success + the typed payload for a valid message", () => {
    const result = parseWorkerMessage<{ type: "ping"; id: number }>(
      { type: "ping", id: 7 },
      testSchema
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ type: "ping", id: 7 });
    }
  });

  it("returns failure (not throw) for a malformed message", () => {
    const result = parseWorkerMessage(
      { type: "ping", id: "not-a-number" },
      testSchema
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(typeof result.error).toBe("string");
      expect(result.error).toContain("id");
    }
  });

  it("returns failure for an unknown discriminator", () => {
    const result = parseWorkerMessage(
      { type: "mystery-event" },
      testSchema
    );
    expect(result.success).toBe(false);
  });

  it("never throws — null/undefined input is a failure", () => {
    expect(() => parseWorkerMessage(null, testSchema)).not.toThrow();
    expect(() => parseWorkerMessage(undefined, testSchema)).not.toThrow();
    expect(parseWorkerMessage(null, testSchema).success).toBe(false);
  });

  it("parseWorkerMessageOrNull returns data on success, null on failure", () => {
    expect(parseWorkerMessageOrNull({ type: "shutdown" }, testSchema)).toEqual({
      type: "shutdown",
    });
    expect(
      parseWorkerMessageOrNull({ type: "nope" }, testSchema)
    ).toBeNull();
  });
});
