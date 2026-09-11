import { describe, it, expect } from "vitest";
import {
  validateSendBinding,
  SendBindingError,
  type SendBindingInput,
} from "@/service/emailReply/EmailReplySendBinding";
import {
  hashApprovalEnvelope,
  hashApprovalEnvelopeV2,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import type { EmailReplyApprovalEnvelopeV2 } from "@/entityTypes/emailReplyReliabilityTypes";

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
          revision: {
            ...base.revision,
            recipientAddress: "someone-else@x.com",
          },
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

// ---------------------------------------------------------------------------
// Version-2 identity binding tests (§18.2) and §18.3 legacy gate tests.
// The v1 tests above are NOT modified.
// ---------------------------------------------------------------------------

/** Assert that validateSendBinding throws a SendBindingError with the given code. */
function expectBindingError(
  input: SendBindingInput,
  expectedCode: string
): void {
  try {
    validateSendBinding(input);
    expect.unreachable(`expected validateSendBinding to throw ${expectedCode}`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SendBindingError);
    expect((error as SendBindingError).code).toBe(expectedCode);
  }
}
function baseV2Envelope(
  over: Partial<EmailReplyApprovalEnvelopeV2> = {}
): EmailReplyApprovalEnvelopeV2 {
  return {
    version: 2,
    draftId: 10,
    revisionId: 50,
    emailServiceId: 7,
    originalMessageId: 99,
    smtpUsername: "owner@svc.com",
    senderAddress: "owner@svc.com",
    replyToAddress: null,
    recipientAddress: "prospect@example.com",
    subject: "Re: Pricing",
    bodyText: "Hi",
    bodyHtml: null,
    policyVersion: "reply-policy-v2-1",
    validationVersion: "reply-validator-v2-1",
    ...over,
  };
}

function baseV2Input(over: Partial<SendBindingInput> = {}): SendBindingInput {
  const envelope = baseV2Envelope();
  const recomputedHash = hashApprovalEnvelopeV2(envelope);
  return {
    requestedDraftId: envelope.draftId,
    approval: {
      draftId: envelope.draftId,
      revisionId: envelope.revisionId,
      approvedHash: recomputedHash,
    },
    draft: {
      id: envelope.draftId,
      currentRevisionId: envelope.revisionId,
      contentHash: recomputedHash,
      emailServiceId: envelope.emailServiceId,
    },
    revision: {
      id: envelope.revisionId,
      senderAddress: envelope.senderAddress,
      recipientAddress: envelope.recipientAddress,
      contentHash: recomputedHash,
      envelopeVersion: 2,
      smtpUsername: envelope.smtpUsername,
      replyToAddress: envelope.replyToAddress,
    },
    message: {
      id: envelope.originalMessageId,
      emailServiceId: envelope.emailServiceId,
      fromAddress: "prospect@example.com",
      replyToAddress: null,
    },
    service: {
      id: envelope.emailServiceId,
      from: envelope.senderAddress,
      status: 1,
      smtpUsername: envelope.smtpUsername,
      replyTo: envelope.replyToAddress,
    },
    recomputedHash,
    ...over,
  };
}

describe("validateSendBinding — v2 identity binding (§18.2)", () => {
  it("passes for a fully consistent v2 envelope", () => {
    expect(() => validateSendBinding(baseV2Input())).not.toThrow();
  });

  it("rejects v2 when smtpUsername differs from the current effective login", () => {
    const base = baseV2Input();
    expectBindingError(
      baseV2Input({
        service: { ...base.service, smtpUsername: "different@svc.com" },
      }),
      "reply_identity_mismatch"
    );
  });

  it("rejects v2 when revision smtpUsername differs from service effective login", () => {
    const base = baseV2Input();
    expectBindingError(
      baseV2Input({
        revision: { ...base.revision, smtpUsername: "different@svc.com" },
      }),
      "reply_identity_mismatch"
    );
  });

  it("rejects v2 when replyTo changes from null to non-null on the service", () => {
    const base = baseV2Input();
    expectBindingError(
      baseV2Input({
        service: { ...base.service, replyTo: "replies@other.com" },
      }),
      "reply_identity_mismatch"
    );
  });

  it("rejects v2 when revision replyTo is null but service has replyTo set", () => {
    const base = baseV2Input();
    expectBindingError(
      baseV2Input({
        service: { ...base.service, replyTo: "replies@other.com" },
      }),
      "reply_identity_mismatch"
    );
  });

  it("rejects v2 when revision replyTo is non-null but service replyTo is null", () => {
    const base = baseV2Input();
    const envWithReplyTo = baseV2Envelope({
      replyToAddress: "replies@other.com",
    });
    const hash = hashApprovalEnvelopeV2(envWithReplyTo);
    expectBindingError(
      baseV2Input({
        approval: { ...base.approval, approvedHash: hash },
        revision: {
          ...base.revision,
          replyToAddress: "replies@other.com",
          contentHash: hash,
        },
        recomputedHash: hash,
      }),
      "reply_identity_mismatch"
    );
  });

  it("passes v2 when both revision and service have matching non-null replyTo", () => {
    const envWithReplyTo = baseV2Envelope({
      replyToAddress: "replies@other.com",
    });
    const hash = hashApprovalEnvelopeV2(envWithReplyTo);
    expect(() =>
      validateSendBinding(
        baseV2Input({
          approval: { draftId: 10, revisionId: 50, approvedHash: hash },
          revision: {
            id: 50,
            senderAddress: envWithReplyTo.senderAddress,
            recipientAddress: envWithReplyTo.recipientAddress,
            contentHash: hash,
            envelopeVersion: 2,
            smtpUsername: envWithReplyTo.smtpUsername,
            replyToAddress: envWithReplyTo.replyToAddress,
          },
          service: {
            id: 7,
            from: envWithReplyTo.senderAddress,
            status: 1,
            smtpUsername: envWithReplyTo.smtpUsername,
            replyTo: envWithReplyTo.replyToAddress,
          },
          recomputedHash: hash,
        })
      )
    ).not.toThrow();
  });

  it("falls back to service.from when service.smtpUsername is null (v2)", () => {
    const base = baseV2Input();
    // revision smtpUsername = "owner@svc.com", service.from = "owner@svc.com"
    // service.smtpUsername = null → effective = "owner@svc.com" → match
    expect(() =>
      validateSendBinding(
        baseV2Input({
          service: { ...base.service, smtpUsername: null },
        })
      )
    ).not.toThrow();
  });
});

describe("validateSendBinding — §18.3 legacy v1 gate", () => {
  /**
   * The v1 baseInput already produces a v1 revision (no envelopeVersion set,
   * so it defaults to 1). We reuse it and add service identity fields.
   */
  it("passes v1 when service smtpUsername == from and replyTo is null", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          service: {
            ...base.service,
            smtpUsername: "owner@svc.com",
            replyTo: null,
          },
        })
      )
    ).not.toThrow();
  });

  it("passes v1 when service smtpUsername is null (falls back to from) and replyTo is null", () => {
    const base = baseInput();
    expect(() =>
      validateSendBinding(
        baseInput({
          service: {
            ...base.service,
            smtpUsername: null,
            replyTo: null,
          },
        })
      )
    ).not.toThrow();
  });

  it("rejects v1 when service replyTo is non-null (legacy_reply_identity_requires_review)", () => {
    const base = baseInput();
    expectBindingError(
      baseInput({
        service: {
          ...base.service,
          smtpUsername: "owner@svc.com",
          replyTo: "replies@other.com",
        },
      }),
      "legacy_reply_identity_requires_review"
    );
  });

  it("rejects v1 when service smtpUsername differs from from (legacy_reply_identity_requires_review)", () => {
    const base = baseInput();
    expectBindingError(
      baseInput({
        service: {
          ...base.service,
          smtpUsername: "different-login@svc.com",
          replyTo: null,
        },
      }),
      "legacy_reply_identity_requires_review"
    );
  });

  it("rejects v1 when both smtpUsername differs AND replyTo is set", () => {
    const base = baseInput();
    expectBindingError(
      baseInput({
        service: {
          ...base.service,
          smtpUsername: "different@svc.com",
          replyTo: "replies@other.com",
        },
      }),
      "legacy_reply_identity_requires_review"
    );
  });
});
