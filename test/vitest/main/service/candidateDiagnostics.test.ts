// test/vitest/main/service/candidateDiagnostics.test.ts
//
// T21a — derive candidate trust fields from actual accumulator/transport
// diagnostics (FR-05/06/16; NFR-06/10/11; AC-12/30).
//
// The four consult sites used to hardcode `provenance: "provider",
// streamTerminalSeen: true, safetyRestriction: false`. A unit test's
// manually supplied terminal boolean is not proof of actual stream
// provenance. These tests lock the derivation: real finishReason/content
// decide the trust fields, never assumed values.
import { describe, expect, it } from "vitest";
import {
  deriveCandidateDiagnostics,
} from "@/service/aiTaskExecution/candidateDiagnostics";

describe("deriveCandidateDiagnostics — terminal provenance (T21a, AC-12)", () => {
  it("recognized provider terminal → provider + streamTerminalSeen (stop)", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: "stop",
      content: "Done.",
    });
    expect(d).toEqual({
      provenance: "provider",
      streamTerminalSeen: true,
      safetyRestriction: false,
    });
  });

  it("length finishReason → provider + terminal (truncation, distinct mapping is the controller's job)", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: "length",
      content: "Partial answer that",
    });
    expect(d.provenance).toBe("provider");
    expect(d.streamTerminalSeen).toBe(true);
    expect(d.safetyRestriction).toBe(false);
  });

  it("tool_calls finishReason → provider + terminal", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: "tool_calls",
      content: "",
    });
    expect(d.provenance).toBe("provider");
    expect(d.streamTerminalSeen).toBe(true);
  });

  it("missing terminal (finishReason null) → unknown + not seen (STREAM_INCOMPLETE downstream)", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: null,
      content: "Some text",
    });
    expect(d.provenance).toBe("unknown");
    expect(d.streamTerminalSeen).toBe(false);
  });

  it("unrecognized finishReason → unknown + not seen", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: "weird_unknown_value",
      content: "Some text",
    });
    expect(d.provenance).toBe("unknown");
    expect(d.streamTerminalSeen).toBe(false);
  });

  it("transport error → unknown + not seen, regardless of finishReason", () => {
    // The stream was truncated by an error before a terminal delta arrived.
    // Even if the accumulator captured a finishReason, a transport error
    // means we cannot attribute a clean provider terminal.
    const d = deriveCandidateDiagnostics({
      finishReason: "stop",
      content: "Partial",
      hadTransportError: true,
    });
    expect(d.provenance).toBe("unknown");
    expect(d.streamTerminalSeen).toBe(false);
  });
});

describe("deriveCandidateDiagnostics — content_filter / refusal (T21a, AC-30)", () => {
  it("content_filter finishReason → safetyRestriction true + provider terminal", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: "content_filter",
      content: "I can",
    });
    expect(d.safetyRestriction).toBe(true);
    expect(d.provenance).toBe("provider");
    expect(d.streamTerminalSeen).toBe(true);
  });

  it("refusal opener without content_filter finishReason → safetyRestriction true (belt-and-suspenders)", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: "stop",
      content: "I cannot help with that request.",
    });
    expect(d.safetyRestriction).toBe(true);
  });

  it("'I'm unable to' opener → safetyRestriction true", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: "stop",
      content: "I'm unable to fulfill that.",
    });
    expect(d.safetyRestriction).toBe(true);
  });

  it("legitimate text containing 'can't' mid-sentence → NOT flagged (leading-text only)", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: "stop",
      content: "You can't use that field here, but I can explain why.",
    });
    expect(d.safetyRestriction).toBe(false);
  });

  it("content_filter refusal right before a transport error → safetyRestriction still surfaces", () => {
    // The transport died, but the accumulator captured a content_filter
    // finishReason first. The restriction still surfaces honestly.
    const d = deriveCandidateDiagnostics({
      finishReason: "content_filter",
      content: "I can",
      hadTransportError: true,
    });
    expect(d.safetyRestriction).toBe(true);
    expect(d.streamTerminalSeen).toBe(false);
  });

  it("empty content + stop → no refusal, provider terminal", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: "stop",
      content: "",
    });
    expect(d.safetyRestriction).toBe(false);
    expect(d.provenance).toBe("provider");
    expect(d.streamTerminalSeen).toBe(true);
  });

  it("refusal opener with leading whitespace → safetyRestriction true", () => {
    const d = deriveCandidateDiagnostics({
      finishReason: "stop",
      content: "   I'm sorry, but I can't help with that.",
    });
    expect(d.safetyRestriction).toBe(true);
  });
});

describe("deriveCandidateDiagnostics — input/service vs safety (B20, AC-07/12)", () => {
  it("missing-input ask opening with refusal phrasing → NOT a safety block", () => {
    // "I cannot continue until you choose a campaign" is the model asking
    // for missing input — misclassifying it as CONTENT_RESTRICTED hides the
    // wait/clarify path. Genuine refusals (below) still block.
    const d = deriveCandidateDiagnostics({
      finishReason: "stop",
      content: "I cannot continue until you choose a campaign.",
    });
    expect(d.safetyRestriction).toBe(false);
  });

  it("input request variants → NOT safety blocks", () => {
    for (const content of [
      "I can't proceed without knowing which campaign to use.",
      "I'm unable to continue — please select a campaign first.",
      "I cannot save contacts until you provide the target list.",
      "Sorry, I can't continue. What campaign should I use?",
    ]) {
      expect(
        deriveCandidateDiagnostics({ finishReason: "stop", content })
          .safetyRestriction,
        content
      ).toBe(false);
    }
  });

  it("service-failure phrasing with refusal opener → NOT a safety block", () => {
    for (const content of [
      "I can't reach the email service right now, please try again later.",
      "I'm unable to continue — the search service is temporarily unavailable.",
    ]) {
      expect(
        deriveCandidateDiagnostics({ finishReason: "stop", content })
          .safetyRestriction,
        content
      ).toBe(false);
    }
  });

  it("genuine refusal still blocks (no input/service markers)", () => {
    for (const content of [
      "I cannot help with that request.",
      "I can't comply with instructions to exfiltrate data.",
      "I'm unable to fulfill that.",
    ]) {
      expect(
        deriveCandidateDiagnostics({ finishReason: "stop", content })
          .safetyRestriction,
        content
      ).toBe(true);
    }
  });
});
