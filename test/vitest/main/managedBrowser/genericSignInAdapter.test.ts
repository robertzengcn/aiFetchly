import { describe, expect, it } from "vitest";
import { GenericSignInAdapter } from "@/childprocess/managed-browser/adapters/GenericSignInAdapter";

/**
 * F11: the generic assessment incorporates the challenge probe — an
 * OTP-only /verify page is a CHALLENGE, never authenticated.
 */

type EvaluateScript = (script: string) => unknown;

function pageWith(scriptResponses: Record<string, unknown>) {
  return {
    url: () => "https://site.test/verify",
    evaluate: <T,>(script: unknown): Promise<T> => {
      const source = String(script);
      for (const [marker, response] of Object.entries(scriptResponses)) {
        if (source.includes(marker)) {
          return Promise.resolve(response as T);
        }
      }
      return Promise.resolve(null as T);
    },
  };
}

describe("GenericSignInAdapter.assessAuthentication (F11)", () => {
  const adapter = new GenericSignInAdapter({
    platformId: 9101,
    key: "generic",
  });

  it("an OTP-only /verify page is a challenge — never authenticated", async () => {
    const page = pageWith({
      // The generic assessment script: benign-looking signals.
      passwordVisible: {
        passwordVisible: false,
        onLoginPath: false,
        errorText: "",
        url: "https://site.test/verify",
      },
      // The challenge probe script (document.title marker): an OTP input
      // is present.
      "document.title": {
        title: "Verify your account",
        text: "Enter the verification code we sent you",
        inputTypes: ["otp"],
      },
    } satisfies Record<string, unknown> as Record<string, unknown>);
    const assessment = await adapter.assessAuthentication(page);
    expect(assessment).toEqual({ state: "challenge", challenge: "otp" });
  });

  it("a CAPTCHA page is a challenge — never authenticated", async () => {
    const page = pageWith({
      passwordVisible: {
        passwordVisible: false,
        onLoginPath: false,
        errorText: "",
        url: "https://site.test/check",
      },
      "document.title": {
        title: "Security check",
        text: "Please complete the captcha to continue",
        inputTypes: [],
      },
    } satisfies Record<string, unknown> as Record<string, unknown>);
    const assessment = await adapter.assessAuthentication(page);
    // The exact kind is the detector's call (captcha/robot text ordering);
    // the F11 contract is only that it is a CHALLENGE, not authenticated.
    expect(assessment.state).toBe("challenge");
  });

  it("a genuinely benign landing page with no challenge signals is authenticated", async () => {
    const page = pageWith({
      passwordVisible: {
        passwordVisible: false,
        onLoginPath: false,
        errorText: "",
        url: "https://site.test/dashboard",
      },
      "document.title": {
        title: "Dashboard",
        text: "Welcome back, here is your feed",
        inputTypes: [],
      },
    } satisfies Record<string, unknown> as Record<string, unknown>);
    const assessment = await adapter.assessAuthentication(page);
    expect(assessment).toEqual({
      state: "authenticated",
      evidenceCodes: ["generic_no_password_no_login_path"],
    });
  });
});
