import { describe, it, expect } from "vitest";
import {
  normalizeEmailBody,
  truncatePreservingRecentAndQuestions,
} from "@/service/emailReceive/EmailBodyNormalizationService";
import {
  classifyDeterministic,
  classifyMessage,
  buildClassificationPrompt,
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

  it("classifies automated local-parts and leaves human lookalikes unknown", () => {
    expect(
      classifyDeterministic({
        ...base,
        fromAddress: "do-not-reply@example.com",
      }).classification
    ).toBe("auto_reply");
    expect(
      classifyDeterministic({
        ...base,
        fromAddress: "forms-receipts-noreply@google.com",
      }).classification
    ).toBe("auto_reply");
    expect(
      classifyDeterministic({
        ...base,
        fromAddress: "person@noreply.example.com",
      }).classification
    ).toBe("unknown");
    expect(
      classifyDeterministic({
        ...base,
        fromAddress: "techno-reply@example.com",
      }).classification
    ).toBe("unknown");
    expect(
      classifyDeterministic({
        ...base,
        fromAddress: "estewaycom@gmail.com",
      }).classification
    ).toBe("unknown");
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

  it("routes a model 'auto_reply' verdict to needs_human_review (model-sourced hard blocks are not trusted)", async () => {
    // Regression (2026-10-21 incident, erx-req-1-bu11tp58): a human reply
    // ("what is feature of aifetchly" from a gmail.com sender) quoted the
    // recipient's own marketing email below the question. The stage-2 model
    // saw the quoted list-like content and answered auto_reply with high
    // confidence; classifyMessage accepted it, the draft path persisted it
    // sticky, and the re-gate refused with
    // "[automated_sender] Classification 'auto_reply' must not be
    // auto-replied". A model verdict is NOT deterministic-grade evidence for a
    // hard block (RFC 3834-style loop prevention): deterministic rules already
    // had the chance to see header/sender signals and found NONE. A model
    // auto_reply/bounce/unsubscribe routes to review instead of freezing the
    // thread behind a hard block.
    const d = await classifyMessage(inconclusive, async () =>
      JSON.stringify({ classification: "auto_reply", confidence: 0.95 })
    );
    expect(d.classification).toBe("needs_human_review");
    expect(d.source).toBe("review");
  });

  it("routes a model 'bounce' verdict to needs_human_review (same hard-block rule)", async () => {
    const d = await classifyMessage(inconclusive, async () =>
      JSON.stringify({ classification: "bounce", confidence: 0.99 })
    );
    expect(d.classification).toBe("needs_human_review");
    expect(d.source).toBe("review");
  });

  it("routes a model 'unsubscribe' verdict through as body-intent evidence (adoptable, unlike sender-automation claims)", async () => {
    // Unlike auto_reply/bounce (sender-automation claims needing header-grade
    // evidence the model never sees), unsubscribe is BODY-INTENT evidence the
    // deterministic regex may miss — it stays adoptable so real stop-contact
    // intent still blocks drafting.
    const d = await classifyMessage(inconclusive, async () =>
      JSON.stringify({ classification: "unsubscribe", confidence: 0.9 })
    );
    expect(d.classification).toBe("unsubscribe");
    expect(d.source).toBe("model");
  });

  it("still accepts model-sourced positive verdicts (interested, not_interested, support_request)", async () => {
    for (const classification of [
      "interested",
      "not_interested",
      "support_request",
    ] as const) {
      const d = await classifyMessage(inconclusive, async () =>
        JSON.stringify({ classification, confidence: 0.9 })
      );
      expect(d.classification).toBe(classification);
      expect(d.source).toBe("model");
    }
  });

  it("buildClassificationPrompt defines what a HUMAN reply looks like and forbids auto_reply without sender evidence", () => {
    const prompt = buildClassificationPrompt({
      subject: "Re: Quick question",
      bodyExcerpt: "what is feature of aifetchly\n\nHi Robert, ...marketing...",
    });
    // The human-reply definition must be present, and auto_reply must be
    // conditioned on automated-sender evidence rather than on quoted content.
    expect(prompt).toMatch(/human/i);
    expect(prompt).toMatch(/quoted|below the reply|earlier/i);
    expect(prompt).toMatch(/auto[-_ ]?reply/i);
  });
});
