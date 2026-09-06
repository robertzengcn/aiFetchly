import { describe, it, expect } from "vitest";
import {
  OutboundEmailIntentResolver,
  hashUserAuthoredText,
} from "@/service/outboundEmail/OutboundEmailIntentResolver";
import { OUTBOUND_RESOLVER_VERSION } from "@/service/outboundEmail/outboundReliabilityVersions";
import type { ResolveOutboundEmailIntentInput } from "@/entityTypes/outboundEmailDeliveryTypes";

function input(
  text: string,
  overrides: Partial<ResolveOutboundEmailIntentInput> = {}
): ResolveOutboundEmailIntentInput {
  return {
    conversationId: "conv-1",
    sourceUserMessageId: "msg-1",
    userAuthoredText: text,
    previousAssistantMessageId: null,
    previousAssistantText: null,
    ...overrides,
  };
}

describe("OutboundEmailIntentResolver (deterministic, technical design §9.2)", () => {
  it("detects an explicit send instruction", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("please send these emails now")
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("explicit_send_instruction");
    expect(d.confidence).toBeGreaterThanOrEqual(0.9);
    expect(d.evidence.length).toBeGreaterThan(0);
    expect(d.evidence[0].category).toBe("send");
    // Evidence offsets map back into the source text.
    const span = "please send these emails now".substring(
      d.evidence[0].start,
      d.evidence[0].end
    );
    expect(span.toLowerCase()).toContain("send");
  });

  it("detects a review instruction", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("draft the emails and let me review before sending")
    );
    expect(d.mode).toBe("review_first");
    expect(d.reasonCode).toBe("explicit_review_instruction");
    expect(d.evidence.some((e) => e.category === "review")).toBe(true);
  });

  it("detects negation (do-not-send)", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("don't send the emails yet")
    );
    expect(d.mode).toBe("draft_only");
    expect(d.reasonCode).toBe("explicit_do_not_send");
    expect(d.evidence.some((e) => e.category === "negation")).toBe(true);
  });

  it("review phrases override send phrases (AD-002 precedence)", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("send the emails but show me for review first")
    );
    expect(d.mode).toBe("review_first");
    expect(d.reasonCode).toBe("conflicting_instruction");
  });

  it("negation overrides send phrases (AD-002 precedence)", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("send the campaign but do not send it yet")
    );
    expect(d.mode).toBe("draft_only");
    expect(d.reasonCode).toBe("conflicting_instruction");
  });

  it("falls back to draft_only for ambiguous wording", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("prepare a marketing email for our customers")
    );
    expect(d.mode).toBe("draft_only");
    expect(d.reasonCode).toBe("ambiguous_instruction");
    expect(d.evidence).toHaveLength(0);
  });

  it("detects an explicit skip-review send (write email without review)", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input(
        "please write a test email to 1093968009@qq.com directly, without review"
      )
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("explicit_skip_review");
    expect(d.evidence.some((e) => e.category === "skip_review")).toBe(true);
  });

  it("does not treat skip-review alone as a send", () => {
    const d = OutboundEmailIntentResolver.resolve(input("without review"));
    expect(d.mode).not.toBe("send_now");
  });

  it("does not treat write-an-email alone as a send", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("please write a test email to 1093968009@qq.com")
    );
    expect(d.mode).toBe("draft_only");
  });

  it("keeps ordinary send phrasing as explicit_send_instruction", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("please send a test email to 1093968009@qq.com")
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("explicit_send_instruction");
  });

  it("treats create-and-send-to-address-directly as skip-review send_now", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input(
        "please create a test email and send it to 1093968009@qq.com directly"
      )
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("explicit_skip_review");
  });

  it("treats send-it-directly-without-review as skip-review send_now", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("please send it directly without review")
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("explicit_skip_review");
  });

  it("does not treat 'indirectly' as a Review waiver", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("please send these emails indirectly")
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("explicit_send_instruction");
  });

  it("review still wins over skip-review (AD-002)", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("send a test email without review but let me review first")
    );
    expect(d.mode).toBe("review_first");
  });

  it("detects skip-review send instructions in all six supported languages", () => {
    const cases: Array<[string, string]> = [
      ["en", "send a test email without review"],
      ["zh", "请直接发送测试邮件，无需审核"],
      ["es", "envía estos correos sin revisión"],
      ["fr", "envoie ces e-mails sans révision"],
      ["de", "sende diese E-Mails ohne Prüfung"],
      ["ja", "これらのメールを送信して確認なし"],
    ];
    for (const [lang, text] of cases) {
      const d = OutboundEmailIntentResolver.resolve(input(text));
      expect(
        d.mode,
        `language ${lang} skip-review should resolve send_now`
      ).toBe("send_now");
      expect(d.reasonCode, `language ${lang}`).toBe("explicit_skip_review");
    }
  });

  it("detects send instructions in all six supported languages", () => {
    const cases: Array<[string, string]> = [
      ["en", "send these emails now"],
      ["zh", "立即发送这些邮件"],
      ["es", "envía estos correos ahora"],
      ["fr", "envoie ces e-mails maintenant"],
      ["de", "sende diese E-Mails jetzt"],
      ["ja", "これらのメールを今すぐ送信して"],
    ];
    for (const [lang, text] of cases) {
      const d = OutboundEmailIntentResolver.resolve(input(text));
      expect(d.mode, `language ${lang} should resolve send_now`).toBe(
        "send_now"
      );
      expect(d.reasonCode).toBe("explicit_send_instruction");
    }
  });

  it("detects review instructions in all six supported languages", () => {
    const cases: Array<[string, string]> = [
      ["en", "let me review before sending"],
      ["zh", "发送前让我先审核"],
      ["es", "quiero revisar antes de enviar"],
      ["fr", "je veux vérifier avant l'envoi"],
      ["de", "ich möchte sie prüfen, bevor du sendest"],
      ["ja", "送信前に確認させてください"],
    ];
    for (const [lang, text] of cases) {
      const d = OutboundEmailIntentResolver.resolve(input(text));
      expect(d.mode, `language ${lang} should resolve review_first`).toBe(
        "review_first"
      );
    }
  });

  it("requires a prior assistant confirmation question for a contextual affirmation", () => {
    // "yes" with NO prior question must NOT authorize a send.
    const noQuestion = OutboundEmailIntentResolver.resolve(input("yes"));
    expect(noQuestion.mode).toBe("draft_only");

    // "yes" answering an explicit confirmation question DOES authorize.
    const withQuestion = OutboundEmailIntentResolver.resolve(
      input("yes, go ahead", {
        previousAssistantMessageId: "assistant-9",
        previousAssistantText: "Send batch 42 now? Reply yes to confirm.",
      })
    );
    expect(withQuestion.mode).toBe("send_now");
    expect(withQuestion.reasonCode).toBe("contextual_affirmation");
    expect(withQuestion.confidence).toBeGreaterThanOrEqual(0.9);
    expect(withQuestion.evidence[0].category).toBe("affirmation");
  });

  it("does not treat an assistant statement alone as authorization", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("what is the status?", {
        previousAssistantMessageId: "assistant-1",
        previousAssistantText: "The batch is ready. You can send it whenever.", // statement, not a question
      })
    );
    expect(d.mode).toBe("draft_only");
  });

  it("normalizes NFKC and whitespace before matching", () => {
    // fullwidth latin + non-breaking space + CRLF newlines
    const d = OutboundEmailIntentResolver.resolve(
      input("please  send  these emails now")
    );
    expect(d.mode).toBe("send_now");
  });

  it("records resolver version and source text hash", () => {
    const text = "send these emails now";
    const d = OutboundEmailIntentResolver.resolve(input(text));
    expect(d.resolverVersion).toBe(OUTBOUND_RESOLVER_VERSION);
    expect(d.sourceTextHash).toBe(hashUserAuthoredText(text));
    expect(d.sourceTextHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent for the same input", () => {
    const a = OutboundEmailIntentResolver.resolve(input("send now please"));
    const b = OutboundEmailIntentResolver.resolve(input("send now please"));
    expect(a.mode).toBe(b.mode);
    expect(a.sourceTextHash).toBe(b.sourceTextHash);
    expect(a.evidence).toEqual(b.evidence);
  });
});
