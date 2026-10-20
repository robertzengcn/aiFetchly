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

describe("buildCorrectionPrompt (FR-025, §12.3)", () => {
  it("carries the validation codes and names the correct field intentSuggestion", () => {
    const p = buildCorrectionPrompt({
      originalUserContent: "INBOUND: How much is the Team plan?",
      codes: ["subject:subject_empty", "confidence:confidence_not_finite"],
    });
    expect(p).toContain("subject:subject_empty");
    expect(p).toContain("confidence:confidence_not_finite");
    expect(p).toContain("strict validation");
    // Names the correct field explicitly (the v1 bug was asking for
    // `classification` while the schema required `intentSuggestion`).
    expect(p).toContain("intentSuggestion");
    // The legacy field name `classification` may appear ONLY inside the explicit
    // correction instruction telling the model NOT to use it; it must never
    // appear as the requested JSON field name in the shape line.
    expect(p).toContain('"intentSuggestion"');
    expect(p).not.toMatch(/"classification"/);
  });

  it("preserves the original inbound context so the model regenerates fresh", () => {
    const p = buildCorrectionPrompt({
      originalUserContent: "INBOUND: How much is the Team plan?",
      codes: ["subject:subject_empty"],
    });
    expect(p).toContain("INBOUND: How much is the Team plan?");
    expect(p).toContain("Original inbound email");
  });

  it("does NOT echo invalid raw model output (only codes + original context)", () => {
    const p = buildCorrectionPrompt({
      originalUserContent: "INBOUND: pricing question",
      codes: ["root:malformed_json"],
    });
    // The codes and the original context appear. The instruction tells the
    // model not to repeat the invalid reply. The invalid reply BODY itself
    // is never embedded — only codes + original inbound context.
    expect(p).toContain("root:malformed_json");
    expect(p).toContain("INBOUND: pricing question");
    expect(p).toContain("Do NOT repeat the invalid reply");
    // No fenced code blocks carrying raw failed JSON.
    expect(p).not.toContain("```");
  });

  it("adds a bounded shortening instruction when a length/truncation code is present", () => {
    const p = buildCorrectionPrompt({
      originalUserContent: "INBOUND: pricing",
      codes: ["truncated_output"],
    });
    expect(p).toContain("truncated_output");
    expect(p.toLowerCase()).toContain("shorter");
    expect(p.toLowerCase()).toContain("under 300 words");
  });

  it("omits the shortening instruction when no length code is present", () => {
    const p = buildCorrectionPrompt({
      originalUserContent: "INBOUND: pricing",
      codes: ["subject:subject_empty"],
    });
    expect(p.toLowerCase()).not.toContain("shorter");
    expect(p.toLowerCase()).not.toContain("under 300 words");
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
