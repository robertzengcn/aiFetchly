import { describe, it, expect } from "vitest";
import {
  validateSendBinding,
  SendBindingError,
  type SendBindingInput,
} from "@/service/emailReply/EmailReplySendBinding";
import { hashApprovalEnvelope } from "@/service/emailReply/EmailReplyRevisionHasher";

/** A fully-consistent envelope; each test mutates one field to force a mismatch. */
function baseInput(over: Partial<SendBindingInput> = {}): SendBindingInput {
  const revisionId = 50;
  const draftId = 10;
  const emailServiceId = 7;
  const senderAddress = "owner@svc.com";
  const recipientAddress = "prospect@example.com";
  const recomputedHash = hashApprovalEnvelope({
    draftId,
    revisionId,
    emailServiceId,
    originalMessageId: 99,
    senderAddress,
    recipientAddress,
    subject: "Re: Pricing",
    bodyText: "Hi",
    bodyHtml: null,
    policyVersion: "reply-policy-v2-1",
    validationVersion: "reply-validator-v2-1",
  });
  return {
    requestedDraftId: draftId,
    approval: { draftId, revisionId, approvedHash: recomputedHash },
    draft: {
      id: draftId,
      currentRevisionId: revisionId,
      contentHash: recomputedHash,
      emailServiceId,
    },
    revision: {
      id: revisionId,
      senderAddress,
      recipientAddress,
      contentHash: recomputedHash,
    },
    message: {
      id: 99,
      emailServiceId,
      fromAddress: "prospect@example.com",
      replyToAddress: null,
    },
    service: { id: emailServiceId, from: senderAddress, status: 1 },
    recomputedHash,
    ...over,
  };
}

describe("validateSendBinding — consistent envelope passes", () => {
  it("returns void for a fully consistent envelope", () => {
    expect(() => validateSendBinding(baseInput())).not.toThrow();
  });
});

describe("validateSendBinding — mismatch cases throw BEFORE SMTP (P0.2)", () => {
  it("rejects a draftId that differs from the approval's draft", () => {
    expect(() =>
      validateSendBinding(baseInput({ requestedDraftId: 999 }))
    ).toThrow(SendBindingError);
    expect(() =>
      validateSendBinding(baseInput({ requestedDraftId: 999 }))
    ).toThrow(/does not match the requested draft/);
  });

  it("rejects an approval bound to a stale revision", () => {
    expect(() =>
      validateSendBinding(
        baseInput({
          approval: {
            ...baseInput().approval,
            revisionId: 999,
          },
        })
      )
    ).toThrow(/current revision/);
  });

  it("rejects a wrong-mailbox draft (draft.emailServiceId != message)", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          draft: { ...base.draft, emailServiceId: 8 },
        })
      )
    ).toThrow(/mailbox/);
  });

  it("rejects a loaded service id that does not match the bound mailbox", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          service: { ...base.service, id: 999 },
        })
      )
    ).toThrow(/service id/);
  });

  it("rejects an inactive service", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          service: { ...base.service, status: 0 },
        })
      )
    ).toThrow(/not active/);
  });

  it("rejects a changed sender (service.from != revision.senderAddress)", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          service: { ...base.service, from: "other@svc.com" },
        })
      )
    ).toThrow(/sender/);
  });

  it("rejects a changed recipient (revision recipient != message Reply-To/sender)", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          revision: { ...base.revision, recipientAddress: "someone-else@x.com" },
        })
      )
    ).toThrow(/recipient/);
  });

  it("rejects when the original message has no usable sender/Reply-To", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          message: { ...base.message, fromAddress: "", replyToAddress: null },
        })
      )
    ).toThrow(/recipient/);
  });

  it("rejects a recomputed hash that differs from the approved hash", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          recomputedHash: "0".repeat(64),
        })
      )
    ).toThrow(/approved content/);
  });

  it("rejects a revision whose stored hash differs from the recomputed envelope", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          revision: { ...base.revision, contentHash: "f".repeat(64) },
        })
      )
    ).toThrow(/revision content hash/);
  });

  it("treats sender/recipient case-insensitively in the domain (no false mismatch)", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          service: { ...base.service, from: "owner@SVC.COM" },
        })
      )
    ).not.toThrow();
  });
});
