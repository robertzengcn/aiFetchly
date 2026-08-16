import { describe, it, expect } from "vitest";
import {
  normalizeEmailBody,
  truncatePreservingRecentAndQuestions,
} from "@/service/emailReceive/EmailBodyNormalizationService";
import {
  classifyDeterministic,
  classifyMessage,
  MODEL_CLASSIFIER_VERSION,
  CLASSIFIER_VERSION,
} from "@/service/emailReply/EmailMessageClassificationService";

describe("normalizeEmailBody", () => {
  it("prefers a meaningful plain-text part", () => {
    const r = normalizeEmailBody({
      plainText: "plain wins",
      sanitizedHtml: "<p>html</p>",
    });
    expect(r.source).toBe("plain");
    expect(r.safeText).toBe("plain wins");
  });

  it("converts HTML-only mail to sanitized plain text", () => {
    const r = normalizeEmailBody({
      plainText: null,
      sanitizedHtml: "<p>Hello<b>world</b></p><p>Second paragraph</p>",
    });
    expect(r.source).toBe("html");
    expect(r.safeText).toContain("Hello");
    expect(r.safeText).toContain("Second paragraph");
  });

  it("never carries scripts or active content through from HTML", () => {
    const r = normalizeEmailBody({
      plainText: null,
      sanitizedHtml:
        '<p>ok</p><script>alert(1)</script><img src="http://tracker/x.gif" onerror="steal()">',
    });
    expect(r.safeText).not.toContain("script");
    expect(r.safeText).not.toContain("onerror");
  });

  it("separates newly-written content from quoted history", () => {
    const r = normalizeEmailBody({
      plainText:
        "Yes that works.\n\nOn Mon, Jan 5 p@x.com wrote:\n> earlier stuff\n> more quotes",
    });
    expect(r.newContentText).toBe("Yes that works.");
    expect(r.quotedTextRemoved).toBe(true);
  });

  it("removes a '--' signature from new content", () => {
    const r = normalizeEmailBody({ plainText: "Hello\n--\nRobert\nCell 555" });
    expect(r.newContentText).toBe("Hello");
    expect(r.signatureRemoved).toBe(true);
  });

  it("returns an empty result for an empty message", () => {
    const r = normalizeEmailBody({ plainText: null, sanitizedHtml: null });
    expect(r.source).toBe("empty");
    expect(r.safeText).toBe("");
  });

  it("truncates long mail preserving the tail and detected questions", () => {
    const long =
      "First question: what is the price?\n" +
      "filler\n".repeat(5000) +
      "Recent important tail content.";
    const r = normalizeEmailBody({ plainText: long, maxChars: 500 });
    expect(r.truncated).toBe(true);
    expect(r.safeText).toContain("Recent important tail content.");
    // The question from the dropped head survives.
    expect(r.safeText).toContain("what is the price?");
  });
});

describe("truncatePreservingRecentAndQuestions", () => {
  it("is a no-op under the cap", () => {
    const r = truncatePreservingRecentAndQuestions("short", 100);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("short");
  });
});

describe("classifyDeterministic (FR-007)", () => {
  const base = {
    fromAddress: "person@example.com",
    subject: "Hello",
    bodyText: "Hi there",
  };

  it("classifies a bounce by sender pattern", () => {
    const d = classifyDeterministic({
      ...base,
      fromAddress: "mailer-daemon@example.com",
      subject: "Undeliverable: Hello",
    });
    expect(d.classification).toBe("bounce");
    expect(d.source).toBe("deterministic");
    expect(d.version).toBe(CLASSIFIER_VERSION);
  });

  it("classifies automated mail by Auto-Submitted header (strongest signal)", () => {
    const d = classifyDeterministic({
      ...base,
      autoSubmittedHeader: "auto-generated",
    });
    expect(d.classification).toBe("auto_reply");
    expect(d.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("classifies list mail by Precedence/List headers", () => {
    expect(
      classifyDeterministic({ ...base, precedenceHeader: "bulk" })
        .classification
    ).toBe("auto_reply");
    expect(
      classifyDeterministic({ ...base, listIdHeader: "<dev.lists.x>" })
        .classification
    ).toBe("auto_reply");
  });

  it("classifies unsubscribe intent in English", () => {
    const d = classifyDeterministic({
      ...base,
      bodyText: "Please unsubscribe me from this list.",
    });
    expect(d.classification).toBe("unsubscribe");
  });

  it("classifies unsubscribe intent multilingually (zh/ja/es/fr/de)", () => {
    for (const phrase of [
      "取消订阅",
      "配信停止",
      "deseo desinscribirme",
      "se désabonner",
      "abbestellen",
    ]) {
      const d = classifyDeterministic({ ...base, bodyText: phrase });
      expect(d.classification).toBe("unsubscribe");
    }
  });

  it("routes sensitive topics to needs_human_review", () => {
    for (const body of [
      "I want a refund for my order.",
      "My lawyer will contact you about this lawsuit.",
      "Please reset my password and send credentials.",
      "I dispute this charge.",
    ]) {
      const d = classifyDeterministic({ ...base, bodyText: body });
      expect(d.classification).toBe("needs_human_review");
    }
  });

  it("returns unknown (never a guess) when rules are inconclusive", () => {
    const d = classifyDeterministic(base);
    expect(d.classification).toBe("unknown");
    expect(d.confidence).toBeLessThan(0.7);
  });

  it("bounce beats automated beats unsubscribe in evaluation order", () => {
    // A mailer-daemon with list headers is still a bounce first.
    const d = classifyDeterministic({
      ...base,
      fromAddress: "mailer-daemon@x.com",
      subject: "Delivery failure",
      listIdHeader: "<list.x>",
    });
    expect(d.classification).toBe("bounce");
  });
});

describe("classifyMessage two-stage (FR-007 stage 2, P2.2)", () => {
  const base = {
    fromAddress: "person@example.com",
    subject: "Hello",
    bodyText: "Hi there",
  };
  const inconclusive = {
    fromAddress: "person@example.com",
    subject: "Quick question",
    bodyText: "Can you tell me more about what you do?",
  };

  it("never calls the model when deterministic rules conclude", async () => {
    let called = 0;
    const d = await classifyMessage(
      { ...base, bodyText: "please unsubscribe me" },
      async () => {
        called++;
        return '{"classification":"interested","confidence":0.99}';
      }
    );
    expect(called).toBe(0);
    expect(d.classification).toBe("unsubscribe");
    expect(d.source).toBe("deterministic");
  });

  it("uses the constrained model when rules are inconclusive", async () => {
    const d = await classifyMessage(inconclusive, async () =>
      JSON.stringify({ classification: "support_request", confidence: 0.9 })
    );
    expect(d.classification).toBe("support_request");
    expect(d.source).toBe("model");
    expect(d.version).toBe(MODEL_CLASSIFIER_VERSION);
  });

  it("routes low model confidence to needs_human_review", async () => {
    const d = await classifyMessage(inconclusive, async () =>
      JSON.stringify({ classification: "interested", confidence: 0.3 })
    );
    expect(d.classification).toBe("needs_human_review");
    expect(d.source).toBe("review");
  });

  it("routes schema-invalid model output to needs_human_review (never trusts it)", async () => {
    const d = await classifyMessage(inconclusive, async () =>
      JSON.stringify({ classification: "definitely_interested", confidence: 5 })
    );
    expect(d.classification).toBe("needs_human_review");
  });

  it("routes a model 'unknown' verdict to needs_human_review", async () => {
    const d = await classifyMessage(inconclusive, async () =>
      JSON.stringify({ classification: "unknown", confidence: 0.95 })
    );
    expect(d.classification).toBe("needs_human_review");
  });

  it("survives a model caller that throws", async () => {
    const d = await classifyMessage(inconclusive, async () => {
      throw new Error("provider down");
    });
    expect(d.classification).toBe("needs_human_review");
    expect(d.source).toBe("review");
  });
});
