import { describe, it, expect } from "vitest";
import {
  parseStrictGeneratedReply,
  buildCorrectionPrompt,
  extractJson,
  GENERATED_REPLY_SCHEMA_VERSION,
} from "@/service/emailReply/EmailReplyGenerationSchema";

const valid = JSON.stringify({
  subject: "Re: Pricing",
  bodyText: "Thanks for asking — happy to help.",
  intentSuggestion: "interested",
  confidence: 0.8,
});

describe("parseStrictGeneratedReply (FR-011)", () => {
  it("accepts a valid payload", () => {
    const r = parseStrictGeneratedReply(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subject).toBe("Re: Pricing");
      expect(r.value.intentSuggestion).toBe("interested");
      expect(r.value.confidence).toBe(0.8);
    }
  });

  it("tolerates code fences and stray prose around the JSON", () => {
    const r = parseStrictGeneratedReply(
      "Here you go:\n```json\n" + valid + "\n```\nThanks!"
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a missing JSON object entirely", () => {
    const r1 = parseStrictGeneratedReply("no json here at all");
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.codes).toContain("no_json_object");
  });

  it("rejects malformed JSON", () => {
    const r2 = parseStrictGeneratedReply('{"subject": broken}');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.codes).toContain("malformed_json");
  });

  it("rejects an empty subject / body instead of coercing", () => {
    const r = parseStrictGeneratedReply(
      JSON.stringify({
        subject: "   ",
        bodyText: "ok",
        intentSuggestion: "unknown",
        confidence: 0.5,
      })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes.join()).toMatch(/subject/);
  });

  it("rejects a non-finite / out-of-range confidence", () => {
    for (const bad of [2, -0.1, "high", null]) {
      const r = parseStrictGeneratedReply(
        valid.replace('"confidence":0.8', `"confidence":${JSON.stringify(bad)}`)
      );
      expect(r.ok).toBe(false);
    }
  });

  it("rejects an unknown intent enum value", () => {
    const r = parseStrictGeneratedReply(
      valid.replace('"interested"', '"definitely_interested"')
    );
    expect(r.ok).toBe(false);
  });

  it("enforces the subject length limit in application code", () => {
    const r = parseStrictGeneratedReply(
      JSON.stringify({
        subject: "s".repeat(200),
        bodyText: "ok",
        intentSuggestion: "unknown",
        confidence: 0.5,
      })
    );
    expect(r.ok).toBe(false);
  });
});

describe("buildCorrectionPrompt (§12.3)", () => {
  it("carries only the validation codes, no model prose", () => {
    const p = buildCorrectionPrompt([
      "subject:subject_empty",
      "confidence:confidence_not_finite",
    ]);
    expect(p).toContain("subject:subject_empty");
    expect(p).toContain("confidence:confidence_not_finite");
    expect(p).toContain("failed validation");
  });
});

describe("extractJson", () => {
  it("returns null without an object", () => {
    expect(extractJson("nothing")).toBeNull();
  });
});

describe("schema version", () => {
  it("is stamped for audit metadata", () => {
    expect(GENERATED_REPLY_SCHEMA_VERSION).toBe("gen-schema-v1");
  });
});
