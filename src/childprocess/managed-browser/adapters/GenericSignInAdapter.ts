import type {
  AuthenticationAssessment,
  BrowserChallengeKind,
} from "@/entityTypes/managedBrowserTypes";
import {
  detectChallengeFromPage,
  type AdapterPageLike,
  type AdapterReadiness,
  type DetectedChallenge,
  type PlatformBrowserAdapter,
} from "./PlatformBrowserAdapter";

/**
 * Generic sign-in adapter (R09/S-FR-05/A-FR-13).
 *
 * Used for non-YouTube registered sites that have no dedicated platform
 * adapter. Authentication is assessed by generic page signals:
 *   - authenticated: no visible password input AND the URL left the login
 *     path AND no visible error region;
 *   - wrong credential: still on the login path with a visible error region;
 *   - challenge: left the form but still on an auth path (2FA/OTP);
 *   - unknown: bounded settle elapsed without a classification.
 *
 * The adapter contains PLATFORM FACTS ONLY — no DB, no cookie persistence,
 * no remote AI calls.
 */
export class GenericSignInAdapter implements PlatformBrowserAdapter {
  public readonly platformId: number;
  public readonly key: string;
  public readonly allowedOrigins: readonly string[];
  public readonly loginOrigins: readonly string[];
  public readonly verificationUrl: string;
  public readonly loginUrl: string;

  constructor(options: {
    platformId: number;
    key: string;
    allowedOrigins?: readonly string[];
    loginOrigins?: readonly string[];
    loginUrl?: string;
    verificationUrl?: string;
  }) {
    this.platformId = options.platformId;
    this.key = options.key;
    this.allowedOrigins = options.allowedOrigins ?? [];
    this.loginOrigins = options.loginOrigins ?? [];
    this.loginUrl = options.loginUrl ?? "";
    this.verificationUrl = options.verificationUrl ?? "";
  }

  public readonly sensitiveFieldSelectors = [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[autocomplete="new-password"]',
  ];

  public readonly consequentialEffects: readonly [] = [];

  public async assessAuthentication(
    page: AdapterPageLike
  ): Promise<AuthenticationAssessment> {
    const signals = await page.evaluate<{
      passwordVisible: boolean;
      onLoginPath: boolean;
      errorText: string;
      url: string;
    } | null>(GENERIC_AUTH_ASSESS_SCRIPT).catch(() => null);
    if (!signals) {
      return { state: "unknown", reasonCode: "no_page" };
    }
    // F11: the challenge probe is PART of the assessment — an OTP/verify,
    // CAPTCHA, passkey or recovery page is NEVER authenticated, however
    // benign its URL path looks (an OTP-only /verify page has no password
    // input and may not match the login-path markers).
    const challenge = await this.detectChallenge(page).catch(() => null);
    if (challenge) {
      return { state: "challenge", challenge: challenge.kind };
    }
    if (
      !signals.passwordVisible &&
      !signals.onLoginPath &&
      !signals.errorText
    ) {
      return { state: "authenticated", evidenceCodes: ["generic_no_password_no_login_path"] };
    }
    return { state: "unauthenticated", evidenceCodes: ["generic_login_page_visible"] };
  }

  public async readiness(_page: AdapterPageLike): Promise<AdapterReadiness> {
    return { ready: true, reasonCode: null };
  }

  public detectChallenge(page: AdapterPageLike): Promise<DetectedChallenge | null> {
    return detectChallengeFromPage(page);
  }
}

const GENERIC_AUTH_ASSESS_SCRIPT = `(() => {
  const visible = (el) => {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const passwordVisible =
    Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
  const path = location.pathname.toLowerCase();
  const onLoginPath = /login|signin|sign-in|auth|session|register/.test(path);
  const errorRegion = document.querySelector(
    '[class*="error" i], [role="alert"], [class*="alert" i]'
  );
  const errorText = errorRegion && visible(errorRegion)
    ? (errorRegion.textContent || "").trim().slice(0, 200)
    : "";
  return { passwordVisible, onLoginPath, errorText, url: location.href };
})()`;
