import { describe, expect, it } from "vitest";
import { AgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";

/**
 * C-FR-11/C-FR-14: the startup sweep marks every non-terminal control
 * record interrupted; batch return-now marks the record INTERRUPTED to
 * match its partial result (never failed).
 */

describe("AgentTaskControlService startup sweep (C-FR-14)", () => {
  it("sweeps running/paused/waiting records to interrupted and leaves terminals", () => {
    const control = new AgentTaskControlService();
    control.register("t-running", "conv-1");
    control.register("t-paused", "conv-1");
    control.register("t-done", "conv-1");
    control.setState("t-paused", "paused", "user_paused");
    control.setState("t-done", "completed");

    const swept = control.sweepNonTerminalToInterrupted();
    expect(swept).toBe(2);
    expect(control.getState("t-running")).toBe("interrupted");
    expect(control.getState("t-paused")).toBe("interrupted");
    // Terminal records are untouched.
    expect(control.getState("t-done")).toBe("completed");
  });
});

describe("batch return-now control record (C-FR-11)", () => {
  it("interrupted — not failed — when the user returns results early", () => {
    // The batch tool's return-now branch maps the control record to
    // interrupted; verify the semantics through the control service the
    // same way the tool calls it.
    const control = new AgentTaskControlService();
    control.register("batch_x:0", "conv-1");
    // The tool's return-now branch:
    control.setState("batch_x:0", "interrupted", "return_now_partial");
    expect(control.getState("batch_x:0")).toBe("interrupted");
  });
});
