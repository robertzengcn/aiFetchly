import { describe, it, expect } from "vitest";
import {
  resolveTimeoutMs,
  inferTimeoutClassByName,
} from "@/service/ToolTimeoutPolicy";

describe("executeToolWithTimeout policy integration", () => {
  // The loop reads the policy via inferTimeoutClassByName when no skill
  // resolver is present. Verify the lookup behavior the loop depends on.

  it("uses browser ceiling for search_maps_businesses", () => {
    const cls = inferTimeoutClassByName("search_maps_businesses");
    expect(cls).to.equal("browser");
    expect(resolveTimeoutMs(cls)).to.equal(240_000);
  });

  it("uses fast ceiling for file_read", () => {
    const cls = inferTimeoutClassByName("file_read");
    expect(resolveTimeoutMs(cls)).to.equal(30_000);
  });

  it("uses network ceiling for analyze_website", () => {
    const cls = inferTimeoutClassByName("analyze_website");
    expect(resolveTimeoutMs(cls)).to.equal(90_000);
  });

  it("resolveTimeoutMs(async) returns null so loop dispatches to async path", () => {
    expect(resolveTimeoutMs("async")).to.equal(null);
  });
});

import type {
  AIChatQueryEvent,
  AIChatQueryToolProgressEvent,
} from "@/service/AIChatQueryEvents";

describe("tool_progress event contract", () => {
  it("supports a tool_progress event with phase/message/progress/counts", () => {
    const event: AIChatQueryToolProgressEvent = {
      type: "tool_progress",
      conversationId: "c1",
      messageId: "m1",
      toolCallId: "tc1",
      toolName: "search_maps_businesses",
      phase: "extracting",
      message: "progress.maps.found",
      progress: 0.4,
      partialCount: 8,
      expectedCount: 20,
      timestamp: Date.now(),
    };
    const unioned: AIChatQueryEvent = event;
    expect(unioned.type).to.equal("tool_progress");
  });
});

import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

describe("SkillExecutionContext emitProgress contract", () => {
  it("supports an optional emitProgress callback", () => {
    const ctx: SkillExecutionContext = {
      conversationId: "c1",
      toolCallId: "tc1",
      emitProgress: (e) => {
        // Contract: phase is one of the 5 known values, message is a string.
        expect([
          "queued",
          "running",
          "fetching",
          "extracting",
          "finalizing",
        ]).to.include(e.phase);
        expect(typeof e.message).to.equal("string");
      },
    };
    ctx.emitProgress?.({ phase: "running", message: "test" });
  });

  it("allows emitProgress to be omitted (fast tools pay no cost)", () => {
    const ctx: SkillExecutionContext = {
      conversationId: "c1",
      toolCallId: "tc1",
    };
    expect(ctx.emitProgress).to.equal(undefined);
  });

  it("passes progress and count fields through when provided", () => {
    const received: Array<{
      phase: string;
      message: string;
      progress?: number | null;
      partialCount?: number | null;
      expectedCount?: number | null;
    }> = [];
    const ctx: SkillExecutionContext = {
      conversationId: "c1",
      toolCallId: "tc1",
      emitProgress: (e) => received.push(e),
    };
    ctx.emitProgress?.({
      phase: "fetching",
      message: "Fetching page 2",
      progress: 0.5,
      partialCount: 10,
      expectedCount: 20,
    });
    expect(received).to.have.lengthOf(1);
    expect(received[0].phase).to.equal("fetching");
    expect(received[0].progress).to.equal(0.5);
    expect(received[0].partialCount).to.equal(10);
    expect(received[0].expectedCount).to.equal(20);
  });
});
