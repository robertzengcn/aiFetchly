import { SystemSettingModule } from "@/modules/SystemSettingModule";
import { isManagedBrowserReleaseFlagEnabled } from "@/config/featureFlags";
import {
  MANAGED_BROWSER_CACHE_DEFAULTS,
  MANAGED_BROWSER_SETTING_KEYS,
  parseCacheMaxSizeMb,
  parseStoredToggle,
} from "@/config/managedBrowser";
import type { EffectiveManagedBrowserSettings } from "@/entityTypes/managedBrowserTypes";

/**
 * Managed-browser settings (technical design §7.4; PRD FR-SETTING-001/002).
 *
 * Reads user preferences through `SystemSettingModule` (never a repository)
 * and composes the EFFECTIVE settings with release-flag precedence. The
 * release flag is evaluated separately and can suspend new sessions WITHOUT
 * mutating stored user values. Disabling rejects before cookie decryption or
 * worker creation (enforced by ManagedBrowserModule's start order).
 */

/** Structural reader so tests inject a fake without touching the DB. */
export interface ManagedBrowserSettingReader {
  getSettingValue(key: string): Promise<string | null>;
}

export class ManagedBrowserSettingsModule {
  private readonly reader: ManagedBrowserSettingReader;
  private readonly releaseFlagEnabled: () => boolean;

  constructor(
    reader: ManagedBrowserSettingReader = new SystemSettingModule(),
    releaseFlagEnabled: () => boolean = isManagedBrowserReleaseFlagEnabled
  ) {
    this.reader = reader;
    this.releaseFlagEnabled = releaseFlagEnabled;
  }

  /**
   * Effective enablement (PRD §8.9):
   *   application release flag AND user managed-browser setting
   */
  public async getEffectiveSettings(): Promise<EffectiveManagedBrowserSettings> {
    const [browserRaw, cacheRaw, cacheMaxRaw, clearOnExitRaw] =
      await Promise.all([
        this.reader.getSettingValue(MANAGED_BROWSER_SETTING_KEYS.browserEnabled),
        this.reader.getSettingValue(MANAGED_BROWSER_SETTING_KEYS.cacheEnabled),
        this.reader.getSettingValue(MANAGED_BROWSER_SETTING_KEYS.cacheMaxSizeMb),
        this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.cacheClearOnExit
        ),
      ]);

    // User preference defaults ON (FR-SETTING-001 / FR-CACHE-001).
    const userBrowserEnabled = parseStoredToggle(browserRaw, true);
    const cacheEnabled = parseStoredToggle(cacheRaw, true);

    const releaseEnabled = this.releaseFlagEnabled();
    const browserEnabled = releaseEnabled && userBrowserEnabled;
    const disabledReasonCode = browserEnabled
      ? null
      : releaseEnabled
        ? "user_setting_disabled"
        : "release_flag_disabled";

    return {
      browserEnabled,
      cacheEnabled,
      cacheMaxBytes: parseCacheMaxSizeMb(cacheMaxRaw) * 1024 * 1024,
      clearCacheOnExit: parseStoredToggle(clearOnExitRaw, false),
      disabledReasonCode,
    };
  }

  /** Read the raw stored browser toggle (for the settings UI's active-check). */
  public async getStoredBrowserEnabled(): Promise<boolean> {
    const raw = await this.reader.getSettingValue(
      MANAGED_BROWSER_SETTING_KEYS.browserEnabled
    );
    return parseStoredToggle(raw, true);
  }
}

/** Re-export for callers building the settings UI's size bounds label. */
export const MANAGED_BROWSER_CACHE_LIMITS = {
  minMb: MANAGED_BROWSER_CACHE_DEFAULTS.minMaxSizeMb,
  maxMb: MANAGED_BROWSER_CACHE_DEFAULTS.maxMaxSizeMb,
  defaultMb: MANAGED_BROWSER_CACHE_DEFAULTS.defaultMaxSizeMb,
} as const;
