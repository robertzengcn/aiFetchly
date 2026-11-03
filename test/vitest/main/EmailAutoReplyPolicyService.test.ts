import { describe, it, expect } from "vitest";
import {
  classificationForConfirmedSend,
  confirmedSendRuleRefusal,
  evaluateAutoReplyPolicy,
} from "@/service/emailReply/EmailAutoReplyPolicyService";
import type { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import type { EmailAutoReplyRuleEntity } from "@/entity/EmailAutoReplyRule.entity";

function fakeMessage(
  over: Partial<EmailReceivedMessageEntity> = {}
): EmailReceivedMessageEntity {
  return {
    id: 1,
    emailServiceId: 7,
    providerUid: "u1",
    messageId: "<m@x>",
    threadKey: "<m@x>",
    inReplyTo: null,
    referencesHeader: null,
    fromAddress: "prospect@example.com",
    fromName: "Prospect",
    replyToAddress: null,
    toAddressesJson: "[]",
    ccAddressesJson: null,
    subject: "Pricing",
    bodyText: "Hi, what are your prices?",
    bodyHtmlSanitized: null,
    snippet: null,
    receivedAt: new Date(),
    isUnread: 1,
    classification: null,
    classificationConfidence: null,
    replyStatus: "not_started",
    processedAt: null,
    ...over,
  } as EmailReceivedMessageEntity;
}

function fakeRule(
  over: Partial<EmailAutoReplyRuleEntity> = {}
): EmailAutoReplyRuleEntity {
  return {
    id: 1,
    emailServiceId: 7,
    name: "default",
    enabled: 1,
    allowedClassificationsJson: JSON.stringify([
      "interested",
      "support_request",
    ]),
    blockedSenderPatternsJson: null,
    blockedDomainPatternsJson: JSON.stringify(["spam.test"]),
    dailySendLimit: 10,
    perThreadReplyLimit: 1,
    confidenceThreshold: 0.7,
    quietHoursJson: null,
    requireApprovalBelowThreshold: 0.7,
    ...over,
  } as EmailAutoReplyRuleEntity;
}

const emptyCounts = { todayForService: 0, threadCount: 0 };

describe("evaluateAutoReplyPolicy (Phase 1 — auto-send disabled)", () => {
  it("canSendAutomatically is always false in MVP", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage(),
      classification: "interested",
      confidence: 0.99,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(d.canSendAutomatically).toBe(false);
  });

  it("blocks automated/no-reply senders (loop prevention)", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage({ fromAddress: "no-reply@example.com" }),
      classification: "interested",
      confidence: 0.9,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(d.status).toBe("blocked");
    expect(d.reason).toContain("no-reply@example.com");
    expect(d.reason).toMatch(/automated/i);
    expect(d.reason).toMatch(/configured send address/i);
  });

  it("allows ordinary human From addresses, including domain or local-part lookalikes", () => {
    for (const fromAddress of [
      "estewaycom@gmail.com",
      "david@aiagentlnc.com",
      "person@noreply.example.com",
      "techno-reply@example.com",
    ]) {
      const d = evaluateAutoReplyPolicy({
        message: fakeMessage({ fromAddress }),
        classification: "interested",
        confidence: 0.9,
        rule: fakeRule(),
        sendCounts: emptyCounts,
      });
      expect(d.status, fromAddress).toBe("draft_created");
    }
  });

  it("replies to a human Reply-To when From is a no-reply mailbox", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage({
        fromAddress: "no-reply@forms.example.com",
        replyToAddress: "estewaycom@gmail.com",
      }),
      classification: "interested",
      confidence: 0.9,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(d.status).toBe("draft_created");
  });

  it("lets a confirmed send proceed when classification is unknown", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage(),
      classification: classificationForConfirmedSend("unknown") as never,
      confidence: null,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(d.status).not.toBe("blocked");
    expect(d.status).not.toBe("skipped");
    expect(d.reason).not.toMatch(/unknown/);
  });

  it("still blocks bounce after the confirmed-send classification mapping", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage(),
      classification: classificationForConfirmedSend("bounce") as never,
      confidence: 0.9,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(d.status).toBe("blocked");
    expect(d.reason).toMatch(/bounce/);
  });

  it("blocks bounce / unsubscribe / auto_reply classifications", () => {
    for (const c of [
      "bounce",
      "unsubscribe",
      "auto_reply",
      "needs_human_review",
      "unknown",
    ]) {
      const d = evaluateAutoReplyPolicy({
        message: fakeMessage(),
        classification: c as never,
        confidence: 0.9,
        rule: fakeRule(),
        sendCounts: emptyCounts,
      });
      expect(d.status).toBe("blocked");
    }
  });

  it("routes sensitive content to human review", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage({ bodyText: "I want a full refund immediately." }),
      classification: "interested",
      confidence: 0.9,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(d.status).toBe("needs_human_review");
  });

  it("skips when classification is not in the rule allow-list", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage(),
      classification: "not_interested",
      confidence: 0.9,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(d.status).toBe("skipped");
  });

  it("blocks a sender whose domain is blocked by the rule", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage({ fromAddress: "x@spam.test" }),
      classification: "interested",
      confidence: 0.9,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(d.status).toBe("blocked");
  });

  it("skips when the daily send limit is reached", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage(),
      classification: "interested",
      confidence: 0.9,
      rule: fakeRule(),
      sendCounts: { todayForService: 10, threadCount: 0 },
    });
    expect(d.status).toBe("skipped");
    expect(d.reason).toMatch(/daily/i);
  });

  it("requires approval when confidence is below the threshold", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage(),
      classification: "interested",
      confidence: 0.4,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(d.status).toBe("approval_required");
  });

  it("returns draft_created for a clean, high-confidence message", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage(),
      classification: "interested",
      confidence: 0.95,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(d.status).toBe("draft_created");
  });
});

describe("rule guardrails vs the reply RECIPIENT (D2 review fix)", () => {
  it("blocks a blocked SENDER pattern arriving via Reply-To (From stays clean)", () => {
    const decision = evaluateAutoReplyPolicy({
      message: fakeMessage({
        fromAddress: "innocent@corp.com",
        replyToAddress: "spam-bulk@spam.test",
      }),
      classification: "interested",
      confidence: 0.9,
      rule: fakeRule({
        blockedSenderPatternsJson: JSON.stringify(["spam-bulk"]),
        blockedDomainPatternsJson: null,
      }),
      sendCounts: emptyCounts,
    });
    expect(decision.status).toBe("blocked");
    expect(decision.reason).toContain("blocked pattern");
  });

  it("blocks a blocked DOMAIN on the Reply-To recipient (redirection bypass)", () => {
    const decision = evaluateAutoReplyPolicy({
      message: fakeMessage({
        fromAddress: "person@friendly.org",
        replyToAddress: "deals@spam.test",
      }),
      classification: "interested",
      confidence: 0.9,
      rule: fakeRule(),
      sendCounts: emptyCounts,
    });
    expect(decision.status).toBe("blocked");
    expect(decision.reason).toContain("spam.test");
  });

  it("still blocks a blocked From when Reply-To is absent", () => {
    const decision = evaluateAutoReplyPolicy({
      message: fakeMessage({ fromAddress: "spam-bulk@friendly.org" }),
      classification: "interested",
      confidence: 0.9,
      rule: fakeRule({
        blockedSenderPatternsJson: JSON.stringify(["spam-bulk"]),
        blockedDomainPatternsJson: null,
      }),
      sendCounts: emptyCounts,
    });
    expect(decision.status).toBe("blocked");
  });
});

describe("confirmedSendRuleRefusal (D2 review fix — allowlist vs unknown)", () => {
  it("refuses a stripped-unknown classification not listed in the allowlist", () => {
    const refusal = confirmedSendRuleRefusal(
      fakeRule(),
      classificationForConfirmedSend("unknown")
    );
    expect(refusal).toContain("not allowed by rule 'default'");
  });

  it("allows unknown when the owner explicitly listed it", () => {
    const refusal = confirmedSendRuleRefusal(
      fakeRule({
        allowedClassificationsJson: JSON.stringify([
          "interested",
          "unknown",
        ]),
      }),
      classificationForConfirmedSend("unknown")
    );
    expect(refusal).toBeNull();
  });

  it("allows a listed concrete classification", () => {
    const refusal = confirmedSendRuleRefusal(
      fakeRule(),
      classificationForConfirmedSend("interested")
    );
    expect(refusal).toBeNull();
  });

  it("does not enforce an allowlist when the rule has none", () => {
    const refusal = confirmedSendRuleRefusal(
      fakeRule({ allowedClassificationsJson: undefined }),
      classificationForConfirmedSend("unknown")
    );
    expect(refusal).toBeNull();
  });

  it("does not enforce anything when the rule is disabled", () => {
    const refusal = confirmedSendRuleRefusal(
      fakeRule({ enabled: 0 }),
      classificationForConfirmedSend("unknown")
    );
    expect(refusal).toBeNull();
  });
});

describe("humanConfirmed exemption (reviewed flag — create_email_reply_draft)", () => {
  it("exempts a 'needs_human_review' classification when humanConfirmed, returns a draftable decision", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage(),
      classification: "needs_human_review",
      confidence: 0.5,
      rule: null,
      sendCounts: emptyCounts,
      humanConfirmed: true,
    });
    expect(d.status).not.toBe("blocked");
    expect(d.canSendAutomatically).toBe(false);
  });

  it("still hard-blocks bounce / auto_reply / unsubscribe classifications even when humanConfirmed", () => {
    for (const classification of [
      "bounce",
      "auto_reply",
      "unsubscribe",
    ] as const) {
      const d = evaluateAutoReplyPolicy({
        message: fakeMessage(),
        classification,
        confidence: 0.95,
        rule: null,
        sendCounts: emptyCounts,
        humanConfirmed: true,
      });
      expect(d.status).toBe("blocked");
    }
  });

  it("keeps the automated no-reply recipient block when humanConfirmed", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage({ fromAddress: "no-reply@example.com" }),
      classification: "needs_human_review",
      confidence: 0.5,
      rule: null,
      sendCounts: emptyCounts,
      humanConfirmed: true,
    });
    expect(d.status).toBe("blocked");
  });

  it("flag-adjacent: sensitive keywords with humanConfirmed yield review status (allowed, review, no auto-send)", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage({ bodyText: "Please refund my payment." }),
      classification: null,
      confidence: null,
      rule: null,
      sendCounts: emptyCounts,
      humanConfirmed: true,
    });
    expect(d.status).toBe("needs_human_review");
    expect(d.canSendAutomatically).toBe(false);
  });
});

describe("classificationForConfirmedSend strips needs_human_review", () => {
  it("returns null for unknown and needs_human_review (human-confirmed paths); keeps hard classes", () => {
    expect(classificationForConfirmedSend("unknown")).toBe(null);
    expect(classificationForConfirmedSend("needs_human_review")).toBe(null);
    expect(classificationForConfirmedSend("bounce")).toBe("bounce");
    expect(classificationForConfirmedSend("auto_reply")).toBe("auto_reply");
    expect(classificationForConfirmedSend("unsubscribe")).toBe("unsubscribe");
    expect(classificationForConfirmedSend("interested")).toBe("interested");
    expect(classificationForConfirmedSend(null)).toBe(null);
  });
});
