import { describe, it, expect } from "vitest";
import {
  hashApprovalEnvelope,
  canonicalizeApprovalEnvelope,
  normalizeEmailAddressForHash,
  buildSendIdempotencyKey,
  generateApprovalToken,
  hashApprovalToken,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import type { EmailReplyApprovalEnvelope } from "@/entityTypes/emailReplyReliabilityTypes";

function baseEnvelope(
  over: Partial<EmailReplyApprovalEnvelope> = {}
): EmailReplyApprovalEnvelope {
  return {
    draftId: 10,
    revisionId: 2,
    emailServiceId: 7,
    originalMessageId: 99,
    senderAddress: "Owner@Example.com",
    recipientAddress: "prospect@example.com",
    subject: "Re: Pricing",
    bodyText: "Hi there",
    bodyHtml: null,
    policyVersion: "policy-1",
    validationVersion: "validator-1",
    ...over,
  };
}

describe("normalizeEmailAddressForHash", () => {
  it("lowercases the domain only, preserves local part", () => {
    expect(normalizeEmailAddressForHash("Owner@Example.com")).toBe(
      "Owner@example.com"
    );
    expect(normalizeEmailAddressForHash("A.B+tag@SUB.example.com")).toBe(
      "A.B+tag@sub.example.com"
    );
  });

  it("returns input trimmed and unchanged when no @", () => {
    expect(normalizeEmailAddressForHash("no-at-sign")).toBe("no-at-sign");
    expect(normalizeEmailAddressForHash("  trim@me  ")).toBe("trim@me");
  });
});

describe("hashApprovalEnvelope — stability", () => {
  it("is deterministic for identical input", () => {
    const a = hashApprovalEnvelope(baseEnvelope());
    const b = hashApprovalEnvelope(baseEnvelope());
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("is unaffected by object key reordering at the call site", () => {
    const ordered = hashApprovalEnvelope({
      draftId: 10,
      revisionId: 2,
      emailServiceId: 7,
      originalMessageId: 99,
      senderAddress: "Owner@Example.com",
      recipientAddress: "prospect@example.com",
      subject: "Re: Pricing",
      bodyText: "Hi there",
      bodyHtml: null,
      policyVersion: "policy-1",
      validationVersion: "validator-1",
    });
    // Same fields, different construction order, same canonical hash.
    const reordered = hashApprovalEnvelope({
      validationVersion: "validator-1",
      policyVersion: "policy-1",
      bodyHtml: null,
      bodyText: "Hi there",
      subject: "Re: Pricing",
      recipientAddress: "prospect@example.com",
      senderAddress: "Owner@Example.com",
      originalMessageId: 99,
      emailServiceId: 7,
      revisionId: 2,
      draftId: 10,
    });
    expect(ordered).toBe(reordered);
  });
});

describe("hashApprovalEnvelope — invalidation", () => {
  const baseline = baseEnvelope();

  it("changes when subject changes", () => {
    expect(
      hashApprovalEnvelope({ ...baseline, subject: "Different" })
    ).not.toBe(hashApprovalEnvelope(baseline));
  });

  it("changes when body changes (incl. trailing whitespace)", () => {
    expect(
      hashApprovalEnvelope({ ...baseline, bodyText: "Hi there " })
    ).not.toBe(hashApprovalEnvelope(baseline));
  });

  it("changes when recipient changes", () => {
    expect(
      hashApprovalEnvelope({ ...baseline, recipientAddress: "other@x.com" })
    ).not.toBe(hashApprovalEnvelope(baseline));
  });

  it("changes when sender mailbox changes (mailbox binding)", () => {
    expect(
      hashApprovalEnvelope({ ...baseline, senderAddress: "other@x.com" })
    ).not.toBe(hashApprovalEnvelope(baseline));
  });

  it("changes when policy version changes", () => {
    expect(
      hashApprovalEnvelope({ ...baseline, policyVersion: "policy-2" })
    ).not.toBe(hashApprovalEnvelope(baseline));
  });

  it("distinguishes null bodyHtml from empty-string bodyHtml", () => {
    const nullHtml = hashApprovalEnvelope({ ...baseline, bodyHtml: null });
    const emptyHtml = hashApprovalEnvelope({ ...baseline, bodyHtml: "" });
    expect(nullHtml).not.toBe(emptyHtml);
  });

  it("is insensitive to CRLF vs LF in body text", () => {
    const lf = hashApprovalEnvelope({ ...baseline, bodyText: "line1\nline2" });
    const crlf = hashApprovalEnvelope({
      ...baseline,
      bodyText: "line1\r\nline2",
    });
    expect(lf).toBe(crlf);
  });

  it("is insensitive to email address case in the domain only", () => {
    const a = hashApprovalEnvelope({
      ...baseline,
      recipientAddress: "prospect@EXAMPLE.com",
    });
    const b = hashApprovalEnvelope({
      ...baseline,
      recipientAddress: "prospect@example.com",
    });
    expect(a).toBe(b);
  });
});

describe("canonicalizeApprovalEnvelope — delimiter safety", () => {
  it("does not collide when user content contains the delimiter", () => {
    const a = canonicalizeApprovalEnvelope({
      ...baseEnvelope(),
      subject: "ab",
      bodyText: "c",
    });
    const b = canonicalizeApprovalEnvelope({
      ...baseEnvelope(),
      subject: "a",
      bodyText: "b|c",
    });
    expect(a).not.toBe(b);
  });
});

describe("buildSendIdempotencyKey", () => {
  it("is deterministic for the same approved revision", () => {
    expect(buildSendIdempotencyKey(5, 1, "deadbeef")).toBe(
      buildSendIdempotencyKey(5, 1, "deadbeef")
    );
  });

  it("changes when the approved hash changes", () => {
    expect(buildSendIdempotencyKey(5, 1, "aaa")).not.toBe(
      buildSendIdempotencyKey(5, 1, "bbb")
    );
  });

  it("carries a stable versioned prefix", () => {
    expect(buildSendIdempotencyKey(5, 1, "x").startsWith("erv1:5:1:")).toBe(
      true
    );
  });
});

describe("approval token helpers", () => {
  it("generates a 128-char hex token", () => {
    const t = generateApprovalToken();
    expect(t).toHaveLength(128);
    expect(/^[0-9a-f]+$/.test(t)).toBe(true);
  });

  it("generates distinct tokens", () => {
    expect(generateApprovalToken()).not.toBe(generateApprovalToken());
  });

  it("hashes a token deterministically to 64 hex chars", () => {
    const t = generateApprovalToken();
    expect(hashApprovalToken(t)).toBe(hashApprovalToken(t));
    expect(hashApprovalToken(t)).toHaveLength(64);
  });
});
