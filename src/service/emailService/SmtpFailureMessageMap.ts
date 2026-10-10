import type { SmtpFailureCode } from "@/modules/lib/smtpErrorClassifier";

/**
 * i18n key suffix per SMTP failure category (§19.2, §15). The full key is
 * `emailservice.smtp_error_<suffix>`. `null` covers resolution/setup errors that
 * are not classified SMTP rejections (missing service, no stored password).
 */
const ERROR_KEY_SUFFIX: Readonly<Record<SmtpFailureCode, string>> = {
  smtp_auth_failed: "auth_failed",
  smtp_from_rejected: "from_rejected",
  smtp_recipient_rejected: "recipient_rejected",
  smtp_tls_failed: "tls_failed",
  smtp_connection_failed: "connection_failed",
  smtp_submission_failed: "submission_failed",
  delivery_unknown: "unknown",
};

/** Prefix shared by all SMTP-error category keys. */
export const SMTP_ERROR_KEY_PREFIX = "emailservice.smtp_error_";

/**
 * Resolve a {@link SmtpFailureCode} (or null) to its full i18n key under the
 * `emailservice.smtp_error_*` namespace. Returns `null` when `code` is null so
 * the caller can fall back to a generic key (e.g. `send_test_email_error`).
 */
export function smtpFailureI18nKey(
  code: SmtpFailureCode | null
): string | null {
  if (!code) return null;
  const suffix = ERROR_KEY_SUFFIX[code];
  return `${SMTP_ERROR_KEY_PREFIX}${suffix}`;
}
