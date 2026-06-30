/**
 * Security tests for the deep-link validators extracted from background.ts.
 *
 * These enforce the two core invariants of the secure auth handoff:
 *
 *   1. Token-bearing URLs are REJECTED (acceptance criterion #2 in
 *      docs/custom-protocol-auth-handoff-security-fix.md). The legacy
 *      `?token=...&refresh_token=...` flow must never reach the exchange.
 *   2. The deep-link shape must be exactly
 *      <scheme>://auth/callback?code=...&state=... with no extra params.
 *
 * Extracted into src/modules/deepLinkSecurity.ts so they can be tested
 * without booting the full Electron main-process module graph.
 */
import { describe, it, expect } from "vitest";
import {
  urlContainsTokenParams,
  isValidDeepLinkOrigin,
  urlHasOnlyCodeAndState,
} from "@/modules/deepLinkSecurity";

const SCHEME = "aifetchly";

describe("urlContainsTokenParams", () => {
  it.each([
    "aifetchly://auth/callback?token=abc&state=x",
    "aifetchly://auth/callback?code=abc&state=x&refresh_token=y",
    "aifetchly://auth/callback?access_token=eyJhb...",
    "aifetchly://auth/callback?refreshToken=xyz",
    "aifetchly://auth/callback?expiresIn=3600&code=c",
    "aifetchly://auth/callback?expires_in=3600",
    "aifetchly://auth/callback?refreshExpiresIn=2592000",
    "aifetchly://auth/callback?refresh_expires_in=2592000",
  ])("rejects token-bearing URL: %s", (url) => {
    expect(urlContainsTokenParams(url)).toBe(true);
  });

  it.each([
    "aifetchly://auth/callback?code=abc&state=xyz",
    "aifetchly://auth/callback?code=abc&state=xyz&extra=1", // extra non-token param is allowed at THIS layer
    "aifetchly://auth/callback?state=xyz",
  ])("does not flag non-token URL: %s", (url) => {
    expect(urlContainsTokenParams(url)).toBe(false);
  });

  it("does not trip on substring 'token' in path or value", () => {
    // Path contains 'token' as a substring but not as a query key.
    expect(
      urlContainsTokenParams("aifetchly://tokenbank/callback?code=c")
    ).toBe(false);
    // Value contains 'token' substring.
    expect(
      urlContainsTokenParams(
        "aifetchly://auth/callback?code=notokenhere&state=s"
      )
    ).toBe(false);
    // Query key is similar but not equal.
    expect(
      urlContainsTokenParams("aifetchly://auth/callback?nottoken=1&state=s")
    ).toBe(false);
  });
});

describe("isValidDeepLinkOrigin", () => {
  it.each(["aifetchly://auth/callback?code=c&state=s", "aifetchly://auth/"])(
    "accepts valid shape: %s",
    (url) => {
      expect(isValidDeepLinkOrigin(new URL(url), SCHEME)).toBe(true);
    }
  );

  it.each([
    ["aifetchly://auth/callback/?code=c&state=s", "trailing slash on path"],
    ["aifetchly://auth?code=c", "bare host with no path"],
    ["aifetchly://auth/dashboard?code=c", "wrong path"],
    ["http://auth/callback?code=c", "wrong protocol"],
    ["aifetchly://evil/callback?code=c", "wrong host"],
    ["javascript:aifetchly://auth/callback?code=c", "javascript: protocol"],
  ])("rejects invalid shape: %s (%s)", (url) => {
    expect(isValidDeepLinkOrigin(new URL(url), SCHEME)).toBe(false);
  });

  it("is case-insensitive on protocol", () => {
    expect(
      isValidDeepLinkOrigin(new URL("AIFETCHLY://auth/callback?code=c"), SCHEME)
    ).toBe(true);
  });
});

describe("urlHasOnlyCodeAndState", () => {
  it("accepts code+state only", () => {
    expect(
      urlHasOnlyCodeAndState(
        new URL("aifetchly://auth/callback?code=c&state=s")
      )
    ).toBe(true);
  });

  it.each([
    ["aifetchly://auth/callback?code=c", "missing state"],
    ["aifetchly://auth/callback?state=s", "missing code"],
    ["aifetchly://auth/callback?code=c&state=s&extra=1", "extra param"],
    ["aifetchly://auth/callback?code=&state=s", "empty code"],
    ["aifetchly://auth/callback?code=c&state=", "empty state"],
    ["aifetchly://auth/callback", "no params"],
  ])("rejects %s (%s)", (url) => {
    expect(urlHasOnlyCodeAndState(new URL(url))).toBe(false);
  });
});
