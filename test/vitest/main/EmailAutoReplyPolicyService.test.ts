import { describe, it, expect } from "vitest";
import { evaluateAutoReplyPolicy } from "@/service/emailReply/EmailAutoReplyPolicyService";
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
    expect(d.reason).toMatch(/automated/i);
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
