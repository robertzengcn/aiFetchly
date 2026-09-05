import type { OutboundEmailToolGateResult } from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * Blocked-gate code subset (the allowed branch is excluded by definition).
 */
type BlockedCode = Exclude<OutboundEmailToolGateResult, { allowed: true }>["code"];

/**
 * Actionable, model-facing reason text for a blocked outbound-email send
 * (technical design §14.2/§19). The previous single hardcoded string —
 * "Outbound email sending requires a request-scoped authorization derived
 * from your message; no authorized batch is available." — was returned for
 * EVERY blocking code, including `draft_required`. That gave the model no
 * signal about how to unblock, so it kept re-drafting batches and re-calling
 * the send tool in a loop (RC1/RC4).
 *
 * Each code now yields a distinct, actionable instruction:
 * - draft_required → call draft_outbound_email_batch first.
 * - review_required → the user must review the draft; do not re-draft.
 * - authorization_missing → the user must confirm sending for this turn.
 * - authorization_expired/invalidated → ask the user to re-confirm.
 * - batch_hash_mismatch → the draft changed; re-draft before sending.
 * - permission_denied → permission was denied; do not retry.
 *
 * The model must reference the batch id (when present) and avoid repeatedly
 * calling the send tool after a structured rejection (§19).
 */
export function explainOutboundGateBlock(
  code: BlockedCode,
  batchId: number | null
): string {
  const batchRef = batchId != null ? ` (batch ${batchId})` : "";
  switch (code) {
    case "draft_required":
      return (
        `Outbound send blocked: no reviewed draft is ready for this turn${batchRef}. ` +
        "Call draft_outbound_email_batch first to create a reviewable batch, " +
        "then send after the user confirms."
      );
    case "review_required":
      return (
        `Outbound send blocked: this batch${batchRef} must be reviewed before sending. ` +
        "Do NOT re-draft or re-call the send tool. Present the draft for user " +
        "review and wait for an explicit approval."
      );
    case "authorization_missing":
      return (
        `Outbound send blocked: no request-scoped authorization for this turn${batchRef}. ` +
        "The user's message did not authorize sending. Ask the user to confirm " +
        "sending this batch; do not re-draft or retry the send tool until they do."
      );
    case "authorization_expired":
      return (
        `Outbound send blocked: the authorization for batch${batchRef} expired. ` +
        "Ask the user to confirm sending again; do not silently retry."
      );
    case "authorization_invalidated":
      return (
        `Outbound send blocked: the authorization for batch${batchRef} was invalidated ` +
        "(the draft was edited). Re-draft, then ask the user to confirm sending."
      );
    case "batch_hash_mismatch":
      return (
        `Outbound send blocked: the batch${batchRef} envelope changed since authorization. ` +
        "Re-draft, then ask the user to confirm sending the updated content."
      );
    case "permission_denied":
      return (
        `Outbound send blocked: permission denied for batch${batchRef}. ` +
        "Do not retry the send tool."
      );
    default: {
      // Exhaustiveness guard — if a new code is added to the union without a
      // case above, this branch forces a compile error (BlockedCode is a
      // finite union) and a safe runtime fallback.
      const _exhaustive: never = code;
      return (
        `Outbound send blocked${batchRef} (${_exhaustive}). Do not retry the send tool.`
      );
    }
  }
}
