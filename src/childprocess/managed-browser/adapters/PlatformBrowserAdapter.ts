import type {
  AuthenticationAssessment,
  BrowserChallengeKind,
} from "@/entityTypes/managedBrowserTypes";
import {
  detectChallengeFromSignals,
  classifyChallengeFlow,
  type ChallengeFlowClassification,
} from "@/childprocess/managed-browser/ChallengeDetector";

/**
 * Platform adapter contract (technical design §21).
 *
 * Adapters contain PLATFORM FACTS ONLY — login/verification URLs, stable
 * selector signals, challenge classification hints, sensitive-field
 * selectors. They must never contain database access, account-cookie
 * persistence, or remote AI calls.
 *
 * `AdapterPageLike` is the structural page subset adapters may touch, so the
 * adapters are unit-testable against fakes (no Puppeteer import here).
 */
export interface AdapterPageLike {
  url(): string;
  /** Bounded page-context evaluation (Puppeteer page.evaluate shape). */
  evaluate<T>(pageFunction: unknown, ...args: unknown[]): Promise<T>;
}

export interface AdapterReadiness {
  readonly ready: boolean;
  readonly reasonCode: string | null;
}

export interface DetectedChallenge {
  readonly kind: BrowserChallengeKind;
  readonly evidenceCodes: readonly string[];
  readonly flow: ChallengeFlowClassification;
}

/** Adapters are pure data + probe functions over a page-like object. */
export interface PlatformBrowserAdapter {
  readonly platformId: number;
  readonly key: string;
  /** Suffix-exact hostnames the platform allows for navigation. */
  readonly allowedOrigins: readonly string[];
  /** Login/SSO origins permitted without a new browser session. */
  readonly loginOrigins: readonly string[];
  readonly verificationUrl: string;
  readonly loginUrl: string;

  assessAuthentication(page: AdapterPageLike): Promise<AuthenticationAssessment>;
  detectChallenge(page: AdapterPageLike): Promise<DetectedChallenge | null>;
  /** Selector list of credential/OTP/payment inputs for handoff + redaction. */
  readonly sensitiveFieldSelectors: readonly string[];
  readiness(page: AdapterPageLike): Promise<AdapterReadiness>;
}

/**
 * Shared challenge probe: adapters supply their URL/title/text via a single
 * bounded evaluation; classification itself is the pure ChallengeDetector.
 */
export async function probePageSignals(
  page: AdapterPageLike
): Promise<{
  readonly url: string;
  readonly title: string;
  readonly visibleTextSample: string;
  readonly inputTypes: readonly string[];
}> {
  try {
    const signals = await page.evaluate<{
      title: string;
      text: string;
      inputTypes: string[];
    }>(
      `(() => {
        const title = document.title || '';
        const text = (document.body ? document.body.innerText : '')
          .replace(/\\s+/g, ' ')
          .slice(0, 4000);
        const inputTypes = Array.from(
          document.querySelectorAll('input')
        ).slice(0, 50).map((el) => {
          const t = el.getAttribute('type') || 'text';
          const auto = el.getAttribute('autocomplete') || '';
          if (t === 'password') return 'password';
          if (/one-time-code|otp/i.test(auto)) return 'otp';
          if (/webauthn|passkey/i.test(auto)) return 'passkey';
          if (/cc-number|card/i.test(auto)) return 'card';
          return t;
        });
        return { title, text, inputTypes };
      })()`
    );
    return {
      url: page.url(),
      title: signals?.title ?? "",
      visibleTextSample: signals?.text ?? "",
      inputTypes: signals?.inputTypes ?? [],
    };
  } catch {
    return {
      url: page.url(),
      title: "",
      visibleTextSample: "",
      inputTypes: [],
    };
  }
}

/** Shared challenge detection over probed signals. */
export function detectChallengeFromPage(
  page: AdapterPageLike,
  extraUrlMarkers: readonly string[] = []
): Promise<DetectedChallenge | null> {
  return probePageSignals(page).then((signals) => {
    const withMarkers =
      extraUrlMarkers.some((m) => signals.url.toLowerCase().includes(m))
        ? { ...signals, url: `${signals.url} captcha` }
        : signals;
    const detection = detectChallengeFromSignals(withMarkers);
    if (!detection) {
      return null;
    }
    return {
      ...detection,
      flow: classifyChallengeFlow(signals),
    };
  });
}
