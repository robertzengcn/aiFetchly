/**
 * Machine-readable next-action hints the model can surface to the user
 * (FR-033). Derived from a stable refusal code, never parsed from English.
 */
export type EmailReplyNextAction =
  | "approve_existing_draft"
  | "discard_and_retry"
  | "await_human_review"
  | "no_action";

/**
 * Suggest a machine-readable next action for the model to surface to the user,
 * given a stable refusal code (FR-033). The mapping is conservative: when in
 * doubt, route to human review rather than auto-retry.
 *
 * B12: this is typed-code→action DERIVATION (allowed). The caller passes a
 * typed `code` that originated from a {@link SendPolicyRejection},
 * {@link EmailReplyPolicyDecision}, or a widened {@link CreateDraftOutcome}
 * failure — never a code recovered by parsing English error text. Accepts the
 * raw code string (`string | null | undefined`) so non-policy prefixes like
 * `provider_error` (which is NOT a member of {@link EmailReplyPolicyCode} and
 * therefore cannot occupy the typed `code` slot) can still drive an action.
 */
export function nextActionForCode(
  code: string | null | undefined,
  existingDraftId: number | undefined
): EmailReplyNextAction {
  if (code === "already_replied" && existingDraftId) {
    return "approve_existing_draft";
  }
  if (
    code === "already_replied" ||
    code === "needs_human_review" ||
    code === "delivery_unknown" ||
    code === "reply_state_unknown" ||
    code === "reply_state_conflict" ||
    code === "unsupported_protocol" ||
    code === "missing_message_id" ||
    code === "receive_unavailable" ||
    code === "sent_folder_unavailable" ||
    code === "ambiguous_match" ||
    code === "identity_conflict"
  ) {
    // already_replied WITHOUT an existingDraftId: the message is confirmed
    // replied but no reusable draft id was surfaced. Route to human review so
    // the operator can locate the existing reply rather than silently telling
    // the model to do nothing (no_action would hide a real state the operator
    // needs to act on).
    return "await_human_review";
  }
  if (
    code === "reply_in_progress" ||
    code === "generation_in_progress"
  ) {
    return "no_action";
  }
  if (
    code === "provider_error" ||
    code === "probe_timeout" ||
    code === "probe_limit_exceeded" ||
    code === "probe_failed"
  ) {
    return "discard_and_retry";
  }
  if (code === "no_reply_observed") {
    return "no_action";
  }
  return "no_action";
}
