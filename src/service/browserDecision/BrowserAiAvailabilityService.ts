/**
 * Provider-aware AI availability for browser features (PRD D-FR-01, D-11;
 * technical design §5.1).
 *
 * This is the product-authorized browser exception to the blanket hosted-only
 * AI rule: browser tools must work for a custom-provider user without a
 * hosted subscription. Gate order:
 *
 *   hosted mode -> require USER_AI_ENABLED (hosted entitlement)
 *   local mode  -> require USER_LOCAL_AI_ENABLED + a valid user provider
 *
 * It deliberately does NOT touch `AiFeatureGate`: keyword, email, embedding,
 * and other hosted-only features stay gated exactly as before.
 */
import {
  AIProviderResolver,
  ChatProviderResolution,
} from "@/service/aiProvider/AIProviderResolver";

export interface BrowserAiAvailability {
  readonly available: boolean;
  readonly reasonCode: string | null;
  readonly message: string | null;
}

export interface BrowserAiAvailabilityDeps {
  readonly resolveForChat?: () => ChatProviderResolution;
}

const AVAILABLE: BrowserAiAvailability = {
  available: true,
  reasonCode: null,
  message: null,
};

function toAvailability(resolution: ChatProviderResolution): BrowserAiAvailability {
  if (resolution.canUse) {
    return AVAILABLE;
  }
  return {
    available: false,
    reasonCode: resolution.reason,
    message: resolution.message,
  };
}

export class BrowserAiAvailabilityService {
  private readonly resolveForChat: () => ChatProviderResolution;

  constructor(deps: BrowserAiAvailabilityDeps = {}) {
    this.resolveForChat =
      deps.resolveForChat ?? (() => new AIProviderResolver().resolveForChat());
  }

  /**
   * Evaluate whether browser AI work may proceed under the user's active
   * provider configuration. Pure read; performs no network calls.
   */
  public evaluate(): BrowserAiAvailability {
    try {
      return toAvailability(this.resolveForChat());
    } catch (error: unknown) {
      return {
        available: false,
        reasonCode: "browser_ai_availability_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Convenience boolean form used by existing sync gates. */
  public isAvailable(): boolean {
    return this.evaluate().available;
  }
}

let defaultService: BrowserAiAvailabilityService | null = null;

export function getDefaultBrowserAiAvailabilityService(): BrowserAiAvailabilityService {
  if (!defaultService) {
    defaultService = new BrowserAiAvailabilityService();
  }
  return defaultService;
}

/** Test seam: replace the singleton (returns the previous instance). */
export function setDefaultBrowserAiAvailabilityServiceForTest(
  service: BrowserAiAvailabilityService | null,
): BrowserAiAvailabilityService | null {
  const previous = defaultService;
  defaultService = service;
  return previous;
}
