import { REPLY_VALIDATOR_VERSION } from "@/service/emailReply/replyReliabilityVersions";

/**
 * Deterministic validation of generated reply content (technical design §13,
 * FR-010, FR-012, P0.4). Pure function: takes subject + body, returns
 * machine-readable findings + a version. The approval service blocks any
 * revision with a `block` or `review` finding from reaching `approved`.
 *
 * Finding severities:
 *  - block:   AI disclosure / prompt / tool / retrieval leakage; configured
 *             forbidden phrases. Never sendable.
 *  - review:  unsupported commitments (refund/discount/guaranteed price or date,
 *             legal/credential/account), new URLs, payment instructions, new
 *             recipients, attachment-inspection claims. Visible as a draft but
 *             approval is blocked until resolved (no resolve-UI yet, so review
 *             also blocks approval in this release).
 *  - warning: informational; does not block.
 *
 * Patterns are intentionally broad and multilingual; they err toward flagging
 * (review) rather than letting an unsafe claim through. Obfuscation (leetspeak,
 * zero-width spacing, inserted punctuation) is normalized before matching.
 */

export type EmailReplyValidationSeverity = "block" | "review" | "warning";

export interface EmailReplyValidationFinding {
  readonly code: string;
  readonly severity: EmailReplyValidationSeverity;
  readonly message: string;
  readonly evidence?: string;
}

export interface EmailReplyValidationResult {
  readonly validForReview: boolean;
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
    "leakage_ai_self_disclosure",
    /\b(?:as an? )?ai(?: language model| assistant)?\b|i am an? (?:ai|language model|automated)/i,
    "Generated text discloses that the reply is AI-generated"
  ),
  code(
    "leakage_ai_self_disclosure_zh",
    /(作为一个人工智能|我是一个人工智能|作为一个ai|我是一个ai)/i,
    "Generated text discloses AI origin (Chinese)"
  ),
  code(
    "leakage_ai_self_disclosure_ja",
    /(私はai|人工知能)/i,
    "Generated text discloses AI origin (Japanese)"
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

// ---- Unsupported commitments (review) ----
const COMMITMENT_PATTERNS: readonly CompiledPattern[] = [
  review(
    "commitment_refund",
    /\brefund[s]?\b|reimburse/i,
    "Draft mentions a refund/reimbursement (unsupported commitment)"
  ),
  review(
    "commitment_discount",
    /\bdiscount\b|\b\d+\s*%\s*off\b|\bcoupon\b/i,
    "Draft offers a discount (unsupported commitment)"
  ),
  review(
    "commitment_guaranteed_price",
    /\bguarantee(?:d)?\s+(?:price|rate|cost|quote)\b|\block(?:ed)?[- ]?in price\b/i,
    "Draft guarantees a price (unsupported commitment)"
  ),
  review(
    "commitment_guaranteed_date",
    /\bguarantee(?:d)?\s+(?:delivery|arrival|by|date)|definitely (?:arrive|deliver|ship)/i,
    "Draft guarantees a delivery date (unsupported commitment)"
  ),
  review(
    "commitment_legal",
    /\blawsuit\b|\battorney\b|\blegal (?:action|counsel|advice)\b|\bsue\b/i,
    "Draft makes a legal commitment/interpretation (review)"
  ),
  review(
    "commitment_credential",
    /\bpassword\b|\bcredentials?\b|\breset (?:your )?(?:password|login)\b|\b2fa\b|\bauth code\b/i,
    "Draft references credentials/password (review)"
  ),
  review(
    "commitment_account_change",
    /\b(?:delete|close|cancel|upgrade|downgrade)\s+(?:your\s+)?account\b|\bchange(?:\s+the)?\s+account\b/i,
    "Draft promises an account change (review)"
  ),
  review(
    "commitment_payment_instruction",
    /\bwire (?:transfer|funds?)\b|\bbank (?:account|routing)\b|\bcredit card number\b|\bpaypal\b|\bbitcoin\b|\bcrypto(?:currency)? wallet\b|\bvenmo\b|\bzelle\b/i,
    "Draft gives payment instructions (review)"
  ),
];

// ---- Attachment-inspection claims (review) ----
const ATTACHMENT_CLAIM_PATTERNS: readonly CompiledPattern[] = [
  review(
    "attachment_inspection_claim",
    /\b(?:i|we)\s+(?:opened|read|checked|verified|inspected|reviewed)\s+(?:the\s+)?attach/i,
    "Draft claims the attachment was opened/read (the system never opens attachments)"
  ),
];

// ---- URL detection (review) ----
const URL_PATTERN = /https?:\/\/[^\s)]+|www\.[^\s)]+/i;

// ---- Recipient-in-body detection (review) ----
const NEW_RECIPIENT_PATTERN = /\b(?:cc|bcc|reply-all|forward to)\b/i;

/** Default forbidden phrases (merged with any config-supplied list). */
const DEFAULT_FORBIDDEN_PHRASES: readonly string[] = [
  "unsubscribe me",
  "remove me from your list",
];

function code(codeStr: string, re: RegExp, message: string): CompiledPattern {
  return { code: codeStr, severity: "block", message, re };
}
function review(codeStr: string, re: RegExp, message: string): CompiledPattern {
  return { code: codeStr, severity: "review", message, re };
}

/**
 * Normalize text so obfuscation (leetspeak, inserted punctuation/spacing) does
 * not bypass the patterns. Conservative: lowercases, strips zero-width chars,
 * collapses repeated punctuation/whitespace, and maps common leetspeak.
 */
export function normalizeForValidation(text: string): string {
  return (
    text
      // eslint-disable-next-line no-misleading-character-class -- intentional: stripping zero-width joiner + BOM is the purpose
      .replace(/[-\u200d\ufeff]/g, "") // zero-width chars (ZWJ, BOM)
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
 * checked as-is (evidence quotes come from the original); matching runs against
 * the normalized form so obfuscation cannot bypass it.
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

  const urlMatch = URL_PATTERN.exec(combined);
  if (urlMatch) {
    findings.push({
      code: "new_url",
      severity: "review",
      message: "Draft introduces a URL not present in the inbound message",
      evidence: urlMatch[0].slice(0, 120),
    });
  }
  const recipientMatch = NEW_RECIPIENT_PATTERN.exec(combined);
  if (recipientMatch) {
    findings.push({
      code: "new_recipient_directive",
      severity: "review",
      message:
        "Draft references cc/bcc/forward/reply-all (reply-all is off by default)",
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
  const hasReview = findings.some((f) => f.severity === "review");
  return {
    validForReview: !hasBlock,
    sendableAfterApproval: !hasBlock && !hasReview,
    findings,
    validatorVersion: REPLY_VALIDATOR_VERSION,
  };
}
