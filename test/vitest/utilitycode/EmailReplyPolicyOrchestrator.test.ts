import { describe, it, expect } from "vitest";
import type { EmailReplyPolicyCode } from "@/entityTypes/emailReplyReliabilityTypes";
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

describe("EmailReplyPolicyCode — FR-028/029/036/027 duplicate/refusal codes", () => {
  // Compile-time assertion: each new code is assignable to the union. If any
  // code is removed or misspelled in the union, this block fails to type-check
  // (the tsc gate at test startup catches it).
  const newCodes: readonly EmailReplyPolicyCode[] = [
    "already_replied",
    "reply_in_progress",
    "generation_in_progress",
    "reply_state_conflict",
    "reply_state_unknown",
    "needs_human_review",
    "delivery_unknown",
  ];

  it("exposes all seven new codes as valid union members", () => {
    expect(newCodes).toHaveLength(7);
    // Ensure no accidental duplication.
    expect(new Set(newCodes).size).toBe(7);
  });

  it("does not collide with historical codes", () => {
    const historical: readonly EmailReplyPolicyCode[] = [
      "allowed",
      "approval_required",
      "automated_sender",
      "bounce",
      "unsubscribe",
      "blocked_sender",
      "blocked_domain",
      "sensitive_topic",
      "invalid_recipient",
      "mailbox_mismatch",
      "daily_limit",
      "thread_limit",
      "classification_unknown",
      "context_ambiguous",
      "draft_not_approved",
      "approval_stale",
      "draft_terminal",
    ];
    const overlap = newCodes.filter((c) =>
      (historical as readonly string[]).includes(c)
    );
    expect(overlap).toEqual([]);
  });

  it("mapLegacyDecision still emits historical codes (new codes come from the guard, not legacy)", () => {
    // Regression: the new union members must not leak into the legacy mapper.
    const d = mapLegacyDecision("draft_created", "ok", null);
    expect(d.code).toBe("allowed");
    // The new codes are valid values the orchestrator can return via `deny`,
    // but mapLegacyDecision should never produce them.
    const legacyCodes: readonly string[] = [
      "bounce",
      "unsubscribe",
      "automated_sender",
      "blocked_sender",
      "blocked_domain",
      "daily_limit",
      "thread_limit",
      "sensitive_topic",
      "approval_required",
      "allowed",
    ];
    for (const status of [
      "blocked",
      "skipped",
      "needs_human_review",
      "approval_required",
      "draft_created",
    ] as const) {
      const mapped = mapLegacyDecision(
        status,
        status === "blocked"
          ? "bounce"
          : status === "skipped"
          ? "Daily send limit reached for this inbox"
          : "ok",
        null
      );
      expect(legacyCodes).toContain(mapped.code);
    }
  });

  it("maps classification-flavored blocked reasons to accurate codes (FR-007 §10.1 follow-up)", () => {
    // The classification hard-block reason carries the classification literal.
    // An unattended evaluator that still emits the unknown reason maps to
    // classification_unknown, not the generic blocked_sender fallthrough.
    // A human-confirmed send does not feed stored `unknown` into that evaluator.
    const unknownBlock = mapLegacyDecision(
      "blocked",
      "Classification 'unknown' must not be auto-replied",
      null
    );
    expect(unknownBlock.allowed).toBe(false);
    expect(unknownBlock.code).toBe("classification_unknown");

    // A stored 'auto_reply' classification (e.g. list mail) is an automated
    // sender block, not blocked_sender.
    const autoReplyBlock = mapLegacyDecision(
      "blocked",
      "Classification 'auto_reply' must not be auto-replied",
      null
    );
    expect(autoReplyBlock.code).toBe("automated_sender");

    // A deterministic 'needs_human_review' classification is a sensitive
    // topic, not blocked_sender.
    const reviewBlock = mapLegacyDecision(
      "blocked",
      "Classification 'needs_human_review' must not be auto-replied",
      null
    );
    expect(reviewBlock.code).toBe("sensitive_topic");
  });
});
