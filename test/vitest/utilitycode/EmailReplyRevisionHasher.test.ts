import { describe, it, expect } from "vitest";
import {
  hashApprovalEnvelope,
  hashApprovalEnvelopeV2,
  canonicalizeApprovalEnvelope,
  canonicalizeApprovalEnvelopeV2,
  normalizeEmailAddressForHash,
  buildSendIdempotencyKey,
  generateApprovalToken,
  hashApprovalToken,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import type {
  EmailReplyApprovalEnvelope,
  EmailReplyApprovalEnvelopeV2,
} from "@/entityTypes/emailReplyReliabilityTypes";

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
  it("is deterministic for the same approved revision + approval", () => {
    expect(buildSendIdempotencyKey(5, 1, "deadbeef", 9)).toBe(
      buildSendIdempotencyKey(5, 1, "deadbeef", 9)
    );
  });

  it("changes when the approved hash changes", () => {
    expect(buildSendIdempotencyKey(5, 1, "aaa", 9)).not.toBe(
      buildSendIdempotencyKey(5, 1, "bbb", 9)
    );
  });

  it("changes when the approval id changes (allows retry after failure)", () => {
    expect(buildSendIdempotencyKey(5, 1, "aaa", 9)).not.toBe(
      buildSendIdempotencyKey(5, 1, "aaa", 10)
    );
  });

  it("carries a stable versioned prefix", () => {
    expect(
      buildSendIdempotencyKey(5, 1, "x", 9).startsWith("erv1:5:1:9:")
    ).toBe(true);
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

// ---------------------------------------------------------------------------
// Version-2 reply approval envelope tests (§18.1). The v1 tests above are
// NOT modified — v1 and v2 paths are entirely separate.
// ---------------------------------------------------------------------------

function baseEnvelopeV2(
  over: Partial<EmailReplyApprovalEnvelopeV2> = {}
): EmailReplyApprovalEnvelopeV2 {
  return {
    version: 2,
    draftId: 10,
    revisionId: 2,
    emailServiceId: 7,
    originalMessageId: 99,
    smtpUsername: "smtp-login@svc.com",
    senderAddress: "Owner@Example.com",
    replyToAddress: null,
    recipientAddress: "prospect@example.com",
    subject: "Re: Pricing",
    bodyText: "Hi there",
    bodyHtml: null,
    policyVersion: "policy-1",
    validationVersion: "validator-1",
    ...over,
  };
}

describe("hashApprovalEnvelopeV2 — pinned fixture", () => {
  it("produces the byte-identical pinned hash for the canonical v2 fixture", () => {
    const pinned =
      "8555de3c7ac70dd4bec43f7a0bbd6d26b44dae4706e1fb7b7b1e997763b0f8fa";
    expect(hashApprovalEnvelopeV2(baseEnvelopeV2())).toBe(pinned);
  });

  it("is deterministic for identical v2 input", () => {
    const a = hashApprovalEnvelopeV2(baseEnvelopeV2());
    const b = hashApprovalEnvelopeV2(baseEnvelopeV2());
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("produces a DIFFERENT hash than v1 for the same logical envelope", () => {
    // The v1 hash does NOT include version, smtpUsername, or replyToAddress,
    // so it MUST differ from the v2 hash for the same content.
    const v1 = hashApprovalEnvelope({
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
    const v2 = hashApprovalEnvelopeV2(baseEnvelopeV2());
    expect(v2).not.toBe(v1);
  });
});

describe("hashApprovalEnvelopeV2 — identity binding (§18.2)", () => {
  const baseline = baseEnvelopeV2();

  it("changes when smtpUsername changes", () => {
    expect(
      hashApprovalEnvelopeV2({ ...baseline, smtpUsername: "different@svc.com" })
    ).not.toBe(hashApprovalEnvelopeV2(baseline));
  });

  it("changes when replyToAddress changes from null to non-null", () => {
    expect(
      hashApprovalEnvelopeV2({
        ...baseline,
        replyToAddress: "replies@other.com",
      })
    ).not.toBe(hashApprovalEnvelopeV2(baseline));
  });

  it("changes when replyToAddress changes between two non-null values", () => {
    const a = hashApprovalEnvelopeV2({
      ...baseline,
      replyToAddress: "replies@other.com",
    });
    const b = hashApprovalEnvelopeV2({
      ...baseline,
      replyToAddress: "different@other.com",
    });
    expect(a).not.toBe(b);
  });

  it("distinguishes null replyTo from empty-string replyTo", () => {
    const nullReply = hashApprovalEnvelopeV2({
      ...baseline,
      replyToAddress: null,
    });
    const emptyReply = hashApprovalEnvelopeV2({
      ...baseline,
      replyToAddress: "",
    });
    expect(nullReply).not.toBe(emptyReply);
  });

  it("changes when subject changes", () => {
    expect(
      hashApprovalEnvelopeV2({ ...baseline, subject: "Different" })
    ).not.toBe(hashApprovalEnvelopeV2(baseline));
  });

  it("changes when body changes", () => {
    expect(
      hashApprovalEnvelopeV2({ ...baseline, bodyText: "Hi there " })
    ).not.toBe(hashApprovalEnvelopeV2(baseline));
  });
});

describe("hashApprovalEnvelopeV2 — normalization (§7.3)", () => {
  const baseline = baseEnvelopeV2();

  it("is insensitive to email address case in the domain only (sender)", () => {
    const a = hashApprovalEnvelopeV2({
      ...baseline,
      senderAddress: "Owner@EXAMPLE.com",
    });
    const b = hashApprovalEnvelopeV2({
      ...baseline,
      senderAddress: "Owner@example.com",
    });
    expect(a).toBe(b);
  });

  it("preserves the local part of the sender address", () => {
    const a = hashApprovalEnvelopeV2({
      ...baseline,
      senderAddress: "Owner@Example.com",
    });
    const b = hashApprovalEnvelopeV2({
      ...baseline,
      senderAddress: "owner@Example.com",
    });
    expect(a).not.toBe(b);
  });

  it("is insensitive to whitespace around smtpUsername (trim-only, never lowercased)", () => {
    const a = hashApprovalEnvelopeV2({
      ...baseline,
      smtpUsername: "smtp-login@svc.com",
    });
    const b = hashApprovalEnvelopeV2({
      ...baseline,
      smtpUsername: "  smtp-login@svc.com  ",
    });
    expect(a).toBe(b);
  });

  it("preserves the case of smtpUsername (never lowercased)", () => {
    const a = hashApprovalEnvelopeV2({
      ...baseline,
      smtpUsername: "Smtp-Login@svc.com",
    });
    const b = hashApprovalEnvelopeV2({
      ...baseline,
      smtpUsername: "smtp-login@svc.com",
    });
    expect(a).not.toBe(b);
  });

  it("is insensitive to CRLF vs LF in body text", () => {
    const lf = hashApprovalEnvelopeV2({
      ...baseline,
      bodyText: "line1\nline2",
    });
    const crlf = hashApprovalEnvelopeV2({
      ...baseline,
      bodyText: "line1\r\nline2",
    });
    expect(lf).toBe(crlf);
  });

  it("distinguishes null bodyHtml from empty-string bodyHtml", () => {
    const nullHtml = hashApprovalEnvelopeV2({ ...baseline, bodyHtml: null });
    const emptyHtml = hashApprovalEnvelopeV2({ ...baseline, bodyHtml: "" });
    expect(nullHtml).not.toBe(emptyHtml);
  });
});

describe("canonicalizeApprovalEnvelopeV2 — delimiter safety", () => {
  it("does not collide when user content contains the delimiter", () => {
    const a = canonicalizeApprovalEnvelopeV2({
      ...baseEnvelopeV2(),
      subject: "ab",
      bodyText: "c",
    });
    const b = canonicalizeApprovalEnvelopeV2({
      ...baseEnvelopeV2(),
      subject: "a",
      bodyText: "b|c",
    });
    expect(a).not.toBe(b);
  });

  it("includes the leading version:2 field", () => {
    const canonical = canonicalizeApprovalEnvelopeV2(baseEnvelopeV2());
    expect(canonical.startsWith("version:2|")).toBe(true);
  });
});
