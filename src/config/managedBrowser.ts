/**
 * Centralized managed-browser configuration (technical design §25).
 *
 * PURE DATA + tiny pure helpers. This module must stay dependency-free
 * (no Electron, no Token, no DB) because the managed-browser worker imports
 * it inside its utility-process bundle. Anything needing main-process
 * services (e.g. the release flag reading the Token store) lives in
 * `src/config/featureFlags.ts`.
 *
 * Security limits are code defaults with safe upper bounds. Environment or
 * token settings may reduce them but never raise hard maxima.
 */

// ---------------------------------------------------------------------------
// Release / protocol
// ---------------------------------------------------------------------------

/** Worker protocol version stamped on every message (design §8.1). */
export const MANAGED_BROWSER_PROTOCOL_VERSION = 1;

/** Opaque session ids look like `mb_<random>` (never derived from cookies). */
export const MANAGED_BROWSER_SESSION_ID_PREFIX = "mb_";

/** Hard cap of concurrently active managed browser sessions (design §7.2). */
export const MANAGED_BROWSER_GLOBAL_SESSION_LIMIT = 1;

/** Pilot platform allowlist — platform ids from PlatformSessionManifest. */
export const MANAGED_BROWSER_PILOT_PLATFORM_IDS: readonly number[] = [2]; // YouTube

// ---------------------------------------------------------------------------
// Timing (design §8.4)
// ---------------------------------------------------------------------------

export const MANAGED_BROWSER_TIMEOUTS = {
  /** Worker must send WORKER_READY within this window. */
  workerReadyMs: 10_000,
  /** Chrome launch + fingerprint self-test. */
  chromeLaunchAndSelfTestMs: 30_000,
  /** Initial cookie application into the browser context. */
  cookieApplyMs: 15_000,
  /** Initial navigation + adapter authentication verification. */
  initialVerificationMs: 45_000,
  /** Single non-navigation action. */
  singleActionMs: 15_000,
  /** Navigation action. */
  navigationActionMs: 45_000,
  /** Semantic observation. */
  observeMs: 10_000,
  /** Graceful stop (STOP_SESSION → browser.close()). */
  gracefulStopMs: 5_000,
  /** Forced utilityProcess.kill() after the graceful window expires. */
  forceKillAfterGracefulMs: 2_000,
  /** WORKER_HEARTBEAT cadence. */
  heartbeatIntervalMs: 5_000,
  /** Missed heartbeats before marking the worker unresponsive. */
  heartbeatMissThreshold: 3,
  /** Derived: elapsed time without a heartbeat => unresponsive. */
  heartbeatUnresponsiveMs: 15_000,
  /** Manual-login handoff default duration, explicitly extendable. */
  manualLoginHandoffMs: 10 * 60_000,
  /** Maximum total manual-login handoff duration across all extensions. */
  manualLoginHandoffMaxMs: 60 * 60_000,
  /** Minimum spacing between debounced REFRESHED_COOKIES sends (§13.3). */
  cookieRefreshDebounceMs: 30_000,
} as const;

// ---------------------------------------------------------------------------
// Message size limits (design §8.1)
// ---------------------------------------------------------------------------

export const MANAGED_BROWSER_MESSAGE_LIMITS = {
  /** General inbound/outbound serialized size. */
  maxMessageBytes: 2 * 1024 * 1024,
  /** Dedicated bound for the separately typed screenshot response. */
  maxScreenshotBytes: 8 * 1024 * 1024,
  /** Malformed messages before the session stops with a protocol violation. */
  maxMalformedMessages: 3,
} as const;

// ---------------------------------------------------------------------------
// Observation budgets (design §14.1)
// ---------------------------------------------------------------------------

export const MANAGED_BROWSER_OBSERVATION_BUDGETS = {
  maxInteractiveElements: 120,
  maxVisibleTextChars: 12_000,
  maxAccessibleNameChars: 200,
  maxValueSummaryChars: 100,
  maxSerializedBytes: 64 * 1024,
} as const;

/** Page reference registry bounds (design §14.3). */
export const MANAGED_BROWSER_REFERENCE_REGISTRY = {
  maxEntries: 200,
  entryTtlMs: 60_000,
} as const;

// ---------------------------------------------------------------------------
// Structured action limits (design §15.1)
// ---------------------------------------------------------------------------

export const MANAGED_BROWSER_ACTION_LIMITS = {
  maxActionsPerProgram: 25,
  maxNestedDepth: 3,
  defaultRepeatIterations: 20,
  hardMaxRepeatIterations: 50,
  maxTotalExecutedSteps: 100,
  programWallTimeMs: 240_000,
  maxExtractedItems: 200,
  maxExtractedSerializedBytes: 256 * 1024,
  /** Consecutive equivalent failures before stop + handoff/fail. */
  maxConsecutiveFailures: 3,
} as const;

// ---------------------------------------------------------------------------
// Launch-flag security (design §2.2 item 7; PRD §12.6)
// ---------------------------------------------------------------------------

/**
 * Chromium flags the authenticated managed browser must NEVER launch with in
 * normal desktop operation. Matched exactly (`--flag`), except the
 * safe-browsing control which additionally matches feature disablement.
 */
export const MANAGED_BROWSER_DENIED_LAUNCH_FLAGS: readonly string[] = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-web-security",
  "--ignore-certificate-errors",
  "--ignore-ssl-errors",
  "--allow-running-insecure-content",
  "--disable-site-isolation-trials",
];

/**
 * Feature-name fragments whose presence in `--disable-features=` /
 * `--enable-features=` counts as disabling browser security controls.
 */
const DENIED_FEATURE_FRAGMENTS: readonly string[] = [
  "SafeBrowsing", // e.g. --disable-features=SafeBrowsingEnhancedProtection
  "HttpsUpgrades",
  "SitePerProcess",
];

/**
 * Return the first denied launch flag found in the composed argument list,
 * or null when the list is safe. The flag is returned WITH a reason suffix
 * so callers can log a bounded reason code, not the full command line.
 */
export function findDeniedLaunchFlag(args: readonly string[]): string | null {
  const exact = new Set(MANAGED_BROWSER_DENIED_LAUNCH_FLAGS);
  for (const raw of args) {
    const arg = raw.trim();
    if (exact.has(arg)) {
      return arg;
    }
    const featureMatch = /^(--disable-features|--enable-features)=(.*)$/.exec(
      arg
    );
    if (featureMatch) {
      const features = featureMatch[2].split(",").map((f) => f.trim());
      // Prefix match so variants like SafeBrowsingEnhancedProtection are
      // caught; flagging conservatively is the safe direction.
      const hit = features.find((f) =>
        DENIED_FEATURE_FRAGMENTS.some((frag) => f.startsWith(frag))
      );
      if (hit) {
        return `${featureMatch[1]}=${hit}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stealth policy (design §11.3)
// ---------------------------------------------------------------------------

/**
 * Reviewed evasion allowlist. Evasions that fabricate identity contradictions
 * (user-agent-override, webgl.vendor, platform/os spoofing) are excluded.
 * Each entry needs a fixture test and an owner before being added.
 */
export const MANAGED_BROWSER_STEALTH_EVASION_ALLOWLIST: readonly string[] = [
  "chrome.app",
  "chrome.csi",
  "chrome.loadTimes",
  "chrome.runtime",
  "iframe.contentWindow",
  "navigator.webdriver",
];

/** Default headed window/viewport (design §11.1 defaults). */
export const MANAGED_BROWSER_DEFAULT_VIEWPORT = {
  width: 1365,
  height: 768,
} as const;

export const MANAGED_BROWSER_DEFAULT_WINDOW_SIZE = {
  width: 1400,
  height: 900,
} as const;

// ---------------------------------------------------------------------------
// Screenshot policy (design §19)
// ---------------------------------------------------------------------------

export const MANAGED_BROWSER_SCREENSHOT_POLICY = {
  format: "jpeg" as const,
  quality: 75,
  maxDimension: { width: 1600, height: 1200 },
  maxDecodedBytes: 2 * 1024 * 1024,
  fullPage: false,
} as const;

// ---------------------------------------------------------------------------
// System-setting keys (design §7.4) — rows live in settinggroupInit.ts
// ---------------------------------------------------------------------------

export const MANAGED_BROWSER_SETTING_KEYS = {
  group: "managed-browser-group",
  groupDescription: "managed-browser-group-description",
  browserEnabled: "managed-browser-enabled",
  cacheEnabled: "managed-browser-cache-enabled",
  cacheMaxSizeMb: "managed-browser-cache-max-size-mb",
  cacheClearOnExit: "managed-browser-cache-clear-on-exit",
} as const;

// ---------------------------------------------------------------------------
// Cache defaults (design §13.7)
// ---------------------------------------------------------------------------

export const MANAGED_BROWSER_CACHE_DEFAULTS = {
  /** Global maximum, user range 100..2048 MiB. */
  defaultMaxSizeMb: 500,
  minMaxSizeMb: 100,
  maxMaxSizeMb: 2048,
  /** Per-account eviction target. */
  perAccountTargetBytes: 200 * 1024 * 1024,
  /** Inactive retention target. */
  inactiveRetentionDays: 30,
  /** Maintenance cadence: at most once per 24h after startup pass. */
  maintenanceMinIntervalMs: 24 * 60 * 60 * 1000,
  /** Cache subtree schema version (namespace component). */
  cacheSchemaVersion: 1,
  /** Maintenance worker scan bounds (design §13.9). */
  scanMaxEntries: 200_000,
  scanMaxDepth: 12,
  scanMaxWallTimeMs: 20_000,
} as const;

/** Clamp a user-supplied cache maximum (MiB) into the accepted range. */
export function clampCacheMaxSizeMb(mb: number): number {
  if (!Number.isFinite(mb)) {
    return MANAGED_BROWSER_CACHE_DEFAULTS.defaultMaxSizeMb;
  }
  const rounded = Math.round(mb);
  const { minMaxSizeMb, maxMaxSizeMb } = MANAGED_BROWSER_CACHE_DEFAULTS;
  return Math.min(maxMaxSizeMb, Math.max(minMaxSizeMb, rounded));
}

/** Parse a stored setting string to a clamped MiB value. */
export function parseCacheMaxSizeMb(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") {
    return MANAGED_BROWSER_CACHE_DEFAULTS.defaultMaxSizeMb;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return MANAGED_BROWSER_CACHE_DEFAULTS.defaultMaxSizeMb;
  }
  return clampCacheMaxSizeMb(parsed);
}

/** Interpret a stored toggle value ("1"/"0"); default when absent/invalid. */
export function parseStoredToggle(
  raw: string | null | undefined,
  fallback: boolean
): boolean {
  if (raw == null) {
    return fallback;
  }
  const trimmed = raw.trim();
  if (trimmed === "1" || trimmed === "true") {
    return true;
  }
  if (trimmed === "0" || trimmed === "false") {
    return false;
  }
  return fallback;
}
