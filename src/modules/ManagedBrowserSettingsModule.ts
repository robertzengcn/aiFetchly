import { SystemSettingModule } from "@/modules/SystemSettingModule";
import { bumpProviderConfigVersion } from "@/service/aiProvider/AIProviderConfigVersion";
import { isManagedBrowserReleaseFlagEnabled } from "@/config/featureFlags";
import {
  MANAGED_BROWSER_CACHE_DEFAULTS,
  MANAGED_BROWSER_MAX_CONCURRENT_SESSIONS_DEFAULT,
  MANAGED_BROWSER_MAX_CONCURRENT_SESSIONS_MAX,
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

/**
 * N01/design 5.3: parse the stored decision-route settings. The stored
 * value is a version-1 JSON object; unparseable/foreign-version input
 * falls back to `follow_chat` with no profile (never a broken route).
 */
function parseDecisionRouteRaw(raw: string | null): EffectiveManagedBrowserSettings["decisionRoute"] {
  const fallback: EffectiveManagedBrowserSettings["decisionRoute"] = {
    version: 1,
    mode: "follow_chat",
    chatDecisionModel: null,
    nativeProfile: null,
    requestTimeoutMs: null,
    chatCapabilities: null,
  };
  if (raw == null || raw.trim() === "") {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return fallback;
    }
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) {
      return fallback;
    }
    const mode =
      record.mode === "native_profile" ? "native_profile" : "follow_chat";
    const chatDecisionModel =
      typeof record.chatDecisionModel === "string" &&
      record.chatDecisionModel.trim().length > 0 &&
      record.chatDecisionModel.length <= 200
        ? record.chatDecisionModel.trim()
        : null;
    // The native profile is honored ONLY in native mode with a complete,
    // explicitly-configured record — native support is never inferred.
    let nativeProfile: EffectiveManagedBrowserSettings["decisionRoute"]["nativeProfile"] = null;
    const rawProfile = record.nativeProfile;
    if (
      mode === "native_profile" &&
      typeof rawProfile === "object" &&
      rawProfile !== null
    ) {
      const profile = rawProfile as Record<string, unknown>;
      const displayName =
        typeof profile.displayName === "string" &&
        profile.displayName.trim().length > 0
          ? profile.displayName.trim().slice(0, 100)
          : null;
      const baseUrl =
        typeof profile.baseUrl === "string" &&
        /^https:\/\//.test(profile.baseUrl.trim()) &&
        profile.baseUrl.trim().length <= 500
          ? profile.baseUrl.trim()
          : null;
      const model =
        typeof profile.model === "string" && profile.model.trim().length > 0
          ? profile.model.trim().slice(0, 200)
          : null;
      const apiKeyRef =
        profile.apiKeyRef === "chat" || profile.apiKeyRef === "none"
          ? profile.apiKeyRef
          : null;
      if (displayName && baseUrl && model && apiKeyRef) {
        nativeProfile = { displayName, baseUrl, model, apiKeyRef };
      }
    }
    const requestTimeoutMs =
      typeof record.requestTimeoutMs === "number" &&
      Number.isFinite(record.requestTimeoutMs) &&
      record.requestTimeoutMs > 0
        ? Math.min(Math.floor(record.requestTimeoutMs), 10_000)
        : null;
    // R01/D-FR-18: the probed chat OUTPUT capabilities — booleans only
    // when BOTH flags are valid booleans; anything else is unprobed.
    let chatCapabilities:
      | {
          structuredJsonSchema: boolean;
          forcedToolDecision: boolean;
          providerRevision: string | null;
        }
      | null = null;
    const rawCaps = record.chatCapabilities;
    if (typeof rawCaps === "object" && rawCaps !== null) {
      const caps = rawCaps as Record<string, unknown>;
      if (
        typeof caps.structuredJsonSchema === "boolean" &&
        typeof caps.forcedToolDecision === "boolean"
      ) {
        chatCapabilities = {
          structuredJsonSchema: caps.structuredJsonSchema,
          forcedToolDecision: caps.forcedToolDecision,
          providerRevision:
            typeof caps.providerRevision === "string"
              ? caps.providerRevision.slice(0, 128)
              : null,
        };
      }
    }
    return {
      version: 1,
      mode,
      chatDecisionModel,
      nativeProfile: mode === "native_profile" ? nativeProfile : null,
      requestTimeoutMs,
      chatCapabilities,
    };
  } catch {
    return fallback;
  }
}

/** Parse a bounded positive integer setting; null when unset/invalid. */
function parseBoundedInt(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(min, Math.min(parsed, max));
}

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
  /** M-FR-06: concurrent-session cap (clamped 1..5). */
  readonly maxConcurrentSessions?: number;
  /** M-FR-06: per-site session cap (clamped 1..10). */
  readonly maxSessionsPerSite?: number;
  /** T25/T29: per-feature kill switches. */
  readonly signInEnabled?: boolean;
  readonly siteUpsertEnabled?: boolean;
  readonly proxySwitchEnabled?: boolean;
  readonly parallelAgentsEnabled?: boolean;
  readonly browserDecisionEnabled?: boolean;
  /**
   * N01/design 5.3: the decision-route patch. Merged into the stored
   * versioned JSON; fields the caller omits keep their stored values.
   */
  readonly decisionRoute?: {
    readonly mode?: "follow_chat" | "native_profile";
    readonly chatDecisionModel?: string | null;
    readonly nativeProfile?: {
      readonly displayName: string;
      readonly baseUrl: string;
      readonly model: string;
      readonly apiKeyRef: "chat" | "none";
    } | null;
    readonly requestTimeoutMs?: number | null;
    /** R01/D-FR-18: probed chat output capabilities (settings probe). */
    readonly chatCapabilities?: {
      readonly structuredJsonSchema: boolean;
      readonly forcedToolDecision: boolean;
      readonly providerRevision?: string | null;
    } | null;
  };
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
    const [
      browserRaw,
      cacheRaw,
      cacheMaxRaw,
      clearOnExitRaw,
      maxSessionsRaw,
      perSiteRaw,
      signInRaw,
      siteUpsertRaw,
      proxySwitchRaw,
      parallelRaw,
      decisionRaw,
    ] =
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
        this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.maxConcurrentSessions
        ),
        this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.maxSessionsPerSite
        ),
        this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.signInEnabled
        ),
        this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.siteUpsertEnabled
        ),
        this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.proxySwitchEnabled
        ),
        this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.parallelAgentsEnabled
        ),
        this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.browserDecisionEnabled
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
      // M-FR-06: configurable caps (defaults when unset).
      maxConcurrentSessions:
        parseBoundedInt(
          maxSessionsRaw,
          1,
          MANAGED_BROWSER_MAX_CONCURRENT_SESSIONS_MAX
        ) ?? MANAGED_BROWSER_MAX_CONCURRENT_SESSIONS_DEFAULT,
      maxSessionsPerSite: parseBoundedInt(perSiteRaw, 1, 10) ?? 2,
      // T25/T29: per-feature switches default ON; "0" turns a feature off.
      signInEnabled: parseStoredToggle(signInRaw, true),
      siteUpsertEnabled: parseStoredToggle(siteUpsertRaw, true),
      proxySwitchEnabled: parseStoredToggle(proxySwitchRaw, true),
      parallelAgentsEnabled: parseStoredToggle(parallelRaw, true),
      browserDecisionEnabled: parseStoredToggle(decisionRaw, true),
      // N01/design 5.3: the versioned decision-route settings (validated;
      // anything unparseable falls back to follow_chat with no profile).
      decisionRoute: parseDecisionRouteRaw(
        await this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.decisionRoute
        )
      ),
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
    // M-FR-06 caps + T25/T29 switches.
    for (const [key, value] of [
      [MANAGED_BROWSER_SETTING_KEYS.maxConcurrentSessions, patch.maxConcurrentSessions],
      [MANAGED_BROWSER_SETTING_KEYS.maxSessionsPerSite, patch.maxSessionsPerSite],
      [MANAGED_BROWSER_SETTING_KEYS.signInEnabled, patch.signInEnabled],
      [MANAGED_BROWSER_SETTING_KEYS.siteUpsertEnabled, patch.siteUpsertEnabled],
      [MANAGED_BROWSER_SETTING_KEYS.proxySwitchEnabled, patch.proxySwitchEnabled],
      [MANAGED_BROWSER_SETTING_KEYS.parallelAgentsEnabled, patch.parallelAgentsEnabled],
      [MANAGED_BROWSER_SETTING_KEYS.browserDecisionEnabled, patch.browserDecisionEnabled],
    ] as const) {
      if (value !== undefined) {
        writes.push(
          this.writeStoredValue(
            key,
            typeof value === "boolean" ? (value ? "1" : "0") : String(value)
          )
        );
      }
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
    // B06/D-FR-01–04: decision-relevant settings are part of the route
    // bundle the runner freezes — a change MUST bump the provider epoch
    // so in-flight tasks see provider_config_changed and re-admit under
    // the new configuration.
    // N04: a decisionRoute patch that carries ONLY the probed chat
    // capabilities does NOT bump the epoch — the model/endpoint/key are
    // unchanged, and bumping would make the just-stored revision stale on
    // arrival (the probe could never validate its own result). Any other
    // route change (mode, model, profile) still bumps.
    const routePatchChangesBehavior =
      patch.decisionRoute !== undefined &&
      (patch.decisionRoute.mode !== undefined ||
        patch.decisionRoute.chatDecisionModel !== undefined ||
        patch.decisionRoute.nativeProfile !== undefined ||
        patch.decisionRoute.requestTimeoutMs !== undefined);
    const decisionRelevantChange =
      routePatchChangesBehavior ||
      patch.browserDecisionEnabled !== undefined ||
      patch.parallelAgentsEnabled !== undefined ||
      patch.maxConcurrentSessions !== undefined ||
      patch.maxSessionsPerSite !== undefined ||
      patch.signInEnabled !== undefined;
    // N01/design 5.3: merge the decision-route patch into the stored
    // versioned JSON and persist.
    if (patch.decisionRoute !== undefined) {
      const current = parseDecisionRouteRaw(
        await this.reader.getSettingValue(
          MANAGED_BROWSER_SETTING_KEYS.decisionRoute
        )
      );
      const patchRoute = patch.decisionRoute;
      const nativeProfile =
        patchRoute.nativeProfile !== undefined
          ? patchRoute.nativeProfile
          : current.nativeProfile;
      const merged = {
        version: 1 as const,
        mode: patchRoute.mode ?? current.mode,
        chatDecisionModel:
          patchRoute.chatDecisionModel !== undefined
            ? patchRoute.chatDecisionModel === null
              ? null
              : patchRoute.chatDecisionModel.trim().slice(0, 200) || null
            : current.chatDecisionModel,
        nativeProfile:
          nativeProfile === null
            ? null
            : {
                displayName: nativeProfile.displayName.trim().slice(0, 100),
                baseUrl: nativeProfile.baseUrl.trim(),
                model: nativeProfile.model.trim().slice(0, 200),
                apiKeyRef: nativeProfile.apiKeyRef,
              },
        requestTimeoutMs:
          patchRoute.requestTimeoutMs !== undefined
            ? patchRoute.requestTimeoutMs === null
              ? null
              : Math.min(Math.floor(patchRoute.requestTimeoutMs), 10_000)
            : current.requestTimeoutMs,
        // R01/D-FR-18: probed chat output capabilities ride the patch.
        chatCapabilities:
          patchRoute.chatCapabilities === undefined
            ? current.chatCapabilities
            : patchRoute.chatCapabilities === null
              ? null
              : {
                  structuredJsonSchema:
                    patchRoute.chatCapabilities.structuredJsonSchema,
                  forcedToolDecision:
                    patchRoute.chatCapabilities.forcedToolDecision,
                  providerRevision:
                    patchRoute.chatCapabilities.providerRevision ?? null,
                },
      };
      writes.push(
        this.writeStoredValue(
          MANAGED_BROWSER_SETTING_KEYS.decisionRoute,
          JSON.stringify(merged)
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
    if (decisionRelevantChange) {
      // B06: bump the epoch. N05: the bump runs AFTER ALL writes have
      // COMMITTED — a task capturing the new epoch between two incomplete
      // writes would otherwise read partially-committed settings under a
      // fresh epoch.
      await Promise.all(writes);
      bumpProviderConfigVersion();
      return this.getEffectiveSettings();
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
