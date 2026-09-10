import type {
  AuthenticationAssessment,
} from "@/entityTypes/managedBrowserTypes";
import {
  detectChallengeFromPage,
  type AdapterPageLike,
  type AdapterReadiness,
  type DetectedChallenge,
  type PlatformBrowserAdapter,
  type PlatformEffectDescriptor,
} from "@/childprocess/managed-browser/adapters/PlatformBrowserAdapter";

/**
 * YouTube/Google pilot adapter (technical design §21.1).
 *
 * Authentication evidence uses STABLE structural signals only — account
 * avatar button presence, sign-in CTA absence, Google login redirect — never
 * translated visible text as the sole signal. One ambiguous signal never
 * declares authentication (design §13.2).
 *
 * Selectors here are the adapter's owned surface and must be covered by
 * fixture tests; CI never logs into Google or YouTube.
 */
export class YouTubeBrowserAdapter implements PlatformBrowserAdapter {
  public readonly platformId = 2;
  public readonly key = "youtube";
  /** Manifest platformId 2 allowlist (youtube.com + Google SSO domains). */
  public readonly allowedOrigins = [
    "youtube.com",
    "google.com",
    "accounts.google.com",
  ];
  public readonly loginOrigins = ["accounts.google.com"];
  public readonly verificationUrl = "https://www.youtube.com/";
  public readonly loginUrl = "https://www.youtube.com/";

  public readonly sensitiveFieldSelectors: readonly string[] = [
    'input[type="password"]',
    'input[autocomplete="one-time-code" i]',
    'input[autocomplete*="otp" i]',
    'input[name="totpPin"]',
    'input[autocomplete*="cc-number" i]',
    'input[autocomplete*="passkey" i]',
  ];

  /**
   * TODO-MSB-012 / FR-P1-004: reviewed consequential-effect descriptors.
   * Classification matches these BEFORE generic name heuristics — a
   * relabeled Publish button still matches the "publish" marker, and the
   * adapter (not the model) owns the vocabulary.
   */
  public readonly consequentialEffects: readonly PlatformEffectDescriptor[] =
    [
      {
        effectId: "youtube.publish_video",
        targetNameMarkers: ["publish"],
        maxPerSession: 3,
        previewKey: "managedBrowser.effects.publish_video",
      },
      {
        effectId: "youtube.upload",
        targetNameMarkers: ["upload"],
        maxPerSession: 3,
        previewKey: "managedBrowser.effects.upload",
      },
      {
        effectId: "youtube.comment",
        targetNameMarkers: ["comment"],
        maxPerSession: 10,
        previewKey: "managedBrowser.effects.comment",
      },
      {
        effectId: "youtube.reply",
        targetNameMarkers: ["reply"],
        maxPerSession: 20,
        previewKey: "managedBrowser.effects.reply",
      },
      {
        effectId: "youtube.delete",
        targetNameMarkers: ["delete", "remove"],
        maxPerSession: 3,
        previewKey: "managedBrowser.effects.delete",
      },
      {
        effectId: "youtube.subscribe",
        targetNameMarkers: ["subscribe"],
        maxPerSession: 5,
        previewKey: "managedBrowser.effects.subscribe",
      },
    ];

  public async assessAuthentication(
    page: AdapterPageLike
  ): Promise<AuthenticationAssessment> {
    const url = page.url();
    if (/^https:\/\/accounts\.google\.com\//i.test(url)) {
      return {
        state: "unauthenticated",
        evidenceCodes: ["google_login_redirect"],
      };
    }
    try {
      const probe = await page.evaluate<{
        avatarButton: boolean;
        signInCta: boolean;
        mastheadApp: boolean;
      }>(
        `(() => {
          const avatar = document.querySelector('#avatar-btn') !== null
            || document.querySelector('button[aria-label*="Account" i]') !== null;
          const signIn = document.querySelector('a[href*="ServiceLogin"]') !== null
            || document.querySelector('a[href*="/signin"]') !== null
            || document.querySelector('button[aria-label*="Sign in" i]') !== null;
          const masthead = document.querySelector('ytd-app, #masthead') !== null;
          return { avatarButton: avatar, signInCta: signIn, mastheadApp: masthead };
        })()`
      );
      const evidence: string[] = [];
      if (probe?.avatarButton) evidence.push("avatar_button_present");
      if (probe?.signInCta === false) evidence.push("sign_in_cta_absent");
      if (probe?.mastheadApp) evidence.push("youtube_app_present");

      // Positive signals: avatar present AND no sign-in CTA. Absence of the
      // CTA alone is NOT authentication (design §13.2 ambiguity rule).
      if (probe?.avatarButton && probe?.signInCta === false) {
        return { state: "authenticated", evidenceCodes: evidence };
      }
      if (probe?.signInCta) {
        return { state: "unauthenticated", evidenceCodes: ["sign_in_cta_present"] };
      }
      return { state: "unknown", reasonCode: "ambiguous_page_state" };
    } catch {
      return { state: "unknown", reasonCode: "probe_failed" };
    }
  }

  public async detectChallenge(
    page: AdapterPageLike
  ): Promise<DetectedChallenge | null> {
    return detectChallengeFromPage(page, [
      "/signin/challenge",
      "svcap",
      "sapr",
    ]);
  }

  public async readiness(page: AdapterPageLike): Promise<AdapterReadiness> {
    try {
      const ready = await page.evaluate<boolean>(
        `(() => document.readyState === 'complete'
          || document.querySelector('ytd-app, #masthead') !== null)()`
      );
      return ready
        ? { ready: true, reasonCode: null }
        : { ready: false, reasonCode: "app_shell_absent" };
    } catch {
      return { ready: false, reasonCode: "probe_failed" };
    }
  }
}
