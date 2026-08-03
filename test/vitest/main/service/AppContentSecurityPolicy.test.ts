import { describe, expect, it } from "vitest";
import { buildAppContentSecurityPolicy } from "@/service/AppContentSecurityPolicy";

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

  it("keeps production script policy stricter than development", () => {
    expect(getDirective(buildAppContentSecurityPolicy(false), "script-src")).toBe(
      "script-src 'self'"
    );
    expect(getDirective(buildAppContentSecurityPolicy(true), "script-src")).toBe(
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:* https://localhost:*"
    );
  });
});
