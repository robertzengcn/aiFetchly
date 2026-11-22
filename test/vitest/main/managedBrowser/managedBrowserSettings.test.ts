import { describe, expect, it } from "vitest";

import {
  ManagedBrowserSettingsModule,
  type ManagedBrowserSettingReader,
} from "@/modules/ManagedBrowserSettingsModule";
import { MANAGED_BROWSER_SETTING_KEYS } from "@/config/managedBrowser";
import { settinggroupInit } from "@/config/settinggroupInit";

function fakeReader(values: Record<string, string | null>): ManagedBrowserSettingReader {
  return {
    getSettingValue: async (key) => (key in values ? values[key] : null),
  };
}

describe("ManagedBrowserSettingsModule effective settings", () => {
  it("defaults to browser+cache enabled, 500 MB, clear-on-exit off (FR-SETTING-001)", async () => {
    const mod = new ManagedBrowserSettingsModule(fakeReader({}), () => true);
    const settings = await mod.getEffectiveSettings();
    expect(settings.browserEnabled).toBe(true);
    expect(settings.cacheEnabled).toBe(true);
    expect(settings.cacheMaxBytes).toBe(500 * 1024 * 1024);
    expect(settings.clearCacheOnExit).toBe(false);
    expect(settings.disabledReasonCode).toBeNull();
  });

  it("user toggle off disables with a user_setting_disabled reason", async () => {
    const mod = new ManagedBrowserSettingsModule(
      fakeReader({ "managed-browser-enabled": "0" }),
      () => true
    );
    const settings = await mod.getEffectiveSettings();
    expect(settings.browserEnabled).toBe(false);
    expect(settings.disabledReasonCode).toBe("user_setting_disabled");
  });

  it("release flag off wins without mutating the user preference (FR-SETTING-002)", async () => {
    // User preference row absent (defaults on) but release flag disabled.
    const mod = new ManagedBrowserSettingsModule(fakeReader({}), () => false);
    const settings = await mod.getEffectiveSettings();
    expect(settings.browserEnabled).toBe(false);
    expect(settings.disabledReasonCode).toBe("release_flag_disabled");
    // The stored preference itself is unchanged (reader is read-only).
    expect(await mod.getStoredBrowserEnabled()).toBe(true);
  });

  it("clamps an out-of-range cache maximum (FR-CACHE table)", async () => {
    const tooBig = new ManagedBrowserSettingsModule(
      fakeReader({ "managed-browser-cache-max-size-mb": "99999" }),
      () => true
    );
    expect((await tooBig.getEffectiveSettings()).cacheMaxBytes).toBe(
      2048 * 1024 * 1024
    );

    const tooSmall = new ManagedBrowserSettingsModule(
      fakeReader({ "managed-browser-cache-max-size-mb": "10" }),
      () => true
    );
    expect((await tooSmall.getEffectiveSettings()).cacheMaxBytes).toBe(
      100 * 1024 * 1024
    );
  });

  it("cache toggles and clear-on-exit read independently (FR-CACHE-001)", async () => {
    const mod = new ManagedBrowserSettingsModule(
      fakeReader({
        "managed-browser-enabled": "1",
        "managed-browser-cache-enabled": "0",
        "managed-browser-cache-clear-on-exit": "1",
      }),
      () => true
    );
    const settings = await mod.getEffectiveSettings();
    expect(settings.browserEnabled).toBe(true);
    expect(settings.cacheEnabled).toBe(false);
    expect(settings.clearCacheOnExit).toBe(true);
  });
});

describe("settinggroupInit managed-browser rows", () => {
  it("registers the group with default-on rows for all four keys", () => {
    const group = settinggroupInit.find(
      (g) => g.name === MANAGED_BROWSER_SETTING_KEYS.group
    );
    expect(group).toBeDefined();
    const keys = group?.items.map((i) => i.key) ?? [];
    expect(keys).toContain(MANAGED_BROWSER_SETTING_KEYS.browserEnabled);
    expect(keys).toContain(MANAGED_BROWSER_SETTING_KEYS.cacheEnabled);
    expect(keys).toContain(MANAGED_BROWSER_SETTING_KEYS.cacheMaxSizeMb);
    expect(keys).toContain(MANAGED_BROWSER_SETTING_KEYS.cacheClearOnExit);

    const byKey = new Map(group?.items.map((i) => [i.key, i.value]));
    expect(byKey.get(MANAGED_BROWSER_SETTING_KEYS.browserEnabled)).toBe("1");
    expect(byKey.get(MANAGED_BROWSER_SETTING_KEYS.cacheEnabled)).toBe("1");
    expect(byKey.get(MANAGED_BROWSER_SETTING_KEYS.cacheMaxSizeMb)).toBe("500");
    expect(byKey.get(MANAGED_BROWSER_SETTING_KEYS.cacheClearOnExit)).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// C02/M-FR-12: the batch sub-agent model persists through the preference
// merge — the panel sends it, the merge keeps it, unrelated writes and
// probe writes never drop it, and a model change is decision-relevant
// (epoch bump).
// ---------------------------------------------------------------------------
describe("batchSubAgentModel preference persistence (C02)", () => {
  function makeReadWriteStore(initial: Record<string, string | null> = {}): {
    reader: ManagedBrowserSettingReader;
    store: Map<string, string | null>;
  } {
    const store = new Map<string, string | null>(
      Object.entries(initial)
    );
    let lastKey: string | null = null;
    const reader = {
      getSettingValue: async (key: string) =>
        store.has(key) ? (store.get(key) ?? null) : null,
      getSettingItem: async (key: string) => {
        // Rows pre-exist in production; the store auto-creates.
        if (!store.has(key)) {
          store.set(key, null);
        }
        lastKey = key;
        return { id: 1 };
      },
      updateSystemSetting: async (
        _id: number,
        value: string | null
      ): Promise<unknown> => {
        if (lastKey !== null) {
          store.set(lastKey, value);
        }
        return value;
      },
    };
    return { reader: reader as unknown as ManagedBrowserSettingReader, store };
  }

  it("a save carrying batchSubAgentModel persists it and a reload reads it back", async () => {
    const { reader, store } = makeReadWriteStore();
    const mod = new ManagedBrowserSettingsModule(reader, () => true, reader as never);
    await mod.updatePreferences({
      decisionRoute: { batchSubAgentModel: "my-lane-model" },
    });
    const settings = await mod.getEffectiveSettings();
    expect(settings.decisionRoute.batchSubAgentModel).toBe("my-lane-model");
    // The STORED JSON carries the key too (not just the parsed view).
    const stored = store.get(MANAGED_BROWSER_SETTING_KEYS.decisionRoute);
    expect(stored).toContain("my-lane-model");
  });

  it("an unrelated settings write does NOT drop the stored batch model", async () => {
    const { reader, store } = makeReadWriteStore();
    const mod = new ManagedBrowserSettingsModule(reader, () => true, reader as never);
    await mod.updatePreferences({
      decisionRoute: { batchSubAgentModel: "my-lane-model" },
    });
    // A probe/capabilities write and an unrelated toggle come later.
    await mod.updatePreferences({
      decisionRoute: {
        chatCapabilities: {
          structuredJsonSchema: true,
          forcedToolDecision: false,
          providerRevision: "provider-config:test:9",
        },
      },
    });
    await mod.updatePreferences({ signInEnabled: false });
    const settings = await mod.getEffectiveSettings();
    expect(settings.decisionRoute.batchSubAgentModel).toBe("my-lane-model");
    expect(settings.signInEnabled).toBe(false);
  });

  it("a null clears the override and an oversized value is bounded", async () => {
    const { reader } = makeReadWriteStore();
    const mod = new ManagedBrowserSettingsModule(reader, () => true, reader as never);
    await mod.updatePreferences({
      decisionRoute: { batchSubAgentModel: "m".repeat(500) },
    });
    expect((await mod.getEffectiveSettings()).decisionRoute.batchSubAgentModel).toBe(
      "m".repeat(200)
    );
    await mod.updatePreferences({
      decisionRoute: { batchSubAgentModel: null },
    });
    expect((await mod.getEffectiveSettings()).decisionRoute.batchSubAgentModel).toBeNull();
  });
});
