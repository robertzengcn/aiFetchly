import { REPLY_VALIDATOR_VERSION } from "@/service/emailReply/replyReliabilityVersions";

/**
 * Deterministic validation of generated reply content (technical design §13,
 * FR-010, FR-012, P0.4). Pure function: takes subject + body, returns
 * machine-readable findings + a version. The approval service blocks any
 * revision with a `block` finding from reaching `approved`.
 *
 * Finding severities (two tiers since 2026-10-18):
 *  - block:   prompt / tool / retrieval leakage; configured forbidden phrases.
 *             Never sendable — approval refuses. (AI-self-disclosure was
 *             removed from this set on 2026-10-20 — see LEAKAGE_PATTERNS note.)
 *  - warning: unsupported commitments (refund/discount/guaranteed price or date,
 *             legal/credential/account), payment instructions, new
 *             recipients, attachment-inspection claims. Advisory only: persisted
 *             in `validationFindingsJson` for audit and does NOT gate approval —
 *             the send tool's `requiresConfirmation` gesture (or the renderer's
 *             explicit approve action) is the human gate for advisory content.
 *             A URL in the body is not a finding and does not require extra
 *             confirmation.
 *
 * Revisions materialized before 2026-10-18 may persist the retired `review`
 * severity in their stored findings JSON; that value was non-gating after the
 * demotion and is never re-read for decisions. Revisions materialized before
 * 2026-10-20 may persist a retired `leakage_ai_self_disclosure(_zh|_ja)` block
 * finding in their stored JSON; that code is no longer emitted and stored
 * instances are non-gating (never re-read for decisions — the approval service
 * recomputes validation from the trusted revision body).
 *
 * Patterns are intentionally broad and multilingual; they err toward flagging
 * (as warnings) rather than letting an unsafe claim pass unnoticed.
 * Obfuscation (leetspeak, zero-width spacing, inserted punctuation) is
 * normalized before matching.
 */

export type EmailReplyValidationSeverity = "block" | "warning";

export interface EmailReplyValidationFinding {
  readonly code: string;
  readonly severity: EmailReplyValidationSeverity;
  readonly message: string;
  readonly evidence?: string;
}

export interface EmailReplyValidationResult {
  readonly sendableAfterApproval: boolean;
  readonly findings: readonly EmailReplyValidationFinding[];
  readonly validatorVersion: string;
}

export interface EmailReplyValidatorConfig {
  /** Additional forbidden phrases (matched after normalization). */
  readonly forbiddenPhrases?: readonly string[];
}

interface CompiledPattern {
  readonly code: string;
  readonly severity: EmailReplyValidationSeverity;
  readonly message: string;
  readonly re: RegExp;
}

// ---- Leakage (block) ----
// NOTE: AI-self-disclosure patterns (leakage_ai_self_disclosure / _zh / _ja)
// were removed on 2026-10-20. The English regex made the qualifier
// `(?: language model| assistant)?` optional, so it matched the bare word
// "AI" anywhere — a false positive that deadlocked sends whenever a draft
// mentioned the product ("our AI Email Writer") or used "AI" as a noun.
// Same deadlock class as the 2026-10-18 review-tier demotion. The softer
// gates remain: the prompt-time BANNED_AI_PHRASES list steers the model
// away from AI-author phrasing upstream, the model's requiresHumanReview
// flag still gates approval, and the send tool's requiresConfirmation
// gesture is the human gate. Genuine prompt/tool/retrieval leakage below
// stays a hard block — only AI-self-disclosure was lifted.
const LEAKAGE_PATTERNS: readonly CompiledPattern[] = [
  code(
    "leakage_system_prompt",
    /system (?:prompt|instructions?|policy)\b/i,
    "Generated text references the system prompt or instructions"
  ),
  code(
    "leakage_system_policy",
    /\bSYSTEM POLICY\b|\bREQUIRED OUTPUT SCHEMA\b/i,
    "Generated text echoes the structured prompt section headers"
  ),
  code(
    "leakage_tool_definition",
    /\[(?:tool|function|command)\]|\btool_call\b|\bfunction_call\b/i,
    "Generated text exposes tool/function definition syntax"
  ),
  code(
    "leakage_retrieval_metadata",
    /\b(?:chunk|document|source)\s*(?:id|\[)|\bknowledge source id\b|\bretrieval (?:score|chunk)\b/i,
    "Generated text exposes retrieval/knowledge metadata"
  ),
  code(
    "leakage_angle_brackets",
    /<[#/]?(?:system|imagine|instructions?|context|tool)>/i,
    "Generated text contains prompt-style angle-bracket tags"
  ),
];

// ---- Unsupported commitments (advisory warning) ----
const COMMITMENT_PATTERNS: readonly CompiledPattern[] = [
  warn(
    "commitment_refund",
    /\brefund[s]?\b|reimburse/i,
    "Draft mentions a refund/reimbursement (unsupported commitment)"
  ),
  warn(
    "commitment_discount",
    /\bdiscount\b|\b\d+\s*%\s*off\b|\bcoupon\b/i,
    "Draft offers a discount (unsupported commitment)"
  ),
  warn(
    "commitment_guaranteed_price",
    /\bguarantee(?:d)?\s+(?:price|rate|cost|quote)\b|\block(?:ed)?[- ]?in price\b/i,
    "Draft guarantees a price (unsupported commitment)"
  ),
  warn(
    "commitment_guaranteed_date",
    /\bguarantee(?:d)?\s+(?:delivery|arrival|by|date)|definitely (?:arrive|deliver|ship)/i,
    "Draft guarantees a delivery date (unsupported commitment)"
  ),
  warn(
    "commitment_legal",
    /\blawsuit\b|\battorney\b|\blegal (?:action|counsel|advice)\b|\bsue\b/i,
    "Draft makes a legal commitment/interpretation"
  ),
  warn(
    "commitment_credential",
    /\bpassword\b|\bcredentials?\b|\breset (?:your )?(?:password|login)\b|\b2fa\b|\bauth code\b/i,
    "Draft references credentials/password"
  ),
  warn(
    "commitment_account_change",
    /\b(?:delete|close|cancel|upgrade|downgrade)\s+(?:your\s+)?account\b|\bchange(?:\s+the)?\s+account\b/i,
    "Draft promises an account change"
  ),
  warn(
    "commitment_payment_instruction",
    /\bwire (?:transfer|funds?)\b|\bbank (?:account|routing)\b|\bcredit card number\b|\bpaypal\b|\bbitcoin\b|\bcrypto(?:currency)? wallet\b|\bvenmo\b|\bzelle\b/i,
    "Draft gives payment instructions"
  ),
];

// ---- Attachment-inspection claims (advisory warning) ----
const ATTACHMENT_CLAIM_PATTERNS: readonly CompiledPattern[] = [
  warn(
    "attachment_inspection_claim",
    /\b(?:i|we)\s+(?:opened|read|checked|verified|inspected|reviewed)\s+(?:the\s+)?attach/i,
    "Draft claims the attachment was opened/read (the system never opens attachments)"
  ),
];

// ---- Recipient-in-body detection (advisory warning) ----
const NEW_RECIPIENT_PATTERN = /\b(?:cc|bcc|reply-all|forward to)\b/i;

/** Default forbidden phrases (merged with any config-supplied list). */
const DEFAULT_FORBIDDEN_PHRASES: readonly string[] = [
  "unsubscribe me",
  "remove me from your list",
];

function code(codeStr: string, re: RegExp, message: string): CompiledPattern {
  return { code: codeStr, severity: "block", message, re };
}
function warn(codeStr: string, re: RegExp, message: string): CompiledPattern {
  return { code: codeStr, severity: "warning", message, re };
}

/**
 * Normalize text so obfuscation (leetspeak, inserted punctuation/spacing) does
 * not bypass the patterns. Conservative: lowercases, strips zero-width chars,
 * collapses repeated punctuation/whitespace, and maps common leetspeak.
 */
export function normalizeForValidation(text: string): string {
  return (
    text
    .replace(/[-\u200B-\u200D\uFEFF]/g, "") // hyphens + zero-width chars (ZWSP, ZWNJ, ZWJ, BOM)
    .replace(/[4@]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$]/g, "s")
    .replace(/[.+,]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
  );
}

/**
 * Validate generated reply content. {@link subject} and {@link bodyText} are
 * checked as-is (evidence quotes come from the original). Pattern findings
 * (leakage, commitments) match the RAW combined text; forbidden-PHRASE
 * matching runs against the normalized form so obfuscation cannot bypass it.
 */
export function validateReplyOutput(
  subject: string,
  bodyText: string,
  config: EmailReplyValidatorConfig = {}
): EmailReplyValidationResult {
  const findings: EmailReplyValidationFinding[] = [];
  const combined = `${subject}\n${bodyText}`;
  const normalized = normalizeForValidation(combined);

  const push = (p: CompiledPattern): void => {
    const m = p.re.exec(combined);
    if (m) {
      findings.push({
        code: p.code,
        severity: p.severity,
        message: p.message,
        evidence: m[0].slice(0, 80),
      });
    }
  };

  for (const p of LEAKAGE_PATTERNS) push(p);
  for (const p of COMMITMENT_PATTERNS) push(p);
  for (const p of ATTACHMENT_CLAIM_PATTERNS) push(p);

  const recipientMatch = NEW_RECIPIENT_PATTERN.exec(combined);
  if (recipientMatch) {
    findings.push({
      code: "new_recipient_directive",
      severity: "warning",
      message: "Draft references cc/bcc/forward/reply-all (reply-all is off by default)",
      evidence: recipientMatch[0],
    });
  }

  const forbidden = [
    ...DEFAULT_FORBIDDEN_PHRASES,
    ...(config.forbiddenPhrases ?? []),
  ];
  for (const phrase of forbidden) {
    const p = normalizeForValidation(phrase);
    if (p && normalized.includes(p)) {
      findings.push({
        code: "forbidden_phrase",
        severity: "block",
        message: `Draft contains a forbidden phrase: "${phrase}"`,
      });
    }
  }

  const hasBlock = findings.some((f) => f.severity === "block");
  return {
    sendableAfterApproval: !hasBlock,
    findings,
    validatorVersion: REPLY_VALIDATOR_VERSION,
  };
}
