import { describe, expect, it } from "vitest";
import {
  buildAppContentSecurityPolicy,
  shouldApplyAppContentSecurityPolicy,
} from "@/service/AppContentSecurityPolicy";

function getDirective(policy: string, name: string): string | undefined {
  return policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
}

describe("buildAppContentSecurityPolicy", () => {
  it.each([true, false])(
    "allows blob media URLs for spoken responses (development=%s)",
    (isDevelopment) => {
      const policy = buildAppContentSecurityPolicy(isDevelopment);
      expect(getDirective(policy, "media-src")).toBe("media-src 'self' blob:");
    }
  );

  it("keeps blob out of default-src so the exception is scoped to media", () => {
    const policy = buildAppContentSecurityPolicy(false);
    expect(getDirective(policy, "default-src")).toBe("default-src 'self'");
  });

  it("does not apply app CSP to extension and devtools documents", () => {
    expect(
      shouldApplyAppContentSecurityPolicy(
        "chrome-extension://lojjpkpnigleikjdhnceipeamjchmacb/pages/devtools-background.html"
      )
    ).toBe(false);
    expect(
      shouldApplyAppContentSecurityPolicy("devtools://devtools/bundled/")
    ).toBe(false);
    expect(shouldApplyAppContentSecurityPolicy("http://localhost:5173/")).toBe(
      true
    );
  });

  it("keeps production script policy stricter than development", () => {
    expect(
      getDirective(buildAppContentSecurityPolicy(false), "script-src")
    ).toBe("script-src 'self'");
    expect(
      getDirective(buildAppContentSecurityPolicy(true), "script-src")
    ).toBe(
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:* https://localhost:*"
    );
  });

  it("allows blob worker URLs in development so Vite HMR workers load", () => {
    const policy = buildAppContentSecurityPolicy(true);
    expect(getDirective(policy, "worker-src")).toBe(
      "worker-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:* https://localhost:* blob:"
    );
  });

  it("keeps blob out of worker-src in production", () => {
    const policy = buildAppContentSecurityPolicy(false);
    expect(getDirective(policy, "worker-src")).toBe("worker-src 'self'");
  });
});
