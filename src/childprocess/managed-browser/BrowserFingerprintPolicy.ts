import {
  MANAGED_BROWSER_DEFAULT_VIEWPORT,
  MANAGED_BROWSER_DEFAULT_WINDOW_SIZE,
  MANAGED_BROWSER_STEALTH_EVASION_ALLOWLIST,
  findDeniedLaunchFlag,
} from "@/config/managedBrowser";
import type {
  BrowserExecutableDescriptor,
  BrowserLaunchPolicy,
  FingerprintSelfTestEvidence,
  FingerprintValidationResult,
} from "@/entityTypes/managedBrowserTypes";

/**
 * Single fingerprint policy (technical design §11; PRD §12).
 *
 * PRINCIPLE: internal consistency, not invisibility. Native values are
 * preferred; every override adds a consistency obligation and an automated
 * check here. Startup MUST fail with a `fingerprint_mismatch`-class reason
 * before platform navigation when validation does not pass.
 */

/** Extract the Chrome major from a user-agent string, or null. */
export function extractUserAgentMajor(userAgent: string): number | null {
  const match = /Chrome\/(\d+)/.exec(userAgent);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Whether a UA string claims a non-Chrome primary browser brand (FR-FP-004).
 * Note every genuine Chrome UA carries a `Safari/537.36` compatibility token,
 * so Safari alone only conflicts when no Chrome token is present.
 */
export function claimsConflictingBrowserBrand(userAgent: string): boolean {
  if (
    /\b(Firefox|FxiOS|OPR\/|Edg\/|Edge\/|EdgA\/|EdgiOS\/|SamsungBrowser)/.test(
      userAgent
    )
  ) {
    return true;
  }
  return !/Chrome\/\d+/.test(userAgent) && /Safari\/\d+/.test(userAgent);
}

export interface BuildLaunchPolicyOptions {
  readonly locale?: string | null;
  readonly timezoneId?: string | null;
  readonly userAgentOverride?: string | null;
  readonly extraArgs?: readonly string[];
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly windowSize?: { readonly width: number; readonly height: number };
}

/**
 * Default launch policy: headed, NATIVE user agent, native platform/GPU/
 * hardware values, clamped viewport inside the window (design §11.1).
 */
export function buildDefaultLaunchPolicy(
  options: BuildLaunchPolicyOptions = {}
): BrowserLaunchPolicy {
  const windowSize = options.windowSize ?? MANAGED_BROWSER_DEFAULT_WINDOW_SIZE;
  const requested = options.viewport ?? MANAGED_BROWSER_DEFAULT_VIEWPORT;
  const viewport = {
    width: Math.max(1, Math.min(requested.width, windowSize.width)),
    height: Math.max(1, Math.min(requested.height, windowSize.height)),
  };
  return {
    headless: false,
    locale: options.locale ?? null,
    timezoneId: options.timezoneId ?? null,
    viewport,
    windowSize,
    userAgentOverride: options.userAgentOverride ?? null,
    enabledStealthEvasions: [...MANAGED_BROWSER_STEALTH_EVASION_ALLOWLIST],
    extraArgs: [...(options.extraArgs ?? [])],
  };
}

export interface ValidateFingerprintInput {
  readonly descriptor: BrowserExecutableDescriptor;
  readonly launchPolicy: BrowserLaunchPolicy;
  readonly evidence: FingerprintSelfTestEvidence;
  /** The final composed Chromium argv (post user-data-dir/proxy/etc.). */
  readonly composedArgs?: readonly string[];
}

const FAIL = (code: string): FingerprintValidationResult => ({
  result: "fail",
  reasonCodes: [code],
});

/**
 * Validate fingerprint self-test evidence BEFORE platform navigation
 * (design §11.2). Every fail condition returns a bounded reason code — never
 * page content or secrets.
 */
export function validateFingerprint(
  input: ValidateFingerprintInput
): FingerprintValidationResult {
  const { descriptor, launchPolicy, evidence } = input;
  const reasons: string[] = [];

  // The worker must have launched exactly what the main resolved.
  if (evidence.browserMajor !== descriptor.majorVersion) {
    reasons.push("executable_version_mismatch");
  }

  // User-agent consistency (FR-FP-001..005).
  if (launchPolicy.userAgentOverride == null) {
    // Native mode: the reported UA major must equal the executable major.
    const nativeMajor =
      evidence.userAgentMajor ?? extractUserAgentMajor(evidence.userAgent);
    if (nativeMajor !== descriptor.majorVersion) {
      reasons.push("ua_major_mismatch");
    }
  } else {
    if (claimsConflictingBrowserBrand(launchPolicy.userAgentOverride)) {
      reasons.push("override_brand_conflict");
    }
    const overrideMajor = extractUserAgentMajor(launchPolicy.userAgentOverride);
    if (overrideMajor === null || overrideMajor !== descriptor.majorVersion) {
      reasons.push("ua_major_mismatch");
    }
    const reportedMajor =
      evidence.userAgentMajor ?? extractUserAgentMajor(evidence.userAgent);
    if (reportedMajor !== overrideMajor) {
      reasons.push("ua_reported_mismatch");
    }
  }

  // Locale consistency (FR-FP-007): explicit policy locale must be honored by
  // the page's navigator.language/languages.
  if (launchPolicy.locale != null) {
    const expected = launchPolicy.locale.toLowerCase();
    const lang = evidence.language.toLowerCase();
    if (!lang.startsWith(expected.split("-")[0])) {
      reasons.push("locale_mismatch");
    }
  }

  // Timezone consistency (FR-FP-008): an explicit verified timezone must hold.
  if (
    launchPolicy.timezoneId != null &&
    evidence.timezone !== launchPolicy.timezoneId
  ) {
    reasons.push("timezone_mismatch");
  }

  // Viewport must fit the window and the real screen (FR-FP-011).
  const { viewport, windowSize } = launchPolicy;
  if (
    viewport.width > windowSize.width ||
    viewport.height > windowSize.height
  ) {
    reasons.push("viewport_exceeds_window");
  }
  const screen = evidence.screen;
  if (
    (screen.width > 0 && viewport.width > screen.width) ||
    (screen.height > 0 && viewport.height > screen.height)
  ) {
    reasons.push("viewport_exceeds_screen");
  }

  // Unsafe launch flags must never be active (design §2.2 item 7).
  const deniedInPolicy = findDeniedLaunchFlag(launchPolicy.extraArgs);
  const deniedInComposed = input.composedArgs
    ? findDeniedLaunchFlag(input.composedArgs)
    : null;
  if (deniedInPolicy ?? deniedInComposed) {
    reasons.push("denied_launch_flag");
  }

  if (reasons.length > 0) {
    return { result: "fail", reasonCodes: reasons };
  }
  return { result: "pass", reasonCodes: [] };
}

export interface ComposeLaunchArgsOptions {
  readonly userDataDir: string;
  readonly diskCacheDir?: string | null;
  /** `host:port` proxy endpoint (credentials NEVER go on the argv). */
  readonly proxyServer?: string | null;
  readonly locale?: string | null;
}

/**
 * Compose the Chromium argv from the launch policy. By construction this list
 * contains no security-reducing flags; a final `findDeniedLaunchFlag` check
 * in the caller is the belt-and-braces verification.
 */
export function composeLaunchArgs(
  policy: BrowserLaunchPolicy,
  options: ComposeLaunchArgsOptions
): string[] {
  const args: string[] = [
    `--user-data-dir=${options.userDataDir}`,
    `--window-size=${policy.windowSize.width},${policy.windowSize.height}`,
    `--no-first-run`,
    `--no-default-browser-check`,
    `--disable-background-networking`,
    `--disable-component-update`,
    `--disable-default-apps`,
    `--disable-extensions`,
    `--disable-sync`,
    `--metrics-recording-only`,
  ];
  if (options.diskCacheDir) {
    args.push(`--disk-cache-dir=${options.diskCacheDir}`);
  }
  if (options.proxyServer) {
    // Authenticated proxies are handled via CDP auth in the worker —
    // credentials must not appear in argv (visible in process listings).
    args.push(`--proxy-server=${options.proxyServer}`);
  }
  const locale = options.locale ?? policy.locale;
  if (locale) {
    args.push(`--lang=${locale}`);
  }
  args.push(...policy.extraArgs);
  return args;
}
