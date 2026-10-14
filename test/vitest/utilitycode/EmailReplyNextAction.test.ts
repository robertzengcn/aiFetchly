import { describe, it, expect } from "vitest";
import {
  nextActionForCode,
  nextActionForReuse,
  type EmailReplyNextAction,
} from "@/service/emailReply/EmailReplyNextAction";

/**
 * FR-033 / T06 step 12: next-action derivation from a typed refusal code.
 * The mapping is conservative — route to human review when in doubt, never
 * auto-retry on an inconclusive result. The caller always passes a typed
 * code (never a code recovered by parsing English), so this is allowed
 * typed-code→action derivation (per the B12 contract).
 *
 * R22: refusal-side guidance NEVER routes to approve_existing_draft. A draft
 * id on a refusal is context (which stale draft the refusal touched), not
 * evidence it is eligible to approve/send; already_replied is a denial and
 * routes to await_human_review with or without a surfaced draft. Approval
 * guidance lives only in nextActionForReuse (the eligible reused:true path).
 */
describe("nextActionForCode — existing policy codes (FR-033)", () => {
  it("routes already_replied to await_human_review — a denial, never approval guidance (R22)", () => {
    // R22: the previously-unsafe mapping returned approve_existing_draft
    // when a draft id was passed alongside already_replied. The draft on a
    // refusal is the stale draft someone already replied around; guiding
    // the operator to approve it would point at a duplicate send. The
    // draftId parameter is removed from the signature so this cannot return.
    expect(nextActionForCode("already_replied")).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes needs_human_review to await_human_review", () => {
    expect(nextActionForCode("needs_human_review")).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes delivery_unknown to await_human_review", () => {
    expect(nextActionForCode("delivery_unknown")).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes reply_state_unknown to await_human_review", () => {
    expect(
      nextActionForCode("reply_state_unknown")
    ).toBe<EmailReplyNextAction>("await_human_review");
  });

  it("routes reply_state_conflict to await_human_review", () => {
    expect(
      nextActionForCode("reply_state_conflict")
    ).toBe<EmailReplyNextAction>("await_human_review");
  });

  it("routes reply_in_progress to no_action", () => {
    expect(nextActionForCode("reply_in_progress")).toBe<EmailReplyNextAction>(
      "no_action"
    );
  });

  it("routes generation_in_progress to no_action", () => {
    expect(
      nextActionForCode("generation_in_progress")
    ).toBe<EmailReplyNextAction>("no_action");
  });

  it("routes approval_stale to no_action (a binding error, not auto-retried by the code→action map)", () => {
    // approval_stale is a SendBindingError code, not a detection policy code.
    // The send tool maps it to discard_and_retry explicitly via the binding
    // failure branch; the generic nextActionForCode map leaves it to no_action
    // (the caller derives the action directly from the binding error type).
    expect(nextActionForCode("approval_stale")).toBe<EmailReplyNextAction>(
      "no_action"
    );
  });

  it("routes provider_error to discard_and_retry", () => {
    expect(nextActionForCode("provider_error")).toBe<EmailReplyNextAction>(
      "discard_and_retry"
    );
  });

  it("returns no_action for an unrecognized code", () => {
    expect(nextActionForCode("some_new_code")).toBe<EmailReplyNextAction>(
      "no_action"
    );
  });

  it("returns no_action for null/undefined", () => {
    expect(nextActionForCode(null)).toBe<EmailReplyNextAction>("no_action");
    expect(nextActionForCode(undefined)).toBe<EmailReplyNextAction>("no_action");
  });

  it("never returns approve_existing_draft for ANY refusal code (R22 invariant)", () => {
    // The refusal-side map cannot emit approval guidance at all — enumerate
    // every refusal code the map knows plus the out-of-union transport code
    // and assert none approves. This pins the R22 contract structurally.
    const refusalCodes = [
      "already_replied",
      "needs_human_review",
      "delivery_unknown",
      "reply_state_unknown",
      "reply_state_conflict",
      "unsupported_protocol",
      "missing_message_id",
      "receive_unavailable",
      "sent_folder_unavailable",
      "ambiguous_match",
      "identity_conflict",
      "reply_in_progress",
      "generation_in_progress",
      "provider_error",
      "probe_timeout",
      "probe_limit_exceeded",
      "probe_failed",
      "no_reply_observed",
      "some_unknown_code",
    ] as const;
    for (const code of refusalCodes) {
      expect(nextActionForCode(code)).not.toBe<EmailReplyNextAction>(
        "approve_existing_draft"
      );
    }
  });
});

// ---------------------------------------------------------------------------
// T06 step 12: detection unknown codes → next action (FR-031/FR-033)
// ---------------------------------------------------------------------------

describe("nextActionForCode — detection unknown codes (T06 step 12)", () => {
  // Folder / protocol / identity unknowns — the operator must inspect the
  // mailbox configuration or matched identity; never auto-retry.
  it("routes unsupported_protocol (POP3) to await_human_review", () => {
    expect(
      nextActionForCode("unsupported_protocol")
    ).toBe<EmailReplyNextAction>("await_human_review");
  });

  it("routes missing_message_id to await_human_review", () => {
    expect(
      nextActionForCode("missing_message_id")
    ).toBe<EmailReplyNextAction>("await_human_review");
  });

  it("routes receive_unavailable to await_human_review", () => {
    expect(
      nextActionForCode("receive_unavailable")
    ).toBe<EmailReplyNextAction>("await_human_review");
  });

  it("routes sent_folder_unavailable to await_human_review", () => {
    expect(
      nextActionForCode("sent_folder_unavailable")
    ).toBe<EmailReplyNextAction>("await_human_review");
  });

  it("routes ambiguous_match to await_human_review", () => {
    expect(nextActionForCode("ambiguous_match")).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes identity_conflict to await_human_review", () => {
    expect(nextActionForCode("identity_conflict")).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  // Probe failures — transient (timeout / limit / generic probe failure).
  // The operator may discard and retry; the detector cache will refresh.
  it("routes probe_timeout to discard_and_retry", () => {
    expect(nextActionForCode("probe_timeout")).toBe<EmailReplyNextAction>(
      "discard_and_retry"
    );
  });

  it("routes probe_limit_exceeded to discard_and_retry", () => {
    expect(
      nextActionForCode("probe_limit_exceeded")
    ).toBe<EmailReplyNextAction>("discard_and_retry");
  });

  it("routes probe_failed to discard_and_retry", () => {
    expect(nextActionForCode("probe_failed")).toBe<EmailReplyNextAction>(
      "discard_and_retry"
    );
  });

  // A complete negative across all required sources. There is nothing to
  // retry — the message genuinely has no reply yet. The model should not
  // surface a retry nudge.
  it("routes no_reply_observed to no_action (a real negative needs no retry)", () => {
    expect(nextActionForCode("no_reply_observed")).toBe<EmailReplyNextAction>(
      "no_action"
    );
  });
});

// ---------------------------------------------------------------------------
// R22: eligible-reuse next action (the reused:true success path)
// ---------------------------------------------------------------------------

describe("nextActionForReuse — eligible reuse guidance (R22)", () => {
  it("routes a clean reused draft to approve_existing_draft (the eligible path)", () => {
    // This is where approval guidance is authoritative: the message-level
    // guard cleared the draft for reuse, so the operator may approve/send.
    expect(nextActionForReuse(false)).toBe<EmailReplyNextAction>(
      "approve_existing_draft"
    );
  });

  it("routes an R21-flagged reused draft to await_human_review (approval is gated)", () => {
    // The model flagged the draft for human review and the approval service
    // refuses approval while the flag is set — approve_existing_draft
    // guidance would contradict the gate and route the operator to an
    // approval that cannot succeed.
    expect(nextActionForReuse(true)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });
});
