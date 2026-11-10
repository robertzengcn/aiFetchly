/**
 * R9 B04 — session-scope reported-output state (FR-RPT-009, AD-005).
 *
 * The reported set is module-scope shared state (no pinia requirement, same
 * pattern as useInnerPageShellFlag): it must survive a center remount and
 * merge conversation-report successes' selected message ids; it must never
 * be persisted or transfer markers to unrelated messages.
 */
import { describe, beforeEach, expect, it } from "vitest";
import {
  useChatReportState,
  resetChatReportStateForTest,
} from "@/views/store/chatReportState";

beforeEach(() => {
  resetChatReportStateForTest();
});

describe("chatReportState (R9 B04)", () => {
  it("marks single and batched reported outputs", () => {
    const state = useChatReportState();
    expect(state.isReported("output-a")).toBe(false);
    state.markReported(["output-a"]);
    expect(state.isReported("output-a")).toBe(true);
    state.markReported(["output-b", "output-c"]);
    expect(state.isReported("output-b")).toBe(true);
    expect(state.isReported("output-c")).toBe(true);
  });

  it("ignores empty ids and keeps the existing set intact", () => {
    const state = useChatReportState();
    state.markReported(["output-a"]);
    state.markReported(["", "output-b"]);
    expect(state.isReported("output-a")).toBe(true);
    expect(state.isReported("output-b")).toBe(true);
  });

  it("markers survive a composable re-entry (remount) in the same session", () => {
    const state = useChatReportState();
    state.markReported(["output-session"]);
    // A center remount re-enters the same module singleton — no reset,
    // no transfer.
    const again = useChatReportState();
    expect(again.isReported("output-session")).toBe(true);
    expect(again.isReported("output-unrelated")).toBe(false);
  });

  it("the reactive view updates when markers are added after capture", () => {
    const state = useChatReportState();
    const before = state.reportedMessageIds.value;
    expect(before.has("output-late")).toBe(false);
    state.markReported(["output-late"]);
    expect(state.reportedMessageIds.value.has("output-late")).toBe(true);
  });
});
