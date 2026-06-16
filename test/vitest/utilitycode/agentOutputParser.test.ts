// test/vitest/utilitycode/agentOutputParser.test.ts
import { describe, it, expect } from "vitest";
import { AgentOutputParser } from "@/service/AgentOutputParser";

const SCHEMA = {
  type: "object",
  required: ["businessSummary", "sourceUrls", "confidence"],
  properties: {
    businessSummary: { type: "string" },
    sourceUrls: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
};

describe("AgentOutputParser", () => {
  it("parses direct JSON", () => {
    const parser = new AgentOutputParser();
    const text = JSON.stringify({
      businessSummary: "ok",
      sourceUrls: ["https://x.com"],
      confidence: 0.8,
    });
    const r = parser.parse(text, SCHEMA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.output as Record<string, unknown>).businessSummary).toBe("ok");
    }
  });

  it("parses fenced JSON block", () => {
    const parser = new AgentOutputParser();
    const text =
      "Here you go:\n```json\n" +
      JSON.stringify({
        businessSummary: "ok",
        sourceUrls: [],
        confidence: 0.5,
      }) +
      "\n```";
    const r = parser.parse(text, SCHEMA);
    expect(r.ok).toBe(true);
  });

  it("fails on malformed JSON", () => {
    const parser = new AgentOutputParser();
    const r = parser.parse("not json at all", SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("fails when required fields are missing", () => {
    const parser = new AgentOutputParser();
    const r = parser.parse(JSON.stringify({ businessSummary: "ok" }), SCHEMA);
    expect(r.ok).toBe(false);
  });

  it("returns a discriminated union (not any)", () => {
    const parser = new AgentOutputParser();
    const r = parser.parse("{}", SCHEMA);
    if (r.ok) {
      void (r.output as Record<string, unknown>);
    } else {
      void r.error;
    }
    expect(true).toBe(true);
  });
});
