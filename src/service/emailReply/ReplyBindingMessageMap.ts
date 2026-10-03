/**
 * Maps a {@link SendBindingErrorCode} to its localized i18n key (P1.2, FR-013).
 *
 * Mirrors {@link SmtpFailureMessageMap}: the main-process IPC layer resolves
 * the code to a `emailReplyBinding.<suffix>` key, passes the key as the dialog
 * title, and the renderer's `t()` localizes it. Returns null for unknown/null
 * codes so callers can fall back to the generic error copy.
 */
import type { SendBindingErrorCode } from "@/service/emailReply/EmailReplySendBinding";

export const REPLY_BINDING_KEY_PREFIX = "emailReplyBinding.";

const CODE_TO_SUFFIX: Record<SendBindingErrorCode, string> = {
  draft_token_mismatch: "draft_token_mismatch",
  approval_stale: "approval_stale",
  hash_mismatch: "hash_mismatch",
  revision_hash_mismatch: "revision_hash_mismatch",
  mailbox_mismatch: "mailbox_mismatch",
  service_inactive: "service_inactive",
  service_missing: "service_missing",
  sender_mismatch: "sender_mismatch",
  recipient_mismatch: "recipient_mismatch",
  smtp_username_mismatch: "smtp_username_mismatch",
  reply_to_mismatch: "reply_to_mismatch",
  legacy_reply_identity_requires_review:
    "legacy_reply_identity_requires_review",
};

export function replyBindingI18nKey(
  code: SendBindingErrorCode | null | undefined
): string | null {
  if (!code) return null;
  const suffix = CODE_TO_SUFFIX[code];
  return suffix ? `${REPLY_BINDING_KEY_PREFIX}${suffix}` : null;
}
