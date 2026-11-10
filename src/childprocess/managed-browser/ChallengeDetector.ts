import type {
  BrowserChallengeKind,
  ChallengeDetectionResult,
} from "@/entityTypes/managedBrowserTypes";

/**
 * Challenge detection (technical design §18.3 — DETECTION ONLY).
 *
 * Classifies CAPTCHA / robot-verification / credential-prompt page states from
 * sanitized page signals. It never holds provider credentials, never calls a
 * provider, and never decides resolution — the MAIN-process
 * `CaptchaResolutionPolicy` owns the decision (FR-CAPTCHA-002).
 *
 * Pure heuristics over URL/title/text samples; no network, no DOM objects.
 */

export interface ChallengeSignals {
  readonly url: string;
  readonly title: string;
  /** Budgeted visible-text sample (already sanitized). */
  readonly visibleTextSample: string;
  /** Present input types, e.g. ["password", "otp", "text"]. */
  readonly inputTypes: readonly string[];
}

export type ChallengeFlowClassification =
  | "login"
  | "security"
  | "payment"
  | "content_action"
  | "read_navigation"
  | "unknown";

const CAPTCHA_URL =
  /(recaptcha|captcha|grecaptcha|hcaptcha|turnstile|challenge)/i;
const CAPTCHA_TEXT =
  /(verify you.{0,12}(are|r) (a )?human|i.{0,3}m not a robot|not a robot|are you a robot|robot verification|unusual traffic|complete the security check|prove you.{0,12}human|confirm you.{0,20}(are|r) human)/i;
const ROBOT_TEXT =
  /(security check|bot detection|automated traffic|verify it.?s you)/i;

const LOGIN_CONTEXT =
  /(signin|sign-in|log-?in|login|accounts\.[a-z0-9.-]+|password|authenticate|session expired)/i;
const SECURITY_CONTEXT =
  /(security check|2fa|two-factor|two step|verify your identity|recovery|account.?settings|privacy check)/i;
const PAYMENT_CONTEXT =
  /(checkout|payment|billing|purchase|card|subscription|pay\.)/i;

/**
 * Detect a challenge state from page signals. Returns null when the page
 * shows no challenge indicators.
 */
export function detectChallengeFromSignals(
  signals: ChallengeSignals
): ChallengeDetectionResult | null {
  const combined = `${signals.title}\n${signals.visibleTextSample}`;

  // CAPTCHA / robot verification.
  if (CAPTCHA_URL.test(signals.url) || CAPTCHA_TEXT.test(combined)) {
    const kind: BrowserChallengeKind = /invisible|turnstile/i.test(
      `${signals.url} ${combined}`
    )
      ? "captcha_invisible"
      : "captcha_image";
    return {
      kind,
      evidenceCodes: [
        CAPTCHA_URL.test(signals.url)
          ? "url_captcha_marker"
          : "text_captcha_marker",
        "captcha_text_present",
      ],
    };
  }
  if (ROBOT_TEXT.test(combined)) {
    return {
      kind: "robot_verification",
      evidenceCodes: ["robot_text_present"],
    };
  }

  // Credential-flow prompts (these ALWAYS mean user handoff — FR-CAPTCHA-003).
  const inputs = signals.inputTypes.map((t) => t.toLowerCase());
  if (inputs.includes("otp") || inputs.includes("one-time-code")) {
    return { kind: "otp", evidenceCodes: ["otp_input_present"] };
  }
  if (
    inputs.includes("passkey") ||
    /passkey|security key|webauthn/i.test(combined)
  ) {
    return { kind: "passkey", evidenceCodes: ["passkey_signal"] };
  }
  if (inputs.includes("password")) {
    return { kind: "password", evidenceCodes: ["password_input_present"] };
  }
  if (/(recovery code|account recovery|reset your password)/i.test(combined)) {
    return { kind: "recovery", evidenceCodes: ["recovery_text_present"] };
  }

  return null;
}

/**
 * Classify the FLOW a challenge appeared in. Sensitive flows (login,
 * security, payment, unknown) are NEVER eligible for an external provider
 * (FR-CAPTCHA-003) regardless of configuration.
 */
export function classifyChallengeFlow(
  signals: ChallengeSignals
): ChallengeFlowClassification {
  const combined = `${signals.url} ${signals.title} ${signals.visibleTextSample}`;
  if (LOGIN_CONTEXT.test(combined)) {
    return "login";
  }
  if (SECURITY_CONTEXT.test(combined)) {
    return "security";
  }
  if (PAYMENT_CONTEXT.test(combined)) {
    return "payment";
  }
  // Ambiguous by default — treated as sensitive downstream.
  return "unknown";
}
