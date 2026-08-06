import { Token } from "@/modules/token";

/**
 * Feature flags evaluated in the Electron MAIN process only (design §15).
 * The renderer may display availability but cannot force-enable an import path.
 *
 * Browser-profile import requires a reviewed, signed Chromium extension AND an
 * OS-installer-registered native-messaging host (design Open Implementation
 * Decisions #1–#2). Those external pieces are not yet shipped, so the flag
 * defaults to OFF. Flipping it requires the Token store to contain the
 * explicit value "true".
 */
export const BROWSER_PROFILE_IMPORT_FLAG = "browser_profile_import_enabled";

let cachedFlag: boolean | null = null;

export function isBrowserProfileImportEnabled(): boolean {
  if (cachedFlag !== null) {
    return cachedFlag;
  }
  try {
    cachedFlag = new Token().getValue(BROWSER_PROFILE_IMPORT_FLAG) === "true";
  } catch {
    cachedFlag = false;
  }
  return cachedFlag;
}

/** Test-only: reset the cache (e.g. after toggling the Token store in a test). */
export function resetFeatureFlagCacheForTest(): void {
  cachedFlag = null;
}
