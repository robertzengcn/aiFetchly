import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitShellDiagnostic,
  getShellDiagnostics,
  hashConversationId,
  resetShellDiagnosticsForTesting,
  trackShellMounted,
  trackShellUnmounted,
  workspaceFailureCategory,
  type ShellDiagnosticEvent,
} from "@/views/utils/shellDiagnostics";

/**
 * Privacy-safe shell observability (technical design §22 / PRD §29):
 * diagnostics are structured, content-free, and bounded. These tests prove
 * the invariants: hashed identifiers never leak raw conversation ids, the
 * ring buffer is capped, duplicate shells are detected, and failure
 * categories are bounded enums.
 */

const SENSITIVE_CONVERSATION_ID = "v2-a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("shellDiagnostics (design §22)", () => {
  beforeEach(() => {
    resetShellDiagnosticsForTesting();
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    trackShellUnmounted(); // balance any mount from duplicate tests
    vi.restoreAllMocks();
  });

  it("hashes conversation ids deterministically without leaking the raw id", () => {
    const hash = hashConversationId(SENSITIVE_CONVERSATION_ID);
    expect(hash).toMatch(/^h[0-9a-z]+$/);
    expect(hash).toBe(hashConversationId(SENSITIVE_CONVERSATION_ID));
    expect(hash).not.toBe(SENSITIVE_CONVERSATION_ID);
    expect(hash).not.toContain("v2-");
    // Distinct ids hash distinctly for correlation.
    expect(hash).not.toBe(hashConversationId("v2-other"));
    expect(hashConversationId(null)).toBe("none");
  });

  it("keeps every emitted event content-free (no raw ids, paths, or messages)", () => {
    emitShellDiagnostic({
      type: "chat.selection_loaded",
      conversationHash: hashConversationId(SENSITIVE_CONVERSATION_ID),
      generation: 3,
      latencyMs: 42,
      outcome: "ok",
    });
    emitShellDiagnostic({
      type: "chat.workspace_load_failed",
      conversationHash: hashConversationId(SENSITIVE_CONVERSATION_ID),
      category: "network",
    });

    const serialized = JSON.stringify(getShellDiagnostics());
    expect(serialized).not.toContain(SENSITIVE_CONVERSATION_ID);
    expect(serialized).not.toContain("v2-");
    // Exactly the two bounded events were recorded.
    const events = getShellDiagnostics();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("chat.selection_loaded");
    expect(events[1].type).toBe("chat.workspace_load_failed");
  });

  it("bounds the diagnostic ring buffer", () => {
    for (let i = 0; i < 150; i += 1) {
      emitShellDiagnostic({
        type: "shell.route_changed",
        from: "A",
        to: "B",
      });
    }
    expect(getShellDiagnostics()).toHaveLength(100);
  });

  it("detects duplicate shells and warns once until reset", () => {
    const first = trackShellMounted();
    expect(first.duplicates).toBe(0);

    const second = trackShellMounted();
    expect(second.duplicates).toBe(1);
    expect(console.warn).toHaveBeenCalledTimes(1);

    // A third mount does not re-warn (once per duplicate episode).
    trackShellMounted();
    expect(console.warn).toHaveBeenCalledTimes(1);

    // Full unmount resets the episode.
    trackShellUnmounted();
    trackShellUnmounted();
    trackShellUnmounted();
    trackShellMounted();
    expect(console.warn).toHaveBeenCalledTimes(1); // no new episode
  });

  it("classifies workspace failures into bounded categories", () => {
    expect(
      workspaceFailureCategory(new Error("fetch failed: ECONNREFUSED"))
    ).toBe("network");
    expect(
      workspaceFailureCategory(new TypeError("Failed to fetch"))
    ).toBe("network");
    expect(workspaceFailureCategory(new Error("boom"))).toBe("unknown");
    expect(workspaceFailureCategory("not-an-error")).toBe("unknown");
  });

  it("emits route-change events carrying route names only", () => {
    emitShellDiagnostic({
      type: "shell.route_changed",
      from: "AI_Chat_Workspace",
      to: "Insights",
    });
    const event = getShellDiagnostics()[0] as Extract<
      ShellDiagnosticEvent,
      { type: "shell.route_changed" }
    >;
    expect(event.from).toBe("AI_Chat_Workspace");
    expect(event.to).toBe("Insights");
    expect(Object.keys(event).sort()).toEqual(["from", "to", "type"]);
  });
});
