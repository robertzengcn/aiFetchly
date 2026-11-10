import { SystemSettingModule } from "@/modules/SystemSettingModule";
import { isManagedBrowserReleaseFlagEnabled } from "@/config/featureFlags";
import {
  MANAGED_BROWSER_CACHE_DEFAULTS,
  MANAGED_BROWSER_SETTING_KEYS,
  clampCacheMaxSizeMb,
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

/** Key-based write surface (SystemSettingModule implements both). */
export interface ManagedBrowserSettingWriter {
  getSettingItem(key: string): Promise<{ id: number } | null>;
  updateSystemSetting(
    settingId: number,
    settingValue: string | null
  ): Promise<unknown>;
}

/** User-controllable preference patch for the settings panel. */
export interface ManagedBrowserPreferencePatch {
  readonly browserEnabled?: boolean;
  readonly cacheEnabled?: boolean;
  readonly cacheMaxSizeMb?: number;
  readonly clearCacheOnExit?: boolean;
}

export class ManagedBrowserSettingsModule {
  private readonly reader: ManagedBrowserSettingReader;
  private readonly writer: ManagedBrowserSettingWriter | null;
  private readonly releaseFlagEnabled: () => boolean;

  constructor(
    reader: ManagedBrowserSettingReader = new SystemSettingModule(),
    releaseFlagEnabled: () => boolean = isManagedBrowserReleaseFlagEnabled,
    writer: ManagedBrowserSettingWriter | null = reader as Partial<ManagedBrowserSettingWriter> as ManagedBrowserSettingWriter | null
  ) {
    this.reader = reader;
    this.releaseFlagEnabled = releaseFlagEnabled;
    this.writer = writer;
  }

  /**
   * Effective enablement (PRD §8.9):
   *   application release flag AND user managed-browser setting
   */
  public async getEffectiveSettings(): Promise<EffectiveManagedBrowserSettings> {
    const [browserRaw, cacheRaw, cacheMaxRaw, clearOnExitRaw] =
      await Promise.all([
        this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.browserEnabled
        ),
        this.reader.getSettingValue(MANAGED_BROWSER_SETTING_KEYS.cacheEnabled),
        this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.cacheMaxSizeMb
        ),
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

  /**
   * Persist a user preference patch (settings panel). Rows are seeded by
   * settinggroupInit; a missing row is a setup error, not a silent default.
   * Returns the refreshed effective settings.
   */
  public async updatePreferences(
    patch: ManagedBrowserPreferencePatch
  ): Promise<EffectiveManagedBrowserSettings> {
    if (!this.writer) {
      throw new Error("setting_writer_unavailable");
    }
    const writes: Array<Promise<unknown>> = [];
    if (patch.browserEnabled !== undefined) {
      writes.push(
        this.writeStoredValue(
          MANAGED_BROWSER_SETTING_KEYS.browserEnabled,
          patch.browserEnabled ? "1" : "0"
        )
      );
    }
    if (patch.cacheEnabled !== undefined) {
      writes.push(
        this.writeStoredValue(
          MANAGED_BROWSER_SETTING_KEYS.cacheEnabled,
          patch.cacheEnabled ? "1" : "0"
        )
      );
    }
    if (patch.clearCacheOnExit !== undefined) {
      writes.push(
        this.writeStoredValue(
          MANAGED_BROWSER_SETTING_KEYS.cacheClearOnExit,
          patch.clearCacheOnExit ? "1" : "0"
        )
      );
    }
    if (patch.cacheMaxSizeMb !== undefined) {
      writes.push(
        this.writeStoredValue(
          MANAGED_BROWSER_SETTING_KEYS.cacheMaxSizeMb,
          String(clampCacheMaxSizeMb(patch.cacheMaxSizeMb))
        )
      );
    }
    await Promise.all(writes);
    return this.getEffectiveSettings();
  }

  private async writeStoredValue(key: string, value: string): Promise<unknown> {
    const writer = this.writer as ManagedBrowserSettingWriter;
    const item = await writer.getSettingItem(key);
    if (!item) {
      throw new Error("setting_row_missing");
    }
    return writer.updateSystemSetting(item.id, value);
  }
}

/** Re-export for callers building the settings UI's size bounds label. */
export const MANAGED_BROWSER_CACHE_LIMITS = {
  minMb: MANAGED_BROWSER_CACHE_DEFAULTS.minMaxSizeMb,
  maxMb: MANAGED_BROWSER_CACHE_DEFAULTS.maxMaxSizeMb,
  defaultMb: MANAGED_BROWSER_CACHE_DEFAULTS.defaultMaxSizeMb,
} as const;
