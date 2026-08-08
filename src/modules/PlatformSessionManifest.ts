/**
 * Platform session manifest (technical design §6).
 *
 * Pure data + pure functions. No renderer, Electron, or DB imports — safe to
 * import from the main process, native-host build tooling, and tests.
 *
 * Maps a supported social platform (by id, copied from `SocialPlatformList` in
 * src/config/generate.ts — never guessed) to the cookie-domain allowlist that
 * defines which persisted cookies are part of that platform's session.
 *
 * Domain matching is SUFFIX-exact: a cookie domain matches only if it equals
 * an allowlisted suffix or ends in `.<suffix>`. Substring matching is
 * explicitly forbidden (so `not-google.com` never matches `google.com`).
 */

export interface PlatformSessionDefinition {
  /** Copied from SocialPlatformList.id. */
  readonly platformId: number;
  /** Copied from SocialPlatformList.name (lowercased canonical form). */
  readonly platformName: string;
  /** Copied from SocialPlatformList.url. */
  readonly loginUrl: string;
  /** URL the user can open to verify the session post-import. */
  readonly verificationUrl: string;
  /** Cookie domains permitted for this platform. Lowercase, no leading dot. */
  readonly allowedDomainSuffixes: readonly string[];
  /**
   * Domains a viable session must include at least one cookie from.
   * Must be a subset of allowedDomainSuffixes.
   */
  readonly requiredDomainSuffixes: readonly string[];
  /**
   * Whether browser-profile import is offered for this platform.
   * Gated globally by BROWSER_PROFILE_IMPORT_ENABLED as well.
   */
  readonly browserProfileImportEnabled: boolean;
}

/**
 * First-release manifest. Platform IDs/URLs mirror SocialPlatformList exactly.
 *
 * Browser-profile import is enabled only for the major SSO-bearing platforms
 * (YouTube/Google share accounts.google.com; Facebook is single-domain). The
 * global feature flag (src/config/featureFlags.ts) must ALSO be on before the
 * UI offers import, regardless of this per-platform switch.
 *
 * The exact first-release platform set is PRD Open Decision #2; this is a
 * conservative default that can be widened per-platform after manual QA.
 */
export const PLATFORM_SESSION_MANIFEST: readonly PlatformSessionDefinition[] = [
  {
    platformId: 1, // Facebook
    platformName: "facebook",
    loginUrl: "https://www.facebook.com",
    verificationUrl: "https://www.facebook.com/",
    allowedDomainSuffixes: ["facebook.com"],
    requiredDomainSuffixes: ["facebook.com"],
    browserProfileImportEnabled: true,
  },
  {
    platformId: 2, // Youtube
    platformName: "youtube",
    loginUrl: "https://www.youtube.com",
    verificationUrl: "https://www.youtube.com/",
    allowedDomainSuffixes: ["youtube.com", "google.com", "accounts.google.com"],
    requiredDomainSuffixes: ["youtube.com", "google.com"],
    browserProfileImportEnabled: true,
  },
  {
    platformId: 3, // Bilibili
    platformName: "bilibili",
    loginUrl: "https://www.bilibili.com",
    verificationUrl: "https://www.bilibili.com/",
    allowedDomainSuffixes: ["bilibili.com"],
    requiredDomainSuffixes: ["bilibili.com"],
    browserProfileImportEnabled: false,
  },
  {
    platformId: 4, // Google
    platformName: "google",
    loginUrl: "https://www.google.com",
    verificationUrl: "https://www.google.com/",
    allowedDomainSuffixes: ["google.com", "accounts.google.com"],
    requiredDomainSuffixes: ["google.com"],
    browserProfileImportEnabled: true,
  },
  {
    platformId: 5, // Bing
    platformName: "bing",
    loginUrl: "https://www.bing.com",
    verificationUrl: "https://www.bing.com/",
    allowedDomainSuffixes: ["bing.com"],
    requiredDomainSuffixes: ["bing.com"],
    browserProfileImportEnabled: false,
  },
  {
    platformId: 14, // Yandex
    platformName: "yandex",
    loginUrl: "https://www.yandex.com",
    verificationUrl: "https://www.yandex.com/",
    allowedDomainSuffixes: ["yandex.com", "yandex.ru"],
    requiredDomainSuffixes: ["yandex.com"],
    browserProfileImportEnabled: false,
  },
];

/** Known public suffixes that are too broad to allowlist on their own. */
const PUBLIC_SUFFIXES = new Set([
  "com",
  "net",
  "org",
  "edu",
  "gov",
  "io",
  "co",
  "us",
  "uk",
  "de",
  "fr",
  "it",
  "es",
  "jp",
  "cn",
  "ru",
  "co.uk",
  "com.au",
  "co.jp",
  "com.br",
]);

export class ManifestValidationError extends Error {
  constructor(
    message: string,
    public readonly platformId: number | null,
    public readonly field: string
  ) {
    super(message);
    this.name = "ManifestValidationError";
  }
}

function isLowercaseAsciiDomain(domain: string): boolean {
  return /^[a-z0-9.-]+$/.test(domain);
}

/**
 * Validate the manifest at startup (design §6.2). Throws on the first error.
 * The caller (main process) should catch, log a safe message, and disable
 * browser-profile import globally rather than allowing a broad fallback.
 */
export function validateManifest(
  manifest: readonly PlatformSessionDefinition[] = PLATFORM_SESSION_MANIFEST
): void {
  const seenIds = new Set<number>();

  for (const def of manifest) {
    if (seenIds.has(def.platformId)) {
      throw new ManifestValidationError(
        `duplicate platformId ${def.platformId}`,
        def.platformId,
        "platformId"
      );
    }
    seenIds.add(def.platformId);

    for (const suffix of def.allowedDomainSuffixes) {
      if (typeof suffix !== "string" || suffix.length === 0) {
        throw new ManifestValidationError(
          "empty domain suffix",
          def.platformId,
          "allowedDomainSuffixes"
        );
      }
      if (suffix.startsWith(".") || suffix.endsWith(".")) {
        throw new ManifestValidationError(
          `domain suffix must not have leading/trailing dot: ${suffix}`,
          def.platformId,
          "allowedDomainSuffixes"
        );
      }
      if (suffix.includes("*") || suffix.includes("/") || suffix.includes(":")) {
        throw new ManifestValidationError(
          `domain suffix must not contain wildcard/path/port: ${suffix}`,
          def.platformId,
          "allowedDomainSuffixes"
        );
      }
      if (!isLowercaseAsciiDomain(suffix)) {
        throw new ManifestValidationError(
          `domain suffix must be lowercase ASCII: ${suffix}`,
          def.platformId,
          "allowedDomainSuffixes"
        );
      }
      if (PUBLIC_SUFFIXES.has(suffix)) {
        throw new ManifestValidationError(
          `domain suffix is a broad public suffix: ${suffix}`,
          def.platformId,
          "allowedDomainSuffixes"
        );
      }
    }

    for (const required of def.requiredDomainSuffixes) {
      if (!def.allowedDomainSuffixes.includes(required)) {
        throw new ManifestValidationError(
          `required domain ${required} is not in allowedDomainSuffixes`,
          def.platformId,
          "requiredDomainSuffixes"
        );
      }
    }

    if (def.browserProfileImportEnabled) {
      try {
        new URL(def.verificationUrl);
      } catch {
        throw new ManifestValidationError(
          `import-enabled platform needs a valid verificationUrl: ${def.verificationUrl}`,
          def.platformId,
          "verificationUrl"
        );
      }
    }
  }
}

/** Look up a platform definition by id. Returns undefined when unsupported. */
export function getPlatformManifest(
  platformId: number,
  manifest: readonly PlatformSessionDefinition[] = PLATFORM_SESSION_MANIFEST
): PlatformSessionDefinition | undefined {
  return manifest.find((m) => m.platformId === platformId);
}

/**
 * Domain allowlist match (design §6.3). Normalizes the cookie domain
 * (trim, lowercase, strip one leading dot) before comparing.
 *
 * Exact-suffix match only — never substring match.
 */
export function matchesAllowedDomain(
  cookieDomain: string,
  allowedSuffixes: readonly string[]
): boolean {
  const domain = String(cookieDomain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  if (domain.length === 0) {
    return false;
  }
  return allowedSuffixes.some(
    (suffix) => domain === suffix || domain.endsWith(`.${suffix}`)
  );
}

/** Convenience: allowlist predicate bound to a platform id. */
export function makeDomainMatcher(
  platformId: number,
  manifest: readonly PlatformSessionDefinition[] = PLATFORM_SESSION_MANIFEST
): (cookieDomain: string) => boolean {
  const def = getPlatformManifest(platformId, manifest);
  const suffixes = def ? def.allowedDomainSuffixes : [];
  return (cookieDomain: string) => matchesAllowedDomain(cookieDomain, suffixes);
}
