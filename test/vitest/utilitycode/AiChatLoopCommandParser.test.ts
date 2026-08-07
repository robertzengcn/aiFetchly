import { describe, expect, it } from "vitest";
import {
  parseAiLoopCommand,
  parseScheduledLoopDuration,
} from "@/service/slashCommands/AiChatLoopCommandParser";
import {
  SCHEDULED_LOOP_DEFAULT_MAX_LIFETIME_MS,
  SCHEDULED_LOOP_DEFAULT_MAX_RUNS,
} from "@/config/aiChatScheduledLoopConfig";

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 24 * MS_HOUR;

describe("parseScheduledLoopDuration", () => {
  it("parses minutes and hours", () => {
    expect(parseScheduledLoopDuration("5m")).toEqual({
      value: 5,
      unit: "m",
      milliseconds: 5 * MS_MIN,
    });
    expect(parseScheduledLoopDuration("2h")).toEqual({
      value: 2,
      unit: "h",
      milliseconds: 2 * MS_HOUR,
    });
  });

  it("is case-insensitive on the unit", () => {
    expect(parseScheduledLoopDuration("5M")?.unit).toBe("m");
    expect(parseScheduledLoopDuration("3H")?.unit).toBe("h");
  });

  it("rejects zero, negatives, decimals, unknown units, and missing units", () => {
    expect(parseScheduledLoopDuration("0m")).toBeNull();
    expect(parseScheduledLoopDuration("-5m")).toBeNull();
    expect(parseScheduledLoopDuration("1.5h")).toBeNull();
    expect(parseScheduledLoopDuration("5d")).toBeNull();
    expect(parseScheduledLoopDuration("5")).toBeNull();
    expect(parseScheduledLoopDuration("5min")).toBeNull();
    expect(parseScheduledLoopDuration("")).toBeNull();
    expect(parseScheduledLoopDuration("m")).toBeNull();
  });

  it("rejects values that overflow safe integer arithmetic", () => {
    expect(parseScheduledLoopDuration("99999999999999m")).toBeNull();
  });
});

describe("parseAiLoopCommand - non-commands", () => {
  it("returns none for ordinary messages", () => {
    expect(parseAiLoopCommand("just a message")).toEqual({ type: "none" });
    expect(parseAiLoopCommand("")).toEqual({ type: "none" });
  });

  it("returns none for other slash commands", () => {
    expect(parseAiLoopCommand("/review something")).toEqual({ type: "none" });
    expect(parseAiLoopCommand("/goal do a thing")).toEqual({ type: "none" });
  });
});

describe("parseAiLoopCommand - goal loop (backward compatible)", () => {
  it("classifies bare /loop as goal_loop with null iterations", () => {
    expect(parseAiLoopCommand("/loop")).toEqual({
      type: "goal_loop",
      maxIterations: null,
    });
  });

  it("classifies /loop <integer> as goal_loop", () => {
    expect(parseAiLoopCommand("/loop 5")).toEqual({
      type: "goal_loop",
      maxIterations: 5,
    });
    expect(parseAiLoopCommand("/loop 10")).toEqual({
      type: "goal_loop",
      maxIterations: 10,
    });
    // Classification is raw; the goal-loop IPC clamps to its own range.
    expect(parseAiLoopCommand("/loop 11")).toEqual({
      type: "goal_loop",
      maxIterations: 11,
    });
  });

  it("rejects trailing text after a bare goal-loop integer", () => {
    const r = parseAiLoopCommand("/loop 5 check");
    expect(r.type).toBe("invalid_loop");
  });
});

describe("parseAiLoopCommand - control operations", () => {
  it.each(["status", "pause", "resume", "stop"] as const)(
    "classifies /loop %s as control",
    (op) => {
      expect(parseAiLoopCommand(`/loop ${op}`)).toEqual({
        type: "scheduled_loop_control",
        operation: op,
      });
    }
  );

  it("is case-insensitive on control keywords", () => {
    expect(parseAiLoopCommand("/loop STOP")).toEqual({
      type: "scheduled_loop_control",
      operation: "stop",
    });
  });

  it("rejects control keyword with trailing text instead of falling through", () => {
    const r = parseAiLoopCommand("/loop status now");
    expect(r.type).toBe("invalid_loop");
  });
});

describe("parseAiLoopCommand - shorthand scheduled loop", () => {
  it("parses /loop <duration> <prompt>", () => {
    const r = parseAiLoopCommand(
      "/loop 5m check if the deployment finished and tell me what happened"
    );
    expect(r).toEqual({
      type: "scheduled_loop",
      intervalMs: 5 * MS_MIN,
      prompt: "check if the deployment finished and tell me what happened",
      maxRuns: SCHEDULED_LOOP_DEFAULT_MAX_RUNS,
      maxLifetimeMs: SCHEDULED_LOOP_DEFAULT_MAX_LIFETIME_MS,
    });
  });

  it("parses hour shorthand", () => {
    const r = parseAiLoopCommand("/loop 2h summarize any new campaign replies");
    expect(r).toMatchObject({ type: "scheduled_loop", intervalMs: 2 * MS_HOUR });
  });

  it("is case-insensitive on command and unit", () => {
    const r = parseAiLoopCommand("/LOOP 5M CHECK");
    expect(r).toMatchObject({ type: "scheduled_loop", intervalMs: 5 * MS_MIN });
  });

  it("requires a prompt", () => {
    const r = parseAiLoopCommand("/loop 5m");
    expect(r).toEqual({ type: "invalid_loop", code: "PROMPT_REQUIRED" });
  });

  it("rejects zero, negative, decimal, and unknown-unit intervals", () => {
    expect(parseAiLoopCommand("/loop 0m check deployment")).toEqual({
      type: "invalid_loop",
      code: "INVALID_INTERVAL",
    });
    expect(parseAiLoopCommand("/loop -5m check deployment")).toEqual({
      type: "invalid_loop",
      code: "INVALID_INTERVAL",
    });
    expect(parseAiLoopCommand("/loop 1.5h check deployment")).toEqual({
      type: "invalid_loop",
      code: "INVALID_INTERVAL",
    });
    expect(parseAiLoopCommand("/loop 5d check deployment")).toEqual({
      type: "invalid_loop",
      code: "INVALID_INTERVAL",
    });
  });

  it("rejects above the 24h max interval and accepts the bound", () => {
    expect(parseAiLoopCommand("/loop 25h check deployment")).toEqual({
      type: "invalid_loop",
      code: "INVALID_INTERVAL",
    });
    const r = parseAiLoopCommand("/loop 24h check deployment");
    expect(r).toMatchObject({ type: "scheduled_loop", intervalMs: MS_DAY });
  });

  it("rejects word-style intervals without falling through", () => {
    const r = parseAiLoopCommand("/loop 5 minutes check deployment");
    expect(r.type).toBe("invalid_loop");
  });
});

describe("parseAiLoopCommand - canonical scheduled loop", () => {
  it("parses every <duration> --times -- <prompt>", () => {
    const r = parseAiLoopCommand(
      "/loop every 5m --times 12 -- check if the deployment finished"
    );
    expect(r).toEqual({
      type: "scheduled_loop",
      intervalMs: 5 * MS_MIN,
      prompt: "check if the deployment finished",
      maxRuns: 12,
      maxLifetimeMs: SCHEDULED_LOOP_DEFAULT_MAX_LIFETIME_MS,
    });
  });

  it("parses every <duration> --for -- <prompt>", () => {
    const r = parseAiLoopCommand(
      "/loop every 1h --for 8h -- summarize new campaign replies"
    );
    expect(r).toEqual({
      type: "scheduled_loop",
      intervalMs: MS_HOUR,
      prompt: "summarize new campaign replies",
      maxRuns: SCHEDULED_LOOP_DEFAULT_MAX_RUNS,
      maxLifetimeMs: 8 * MS_HOUR,
    });
  });

  it("parses both --times and --for together", () => {
    const r = parseAiLoopCommand(
      "/loop every 30m --times 6 --for 3h -- check the import status"
    );
    expect(r).toEqual({
      type: "scheduled_loop",
      intervalMs: 30 * MS_MIN,
      prompt: "check the import status",
      maxRuns: 6,
      maxLifetimeMs: 3 * MS_HOUR,
    });
  });

  it("accepts the 100 run and 168h lifetime bounds and rejects above", () => {
    expect(
      parseAiLoopCommand("/loop every 5m --times 100 -- x")
    ).toMatchObject({ type: "scheduled_loop", maxRuns: 100 });
    expect(parseAiLoopCommand("/loop every 5m --times 101 -- x")).toEqual({
      type: "invalid_loop",
      code: "INVALID_LOOP_LIMIT",
    });
    expect(
      parseAiLoopCommand("/loop every 5m --for 168h -- x")
    ).toMatchObject({ type: "scheduled_loop", maxLifetimeMs: 168 * MS_HOUR });
    expect(parseAiLoopCommand("/loop every 5m --for 169h -- x")).toEqual({
      type: "invalid_loop",
      code: "INVALID_LOOP_LIMIT",
    });
  });

  it("requires the -- separator", () => {
    expect(parseAiLoopCommand("/loop every 5m check deployment")).toEqual({
      type: "invalid_loop",
      code: "INVALID_LOOP_SYNTAX",
    });
  });

  it("requires a prompt after the separator", () => {
    expect(parseAiLoopCommand("/loop every 5m -- ")).toEqual({
      type: "invalid_loop",
      code: "PROMPT_REQUIRED",
    });
  });

  it("does not let prompt text containing option-like words be consumed as flags", () => {
    const r = parseAiLoopCommand(
      "/loop every 5m -- check the logs for the 3 times we retried"
    );
    expect(r).toMatchObject({
      type: "scheduled_loop",
      prompt: "check the logs for the 3 times we retried",
    });
  });

  it("preserves newlines inside the prompt", () => {
    const r = parseAiLoopCommand("/loop 5m line one\nline two");
    expect(r).toMatchObject({
      type: "scheduled_loop",
      prompt: "line one\nline two",
    });
  });

  it("rejects unknown flags", () => {
    expect(
      parseAiLoopCommand("/loop every 5m --bogus 1 -- x")
    ).toMatchObject({ type: "invalid_loop", code: "INVALID_LOOP_SYNTAX" });
  });

  it("rejects a missing flag value", () => {
    expect(parseAiLoopCommand("/loop every 5m --times -- x")).toMatchObject({
      type: "invalid_loop",
      code: "INVALID_LOOP_LIMIT",
    });
  });
});
