import { Token } from "@/modules/token";

/**
 * Feature flags evaluated in the Electron MAIN process only (design §15).
 * The renderer may display availability but cannot force-enable an import path.
 *
 * Browser-profile import is enabled by default. The Token store may opt out
 * by containing the explicit value "false"; any other value (including an
 * unreadable or missing store) keeps the feature enabled.
 *
 * Read on each call (no process-lifetime cache): Token is a local electron-store
 * file read and this is invoked per user action, not on a hot path — so a runtime
 * toggle by support staff takes effect without an app restart.
 */
export const BROWSER_PROFILE_IMPORT_FLAG = "browser_profile_import_enabled";

export function isBrowserProfileImportEnabled(): boolean {
  try {
    return new Token().getValue(BROWSER_PROFILE_IMPORT_FLAG) !== "false";
  } catch {
    // Token store unreadable (DB not initialized, encrypted store corrupt):
    // enable by default rather than blocking the feature on a storage hiccup.
    return true;
  }
}

// Kept for any external caller / test that referenced the cache reset hook.
export function resetFeatureFlagCacheForTest(): void {
  /* no-op: flag is read live and not cached. */
}
