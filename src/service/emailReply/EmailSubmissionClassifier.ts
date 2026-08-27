import type {
  EmailSubmissionCertainty,
  ClassifiedSubmissionResult,
} from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Classify a raw SMTP send result into an {@link EmailSubmissionCertainty}
 * (technical design §15.4, FR-019).
 *
 * CRITICAL SAFETY PROPERTY: a Nodemailer error is NOT assumed to be a definite
 * rejection. Only known PRE-ACCEPTANCE failures (auth, connection refused, DNS,
 * TLS handshake, envelope/address rejection, blocked content) map to
 * `definitely_rejected`. Anything ambiguous — timeout, mid-transfer socket
 * drop, unrecognized error — is `unknown`, which the delivery service treats as
 * `delivery_unknown` and never automatically retries.
 *
 * The classifier works from the error string because the shared
 * {@link EmailSendResult} carries only `info` (the message). Nodemailer's
 * `err.code` tokens (EAUTH, EENVELOPE, …) typically appear inside that message.
 */

interface RawSendResult {
  readonly status: boolean;
  readonly info?: string;
}

/** Error substrings that prove the server never accepted the message. */
const DEFINITE_REJECTION_PATTERNS: readonly RegExp[] = [
  /EAUTH/i,
  /Invalid login/i,
  /authentication/i,
  /Username and Password not accepted/i,
  /EENVELOPE/i,
  /Recipient address rejected/i,
  /Sender address rejected/i,
  /Relay access denied/i,
  /User unknown/i,
  /no mailbox/i,
  /ECONNREFUSED/i,
  /connection refused/i,
  /ENOTFOUND/i,
  /getaddrinfo/i,
  /EHOSTUNREACH/i,
  /certificate/i,
  /self-signed/i,
  /UNABLE_TO_VERIFY/i,
  /self.signed certificate/i,
  /Recipients rejected/i,
];

/** Error substrings that are ambiguous after submission may have begun. */
const AMBIGUOUS_PATTERNS: readonly RegExp[] = [
  /ETIMEDOUT/i,
  /ESOCKET/i,
  /ESTREAM/i,
  /EPIPE/i,
  /socket disconnected/i,
  /connection (?:timed out|closed|reset)/i,
  /fetch failed/i,
];

/** Maximum length of a sanitized diagnostic stored in the send attempt. */
const MAX_SANITIZED_ERROR_LEN = 240;

/**
 * Classify a raw result. When {@link raw.status} is true the message was
 * accepted by the provider; otherwise the error message decides between a
 * definite rejection and an unknown outcome.
 */
export function classifySubmissionResult(
  raw: RawSendResult
): ClassifiedSubmissionResult {
  if (raw.status) {
    return {
      accepted: true,
      certainty: "accepted",
      providerMessageId: typeof raw.info === "string" && raw.info ? raw.info : null,
      sanitizedError: null,
    };
  }

  const message = raw.info ?? "";
  if (DEFINITE_REJECTION_PATTERNS.some((re) => re.test(message))) {
    return {
      accepted: false,
      certainty: "definitely_rejected",
      providerMessageId: null,
      sanitizedError: sanitize(message),
    };
  }
  // Ambiguous patterns and any unrecognized error both fall through to unknown.
  // (Listing ambiguous patterns explicitly documents intent; the default branch
  // is what makes this safe.)
  void AMBIGUOUS_PATTERNS;
  return {
    accepted: false,
    certainty: "unknown",
    providerMessageId: null,
    sanitizedError: sanitize(message),
  };
}

/** Trim and bound a diagnostic so logs/attempts never carry huge SMTP dumps. */
export function sanitizeError(message: string | undefined | null): string {
  return sanitize(message ?? "");
}

function sanitize(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_SANITIZED_ERROR_LEN) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_SANITIZED_ERROR_LEN) + "…";
}
