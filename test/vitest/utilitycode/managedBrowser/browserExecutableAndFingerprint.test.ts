import { describe, expect, it } from "vitest";

import {
  BrowserExecutableResolver,
  parseChromeVersion,
  type ResolverFs,
} from "@/childprocess/managed-browser/BrowserExecutableResolver";
import { findDeniedLaunchFlag } from "@/config/managedBrowser";
import {
  buildDefaultLaunchPolicy,
  claimsConflictingBrowserBrand,
  composeLaunchArgs,
  extractUserAgentMajor,
  validateFingerprint,
} from "@/childprocess/managed-browser/BrowserFingerprintPolicy";
import type {
  BrowserExecutableDescriptor,
  FingerprintSelfTestEvidence,
} from "@/entityTypes/managedBrowserTypes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHROME_136 =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const CHROME_118_POOL =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36";

const descriptor136: BrowserExecutableDescriptor = {
  path: "/usr/bin/google-chrome",
  source: "system",
  product: "chrome",
  version: "136.0.7103.94",
  majorVersion: 136,
  architecture: "x64",
};

function evidenceFor(
  overrides: Partial<FingerprintSelfTestEvidence> = {}
): FingerprintSelfTestEvidence {
  return {
    browserVersion: "136.0.7103.94",
    browserMajor: 136,
    userAgent: CHROME_136,
    userAgentMajor: 136,
    platform: "Linux x86_64",
    language: "en-US",
    languages: ["en-US", "en"],
    timezone: "America/New_York",
    viewport: { width: 1365, height: 768 },
    screen: { width: 1920, height: 1080 },
    webdriver: null,
    ...overrides,
  };
}

function fakeFs(existing: Record<string, boolean>): ResolverFs {
  return {
    existsSync: (p) => existing[p] === true,
    isFileSync: (p) => existing[p] === true,
    realpathSync: (p) => p,
  };
}

// ---------------------------------------------------------------------------
// Version parsing
// ---------------------------------------------------------------------------

describe("parseChromeVersion", () => {
  it("parses a stable four-part version", () => {
    expect(parseChromeVersion("Google Chrome 136.0.7103.94")).toEqual({
      version: "136.0.7103.94",
      majorVersion: 136,
    });
  });

  it("parses three-part and dev-channel strings", () => {
    const dev = parseChromeVersion("137.0.0.0 dev");
    expect(dev).not.toBeNull();
    expect(dev?.majorVersion).toBe(137);
    const chromium = parseChromeVersion("Chromium 135.0.7049.0");
    expect(chromium?.version).toBe("135.0.7049.0");
  });

  it("rejects unparseable strings", () => {
    expect(parseChromeVersion("")).toBeNull();
    expect(parseChromeVersion("not-a-version")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Executable resolution
// ---------------------------------------------------------------------------

describe("BrowserExecutableResolver", () => {
  const versionReader = () => "Google Chrome 136.0.7103.94";

  it("prefers the configured executable when valid", () => {
    const resolver = new BrowserExecutableResolver({
      configuredPath: "/opt/chrome/chrome",
      managedCandidates: ["/managed/chrome"],
      extraSystemPaths: ["/usr/bin/google-chrome"],
      fs: fakeFs({
        "/opt/chrome/chrome": true,
        "/managed/chrome": true,
        "/usr/bin/google-chrome": true,
      }),
      readExecutableVersion: versionReader,
    });
    const result = resolver.resolve();
    expect(result).not.toHaveProperty("errorCode");
    if ("descriptor" in result) {
      expect(result.descriptor.source).toBe("configured");
      expect(result.descriptor.majorVersion).toBe(136);
    }
  });

  it("falls back to managed then system candidates", () => {
    const managedOnly = new BrowserExecutableResolver({
      managedCandidates: ["/managed/chrome"],
      extraSystemPaths: ["/usr/bin/google-chrome"],
      fs: fakeFs({ "/managed/chrome": true }),
      readExecutableVersion: versionReader,
    });
    const managedResult = managedOnly.resolve();
    if ("descriptor" in managedResult) {
      expect(managedResult.descriptor.source).toBe("managed");
    } else {
      throw new Error("expected managed resolution");
    }

    const systemOnly = new BrowserExecutableResolver({
      extraSystemPaths: ["/usr/bin/google-chrome"],
      fs: fakeFs({ "/usr/bin/google-chrome": true }),
      readExecutableVersion: versionReader,
    });
    const systemResult = systemOnly.resolve();
    if ("descriptor" in systemResult) {
      expect(systemResult.descriptor.source).toBe("system");
    } else {
      throw new Error("expected system resolution");
    }
  });

  it("returns a typed diagnostic when nothing resolves", () => {
    const resolver = new BrowserExecutableResolver({
      extraSystemPaths: ["/nope/chrome"],
      fs: fakeFs({}),
      readExecutableVersion: versionReader,
    });
    const result = resolver.resolve();
    expect(result).toHaveProperty("errorCode", "browser_dependency_missing");
    if ("searchedPaths" in result) {
      expect(result.searchedPaths).toContain("/nope/chrome");
    }
  });

  it("skips candidates whose version cannot be read", () => {
    let calls = 0;
    const resolver = new BrowserExecutableResolver({
      extraSystemPaths: ["/bad/chrome", "/good/chrome"],
      fs: fakeFs({ "/bad/chrome": true, "/good/chrome": true }),
      readExecutableVersion: () => {
        calls++;
        return calls === 1 ? null : "136.0.0.0";
      },
    });
    const result = resolver.resolve();
    if ("descriptor" in result) {
      expect(result.descriptor.path).toBe("/good/chrome");
    } else {
      throw new Error("expected resolution past the bad candidate");
    }
  });

  it("rejects filesystem roots and null-byte paths", () => {
    const resolver = new BrowserExecutableResolver({
      configuredPath: "/etc/passwd\0",
      extraSystemPaths: [],
      fs: fakeFs({ "/": true, "C:\\": true }),
      readExecutableVersion: versionReader,
    });
    const result = resolver.resolve();
    expect(result).toHaveProperty("errorCode");
  });
});

// ---------------------------------------------------------------------------
// Fingerprint policy
// ---------------------------------------------------------------------------

describe("extractUserAgentMajor / brand conflicts", () => {
  it("extracts the Chrome major", () => {
    expect(extractUserAgentMajor(CHROME_136)).toBe(136);
    expect(
      extractUserAgentMajor(
        "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0"
      )
    ).toBeNull();
  });

  it("detects conflicting browser brands in an override", () => {
    expect(
      claimsConflictingBrowserBrand(
        "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0"
      )
    ).toBe(true);
    expect(claimsConflictingBrowserBrand(CHROME_136)).toBe(false);
  });
});

describe("buildDefaultLaunchPolicy", () => {
  it("defaults to headed, native UA, and a viewport inside the window", () => {
    const policy = buildDefaultLaunchPolicy();
    expect(policy.headless).toBe(false);
    expect(policy.userAgentOverride).toBeNull();
    expect(policy.viewport.width).toBeLessThanOrEqual(policy.windowSize.width);
    expect(policy.viewport.height).toBeLessThanOrEqual(
      policy.windowSize.height
    );
  });

  it("clamps an oversized viewport to the window", () => {
    const policy = buildDefaultLaunchPolicy({
      viewport: { width: 9999, height: 9999 },
    });
    expect(policy.viewport.width).toBe(policy.windowSize.width);
    expect(policy.viewport.height).toBe(policy.windowSize.height);
  });
});

describe("validateFingerprint", () => {
  const passPolicy = buildDefaultLaunchPolicy();

  it("passes with native evidence (FR-P0-005)", () => {
    const result = validateFingerprint({
      descriptor: descriptor136,
      launchPolicy: passPolicy,
      evidence: evidenceFor(),
    });
    expect(result.result).toBe("pass");
  });

  it("fails when the hard-coded Chrome 118 pool UA meets Chrome 136 (FR-FP-005)", () => {
    const result = validateFingerprint({
      descriptor: descriptor136,
      launchPolicy: passPolicy,
      evidence: evidenceFor({
        userAgent: CHROME_118_POOL,
        userAgentMajor: 118,
      }),
    });
    expect(result.result).toBe("fail");
    expect(result.reasonCodes).toContain("ua_major_mismatch");
  });

  it("fails when an override claims another browser (FR-FP-004)", () => {
    const result = validateFingerprint({
      descriptor: descriptor136,
      launchPolicy: buildDefaultLaunchPolicy({
        userAgentOverride:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/136.0",
      }),
      evidence: evidenceFor(),
    });
    expect(result.result).toBe("fail");
    expect(result.reasonCodes).toContain("override_brand_conflict");
  });

  it("accepts an override whose major matches the executable (FR-FP-003)", () => {
    const result = validateFingerprint({
      descriptor: descriptor136,
      launchPolicy: buildDefaultLaunchPolicy({
        userAgentOverride: CHROME_136,
      }),
      evidence: evidenceFor(),
    });
    expect(result.result).toBe("pass");
  });

  it("fails a locale contradiction (FR-FP-007)", () => {
    const result = validateFingerprint({
      descriptor: descriptor136,
      launchPolicy: buildDefaultLaunchPolicy({ locale: "ja-JP" }),
      evidence: evidenceFor({ language: "en-US", languages: ["en-US"] }),
    });
    expect(result.result).toBe("fail");
    expect(result.reasonCodes).toContain("locale_mismatch");
  });

  it("fails a timezone contradiction (FR-FP-008)", () => {
    const result = validateFingerprint({
      descriptor: descriptor136,
      launchPolicy: buildDefaultLaunchPolicy({ timezoneId: "Asia/Tokyo" }),
      evidence: evidenceFor({ timezone: "America/New_York" }),
    });
    expect(result.result).toBe("fail");
    expect(result.reasonCodes).toContain("timezone_mismatch");
  });

  it("fails a viewport that exceeds the real screen (FR-FP-011)", () => {
    const result = validateFingerprint({
      descriptor: descriptor136,
      launchPolicy: passPolicy,
      evidence: evidenceFor({ screen: { width: 1024, height: 640 } }),
    });
    expect(result.result).toBe("fail");
    expect(result.reasonCodes).toContain("viewport_exceeds_screen");
  });

  it("fails when the launched executable differs from the resolved one", () => {
    const result = validateFingerprint({
      descriptor: descriptor136,
      launchPolicy: passPolicy,
      evidence: evidenceFor({ browserMajor: 137, browserVersion: "137.0.0.0" }),
    });
    expect(result.result).toBe("fail");
    expect(result.reasonCodes).toContain("executable_version_mismatch");
  });

  it("fails when composed args contain a denied flag", () => {
    const result = validateFingerprint({
      descriptor: descriptor136,
      launchPolicy: passPolicy,
      evidence: evidenceFor(),
      composedArgs: ["--no-sandbox"],
    });
    expect(result.result).toBe("fail");
    expect(result.reasonCodes).toContain("denied_launch_flag");
  });
});

describe("composeLaunchArgs", () => {
  it("never emits security-reducing flags and keeps proxy credentials out", () => {
    const policy = buildDefaultLaunchPolicy();
    const args = composeLaunchArgs(policy, {
      userDataDir: "/tmp/profile-x",
      diskCacheDir: "/cache/ns/http-cache",
      proxyServer: "http://proxy.example:8080",
      locale: "en-US",
    });
    expect(args).toContain("--user-data-dir=/tmp/profile-x");
    expect(args).toContain("--disk-cache-dir=/cache/ns/http-cache");
    expect(args).toContain("--proxy-server=http://proxy.example:8080");
    expect(args.find((a) => a.startsWith("--proxy-server"))).not.toContain(
      "password"
    );
    // Belt-and-braces: the composed list must survive the denied-flag scan.
    expect(findDeniedLaunchFlag(args)).toBeNull();
  });
});
