import { describe, expect, it } from "vitest";
import {
  BrowserAiAvailabilityService,
  setDefaultBrowserAiAvailabilityServiceForTest,
} from "@/service/browserDecision/BrowserAiAvailabilityService";
import type { ChatProviderResolution } from "@/service/aiProvider/AIProviderResolver";

function hostedResolution(canUse: boolean): ChatProviderResolution {
  return canUse
    ? { kind: "hosted", canUse: true }
    : {
        canUse: false,
        reason: "hosted_subscription_required",
        message: "AI features are not enabled. Please upgrade your plan.",
      } as unknown as ChatProviderResolution;
}

function localResolution(canUse: boolean): ChatProviderResolution {
  return canUse
    ? {
        kind: "local",
        canUse: true,
        config: {
          preset: "openai-compatible",
          name: "My provider",
          baseUrl: "https://api.example.test/v1",
          defaultModel: "model-a",
          apiKeyConfigured: true,
        },
        apiKey: "sk-test",
      } as unknown as ChatProviderResolution
    : {
        canUse: false,
        reason: "local_provider_not_configured",
        message: "No local provider configured.",
      } as unknown as ChatProviderResolution;
}

describe("BrowserAiAvailabilityService (PRD D-FR-01)", () => {
  it("admits a subscribed hosted user", () => {
    const service = new BrowserAiAvailabilityService({
      resolveForChat: () => hostedResolution(true),
    });
    const availability = service.evaluate();
    expect(availability.available).toBe(true);
    expect(availability.reasonCode).toBeNull();
  });

  it("admits an unsubscribed custom-provider user with a valid provider", () => {
    const service = new BrowserAiAvailabilityService({
      resolveForChat: () => localResolution(true),
    });
    const availability = service.evaluate();
    expect(availability.available).toBe(true);
  });

  it("denies a hosted user without entitlement and reports the reason", () => {
    const service = new BrowserAiAvailabilityService({
      resolveForChat: () => hostedResolution(false),
    });
    const availability = service.evaluate();
    expect(availability.available).toBe(false);
    expect(availability.reasonCode).toBe("hosted_subscription_required");
    expect(availability.message).toBeTruthy();
  });

  it("denies a disabled/invalid custom provider and reports the reason", () => {
    const service = new BrowserAiAvailabilityService({
      resolveForChat: () => localResolution(false),
    });
    const availability = service.evaluate();
    expect(availability.available).toBe(false);
    expect(availability.reasonCode).toBe("local_provider_not_configured");
  });

  it("fails closed when the resolver throws", () => {
    const service = new BrowserAiAvailabilityService({
      resolveForChat: () => {
        throw new Error("boom");
      },
    });
    const availability = service.evaluate();
    expect(availability.available).toBe(false);
    expect(availability.reasonCode).toBe("browser_ai_availability_error");
  });
});

describe("default availability singleton", () => {
  it("can be replaced and restored for tests", () => {
    const replacement = new BrowserAiAvailabilityService({
      resolveForChat: () => hostedResolution(true),
    });
    const previous = setDefaultBrowserAiAvailabilityServiceForTest(replacement);
    expect(previous).not.toBe(replacement);
    expect(replacement.isAvailable()).toBe(true);
    // Restore whatever default existed before the test.
    setDefaultBrowserAiAvailabilityServiceForTest(
      previous instanceof BrowserAiAvailabilityService ? previous : null,
    );
  });
});
