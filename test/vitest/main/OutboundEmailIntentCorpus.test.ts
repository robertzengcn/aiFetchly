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

  it("blocks a send_now intent when no request-scoped authorization exists", () => {
    // Even the clearest send instruction is still refused by the gate without
    // a persisted authorization (AD-003/AD-009). authorization === null is the
    // invariant: no authorization, no send.
    const d = OutboundEmailIntentResolver.resolve(
      input("send these emails now")
    );
    expect(d.mode).toBe("send_now");

    const gate = OutboundEmailToolGate.evaluate(d, null, null);
    expect(refusedCode(gate)).toBe("authorization_missing");
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
 * "please send a test email to …" is an unambiguous send instruction: the user
 * is asking for delivery now, not a draft for later review. It must resolve to
 * `send_now` so that, once a draft batch exists for the turn, trusted app code
 * can create the §13.1 direct-send authorization. The deny/review/ambiguous
 * corpus above is unchanged — only wording that clearly asks for the send
 * resolves here.
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
});
