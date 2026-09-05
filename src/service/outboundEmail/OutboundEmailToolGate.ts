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
   *   authorization exists for the target batch. Resolved by the caller
   *   (the query loop, via `OutboundEmailAuthorizationService.resolveDirectSendForTurn`)
   *   from the turn's intent + draft batch — never from tool arguments. When
   *   null, a `send_now` intent with no batch is blocked as `draft_required`;
   *   a known batch without authorization is `authorization_missing`.
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
        // A send_now intent still needs a durable, request-scoped
        // authorization before anything goes out (AD-001, AD-009). The caller
        // resolves it from trusted turn state; when none exists, block.
        if (!authorization) {
          return { allowed: false, code: "authorization_missing", batchId };
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
