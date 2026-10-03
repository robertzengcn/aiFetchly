/**
 * Pure effective-identity resolver for email services (technical design §7.1).
 *
 * One place owns the fallback rule `smtpUsername ?? from`. No controller, worker,
 * or mail sender may inline that rule (AD-003). The resolver never reads the
 * database, never decrypts credentials, never lowercases SMTP usernames
 * (providers may treat non-email logins as case-sensitive), and never mutates
 * its input. It does not repair invalid From/Reply-To addresses; validation owns
 * that decision.
 *
 * The only side effect is a best-effort observability counter
 * (`email_service_identity_legacy_fallback_total`, §21) fired when the fallback
 * path is taken. The metrics emitter swallows all errors, so this never affects
 * the resolved value or breaks callers — it keeps the fallback detection in the
 * single place that owns the rule (AD-003).
 */
import { incrementEmailServiceMetric } from "@/modules/lib/EmailServiceMetrics";

export interface EmailServiceIdentityInput {
  readonly smtpUsername?: string | null;
  readonly from: string;
  readonly replyTo?: string | null;
  readonly receiveUsername?: string | null;
}

export interface ResolvedEmailServiceIdentity {
  readonly smtpUsername: string;
  readonly fromAddress: string;
  readonly replyToAddress: string | null;
  readonly receiveUsername: string;
}

/**
 * Resolve the effective identity for one service-like object.
 *
 * Rules (§7.1):
 *   fromAddress    = input.from.trim()
 *   smtpUsername   = input.smtpUsername?.trim() || fromAddress
 *   replyToAddress = input.replyTo?.trim() || null
 *   receiveUsername= input.receiveUsername?.trim() || smtpUsername || fromAddress
 */
export function resolveEmailServiceIdentity(
  input: EmailServiceIdentityInput
): ResolvedEmailServiceIdentity {
  const fromAddress = input.from.trim();
  const trimmedSmtp = input.smtpUsername?.trim();
  const smtpUsername = trimmedSmtp || fromAddress;
  // §21 observability: when no explicit smtpUsername is configured, the
  // identity falls back to the From address (legacy compatibility path).
  // Emit a counter so a migration away from this fallback is visible. The
  // emitter swallows errors, so this never affects the resolved value.
  if (!trimmedSmtp) {
    incrementEmailServiceMetric("identity_legacy_fallback");
  }
  const replyToAddress = input.replyTo?.trim() || null;
  const receiveUsername =
    input.receiveUsername?.trim() || smtpUsername || fromAddress;
  return { smtpUsername, fromAddress, replyToAddress, receiveUsername };
}

/**
 * Reject CR/LF in identity fields before persistence, hashing, and sending
 * (§7.2 header-injection defense). Also blocks Unicode line/paragraph
 * separators (U+2028/U+2029) which are valid JS string line terminators — a
 * defense-in-depth measure; nodemailer's own sanitizer targets \r?\n only.
 */
export function containsEmailHeaderBreak(value: string): boolean {
  return (
    value.includes("\r") ||
    value.includes("\n") ||
    value.includes("\u2028") ||
    value.includes("\u2029")
  );
}
