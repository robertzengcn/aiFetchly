import type { EmailMessageClassification } from "@/entityTypes/emailReceiveTypes";

/**
 * Independent safety classification, separate from prose generation (technical
 * design §10.1, FR-007). Deterministic header/content rules run FIRST and take
 * precedence over any model output; the constrained model stage is a later
 * extension behind the same interface.
 *
 * Deterministic results can never be overwritten by draft generation: the
 * generation path does not call this service, and consumers can check
 * `source === "deterministic"` to know the value is authoritative.
 */

export const CLASSIFIER_VERSION = "deterministic-v1";

export interface ClassificationDecision {
  readonly classification: EmailMessageClassification;
  readonly confidence: number;
  readonly source: "deterministic";
  readonly version: string;
  readonly reason: string;
}

export interface ClassificationInput {
  readonly fromAddress: string;
  readonly subject: string;
  readonly bodyText: string | null;
  readonly replyToAddress?: string | null;
  readonly autoSubmittedHeader?: string | null;
  readonly precedenceHeader?: string | null;
  readonly listIdHeader?: string | null;
  readonly listUnsubscribeHeader?: string | null;
}

/** Deterministic unsubscribe intent, multilingual where practical. */
const UNSUBSCRIBE_RE =
  /\bunsubscribe\b|\bremove me\b|opt[- ]?out|stop receiving|take me off|取消订阅|退订|desinscribir|se désabonner|abbestellen|配信停止|停止配信|受信拒否/i;

const BOUNCE_FROM_RE =
  /mailer-daemon@|postmaster@|no-?reply.*bounce|bounces?@|mail-daemon/i;
const BOUNCE_SUBJECT_RE =
  /undeliverable|delivery (?:failure|status notification)|returned mail|mail delivery failed|bounce/i;

const AUTOMATED_FROM_RE =
  /no-?reply@|donotreply@|noreply@|mailer@|notifications?@|auto-?reply@|automated@/i;

const SENSITIVE_RE =
  /\brefund\b|\bchargeback\b|\blawsuit\b|\blegal (?:action|advice|counsel)\b|\battorney\b|\bpassword\b|\bcredentials?\b|\baccount (?:closure|deletion|access)\b|\bdispute\b|\bcharge dispute\b/i;

/** Classify one inbound message deterministically. Order matters (§10.3). */
export function classifyDeterministic(
  input: ClassificationInput
): ClassificationDecision {
  const from = input.fromAddress ?? "";
  const subject = input.subject ?? "";
  const body = input.bodyText ?? "";
  const combined = `${subject}\n${body}`;

  // 1. Bounce / delivery-status notification (headers or sender).
  if (
    input.autoSubmittedHeader?.match(/auto-(?:replied|generated)/i) &&
    BOUNCE_SUBJECT_RE.test(subject)
  ) {
    return dec("bounce", 0.99, "Auto-Submitted header + bounce subject");
  }
  if (BOUNCE_FROM_RE.test(from) || BOUNCE_SUBJECT_RE.test(subject)) {
    return dec("bounce", 0.97, "Bounce sender or subject pattern");
  }

  // 2. Automated reply / list mail (header signals are strongest).
  if (/\bauto-/i.test(input.autoSubmittedHeader ?? "")) {
    return dec("auto_reply", 0.97, "Auto-Submitted header present");
  }
  if (/\b(?:bulk|junk|list)\b/i.test(input.precedenceHeader ?? "")) {
    return dec("auto_reply", 0.95, "Precedence bulk/junk/list");
  }
  if (input.listIdHeader || input.listUnsubscribeHeader) {
    return dec("auto_reply", 0.9, "List headers present (List-ID / List-Unsubscribe)");
  }
  if (AUTOMATED_FROM_RE.test(from)) {
    return dec("auto_reply", 0.9, "Automated/no-reply sender pattern");
  }

  // 3. Unsubscribe / stop-contact intent (multilingual content rules).
  if (UNSUBSCRIBE_RE.test(combined)) {
    return dec("unsubscribe", 0.95, "Unsubscribe language detected");
  }

  // 4. Sensitive topics route to human review (never auto-decided).
  if (SENSITIVE_RE.test(combined)) {
    return dec(
      "needs_human_review",
      0.9,
      "Sensitive topic (financial/legal/credential/account) requires review"
    );
  }

  // 5. Inconclusive deterministically — the constrained model stage (later
  //    milestone) or a low-confidence unknown flows here. Never guess.
  return dec("unknown", 0.5, "Deterministic rules inconclusive");
}

function dec(
  classification: EmailMessageClassification,
  confidence: number,
  reason: string
): ClassificationDecision {
  return { classification, confidence, source: "deterministic", version: CLASSIFIER_VERSION, reason };
}
