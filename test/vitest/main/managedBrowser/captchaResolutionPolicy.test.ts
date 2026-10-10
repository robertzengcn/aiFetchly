import { describe, expect, it } from "vitest";

import {
  CAPTCHA_PROVIDER_DISCLOSURE_VERSION,
  decideCaptchaResolution,
  isOriginAuthorized,
  type CaptchaResolutionContext,
} from "@/service/CaptchaResolutionPolicy";

/**
 * CAPTCHA resolution policy ladder (design §18.3). The decision is fully
 * deterministic main-process logic — no LLM, worker, or page input can
 * reach any authorization field.
 */

function makeContext(
  overrides: Partial<CaptchaResolutionContext> = {},
  providerOverrides: Partial<CaptchaResolutionContext["providerConfig"]> = {}
): CaptchaResolutionContext {
  return {
    sessionId: "mb_session0000001",
    challengeId: "challenge-001",
    origin: "https://www.youtube.com",
    platformId: 2,
    challengeType: "image_grid",
    flow: "content_action",
    currentActionRisk: "read",
    providerInputAvailable: true,
    providerConfig: {
      enabled: true,
      tokenPresent: true,
      disclosureVersionAccepted: CAPTCHA_PROVIDER_DISCLOSURE_VERSION,
      authorizedDomains: ["youtube.com"],
      nonLoginChallengesAllowed: true,
      ...providerOverrides,
    },
    attemptedChallengeIds: new Set<string>(),
    ...overrides,
  };
}

describe("decideCaptchaResolution", () => {
  it("hands off for sensitive flows (FR-CAPTCHA-003)", () => {
    for (const flow of ["login", "security", "payment", "unknown"] as const) {
      expect(decideCaptchaResolution(makeContext({ flow }))).toEqual({
        mode: "manual_handoff",
        reasonCode: `sensitive_flow_${flow}`,
      });
    }
  });

  it("hands off when the current action is high-risk", () => {
    for (const risk of [
      "credential_or_security",
      "consequential_write",
    ] as const) {
      expect(
        decideCaptchaResolution(makeContext({ currentActionRisk: risk }))
      ).toEqual({
        mode: "manual_handoff",
        reasonCode: "action_risk_requires_handoff",
      });
    }
  });

  it("hands off when non-login challenges are not allowed (default)", () => {
    expect(
      decideCaptchaResolution(
        makeContext({}, { nonLoginChallengesAllowed: false })
      )
    ).toEqual({
      mode: "manual_handoff",
      reasonCode: "non_login_challenges_not_allowed",
    });
  });

  it("hands off when the challenge origin is not domain-authorized", () => {
    expect(
      decideCaptchaResolution(
        makeContext(
          { origin: "https://unknown.example" },
          { authorizedDomains: ["youtube.com"] }
        )
      )
    ).toEqual({
      mode: "manual_handoff",
      reasonCode: "domain_not_authorized",
    });
  });

  it("hands off when the provider is disabled or tokenless", () => {
    expect(
      decideCaptchaResolution(makeContext({}, { enabled: false }))
    ).toEqual({
      mode: "manual_handoff",
      reasonCode: "provider_not_configured",
    });
    expect(
      decideCaptchaResolution(makeContext({}, { tokenPresent: false }))
    ).toEqual({
      mode: "manual_handoff",
      reasonCode: "provider_not_configured",
    });
  });

  it("hands off when the versioned disclosure was not accepted", () => {
    expect(
      decideCaptchaResolution(
        makeContext({}, { disclosureVersionAccepted: "2025-01-v0" })
      )
    ).toEqual({
      mode: "manual_handoff",
      reasonCode: "disclosure_consent_required",
    });
    expect(
      decideCaptchaResolution(
        makeContext({}, { disclosureVersionAccepted: null })
      )
    ).toEqual({
      mode: "manual_handoff",
      reasonCode: "disclosure_consent_required",
    });
  });

  it("BLOCKS a second provider attempt for the same challenge (FR-CAPTCHA-005)", () => {
    expect(
      decideCaptchaResolution(
        makeContext({
          attemptedChallengeIds: new Set(["challenge-001"]),
        })
      )
    ).toEqual({
      mode: "blocked",
      reasonCode: "duplicate_attempt",
    });
  });

  it("hands off when provider input cannot be produced", () => {
    expect(
      decideCaptchaResolution(makeContext({ providerInputAvailable: false }))
    ).toEqual({
      mode: "manual_handoff",
      reasonCode: "provider_input_unavailable",
    });
  });

  it("authorizes exactly one request-scoped provider attempt when every gate passes", () => {
    expect(decideCaptchaResolution(makeContext())).toEqual({
      mode: "provider",
      provider: "2captcha",
      authorizationId: "cpa_challenge-001",
      attempt: 1,
    });
  });

  it("never authorizes by default: the default context denies everything (FR-P0-016)", () => {
    // The P0 rollout default: no domain authorization, no non-login opt-in.
    const decision = decideCaptchaResolution(
      makeContext(
        {},
        {
          authorizedDomains: [],
          nonLoginChallengesAllowed: false,
          enabled: false,
          tokenPresent: false,
          disclosureVersionAccepted: null,
        }
      )
    );
    expect(decision.mode).toBe("manual_handoff");
  });
});

describe("isOriginAuthorized (suffix-exact matching)", () => {
  it("accepts the exact domain and subdomains", () => {
    const domains = ["youtube.com"];
    expect(isOriginAuthorized("youtube.com", domains)).toBe(true);
    expect(isOriginAuthorized("www.youtube.com", domains)).toBe(true);
    expect(isOriginAuthorized("accounts.youtube.com", domains)).toBe(true);
  });

  it("rejects look-alike suffix domains", () => {
    const domains = ["youtube.com"];
    expect(isOriginAuthorized("notyoutube.com", domains)).toBe(false);
    expect(isOriginAuthorized("youtube.com.evil.example", domains)).toBe(false);
    expect(isOriginAuthorized("evil.example", domains)).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(isOriginAuthorized("WWW.YouTube.com", ["youtube.com"])).toBe(true);
  });
});
