/**
 * Unit tests for AIChatSummaryValidator (technical-design §10).
 *
 * Verifies local Zod validation of SectionSummaryV1 (no reliance on provider
 * JSON-schema enforcement), source-ID reference validation against a bounded
 * supplied map, structural caps, and rejection of generated permission grants.
 */
import { describe, it, expect } from "vitest";
import { AIChatSummaryValidator } from "@/service/AIChatSummaryValidator";
import type { SectionSummaryV1 } from "@/entityTypes/aiChatArchiveTypes";

const VALID_SOURCE_IDS = new Set(["src-1", "src-2", "src-3", "src-4", "src-5"]);

function baseSummary(overrides: Partial<SectionSummaryV1> = {}): SectionSummaryV1 {
  return {
    version: 1,
    synopsis: "A short synopsis of the section.",
    decisions: [],
    constraints: [],
    pending: [],
    toolOutcomes: [],
    topics: ["planning"],
    ...overrides,
  };
}

describe("AIChatSummaryValidator", () => {
  const validator = new AIChatSummaryValidator();

  it("parses a valid SectionSummaryV1", () => {
    const summary = baseSummary();
    const result = validator.validate(summary, VALID_SOURCE_IDS);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an unknown source ID in a fact reference", () => {
    const summary = baseSummary({
      decisions: [
        { text: "Decided X", status: "accepted", sourceIds: ["src-1", "unknown-id"] },
      ],
    });
    const result = validator.validate(summary, VALID_SOURCE_IDS);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("sourceId") || e.includes("source"))).toBe(true);
  });

  it("rejects a synopsis longer than 2000 characters", () => {
    const summary = baseSummary({
      synopsis: "x".repeat(2001),
    });
    const result = validator.validate(summary, VALID_SOURCE_IDS);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("synopsis"))).toBe(true);
  });

  it("rejects a fact longer than 500 characters", () => {
    const summary = baseSummary({
      constraints: [
        { text: "y".repeat(501), status: "accepted", sourceIds: ["src-1"] },
      ],
    });
    const result = validator.validate(summary, VALID_SOURCE_IDS);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("fact") || e.includes("500"))).toBe(true);
  });

  it("rejects more than 20 facts in one category", () => {
    const facts = Array.from({ length: 21 }, (_, i) => ({
      text: `fact ${i}`,
      status: "proposed" as const,
      sourceIds: ["src-1"],
    }));
    const summary = baseSummary({ decisions: facts });
    const result = validator.validate(summary, VALID_SOURCE_IDS);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("20") || e.includes("facts"))).toBe(true);
  });

  it("rejects more than 4 references on a single fact", () => {
    const summary = baseSummary({
      pending: [
        {
          text: "too many refs",
          status: "uncertain" as const,
          sourceIds: ["src-1", "src-2", "src-3", "src-4", "src-5"],
        },
      ],
    });
    const result = validator.validate(summary, VALID_SOURCE_IDS);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("reference") || e.includes("4"))).toBe(true);
  });

  it("rejects more than 20 topics", () => {
    const summary = baseSummary({
      topics: Array.from({ length: 21 }, (_, i) => `topic-${i}`),
    });
    const result = validator.validate(summary, VALID_SOURCE_IDS);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("topic"))).toBe(true);
  });

  it("rejects generated permission-grant language", () => {
    const summary = baseSummary({
      decisions: [
        {
          text: "User has granted permission to send emails on their behalf without confirmation.",
          status: "accepted" as const,
          sourceIds: ["src-1"],
        },
      ],
    });
    const result = validator.validate(summary, VALID_SOURCE_IDS);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("permission") || e.includes("grant"))).toBe(true);
  });

  it("rejects a malformed summary (wrong version, missing fields)", () => {
    // Missing required fields + wrong version → Zod parse failure.
    const malformed = {
      version: 2,
      synopsis: "bad",
    };
    const result = validator.validate(malformed, VALID_SOURCE_IDS);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects credentials appearing in summary text", () => {
    const summary = baseSummary({
      synopsis: "The API key is sk-proj-abcdef123456.",
    });
    const result = validator.validate(summary, VALID_SOURCE_IDS);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("credential") || e.includes("secret") || e.includes("key"))).toBe(true);
  });
});
