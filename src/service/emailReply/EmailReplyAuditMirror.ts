import type {
  EmailAutoReplyAuditAction,
  EmailAutoReplyDecisionStatus,
  EmailReplyAuditAction,
} from "@/entityTypes/emailReceiveTypes";
import { EmailAutoReplyAuditLogEntity } from "@/entity/EmailAutoReplyAuditLog.entity";

/**
 * Decision-relevant reply-audit actions mirrored into the auto-reply audit UI
 * table. Everything else is lifecycle bookkeeping (fetch/read/knowledge/
 * classify/claim/reopen/notes) that never represents a user-visible decision.
 *
 * `draft_created` is deliberately absent: the generation service already
 * writes the auto-table row for it on the success path, so mirroring it here
 * would double the row.
 */
const MIRRORED_ACTIONS: Partial<
  Record<EmailReplyAuditAction, { action: EmailAutoReplyAuditAction; decisionStatus: EmailAutoReplyDecisionStatus }>
> = {
  reply_skipped: { action: "auto_reply_skipped", decisionStatus: "skipped" },
  auto_reply_blocked: { action: "auto_reply_blocked", decisionStatus: "blocked" },
  send_failed: { action: "auto_reply_failed", decisionStatus: "failed" },
  delivery_unknown: { action: "auto_reply_failed", decisionStatus: "failed" },
  reply_sent: { action: "auto_reply_sent", decisionStatus: "auto_sent" },
};

/**
 * Build the auto-reply audit row that mirrors a decision-relevant reply-audit
 * event, or `null` when the event is lifecycle bookkeeping that the audit UI
 * should not surface as a decision.
 *
 * The mirror copies the SAME reason text and the SAME metadataJson so the UI's
 * structured metadata extraction (stage/code) keeps working without parsing
 * English reason text. requiresUserApproval/approvedByUser default to 1/0
 * because the pipeline runs with approval enforced; approvedByUser refers to a
 * user approving a draft, which a refusal, send failure, or system send never
 * had.
 */
export function buildAutoReplyAuditMirrorRow(input: {
  emailServiceId: number;
  messageId: number | null;
  draftId: number | null;
  action: EmailReplyAuditAction;
  reason: string | null;
  metadataJson: string | null;
}): EmailAutoReplyAuditLogEntity | null {
  const mapping = MIRRORED_ACTIONS[input.action];
  if (!mapping) {
    return null;
  }
  if (input.messageId === null) {
    // The auto-table requires a messageId; a decision event without one has no
    // stable identity to surface in the UI.
    return null;
  }
  const row = new EmailAutoReplyAuditLogEntity();
  row.emailServiceId = input.emailServiceId;
  row.messageId = input.messageId;
  row.draftId = input.draftId;
  row.action = mapping.action;
  row.decisionStatus = mapping.decisionStatus;
  row.reason = input.reason;
  row.metadataJson = input.metadataJson;
  row.requiresUserApproval = 1;
  row.approvedByUser = 0;
  return row;
}
