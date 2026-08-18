import { describe, expect, it } from "vitest";
import {
  isValidLoopCount,
  parseAiGoalCommand,
} from "@/views/utils/aiGoalCommand";

describe("parseAiGoalCommand", () => {
  it("parses /goal with an objective", () => {
    expect(parseAiGoalCommand("/goal Build a scraper and verify it")).toEqual({
      type: "goal",
      objective: "Build a scraper and verify it",
    });
  });

  it("returns empty objective for bare /goal", () => {
    expect(parseAiGoalCommand("/goal")).toEqual({
      type: "goal",
      objective: "",
    });
  });

  it("parses /loop with a count", () => {
    expect(parseAiGoalCommand("/loop 5")).toEqual({
      type: "loop",
      count: 5,
    });
  });

  it("returns null count for bare /loop", () => {
    expect(parseAiGoalCommand("/loop")).toEqual({ type: "loop", count: null });
  });

  it("ignores non-command text", () => {
    expect(parseAiGoalCommand("just a message")).toEqual({ type: "none" });
    expect(parseAiGoalCommand("")).toEqual({ type: "none" });
  });

  it("ignores other slash commands", () => {
    expect(parseAiGoalCommand("/review something")).toEqual({ type: "none" });
  });

  it("is case-insensitive on the command name", () => {
    expect(parseAiGoalCommand("/GOAL do a thing")).toEqual({
      type: "goal",
      objective: "do a thing",
    });
  });
});

describe("isValidLoopCount", () => {
  it("accepts counts within bounds", () => {
    expect(isValidLoopCount(1)).toBe(true);
    expect(isValidLoopCount(5)).toBe(true);
    expect(isValidLoopCount(10)).toBe(true);
  });
  it("rejects counts outside bounds", () => {
    expect(isValidLoopCount(0)).toBe(false);
    expect(isValidLoopCount(11)).toBe(false);
    expect(isValidLoopCount(NaN)).toBe(false);
  });
});
