import { redactString } from "@/modules/diagnostics/DiagnosticRedactor";

export type SmtpFailureCode =
  | "smtp_auth_failed"
  | "smtp_from_rejected"
  | "smtp_recipient_rejected"
  | "smtp_tls_failed"
  | "smtp_connection_failed"
  | "smtp_submission_failed"
  | "delivery_unknown";

export interface ClassifiedSmtpFailure {
  readonly code: SmtpFailureCode;
  readonly retrySafety: "safe" | "unknown";
  readonly sanitizedMessage: string;
}

const LOG_LIMIT = 240;

type StructuredFields = {
  code?: unknown;
  command?: unknown;
  responseCode?: unknown;
};

function fields(error: unknown): StructuredFields {
  if (typeof error !== "object" || error === null) return {};
  return error as StructuredFields;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function text(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const obj = error as { message?: unknown };
    if (typeof obj.message === "string") return obj.message;
  }
  return String(error);
}

/**
 * Sanitize the provider message (§19.3): strip SMTP/receive passwords,
 * authorization tokens, and long provider responses. Delegates to the shared
 * `DiagnosticRedactor.redactString` so the credential redaction surface stays
 * consistent app-wide, then enforces the 240-char log limit.
 */
function sanitize(message: string): string {
  const redacted = redactString(message);
  return redacted.length > LOG_LIMIT
    ? `${redacted.slice(0, LOG_LIMIT)}…`
    : redacted;
}

/**
 * Classify an SMTP failure using §19.2 precedence: structured Nodemailer
 * fields (code, command) before known response patterns.
 * `delivery_unknown` is never auto-retried (fail-closed).
 */
export function classifySmtpFailure(error: unknown): ClassifiedSmtpFailure {
  const f = fields(error);
  const command = str(f.command).toUpperCase();
  const code = str(f.code);
  const message = text(error);
  const combined = `${code} ${command} ${message}`.toLowerCase();

  // AUTH / 535 — authentication failure.
  if (
    command === "AUTH" ||
    code === "EAUTH" ||
    /535|invalid login|authentication failed|username and password not accepted/i.test(
      combined
    )
  ) {
    return {
      code: "smtp_auth_failed",
      retrySafety: "safe",
      sanitizedMessage: sanitize(message),
    };
  }

  // MAIL FROM / sender rejected.
  if (
    command === "MAIL" ||
    code === "EENVELOPE" ||
    /sender address rejected|relay access denied|policy/i.test(combined)
  ) {
    return {
      code: "smtp_from_rejected",
      retrySafety: "safe",
      sanitizedMessage: sanitize(message),
    };
  }

  // RCPT TO / recipient rejected.
  if (
    command === "RCPT" ||
    /recipient address rejected|user unknown|no mailbox|recipients rejected/i.test(
      combined
    )
  ) {
    return {
      code: "smtp_recipient_rejected",
      retrySafety: "safe",
      sanitizedMessage: sanitize(message),
    };
  }

  // TLS / certificate before submission.
  if (/certificate|self-signed|unable_to_verify|cert_/i.test(combined)) {
    return {
      code: "smtp_tls_failed",
      retrySafety: "safe",
      sanitizedMessage: sanitize(message),
    };
  }

  // DNS / refused / unreachable before submission.
  if (
    /enotfound|econnrefused|ehostunreachable|getaddrinfo|eai_again/i.test(
      combined
    )
  ) {
    return {
      code: "smtp_connection_failed",
      retrySafety: "safe",
      sanitizedMessage: sanitize(message),
    };
  }

  // Uncertain post-DATA handoff or unrecognized state → never auto-retry.
  return {
    code: "delivery_unknown",
    retrySafety: "unknown",
    sanitizedMessage: sanitize(message),
  };
}
