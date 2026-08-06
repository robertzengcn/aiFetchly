import { Token } from "@/modules/token";

/**
 * Feature flags evaluated in the Electron MAIN process only (design §15).
 * The renderer may display availability but cannot force-enable an import path.
 *
 * Browser-profile import requires a reviewed, signed Chromium extension AND an
 * OS-installer-registered native-messaging host (design Open Implementation
 * Decisions #1-#2). Those external pieces are not yet shipped, so the flag
 * defaults to OFF. Flipping it requires the Token store to contain the
 * explicit value "true".
 *
 * Read on each call (no process-lifetime cache): Token is a local electron-store
 * file read and this is invoked per user action, not on a hot path — so a runtime
 * toggle by support staff takes effect without an app restart.
 */
export const BROWSER_PROFILE_IMPORT_FLAG = "browser_profile_import_enabled";

export function isBrowserProfileImportEnabled(): boolean {
  try {
    return new Token().getValue(BROWSER_PROFILE_IMPORT_FLAG) === "true";
  } catch {
    // Token store unreadable (DB not initialized, encrypted store corrupt):
    // fail closed — never silently enable a gated feature.
    return false;
  }
}

// Kept for any external caller / test that referenced the cache reset hook.
export function resetFeatureFlagCacheForTest(): void {
  /* no-op: flag is read live and not cached. */
}
