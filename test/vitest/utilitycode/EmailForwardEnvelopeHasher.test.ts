import { describe, it, expect } from "vitest";
import {
  buildEnvelopeRecipients,
  ensureFwdPrefix,
  hashForwardEnvelope,
  isValidEmailAddress,
  normalizeEmailAddress,
  type ForwardEnvelopeV1,
} from "@/service/emailOrganization/EmailForwardEnvelopeHasher";
import { EMAIL_ORGANIZATION_LIMITS } from "@/entityTypes/emailOrganizationTypes";

function envelope(overrides?: Partial<ForwardEnvelopeV1>): ForwardEnvelopeV1 {
  return {
    sendingAccountId: 1,
    fromAddress: "me@example.test",
    fromName: "Me",
    replyToAddress: null,
    smtpUsername: "me@example.test",
    toRecipients: ["alice@example.test"],
    ccRecipients: [],
    bccRecipients: [],
    subject: "Fwd: Invoice",
    note: null,
    bodyTextHash: "a".repeat(64),
    bodyHtmlHash: "b".repeat(64),
    attachments: [],
    composedMessageId: "<fwd-1@local>",
    sourceLocationSnapshotJson: '{"folderPath":"INBOX","uidValidity":"1","uid":"2"}',
    sourceFullSourceHash: "c".repeat(64),
    ...overrides,
  };
}

describe("hashForwardEnvelope", () => {
  it("is deterministic for identical envelopes", () => {
    expect(hashForwardEnvelope(envelope())).toBe(hashForwardEnvelope(envelope()));
  });

  it("changes when any approved payload field changes", () => {
    const base = hashForwardEnvelope(envelope());
    expect(hashForwardEnvelope(envelope({ toRecipients: ["bob@example.test"] }))).not.toBe(base);
    expect(hashForwardEnvelope(envelope({ subject: "Fwd: Invoice 2" }))).not.toBe(base);
    expect(hashForwardEnvelope(envelope({ note: "see attached" }))).not.toBe(base);
    expect(hashForwardEnvelope(envelope({ fromAddress: "other@example.test" }))).not.toBe(base);
    expect(hashForwardEnvelope(envelope({ sourceFullSourceHash: "d".repeat(64) }))).not.toBe(base);
  });

  it("is insensitive to recipient order", () => {
    const one = hashForwardEnvelope(
      envelope({ toRecipients: ["a@x.test", "b@x.test"] })
    );
    const two = hashForwardEnvelope(
      envelope({ toRecipients: ["b@x.test", "a@x.test"] })
    );
    expect(one).toBe(two);
  });

  it("includes selected attachments in the frozen manifest", () => {
    const attachments = [
      {
        partId: "part-1",
        displayName: "invoice.pdf",
        contentType: "application/pdf",
        decodedSize: 10,
        contentHash: "e".repeat(64),
        disposition: "attachment" as const,
        contentId: null,
        selected: true,
        artifactId: "x",
      },
    ];
    const withAttachment = hashForwardEnvelope(envelope({ attachments }));
    const deselected = hashForwardEnvelope(
      envelope({ attachments: [{ ...attachments[0], selected: false }] })
    );
    expect(withAttachment).not.toBe(deselected);
  });
});

describe("buildEnvelopeRecipients", () => {
  it("deduplicates across fields with first-field priority and normalizes case", () => {
    const envelopeList = buildEnvelopeRecipients(
      ["Alice@Example.test"],
      ["alice@example.test", "bob@test.io"],
      ["BOB@TEST.IO"]
    );
    expect(envelopeList).toEqual(["alice@example.test", "bob@test.io"]);
  });
});

describe("ensureFwdPrefix", () => {
  it("adds the prefix once and stays idempotent", () => {
    expect(ensureFwdPrefix("Invoice")).toBe("Fwd: Invoice");
    expect(ensureFwdPrefix("Fwd: Invoice")).toBe("Fwd: Invoice");
    expect(ensureFwdPrefix("fwd : Invoice")).toBe("fwd : Invoice");
    expect(ensureFwdPrefix("FWD: Invoice")).toBe("FWD: Invoice");
  });
});

describe("address helpers", () => {
  it("validates addresses and normalizes case", () => {
    expect(isValidEmailAddress("alice@example.test")).toBe(true);
    expect(isValidEmailAddress("not-an-address")).toBe(false);
    expect(isValidEmailAddress("a@b")).toBe(false);
    expect(normalizeEmailAddress("  Alice@Example.TEST ")).toBe("alice@example.test");
  });
});

describe("limit constants", () => {
  it("match the PRD product limits", () => {
    expect(EMAIL_ORGANIZATION_LIMITS.maxRecipients).toBe(20);
    expect(EMAIL_ORGANIZATION_LIMITS.maxAttachments).toBe(20);
    expect(EMAIL_ORGANIZATION_LIMITS.maxTotalAttachmentBytes).toBe(15 * 1024 * 1024);
    expect(EMAIL_ORGANIZATION_LIMITS.maxSourceBytes).toBe(30 * 1024 * 1024);
    expect(EMAIL_ORGANIZATION_LIMITS.authorizationTtlMs).toBe(15 * 60 * 1000);
  });
});
