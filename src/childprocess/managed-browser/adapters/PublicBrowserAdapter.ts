import type { AuthenticationAssessment } from "@/entityTypes/managedBrowserTypes";
import {
  detectChallengeFromPage,
  type AdapterPageLike,
  type AdapterReadiness,
  type DetectedChallenge,
  type PlatformBrowserAdapter,
} from "./PlatformBrowserAdapter";

/** Ephemeral public browsing: no saved identity or login verification. */
export class PublicBrowserAdapter implements PlatformBrowserAdapter {
  public readonly platformId = 0;
  public readonly key = "public";
  public readonly allowedOrigins: readonly string[] = [];
  public readonly loginOrigins: readonly string[] = [];
  public readonly verificationUrl = "about:blank";
  public readonly loginUrl = "about:blank";
  public readonly sensitiveFieldSelectors = [
    'input[type="password"]',
    'input[autocomplete="one-time-code"]',
    'input[autocomplete="cc-number"]',
  ];
  public readonly consequentialEffects = [];

  public async assessAuthentication(_page: AdapterPageLike): Promise<AuthenticationAssessment> {
    // The worker's ready state reuses this assessment; the main process
    // reports authenticated=null for public sessions, never a saved identity.
    return { state: "authenticated", evidenceCodes: ["public_browsing_no_login_required"] };
  }

  public detectChallenge(page: AdapterPageLike): Promise<DetectedChallenge | null> {
    return detectChallengeFromPage(page);
  }

  public async readiness(_page: AdapterPageLike): Promise<AdapterReadiness> {
    return { ready: true, reasonCode: null };
  }
}
