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
 * Derive a {@link EmailReplyNextAction} for a refusal that surfaces as a typed
 * failure envelope (FR-033, B12). This overload is for REFUSAL codes only —
 * the refusal-side next action. A draft id on a refusal is context (which
 * stale draft the refusal touched), never evidence that the draft is eligible
 * to approve or send; an `already_replied` refusal therefore routes to human
 * review so the operator can locate the existing reply, never to approval
 * guidance (R22).
 *
 * For an ELIGIBLE reused draft (`reused: true` success), call
 * {@link nextActionForReuse} instead — that is where approval guidance is
 * authoritative, gated by the persisted review flag (R21).
 *
 * The mapping is conservative: when in doubt, route to human review rather
 * than auto-retry. B12: this is typed-code→action DERIVATION (allowed). The
 * caller passes a typed `code` that originated from a
 * {@link SendPolicyRejection}, {@link EmailReplyPolicyDecision}, or a widened
 * {@link CreateDraftOutcome} failure — never a code recovered by parsing
 * English error text. Accepts the raw code string (`string | null | undefined`)
 * so non-policy prefixes like `provider_error` (which is NOT a member of
 * {@link EmailReplyPolicyCode} and therefore cannot occupy the typed `code`
 * slot) can still drive an action.
 */
export function nextActionForCode(
  code: string | null | undefined
): EmailReplyNextAction {
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
    // already_replied is a DENIAL: the message is confirmed replied, so any
    // stale draft surfaced with the refusal is not eligible to approve/send
    // (it is the draft someone already replied around, or a prior refusal's
    // leftover). Route to human review so the operator can locate the
    // existing reply rather than pointing them at an approval that would
    // duplicate it (R22 — previously this returned approve_existing_draft
    // when an existingDraftId was passed, contradicting the refusal).
    return "await_human_review";
  }
  if (code === "reply_in_progress" || code === "generation_in_progress") {
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

/**
 * Derive the next action for an ELIGIBLE reused draft (the `reused: true`
 * success path — a live `draft`/`approved`/`failed` draft the message-level
 * guard cleared for reuse). This is where approval guidance is authoritative:
 * a clean reused draft routes to `approve_existing_draft`, but a draft with
 * PENDING human review routes to `await_human_review` instead — the approval
 * service refuses approval while review is pending, so `approve_existing_draft`
 * guidance would contradict the gate and send the operator to an approval
 * that cannot succeed (R22).
 *
 * F09: pass the EFFECTIVE pending status (see
 * {@link isHumanReviewPendingForRevision}), not the raw model flag — a
 * revision-bound human resolution lifts the gate for the reviewed revision,
 * and guidance must follow the gate, not the immutable model provenance.
 */
export function nextActionForReuse(
  humanReviewPending: boolean
): EmailReplyNextAction {
  return humanReviewPending ? "await_human_review" : "approve_existing_draft";
}

/**
 * F09/G02: effective human-review pending status for a draft row/DTO.
 * The model's `requiresHumanReview` request is IMMUTABLE provenance (never
 * cleared); a human resolves it per revision via an explicit acknowledgment
 * bound to `currentRevisionId`. Review is pending unless a resolution stamp
 * exists for the CURRENT revision — an edit (new revision) or a stale
 * acknowledgment restores the pending state. Approval gating and user
 * guidance MUST derive from this, never from the raw flag alone; the raw
 * flag stays visible as provenance.
 */
export function isHumanReviewPendingForRevision(input: {
  readonly requiresHumanReview: number | boolean | null | undefined;
  readonly currentRevisionId: number | null | undefined;
  readonly humanReviewResolvedAt: unknown;
  readonly humanReviewResolvedRevisionId: number | null | undefined;
}): boolean {
  const flagged =
    input.requiresHumanReview === true || input.requiresHumanReview === 1;
  if (!flagged) return false;
  if (input.currentRevisionId == null) return true;
  return !(
    input.humanReviewResolvedAt != null &&
    input.humanReviewResolvedRevisionId === input.currentRevisionId
  );
}
