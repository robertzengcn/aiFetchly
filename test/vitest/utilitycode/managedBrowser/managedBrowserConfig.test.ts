import { describe, expect, it } from "vitest";

import {
  MANAGED_BROWSER_ACTION_LIMITS,
  MANAGED_BROWSER_CACHE_DEFAULTS,
  MANAGED_BROWSER_DENIED_LAUNCH_FLAGS,
  MANAGED_BROWSER_GLOBAL_SESSION_LIMIT,
  MANAGED_BROWSER_MESSAGE_LIMITS,
  MANAGED_BROWSER_OBSERVATION_BUDGETS,
  MANAGED_BROWSER_PROTOCOL_VERSION,
  MANAGED_BROWSER_SETTING_KEYS,
  MANAGED_BROWSER_STEALTH_EVASION_ALLOWLIST,
  MANAGED_BROWSER_TIMEOUTS,
  clampCacheMaxSizeMb,
  findDeniedLaunchFlag,
  parseCacheMaxSizeMb,
  parseStoredToggle,
} from "@/config/managedBrowser";

describe("managed-browser config defaults", () => {
  it("pins the worker protocol version", () => {
    expect(MANAGED_BROWSER_PROTOCOL_VERSION).toBe(1);
  });

  it("defaults to a single concurrent managed session", () => {
    expect(MANAGED_BROWSER_GLOBAL_SESSION_LIMIT).toBe(1);
  });

  it("matches the technical-design timing table", () => {
    expect(MANAGED_BROWSER_TIMEOUTS.workerReadyMs).toBe(10_000);
    expect(MANAGED_BROWSER_TIMEOUTS.chromeLaunchAndSelfTestMs).toBe(30_000);
    expect(MANAGED_BROWSER_TIMEOUTS.cookieApplyMs).toBe(15_000);
    expect(MANAGED_BROWSER_TIMEOUTS.initialVerificationMs).toBe(45_000);
    expect(MANAGED_BROWSER_TIMEOUTS.singleActionMs).toBe(15_000);
    expect(MANAGED_BROWSER_TIMEOUTS.navigationActionMs).toBe(45_000);
    expect(MANAGED_BROWSER_TIMEOUTS.observeMs).toBe(10_000);
    expect(MANAGED_BROWSER_TIMEOUTS.gracefulStopMs).toBe(5_000);
    expect(MANAGED_BROWSER_TIMEOUTS.forceKillAfterGracefulMs).toBe(2_000);
  });

  it("derives the unresponsive window from heartbeat cadence x threshold", () => {
    const { heartbeatIntervalMs, heartbeatMissThreshold, heartbeatUnresponsiveMs } =
      MANAGED_BROWSER_TIMEOUTS;
    expect(heartbeatIntervalMs).toBe(5_000);
    expect(heartbeatMissThreshold).toBe(3);
    expect(heartbeatUnresponsiveMs).toBe(
      heartbeatIntervalMs * heartbeatMissThreshold
    );
  });

  it("uses a 10 minute default manual-login handoff (FR-HANDOFF-006)", () => {
    expect(MANAGED_BROWSER_TIMEOUTS.manualLoginHandoffMs).toBe(10 * 60_000);
  });

  it("bounds messages to 2 MiB general / 8 MiB screenshots", () => {
    expect(MANAGED_BROWSER_MESSAGE_LIMITS.maxMessageBytes).toBe(2 * 1024 * 1024);
    expect(MANAGED_BROWSER_MESSAGE_LIMITS.maxScreenshotBytes).toBe(
      8 * 1024 * 1024
    );
  });

  it("matches the observation budgets from design §14.1", () => {
    expect(MANAGED_BROWSER_OBSERVATION_BUDGETS.maxInteractiveElements).toBe(120);
    expect(MANAGED_BROWSER_OBSERVATION_BUDGETS.maxVisibleTextChars).toBe(12_000);
    expect(MANAGED_BROWSER_OBSERVATION_BUDGETS.maxAccessibleNameChars).toBe(200);
    expect(MANAGED_BROWSER_OBSERVATION_BUDGETS.maxValueSummaryChars).toBe(100);
  });

  it("matches the P0 action limits from design §15.1", () => {
    expect(MANAGED_BROWSER_ACTION_LIMITS.maxActionsPerProgram).toBe(25);
    expect(MANAGED_BROWSER_ACTION_LIMITS.maxTotalExecutedSteps).toBe(100);
    expect(MANAGED_BROWSER_ACTION_LIMITS.programWallTimeMs).toBe(240_000);
    expect(MANAGED_BROWSER_ACTION_LIMITS.maxExtractedItems).toBe(200);
    expect(MANAGED_BROWSER_ACTION_LIMITS.maxConsecutiveFailures).toBe(3);
  });
});

describe("findDeniedLaunchFlag", () => {
  it("flags every PRD-forbidden flag", () => {
    for (const flag of MANAGED_BROWSER_DENIED_LAUNCH_FLAGS) {
      expect(findDeniedLaunchFlag(["--start-maximized", flag])).toBe(flag);
    }
  });

  it("flags safe-browsing feature disablement", () => {
    expect(
      findDeniedLaunchFlag(["--disable-features=SafeBrowsingEnhancedProtection"])
    ).toBe("--disable-features=SafeBrowsingEnhancedProtection");
    expect(
      findDeniedLaunchFlag(["--disable-features=Translate,SitePerProcess"])
    ).toContain("SitePerProcess");
  });

  it("accepts an ordinary argument list", () => {
    expect(
      findDeniedLaunchFlag(["--start-maximized", "--lang=en", "--incognito"])
    ).toBeNull();
  });

  it("does not substring-match unrelated flags", () => {
    expect(findDeniedLaunchFlag(["--no-sandbox-proxy"])).toBeNull();
    expect(findDeniedLaunchFlag(["--disable-web-security-checks-v2"])).toBeNull();
  });
});

describe("stealth evasion allowlist", () => {
  it("excludes identity-fabricating evasions", () => {
    expect(MANAGED_BROWSER_STEALTH_EVASION_ALLOWLIST).not.toContain(
      "user-agent-override"
    );
    expect(MANAGED_BROWSER_STEALTH_EVASION_ALLOWLIST).not.toContain(
      "webgl.vendor"
    );
  });

  it("includes the chrome.runtime compatibility evasions", () => {
    expect(MANAGED_BROWSER_STEALTH_EVASION_ALLOWLIST).toContain("chrome.runtime");
  });
});

describe("cache size helpers", () => {
  it("returns the 500 MB default for absent/invalid input", () => {
    expect(parseCacheMaxSizeMb(null)).toBe(500);
    expect(parseCacheMaxSizeMb("")).toBe(500);
    expect(parseCacheMaxSizeMb("abc")).toBe(500);
    expect(MANAGED_BROWSER_CACHE_DEFAULTS.defaultMaxSizeMb).toBe(500);
  });

  it("clamps into the accepted 100..2048 range (FR-SETTING table)", () => {
    expect(clampCacheMaxSizeMb(50)).toBe(100);
    expect(clampCacheMaxSizeMb(9999)).toBe(2048);
    expect(clampCacheMaxSizeMb(750)).toBe(750);
    expect(parseCacheMaxSizeMb("750")).toBe(750);
  });
});

describe("stored toggle parsing", () => {
  it("honors explicit values and falls back otherwise", () => {
    expect(parseStoredToggle("1", false)).toBe(true);
    expect(parseStoredToggle("0", true)).toBe(false);
    expect(parseStoredToggle("true", false)).toBe(true);
    expect(parseStoredToggle("false", true)).toBe(false);
    expect(parseStoredToggle(null, true)).toBe(true);
    expect(parseStoredToggle("garbage", false)).toBe(false);
  });
});

describe("setting keys", () => {
  it("uses the design §7.4 key strings", () => {
    expect(MANAGED_BROWSER_SETTING_KEYS.browserEnabled).toBe(
      "managed-browser-enabled"
    );
    expect(MANAGED_BROWSER_SETTING_KEYS.cacheEnabled).toBe(
      "managed-browser-cache-enabled"
    );
    expect(MANAGED_BROWSER_SETTING_KEYS.cacheMaxSizeMb).toBe(
      "managed-browser-cache-max-size-mb"
    );
    expect(MANAGED_BROWSER_SETTING_KEYS.cacheClearOnExit).toBe(
      "managed-browser-cache-clear-on-exit"
    );
  });
});
