import type { BrowserRiskClass } from "@/entityTypes/managedBrowserTypes";

/**
 * CAPTCHA resolution policy (technical design §18.3; PRD §8.7).
 *
 * Deterministic MAIN-process decision. Neither the LLM nor the worker nor
 * page content can influence any input — the flow classification and origin
 * come from sanitized worker detection, the provider authorization from
 * main-held settings. In the P0 rollout the provider branch is unreachable
 * by default: the domain authorization list is empty, so every challenge
 * resolves to `manual_handoff` (FR-P0-016).
 */

/** Version of the external-provider data-disclosure text users must accept. */
export const CAPTCHA_PROVIDER_DISCLOSURE_VERSION = "2026-09-v1";

export type CaptchaChallengeFlow =
  | "login"
  | "security"
  | "payment"
  | "content_action"
  | "read_navigation"
  | "unknown";

export interface CaptchaResolutionContext {
  readonly sessionId: string;
  readonly challengeId: string;
  readonly origin: string;
  readonly platformId: number;
  readonly challengeType: string;
  readonly flow: CaptchaChallengeFlow;
  readonly currentActionRisk: BrowserRiskClass;
  readonly providerInputAvailable: boolean;
  /**
   * Main-held provider state. Page/LLM data never reaches these fields —
   * they come from settings (2captcha-enabled/token) plus the separately
   * reviewed domain/disclosure authorization state.
   */
  readonly providerConfig: {
    readonly enabled: boolean;
    readonly tokenPresent: boolean;
    readonly disclosureVersionAccepted: string | null;
    /** Suffix-exact authorized domains (default empty = deny all). */
    readonly authorizedDomains: readonly string[];
    /** Master opt-in for non-login browser challenges (default false). */
    readonly nonLoginChallengesAllowed: boolean;
  };
  /** Challenge ids that already consumed their single provider attempt. */
  readonly attemptedChallengeIds: ReadonlySet<string>;
}

export type CaptchaResolutionDecision =
  | { readonly mode: "manual_handoff"; readonly reasonCode: string }
  | {
      readonly mode: "provider";
      readonly provider: "2captcha";
      readonly authorizationId: string;
      readonly attempt: 1;
    }
  | { readonly mode: "blocked"; readonly reasonCode: string };

/** Suffix-exact origin-host matcher (same semantics as the cookie allowlist). */
export function isOriginAuthorized(
  originHost: string,
  authorizedDomains: readonly string[]
): boolean {
  const host = originHost.toLowerCase();
  return authorizedDomains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

function originHostOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin.toLowerCase();
  }
}

/**
 * Evaluate the eligibility ladder in order (design §18.3 "Policy input and
 * decision" checks 1-9). Sensitive flows ALWAYS hand off (FR-CAPTCHA-003).
 */
export function decideCaptchaResolution(
  context: CaptchaResolutionContext
): CaptchaResolutionDecision {
  const handoff = (reasonCode: string): CaptchaResolutionDecision => ({
    mode: "manual_handoff",
    reasonCode,
  });

  // 1. Sensitive flows never see a provider.
  if (
    context.flow === "login" ||
    context.flow === "security" ||
    context.flow === "payment" ||
    context.flow === "unknown"
  ) {
    return handoff(`sensitive_flow_${context.flow}`);
  }
  if (
    context.currentActionRisk === "credential_or_security" ||
    context.currentActionRisk === "consequential_write"
  ) {
    return handoff("action_risk_requires_handoff");
  }

  // 2-3. Domain and platform authorization (configured ≠ authorized).
  if (!context.providerConfig.nonLoginChallengesAllowed) {
    return handoff("non_login_challenges_not_allowed");
  }
  const host = originHostOf(context.origin);
  if (!isOriginAuthorized(host, context.providerConfig.authorizedDomains)) {
    return handoff("domain_not_authorized");
  }

  // 4. Provider configuration (enabled + token).
  if (!context.providerConfig.enabled || !context.providerConfig.tokenPresent) {
    return handoff("provider_not_configured");
  }

  // 5. Versioned disclosure consent.
  if (
    context.providerConfig.disclosureVersionAccepted !==
    CAPTCHA_PROVIDER_DISCLOSURE_VERSION
  ) {
    return handoff("disclosure_consent_required");
  }

  // 6. One bounded attempt per challenge id (FR-CAPTCHA-005).
  if (context.attemptedChallengeIds.has(context.challengeId)) {
    return { mode: "blocked", reasonCode: "duplicate_attempt" };
  }

  // 7. Provider input must be producible without secrets.
  if (!context.providerInputAvailable) {
    return handoff("provider_input_unavailable");
  }

  // All gates passed — one request-scoped attempt.
  return {
    mode: "provider",
    provider: "2captcha",
    authorizationId: `cpa_${context.challengeId}`,
    attempt: 1,
  };
}
