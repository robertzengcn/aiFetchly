import { describe, it, expect } from "vitest";
import {
  mapLegacyDecision,
  isValidReplyAddress,
} from "@/service/emailReply/EmailReplyPolicyOrchestrator";

describe("mapLegacyDecision — legacy evaluator status → v2 policy code", () => {
  it("maps a 'blocked' bounce to the bounce hard-block code (not allowed)", () => {
    const d = mapLegacyDecision("blocked", "Classification 'bounce' must not be auto-replied", 3);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("bounce");
    expect(d.ruleId).toBe(3);
  });

  it("maps an unsubscribe block", () => {
    const d = mapLegacyDecision("blocked", "unsubscribe request", null);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("unsubscribe");
  });

  it("maps an automated-sender block", () => {
    const d = mapLegacyDecision("blocked", "Sender is an automated/no-reply address", null);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("automated_sender");
  });

  it("maps a skipped daily-limit decision", () => {
    const d = mapLegacyDecision("skipped", "Daily send limit reached for this inbox", 1);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("daily_limit");
  });

  it("maps a skipped thread-limit decision", () => {
    const d = mapLegacyDecision("skipped", "Per-thread reply limit reached", 1);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("thread_limit");
  });

  it("maps needs_human_review to allowed-with-review (assisted send)", () => {
    const d = mapLegacyDecision("needs_human_review", "sensitive topic", null);
    expect(d.allowed).toBe(true);
    expect(d.requiresHumanReview).toBe(true);
    expect(d.code).toBe("sensitive_topic");
  });

  it("maps approval_required to allowed-with-review", () => {
    const d = mapLegacyDecision("approval_required", "below confidence threshold", null);
    expect(d.allowed).toBe(true);
    expect(d.requiresHumanReview).toBe(true);
    expect(d.code).toBe("approval_required");
  });

  it("maps draft_created to a clean allow", () => {
    const d = mapLegacyDecision("draft_created", "ok", null);
    expect(d.allowed).toBe(true);
    expect(d.requiresHumanReview).toBe(false);
    expect(d.code).toBe("allowed");
  });

  it("always stamps the policy version", () => {
    const d = mapLegacyDecision("draft_created", "ok", null);
    expect(d.policyVersion).toBeTruthy();
  });
});

describe("isValidReplyAddress", () => {
  it("accepts a normal address", () => {
    expect(isValidReplyAddress("prospect@example.com")).toBe(true);
  });

  it("rejects missing, empty, and no-at addresses", () => {
    expect(isValidReplyAddress("")).toBe(false);
    expect(isValidReplyAddress("   ")).toBe(false);
    expect(isValidReplyAddress("noat")).toBe(false);
  });

  it("rejects addresses without a dotted domain", () => {
    expect(isValidReplyAddress("a@b")).toBe(false);
  });

  it("rejects addresses with spaces / multiple @", () => {
    expect(isValidReplyAddress("a b@c.com")).toBe(false);
    expect(isValidReplyAddress("a@b@c.com")).toBe(false);
  });

  it("rejects an over-long address", () => {
    expect(isValidReplyAddress("a@" + "x".repeat(330) + ".com")).toBe(false);
  });
});
