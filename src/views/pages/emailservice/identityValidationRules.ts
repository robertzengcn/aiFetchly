/**
 * Pure validation rules for the three email-identity fields (P1.1, PRD §15).
 *
 * Extracted from servicedetail.vue so the rules are unit-testable in isolation
 * (Vuetify's VTextField only runs these at render runtime; tests need direct
 * access). Each rule returns `true` when valid, or a localized error string
 * when invalid — the Vuetify `:rules` contract.
 *
 * The CR/LF guard mirrors the backend `containsEmailHeaderBreak` (§7.2) and
 * blocks \r, \n, and the Unicode line/paragraph separators (U+2028/U+2029)
 * before the value reaches persistence, hashing, or sending. The separators
 * are written as escapes because U+2028/U+2029 are JS line terminators: a
 * literal occurrence inside a regex character class terminates the regex.
 */

/** Characters that constitute an email-header break (§7.2). */
const HEADER_BREAK = /[\r\n\u2028\u2029]/;

/** Basic single-address email shape. Deliberately permissive (RFC 5322 full
 *  validation is the backend's job); this is a fast client-side pre-check. */
const EMAIL_SHAPE = /.+@.+\..+/;

export type ValidationRule = (value: unknown) => true | string;

/** Required: non-empty after trimming whitespace. */
export const requiredRule =
  (message: string): ValidationRule =>
  (value) => {
    if (value === null || value === undefined || String(value).trim() === "") {
      return message;
    }
    return true;
  };

/** Single valid email address, required (non-empty). */
export const emailRequiredRule =
  (requiredMsg: string, invalidMsg: string): ValidationRule =>
  (value) => {
    if (value === null || value === undefined || String(value).trim() === "") {
      return requiredMsg;
    }
    if (!EMAIL_SHAPE.test(String(value))) {
      return invalidMsg;
    }
    return true;
  };

/** Optional email: empty is valid; a non-empty value must be a single address. */
export const emailOrEmptyRule =
  (invalidMsg: string): ValidationRule =>
  (value) => {
    if (value === null || value === undefined || String(value).trim() === "") {
      return true;
    }
    if (!EMAIL_SHAPE.test(String(value))) {
      return invalidMsg;
    }
    return true;
  };

/** Reject CR/LF and Unicode line separators (§7.2 header-injection defense). */
export const noLineBreakRule =
  (message: string): ValidationRule =>
  (value) => {
    if (value === null || value === undefined || String(value) === "") {
      return true;
    }
    if (HEADER_BREAK.test(String(value))) {
      return message;
    }
    return true;
  };

/**
 * Build the identity-field rule set from localized messages. The component
 * supplies the translated strings so this module stays free of i18n imports.
 */
export interface IdentityRuleMessages {
  readonly required: string;
  readonly emailRequired: string;
  readonly emailInvalid: string;
  readonly noLineBreak: string;
}

export interface IdentityRules {
  /** SMTP username: required, no line breaks (not email-only — some logins
   *  are not email addresses). */
  readonly smtpUsername: ValidationRule[];
  /** From: required, single valid email, no line breaks. */
  readonly from: ValidationRule[];
  /** Reply-To: optional, but non-empty must be a valid single email, no line
   *  breaks. */
  readonly replyTo: ValidationRule[];
}

export function buildIdentityRules(messages: IdentityRuleMessages): IdentityRules {
  return {
    smtpUsername: [
      requiredRule(messages.required),
      noLineBreakRule(messages.noLineBreak),
    ],
    from: [
      emailRequiredRule(messages.emailRequired, messages.emailInvalid),
      noLineBreakRule(messages.noLineBreak),
    ],
    replyTo: [
      emailOrEmptyRule(messages.emailInvalid),
      noLineBreakRule(messages.noLineBreak),
    ],
  };
}
