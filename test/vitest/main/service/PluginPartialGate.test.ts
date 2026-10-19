/**
 * H5 — host-side gate for `notifications/aifetchly/plugin-partial`.
 *
 * Covers: size cap, schema validation, executionId match, monotonic
 * sequence, live-job requirement, valid-snapshot mapping, and the abuse
 * threshold that asks the MCPClient to terminate the call.
 */
import { describe, expect, it } from "vitest";
import {
  MCP_PLUGIN_PARTIAL_METHOD,
  PLUGIN_PARTIAL_ABUSE_TERMINATE_AT,
  PLUGIN_PARTIAL_MAX_BYTES,
  PluginPartialGate,
  pluginPartialNotificationSchema,
} from "@/modules/mcp/pluginPartial";

const EXECUTION_ID = "execution-0001";

function snapshot(overrides?: {
  executionId?: string;
  sequence?: number;
  phase?: string;
  collectedCount?: number;
  expectedCount?: number | null;
  message?: string;
}) {
  return {
    executionId: EXECUTION_ID,
    sequence: 1,
    collectedCount: 0,
    expectedCount: 10,
    phase: "running",
    ...overrides,
  };
}

function liveGate() {
  return new PluginPartialGate(EXECUTION_ID, () => true);
}

describe("pluginPartialNotificationSchema", () => {
  it("rejects unknown phases", () => {
    const parsed = pluginPartialNotificationSchema.safeParse({
      method: MCP_PLUGIN_PARTIAL_METHOD,
      params: snapshot({ phase: "hacked" }),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects oversized messages", () => {
    const parsed = pluginPartialNotificationSchema.safeParse({
      method: MCP_PLUGIN_PARTIAL_METHOD,
      params: snapshot({ message: "x".repeat(201) }),
    });
    expect(parsed.success).toBe(false);
  });
});

describe("PluginPartialGate", () => {
  it("maps a valid snapshot onto bounded partials and progress", () => {
    const gate = liveGate();
    const outcome = gate.observe(snapshot({ sequence: 2 }));
    expect(outcome.accept).toBe(true);
    expect(outcome.terminateCall).toBe(false);
    expect(outcome.partial).toEqual({
      data: { phase: "running", message: "" },
      collectedCount: 0,
      expectedCount: 10,
    });
    expect(outcome.mapping).toEqual({
      phase: "running",
      message: "Collected 0 records",
      progress: 0,
      partialCount: 0,
      expectedCount: 10,
    });
  });

  it("rejects oversized payloads before parsing", () => {
    const gate = liveGate();
    const oversized: unknown = {
      executionId: EXECUTION_ID,
      sequence: 1,
      collectedCount: 0,
      expectedCount: null,
      phase: "running",
      message: null,
      junk: "x".repeat(PLUGIN_PARTIAL_MAX_BYTES + 1),
    };
    const outcome = gate.observe(oversized);
    expect(outcome.accept).toBe(false);
    expect(outcome.reason).toBe("size");
    expect(outcome.terminateCall).toBe(false);
  });

  it("rejects malformed shapes", () => {
    const gate = liveGate();
    expect(gate.observe({ executionId: EXECUTION_ID }).reason).toBe("schema");
    expect(
      gate.observe(snapshot({ collectedCount: 1.5 })).reason
    ).toBe("schema");
  });

  it("rejects snapshots for a different execution id", () => {
    const gate = liveGate();
    const outcome = gate.observe(
      snapshot({ executionId: "execution-9999", sequence: 3 })
    );
    expect(outcome.accept).toBe(false);
    expect(outcome.reason).toBe("execution-id");
  });

  it("rejects non-monotonic sequences", () => {
    const gate = liveGate();
    expect(gate.observe(snapshot({ sequence: 4 })).accept).toBe(true);
    expect(gate.observe(snapshot({ sequence: 4 })).reason).toBe("sequence");
    expect(gate.observe(snapshot({ sequence: 2 })).reason).toBe("sequence");
  });

  it("rejects terminal jobs without advancing the sequence", () => {
    let live = true;
    const gate = new PluginPartialGate(EXECUTION_ID, () => live);
    expect(gate.observe(snapshot({ sequence: 1 })).accept).toBe(true);
    live = false;
    const rejected = gate.observe(snapshot({ sequence: 2 }));
    expect(rejected.accept).toBe(false);
    expect(rejected.reason).toBe("terminal");
    live = true;
    // Sequence was NOT advanced by the rejected snapshot; a retry with a
    // later sequence is accepted once the job is live again.
    expect(gate.observe(snapshot({ sequence: 2 })).accept).toBe(true);
  });

  it("computes progress from collected/expected counts", () => {
    const gate = liveGate();
    const outcome = gate.observe(
      snapshot({ sequence: 5, collectedCount: 5, expectedCount: 10 })
    );
    expect(outcome.mapping?.progress).toBe(0.5);
    const capped = gate.observe(
      snapshot({ sequence: 6, collectedCount: 40, expectedCount: 10 })
    );
    expect(capped.mapping?.progress).toBe(1);
    const unbounded = gate.observe(
      snapshot({ sequence: 7, collectedCount: 2, expectedCount: null })
    );
    expect(unbounded.mapping?.progress).toBeNull();
  });

  it("G02: collected > expected is normalized for display, unknown totals stay null", () => {
    const gate = liveGate();
    const outcome = gate.observe(
      snapshot({ sequence: 2, collectedCount: 40, expectedCount: 10 })
    );
    expect(outcome.mapping?.partialCount).toBe(10);
    expect(outcome.mapping?.progress).toBe(1);
    // The INTERNAL partial keeps the honest count for the result metadata.
    expect(outcome.partial?.collectedCount).toBe(40);
    // Unmatched/unknown estimates are null, never coerced to zero.
    const unknown = gate.observe(
      snapshot({ sequence: 3, collectedCount: 3, expectedCount: null })
    );
    expect(unknown.mapping?.expectedCount).toBeNull();
    expect(unknown.mapping?.partialCount).toBe(3);
  });

  it("G02: server-supplied messages are redacted in the mapping", () => {
    const gate = liveGate();
    const outcome = gate.observe(
      snapshot({
        sequence: 2,
        message: "scraping https://user:hunter2@example.com/api",
      })
    );
    expect(outcome.mapping?.message).toBe(
      "scraping https://[redacted]@example.com/api"
    );
    expect(outcome.mapping?.message).not.toContain("hunter2");
  });

  it("terminates the call once repeated abuse reaches the threshold", () => {
    const gate = liveGate();
    let terminated = false;
    for (let i = 1; i < PLUGIN_PARTIAL_ABUSE_TERMINATE_AT; i += 1) {
      const outcome = gate.observe({ junk: i });
      expect(outcome.accept).toBe(false);
      expect(outcome.terminateCall).toBe(false);
    }
    terminalCheck: {
      const outcome = gate.observe({ junk: 999 });
      terminated = outcome.terminateCall;
    }    expect(terminated).toBe(true);
  });

  it("start of a new call resets sequence and abuse tracking", () => {
    const first = liveGate();
    first.observe({ junk: "bad" });
    const fresh = liveGate();
    expect(fresh.observe(snapshot({ sequence: 1 })).accept).toBe(true);
  });
});
