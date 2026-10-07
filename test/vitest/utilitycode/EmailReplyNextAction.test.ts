import { describe, it, expect } from "vitest";
import {
  nextActionForCode,
  type EmailReplyNextAction,
} from "@/service/emailReply/EmailReplyNextAction";

/**
 * FR-033 / T06 step 12: next-action derivation from a typed refusal code.
 * The mapping is conservative — route to human review when in doubt, never
 * auto-retry on an inconclusive result. The caller always passes a typed
 * code (never a code recovered by parsing English), so this is allowed
 * typed-code→action derivation (per the B12 contract).
 */
describe("nextActionForCode — existing policy codes (FR-033)", () => {
  it("routes already_replied (with existing draft) to approve_existing_draft", () => {
    expect(nextActionForCode("already_replied", 42)).toBe<EmailReplyNextAction>(
      "approve_existing_draft"
    );
  });

  it("routes already_replied (no existing draft) to no_action", () => {
    expect(nextActionForCode("already_replied", undefined)).toBe<EmailReplyNextAction>(
      "no_action"
    );
  });

  it("routes needs_human_review to await_human_review", () => {
    expect(nextActionForCode("needs_human_review", undefined)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes delivery_unknown to await_human_review", () => {
    expect(nextActionForCode("delivery_unknown", undefined)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes reply_state_unknown to await_human_review", () => {
    expect(nextActionForCode("reply_state_unknown", undefined)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes reply_state_conflict to await_human_review", () => {
    expect(nextActionForCode("reply_state_conflict", undefined)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes reply_in_progress to no_action", () => {
    expect(nextActionForCode("reply_in_progress", undefined)).toBe<EmailReplyNextAction>(
      "no_action"
    );
  });

  it("routes generation_in_progress to no_action", () => {
    expect(nextActionForCode("generation_in_progress", undefined)).toBe<EmailReplyNextAction>(
      "no_action"
    );
  });

  it("routes approval_stale to no_action (a binding error, not auto-retried by the code→action map)", () => {
    // approval_stale is a SendBindingError code, not a detection policy code.
    // The send tool maps it to discard_and_retry explicitly via the binding
    // failure branch; the generic nextActionForCode map leaves it to no_action
    // (the caller derives the action directly from the binding error type).
    expect(nextActionForCode("approval_stale", undefined)).toBe<EmailReplyNextAction>(
      "no_action"
    );
  });

  it("routes provider_error to discard_and_retry", () => {
    expect(nextActionForCode("provider_error", undefined)).toBe<EmailReplyNextAction>(
      "discard_and_retry"
    );
  });

  it("returns no_action for an unrecognized code", () => {
    expect(nextActionForCode("some_new_code", undefined)).toBe<EmailReplyNextAction>(
      "no_action"
    );
  });

  it("returns no_action for null/undefined", () => {
    expect(nextActionForCode(null, undefined)).toBe<EmailReplyNextAction>("no_action");
    expect(nextActionForCode(undefined, undefined)).toBe<EmailReplyNextAction>("no_action");
  });
});

// ---------------------------------------------------------------------------
// T06 step 12: detection unknown codes → next action (FR-031/FR-033)
// ---------------------------------------------------------------------------

describe("nextActionForCode — detection unknown codes (T06 step 12)", () => {
  // Folder / protocol / identity unknowns — the operator must inspect the
  // mailbox configuration or matched identity; never auto-retry.
  it("routes unsupported_protocol (POP3) to await_human_review", () => {
    expect(nextActionForCode("unsupported_protocol", undefined)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes missing_message_id to await_human_review", () => {
    expect(nextActionForCode("missing_message_id", undefined)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes receive_unavailable to await_human_review", () => {
    expect(nextActionForCode("receive_unavailable", undefined)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes sent_folder_unavailable to await_human_review", () => {
    expect(nextActionForCode("sent_folder_unavailable", undefined)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes ambiguous_match to await_human_review", () => {
    expect(nextActionForCode("ambiguous_match", undefined)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  it("routes identity_conflict to await_human_review", () => {
    expect(nextActionForCode("identity_conflict", undefined)).toBe<EmailReplyNextAction>(
      "await_human_review"
    );
  });

  // Probe failures — transient (timeout / limit / generic probe failure).
  // The operator may discard and retry; the detector cache will refresh.
  it("routes probe_timeout to discard_and_retry", () => {
    expect(nextActionForCode("probe_timeout", undefined)).toBe<EmailReplyNextAction>(
      "discard_and_retry"
    );
  });

  it("routes probe_limit_exceeded to discard_and_retry", () => {
    expect(nextActionForCode("probe_limit_exceeded", undefined)).toBe<EmailReplyNextAction>(
      "discard_and_retry"
    );
  });

  it("routes probe_failed to discard_and_retry", () => {
    expect(nextActionForCode("probe_failed", undefined)).toBe<EmailReplyNextAction>(
      "discard_and_retry"
    );
  });

  // A complete negative across all required sources. There is nothing to
  // retry — the message genuinely has no reply yet. The model should not
  // surface a retry nudge.
  it("routes no_reply_observed to no_action (a real negative needs no retry)", () => {
    expect(nextActionForCode("no_reply_observed", undefined)).toBe<EmailReplyNextAction>(
      "no_action"
    );
  });
});
