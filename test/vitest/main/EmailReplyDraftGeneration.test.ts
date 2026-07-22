import { describe, it, expect } from "vitest";
import { parseReplyJson } from "@/service/emailReply/EmailReplyDraftGenerationService";

describe("parseReplyJson", () => {
  it("parses a clean JSON reply", () => {
    const r = parseReplyJson(
      JSON.stringify({
        subject: "Re: Pricing",
        bodyText: "Thanks for asking!",
        classification: "interested",
        confidence: 0.9,
      })
    );
    expect(r.subject).toBe("Re: Pricing");
    expect(r.bodyText).toBe("Thanks for asking!");
    expect(r.classification).toBe("interested");
    expect(r.confidence).toBe(0.9);
  });

  it("strips ```json code fences", () => {
    const r = parseReplyJson(
      '```json\n{"subject":"Re: Hi","bodyText":"hello","classification":"interested","confidence":0.8}\n```'
    );
    expect(r.subject).toBe("Re: Hi");
    expect(r.bodyText).toBe("hello");
  });

  it("tolerates stray text around the JSON object", () => {
    const r = parseReplyJson(
      'Here is your reply: {"subject":"Re:x","bodyText":"b","classification":"unknown","confidence":0.1} hope it helps'
    );
    expect(r.subject).toBe("Re:x");
    expect(r.bodyText).toBe("b");
  });

  it("returns empty body when no JSON is present (no raw-text fallback)", () => {
    const r = parseReplyJson("no json at all");
    expect(r.classification).toBe("unknown");
    expect(r.bodyText).toBe("");
    expect(r.confidence).toBe(0);
  });

  it("returns empty body when JSON is malformed", () => {
    const r = parseReplyJson("{not valid json}");
    expect(r.bodyText).toBe("");
    expect(r.classification).toBe("unknown");
  });
});
