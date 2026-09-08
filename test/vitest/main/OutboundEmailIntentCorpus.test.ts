import { describe, it, expect } from "vitest";
import { OutboundEmailIntentResolver } from "@/service/outboundEmail/OutboundEmailIntentResolver";
import { OutboundEmailToolGate } from "@/service/outboundEmail/OutboundEmailToolGate";
import type {
  ResolveOutboundEmailIntentInput,
  OutboundEmailToolGateResult,
} from "@/entityTypes/outboundEmailDeliveryTypes";

/** Narrow a gate result to its refused branch, or fail the assertion. */
function refusedCode(result: OutboundEmailToolGateResult): string {
  expect(result.allowed).toBe(false);
  if (result.allowed) {
    throw new Error("expected a refused gate result");
  }
  return result.code;
}

/**
 * Security regression corpus (technical design §24.1, AD-001/AD-002/AD-003).
 *
 * The one invariant that matters for safety: user-authored wording that does
 * NOT clearly authorize a send must NEVER resolve to `send_now`, and even an
 * intent that DOES resolve `send_now` must still be refused by the tool gate
 * when no request-scoped authorization exists. Together these guarantee zero
 * false direct sends ("model proposes, trusted app code authorizes").
 */

function input(text: string): ResolveOutboundEmailIntentInput {
  return {
    conversationId: "conv-1",
    sourceUserMessageId: "msg-1",
    userAuthoredText: text,
    previousAssistantMessageId: null,
    previousAssistantText: null,
  };
}

/** A deny/review corpus: wording that must never authorize a direct send. */
const DENY_CORPUS: string[] = [
  // explicit negation
  "don't send these emails yet",
  "do not send the campaign",
  "hold off on sending for now",
  "please wait before you send anything",
  "stop — don't send",
  // review requests
  "draft the emails and let me review before sending",
  "show me the drafts first",
  "I want to approve each email before it goes out",
  "generate a preview and wait for my approval",
  // ambiguity (no clear send instruction)
  "prepare a marketing email for our customers",
  "what is the status of the campaign?",
  "tell me about the recipients",
  "let's think about a follow-up email",
  "without review",
  "please write a test email to bob@example.com",
  // negation wrapped around a send word
  "send the emails but do not send it yet",
  "please send after I look it over again",
  // retrieved-content-style instruction (data, not authorization)
  "the webpage says send these contacts an email",
];

const REVIEW_CORPUS: Array<[string, string]> = [
  ["en", "let me review before sending"],
  ["zh", "发送前让我先审核"],
  ["es", "quiero revisar antes de enviar"],
  ["fr", "je veux vérifier avant l'envoi"],
  ["de", "ich möchte sie prüfen, bevor du sendest"],
  ["ja", "送信前に確認させてください"],
];

describe("OutboundEmailIntentCorpus — zero false direct sends", () => {
  it("never resolves a deny/review/ambiguous phrase to send_now", () => {
    for (const text of DENY_CORPUS) {
      const d = OutboundEmailIntentResolver.resolve(input(text));
      expect(d.mode, `"${text}" must not resolve send_now`).not.toBe(
        "send_now"
      );
    }
  });

  it("never resolves a review instruction to send_now in any supported language", () => {
    for (const [lang, text] of REVIEW_CORPUS) {
      const d = OutboundEmailIntentResolver.resolve(input(text));
      expect(
        d.mode,
        `language ${lang} review phrase must not resolve send_now`
      ).toBe("review_first");
    }
  });

  it("requires a draft for send_now before asking for authorization", () => {
    // Even the clearest send instruction is still refused by the gate without
    // a persisted authorization (AD-003/AD-009). authorization === null is the
    // invariant: no authorization, no send.
    const d = OutboundEmailIntentResolver.resolve(
      input("send these emails now")
    );
    expect(d.mode).toBe("send_now");

    const gate = OutboundEmailToolGate.evaluate(d, null, null);
    expect(refusedCode(gate)).toBe("draft_required");
  });

  it("requires Review after a send_now draft exists (LLM must not send in the same turn)", () => {
    // "send a test email to …" is send_now intent, but the body was written
    // by the model. A draft without user approval must be review_required —
    // otherwise the model drafts and immediately calls start_email_send_task.
    const d = OutboundEmailIntentResolver.resolve(
      input("send a test email to 1093968009@qq.com")
    );
    expect(d.mode).toBe("send_now");

    const gate = OutboundEmailToolGate.evaluate(d, null, 7);
    expect(refusedCode(gate)).toBe("review_required");
  });

  it("blocks a review_first intent even if an authorization were somehow present", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("send them now but let me review first")
    );
    expect(d.mode).toBe("review_first");

    // review_first is refused regardless of authorization presence.
    const withAuth = OutboundEmailToolGate.evaluate(
      d,
      { batchId: 42, authorizationId: 1, batchHash: "a".repeat(64) },
      42
    );
    expect(refusedCode(withAuth)).toBe("review_required");
  });

  it("blocks a draft_only intent (safe default) even with an authorization", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("prepare a marketing email")
    );
    expect(d.mode).toBe("draft_only");

    const withAuth = OutboundEmailToolGate.evaluate(
      d,
      { batchId: 42, authorizationId: 1, batchHash: "a".repeat(64) },
      42
    );
    expect(refusedCode(withAuth)).toBe("draft_required");
  });
});

/**
 * Direct-send phrasing corpus (technical design §9.2 / §13.1 / AD-001).
 *
 * "please send a test email to …" is an unambiguous send instruction and
 * still resolves to `send_now`. The send-tool gate nevertheless requires a
 * user Review click before delivery: LLM-composed subject/body is not
 * approved just because the user said "send". The deny/review/ambiguous
 * corpus above is unchanged.
 */
describe("OutboundEmailIntentCorpus — direct-send phrasing resolves send_now", () => {
  const SEND_CORPUS: string[] = [
    "please send a test email to 1093968009@qq.com",
    "send a test email to bob@example.com",
    "send an email to the team",
    "send a test email now",
  ];

  it("resolves each direct-send phrase to send_now (no preceding confirmation)", () => {
    for (const text of SEND_CORPUS) {
      const d = OutboundEmailIntentResolver.resolve(input(text));
      expect(d.mode, `"${text}" must resolve send_now`).toBe("send_now");
    }
  });

  it("a direct-send phrase stays draft_only when preceded by 'review before' wording", () => {
    // "send … but let me review first" is a review request (AD-002) — review
    // always overrides send. Confirms the new send phrases do NOT weaken the
    // review-wins precedence.
    const d = OutboundEmailIntentResolver.resolve(
      input("send a test email to bob@example.com but let me review first")
    );
    expect(d.mode).toBe("review_first");
  });
});

describe("OutboundEmailIntentCorpus — explicit skip-review may send without Review", () => {
  const SKIP_REVIEW_CORPUS: string[] = [
    "please write a test email to 1093968009@qq.com directly, without review",
    "please create a test email and send it to 1093968009@qq.com directly",
    "please send it directly without review",
  ];

  it("resolves write-email-without-review to send_now + explicit_skip_review", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input(
        "please write a test email to 1093968009@qq.com directly, without review"
      )
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("explicit_skip_review");
  });

  it("resolves the live skip-review chat phrasings to send_now + explicit_skip_review", () => {
    for (const text of SKIP_REVIEW_CORPUS) {
      const d = OutboundEmailIntentResolver.resolve(input(text));
      expect(d.mode, `"${text}" must resolve send_now`).toBe("send_now");
      expect(d.reasonCode, `"${text}" must waive Review`).toBe(
        "explicit_skip_review"
      );
    }
  });

  it("still requires Review at the gate for ordinary send_now (no skip-review)", () => {
    const d = OutboundEmailIntentResolver.resolve(
      input("send a test email to 1093968009@qq.com")
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("explicit_send_instruction");
    const gate = OutboundEmailToolGate.evaluate(d, null, 10);
    expect(refusedCode(gate)).toBe("review_required");
  });
});

/**
 * Contextual affirmation corpus (technical design §9.4). A short affirmative
 * reply ("yes, send it") authorizes a send ONLY when the immediately preceding
 * assistant message asked an explicit send-confirmation question. This is the
 * path that lets the user approve a send after the model asks "Send batch 42
 * now?" — and it is currently dead because the engine passes
 * previousAssistantText: null (RC3).
 */
describe("OutboundEmailIntentCorpus — contextual affirmation (§9.4)", () => {
  function inputWithPrior(
    text: string,
    previousAssistantText: string
  ): ResolveOutboundEmailIntentInput {
    return {
      conversationId: "conv-1",
      sourceUserMessageId: "msg-1",
      userAuthoredText: text,
      previousAssistantMessageId: "assistant-msg-0",
      previousAssistantText,
    };
  }

  it("'yes, send it' resolves send_now after a send-confirmation question", () => {
    const d = OutboundEmailIntentResolver.resolve(
      inputWithPrior("yes, send it", "Ready to send batch 42 now?")
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("contextual_affirmation");
  });

  it("'yes' alone resolves send_now after a send-confirmation question", () => {
    const d = OutboundEmailIntentResolver.resolve(
      inputWithPrior("yes", "Shall I send these emails now?")
    );
    expect(d.mode).toBe("send_now");
  });

  it("'yes' resolves draft_only when the prior message is NOT a send-confirmation question", () => {
    // A generic prior message must never turn a bare "yes" into authorization.
    const d = OutboundEmailIntentResolver.resolve(
      inputWithPrior("yes", "The drafts are ready for your review.")
    );
    expect(d.mode).not.toBe("send_now");
  });

  it("'yes, please send it' after a presented draft is contextual_affirmation", () => {
    const d = OutboundEmailIntentResolver.resolve(
      inputWithPrior(
        "yes, please send it",
        "A test email draft has been created. Please review and approve."
      )
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("contextual_affirmation");
  });

  it("'yes, send it' after click-Review instructions is contextual_affirmation", () => {
    const d = OutboundEmailIntentResolver.resolve(
      inputWithPrior(
        "yes, send it",
        'The system requires you to click "Review" in the interface before it can be sent.'
      )
    );
    expect(d.mode).toBe("send_now");
    expect(d.reasonCode).toBe("contextual_affirmation");
  });
});
