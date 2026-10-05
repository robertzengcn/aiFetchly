import type {
  OutboundEmailDeliveryMode,
  OutboundEmailToolGateResult,
} from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * Trusted gate that decides whether a `start_email_send_task` tool call may
 * proceed, evaluated by the query loop BEFORE the tool executes (technical
 * design §14.2). It is the enforcement point for the "model proposes, trusted
 * app code authorizes" rule (AD-003): a model argument saying "send" never
 * bypasses it; only a persisted, request-scoped authorization does.
 *
 * The gate is pure over its inputs — it reads no state itself; the caller
 * supplies the loaded intent decision (and, from Phase 3 onward, the
 * authorization and batch identity). A missing intent decision means there is
 * no trusted evidence the user asked to send at all, so the call is blocked as
 * `draft_required` (the safe default, AD-001).
 */
export class OutboundEmailToolGate {
  /**
   * Decide whether an outbound send may proceed for a given turn.
   *
   * @param intentDecision the persisted intent for this turn's user message,
   *   or null when no trusted decision exists.
   * @param authorization Present when a valid, unexpired request-scoped
   *   authorization already exists for the target batch (user Review approval
   *   or a previously created authorization). Looked up by the caller — never
   *   created for the send tool, and never taken from tool arguments. When
   *   null, a `send_now` intent with no batch is blocked as `draft_required`;
   *   a known batch without authorization is `review_required` so the model
   *   cannot send LLM-composed content before the user clicks Review.
   * @param batchId the target batch id when one exists, else null.
   */
  static evaluate(
    intentDecision: { mode: OutboundEmailDeliveryMode } | null,
    authorization: {
      batchId: number;
      authorizationId: number;
      batchHash: string;
    } | null,
    batchId: number | null
  ): OutboundEmailToolGateResult {
    if (!intentDecision) {
      return { allowed: false, code: "draft_required", batchId };
    }

    switch (intentDecision.mode) {
      case "draft_only":
        // A durable batch is already reviewable. Returning draft_required here
        // tells the model to call draft_outbound_email_batch again, which is
        // what produced the 24-batch retry storm after the first draft.
        if (batchId != null) {
          return { allowed: false, code: "review_required", batchId };
        }
        return { allowed: false, code: "draft_required", batchId };
      case "review_first":
        return { allowed: false, code: "review_required", batchId };
      case "send_now":
      default: {
        // The user has already asked to send, but there is not yet a durable
        // batch to authorize. Tell the model to create the non-sending draft
        // first instead of asking the user to confirm the same instruction.
        if (!authorization && batchId == null) {
          return { allowed: false, code: "draft_required", batchId };
        }
        // A draft exists, but the user has not approved this exact envelope
        // set. Saying "send" is not approval of LLM-written subject/body —
        // wait for the Review UI (exact_draft_approval) before allowing.
        if (!authorization) {
          return { allowed: false, code: "review_required", batchId };
        }
        return {
          allowed: true,
          batchId: authorization.batchId,
          authorizationId: authorization.authorizationId,
          batchHash: authorization.batchHash,
        };
      }
    }
  }
}
