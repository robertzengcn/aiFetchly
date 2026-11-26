import { describe, expect, it, vi } from "vitest";

/**
 * B06/D-FR-01–04: browser decision settings are part of the route bundle
 * the runner freezes — a change MUST bump the provider epoch so in-flight
 * tasks see provider_config_changed, and admission refuses when settings
 * move during the read.
 */

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return "";
    }
    setValue(): void {}
  },
}));

import { currentProviderConfigVersion } from "@/service/aiProvider/AIProviderConfigVersion";
import { ManagedBrowserSettingsModule } from "@/modules/ManagedBrowserSettingsModule";

function makeSettingsModule(): ManagedBrowserSettingsModule {
  const rows = new Map<string, string | null>();
  return new ManagedBrowserSettingsModule({
    getSettingValue: async (key: string) => rows.get(key) ?? null,
    getSettingItem: async (key: string) => {
      if (!rows.has(key)) {
        rows.set(key, null);
        return { id: rows.size };
      }
      return { id: [...rows.keys()].indexOf(key) + 1 };
    },
    updateSystemSetting: async (
      settingId: number,
      settingValue: string | null
    ) => {
      rows.set([...rows.keys()][settingId - 1]!, settingValue);
      return true;
    },
  } as never);
}

describe("B06 provider epoch bumps on decision-relevant settings", () => {
  it("a decisionRoute change bumps the provider epoch", async () => {
    const module = makeSettingsModule();
    const before = currentProviderConfigVersion();
    await module.updatePreferences({
      decisionRoute: { chatDecisionModel: "new-model" },
    });
    expect(currentProviderConfigVersion()).toBe(before + 1);
  });

  it("toggling acceleration bumps the provider epoch", async () => {
    const module = makeSettingsModule();
    const before = currentProviderConfigVersion();
    await module.updatePreferences({ browserDecisionEnabled: false });
    expect(currentProviderConfigVersion()).toBe(before + 1);
  });

  it("a NON-decision setting (cache size) does not bump the epoch", async () => {
    const module = makeSettingsModule();
    const before = currentProviderConfigVersion();
    await module.updatePreferences({ cacheMaxSizeMb: 512 });
    expect(currentProviderConfigVersion()).toBe(before);
  });
});
