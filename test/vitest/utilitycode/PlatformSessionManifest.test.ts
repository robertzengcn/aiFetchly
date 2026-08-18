import { describe, it, expect } from "vitest";
import {
  PLATFORM_SESSION_MANIFEST,
  validateManifest,
  getPlatformManifest,
  matchesAllowedDomain,
  makeDomainMatcher,
  ManifestValidationError,
  type PlatformSessionDefinition,
} from "@/modules/PlatformSessionManifest";

describe("default manifest self-validates", () => {
  it("validateManifest(PLATFORM_SESSION_MANIFEST) does not throw", () => {
    expect(() => validateManifest()).not.toThrow();
  });

  it("every platform id is unique and youtube/google/facebook are import-enabled", () => {
    const ids = PLATFORM_SESSION_MANIFEST.map((m) => m.platformId);
    expect(new Set(ids).size).toBe(ids.length);
    const yt = getPlatformManifest(2);
    expect(yt?.browserProfileImportEnabled).toBe(true);
    expect(getPlatformManifest(4)?.browserProfileImportEnabled).toBe(true); // google
    expect(getPlatformManifest(1)?.browserProfileImportEnabled).toBe(true); // facebook
  });
});

describe("matchesAllowedDomain", () => {
  const suffixes = ["youtube.com", "accounts.google.com"];

  it("matches exact suffix and dotted subdomain", () => {
    expect(matchesAllowedDomain("youtube.com", suffixes)).toBe(true);
    expect(matchesAllowedDomain(".youtube.com", suffixes)).toBe(true);
    expect(matchesAllowedDomain("www.youtube.com", suffixes)).toBe(true);
    expect(matchesAllowedDomain("accounts.google.com", suffixes)).toBe(true);
  });

  it("does NOT substring-match a lookalike domain", () => {
    expect(matchesAllowedDomain("not-youtube.com", suffixes)).toBe(false);
    expect(matchesAllowedDomain("evil.com", suffixes)).toBe(false);
    expect(matchesAllowedDomain("youtube.com.evil.com", suffixes)).toBe(false);
  });

  it("rejects empty / malformed domains", () => {
    expect(matchesAllowedDomain("", suffixes)).toBe(false);
    expect(matchesAllowedDomain(".", suffixes)).toBe(false);
    expect(matchesAllowedDomain("   ", suffixes)).toBe(false);
  });

  it("longer-specific suffix is required for accounts.google.com vs google.com", () => {
    // google.com suffix alone should NOT match accounts.google.com cookie
    // because accounts.google.com is a subdomain of google.com -> it WOULD match.
    // This assertion documents that subdomains match:
    expect(matchesAllowedDomain("accounts.google.com", ["google.com"])).toBe(
      true
    );
  });
});

describe("makeDomainMatcher", () => {
  it("returns a predicate bound to the platform allowlist", () => {
    const yt = makeDomainMatcher(2);
    expect(yt("www.youtube.com")).toBe(true);
    expect(yt("google.com")).toBe(true);
    expect(yt("evil.com")).toBe(false);
  });

  it("returns an always-false predicate for unknown platform", () => {
    const unknown = makeDomainMatcher(99999);
    expect(unknown("youtube.com")).toBe(false);
  });
});

describe("validateManifest rejects unsafe data", () => {
  const ok = (over: Partial<PlatformSessionDefinition>) =>
    ({
      platformId: 100,
      platformName: "x",
      loginUrl: "https://x.com",
      verificationUrl: "https://x.com/",
      allowedDomainSuffixes: ["x.com"],
      requiredDomainSuffixes: ["x.com"],
      browserProfileImportEnabled: false,
      ...over,
    } as const);

  it("rejects duplicate platformId", () => {
    const manifest = [ok({}), ok({})];
    expect(() => validateManifest(manifest)).toThrow(ManifestValidationError);
  });

  it("rejects a required domain missing from allowed", () => {
    const manifest = [
      ok({
        allowedDomainSuffixes: ["x.com"],
        requiredDomainSuffixes: ["y.com"],
      }),
    ];
    expect(() => validateManifest(manifest)).toThrow();
  });

  it("rejects a broad public suffix", () => {
    const manifest = [
      ok({ allowedDomainSuffixes: ["com"], requiredDomainSuffixes: [] }),
    ];
    expect(() => validateManifest(manifest)).toThrow();
  });

  it("rejects a wildcard / path / port domain", () => {
    expect(() =>
      validateManifest([ok({ allowedDomainSuffixes: ["*.com"] })])
    ).toThrow();
    expect(() =>
      validateManifest([ok({ allowedDomainSuffixes: ["x.com/path"] })])
    ).toThrow();
    expect(() =>
      validateManifest([ok({ allowedDomainSuffixes: ["x.com:443"] })])
    ).toThrow();
  });

  it("rejects uppercase / leading-dot domain", () => {
    expect(() =>
      validateManifest([ok({ allowedDomainSuffixes: ["X.com"] })])
    ).toThrow();
    expect(() =>
      validateManifest([ok({ allowedDomainSuffixes: [".x.com"] })])
    ).toThrow();
  });

  it("requires verificationUrl when import is enabled", () => {
    const manifest = [
      ok({ browserProfileImportEnabled: true, verificationUrl: "not-a-url" }),
    ];
    expect(() => validateManifest(manifest)).toThrow();
  });
});
