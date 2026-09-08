import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import ManagedBrowserSettingsPanel from "@/views/components/settings/ManagedBrowserSettingsPanel.vue";
import type {
  EffectiveManagedBrowserSettings,
  SafeManagedBrowserCacheStatus,
} from "@/entityTypes/managedBrowserTypes";

/**
 * ManagedBrowserSettingsPanel (design §22.3): toggles persist through
 * updateBrowserPreferences (reverting on failure) and the clear flow uses
 * the two-step confirmation (issue → dialog → clear with skip_active).
 */

const baseSettings: EffectiveManagedBrowserSettings = {
  browserEnabled: true,
  cacheEnabled: true,
  cacheMaxBytes: 500 * 1024 * 1024,
  clearCacheOnExit: false,
  disabledReasonCode: null,
};

const apiMocks = vi.hoisted(() => ({
  listEligibleAccounts: vi.fn(async (): Promise<unknown[]> => []),
  getEffectiveBrowserSettings: vi.fn(async (): Promise<unknown> => null),
  updateBrowserPreferences: vi.fn(async (patch: unknown): Promise<unknown> => patch),
  getCacheStatus: vi.fn(async (): Promise<unknown> => null),
  listActiveSessions: vi.fn(async (): Promise<unknown[]> => []),
  stopManagedBrowser: vi.fn(async (): Promise<unknown> => null),
  issueClearConfirmation: vi.fn(
    async (_input?: unknown): Promise<unknown> => ({
      confirmationId: "conf-1234-abcd",
    })
  ),
  clearCache: vi.fn(async (): Promise<unknown> => null),
  onManagedBrowserCacheProgress: vi.fn((): (() => void) => () => undefined),
}));
vi.mock("@/views/api/managedBrowser", () => apiMocks);

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { cancel: "Cancel" },
      managedBrowser: {
        settings: {
          title: "Managed Browser",
          description: "Control the built-in social browser.",
          browser_enabled: "Enable the managed browser",
          cache_enabled: "Keep a disk cache between sessions",
          clear_cache_on_exit: "Clear the cache when the app exits",
          cache_size: "Cache size: {size}",
          last_cleared: "Last cleared {when}",
          clear_all: "Clear cache",
          clear_preserves_logins: "Clearing keeps your saved logins.",
          clear_confirm_title: "Clear browser cache?",
          clear_confirm_body: "About {size} of cached files will be removed.",
          clear_confirm_preserved: "Saved logins are preserved.",
          clear_confirm_ok: "Clear cache",
          disabled_reasons: {
            user_setting_disabled: "The managed browser is turned off.",
            release_flag_disabled: "Disabled by a release flag.",
          },
        },
      },
    },
  },
});

// Vuetify stubs — v-switch renders an input that emits update:modelValue.
const VSwitch = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  setup(_, { emit }) {
    const onChange = (e: Event): void => {
      emit("update:modelValue", (e.target as HTMLInputElement).checked);
    };
    return { onChange };
  },
  template: `<label><input type="checkbox" :checked="modelValue" v-bind="$attrs" @change="onChange" /> {{ label }}</label>`,
});
const VBtn = defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
  },
  emits: ["click"],
  setup(_, { emit }) {
    const onClick = (): void => emit("click");
    return { onClick };
  },
  template: `<button :disabled="disabled" @click="onClick"><slot /></button>`,
});
const VDialog = defineComponent({
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  template: `<div v-if="modelValue"><slot /></div>`,
});
const VAlert = { template: "<div><slot /></div>" };
const VDivider = { template: "<hr />" };
const VSpacer = { template: "<span />" };
const VCard = { template: "<div><slot /></div>" };
const VCardTitle = { template: "<div><slot /></div>" };
const VCardText = { template: "<div><slot /></div>" };
const VCardActions = { template: "<div><slot /></div>" };

function mountPanel() {
  return mount(ManagedBrowserSettingsPanel, {
    global: {
      plugins: [i18n],
      stubs: {
        "v-switch": VSwitch,
        "v-btn": VBtn,
        "v-dialog": VDialog,
        "v-alert": VAlert,
        "v-divider": VDivider,
        "v-spacer": VSpacer,
        "v-card": VCard,
        "v-card-title": VCardTitle,
        "v-card-text": VCardText,
        "v-card-actions": VCardActions,
      },
    },
  });
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getEffectiveBrowserSettings.mockImplementation(
    async () => baseSettings
  );
  apiMocks.updateBrowserPreferences.mockImplementation(async (patch: unknown) => ({
    ...baseSettings,
    ...(patch as Partial<EffectiveManagedBrowserSettings>),
  }));
  apiMocks.getCacheStatus.mockImplementation(
    async (): Promise<SafeManagedBrowserCacheStatus> => ({
      scope: "all",
      approximateBytes: 12 * 1024 * 1024,
      lastClearedAt: "2026-09-01T00:00:00.000Z",
      active: false,
      pendingClear: false,
    })
  );
  apiMocks.listActiveSessions.mockImplementation(async () => []);
  apiMocks.stopManagedBrowser.mockImplementation(async () => null);
  apiMocks.clearCache.mockImplementation(async () => ({
    state: "cleared" as const,
    scope: "all" as const,
    approximateDeletedBytes: 12 * 1024 * 1024,
    savedLoginSessionPreserved: true as const,
    reasonCode: null,
  }));
});

describe("ManagedBrowserSettingsPanel", () => {
  it("loads settings and the all-scope cache size on mount", async () => {
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-settings-panel']").exists()
      ).toBe(true)
    );
    await vi.waitFor(() =>
      expect(apiMocks.getCacheStatus).toHaveBeenCalledWith({ scope: "all" })
    );
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-cache-size']").text()).toContain(
        "12.0 MB"
      )
    );
    expect(
      wrapper.find("[data-testid='mb-cache-last-cleared']").text()
    ).toContain("Last cleared");
  });

  it("persists toggles through updateBrowserPreferences", async () => {
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(apiMocks.getEffectiveBrowserSettings).toHaveBeenCalled()
    );
    await wrapper
      .find("[data-testid='mb-toggle-browser']")
      .setValue(false as never);
    await vi.waitFor(() =>
      expect(apiMocks.updateBrowserPreferences).toHaveBeenCalledWith({
        browserEnabled: false,
      })
    );
  });

  it("reverts the toggle when persisting fails", async () => {
    apiMocks.updateBrowserPreferences.mockRejectedValueOnce(
      new Error("write failed")
    );
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(apiMocks.getEffectiveBrowserSettings).toHaveBeenCalled()
    );
    await wrapper
      .find("[data-testid='mb-toggle-cache']")
      .setValue(false as never);
    await vi.waitFor(() =>
      expect(apiMocks.updateBrowserPreferences).toHaveBeenCalled()
    );
    // The persisted state is reloaded and the switch model reverts to true.
    // (Asserted on the component prop: Vue's native-input patch quirk keeps
    // a directly-mutated DOM checked attribute stale in jsdom.)
    await vi.waitFor(() => {
      const cacheSwitch = wrapper
        .findAllComponents(VSwitch)
        .find(
          (w) =>
            (w.find("input").element as HTMLInputElement).getAttribute(
              "data-testid"
            ) === "mb-toggle-cache"
        );
      expect(cacheSwitch?.props("modelValue")).toBe(true);
    });
  });

  it("clear uses the two-step confirmation with skip_active", async () => {
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(apiMocks.getCacheStatus).toHaveBeenCalled()
    );
    // Wait until the initial load finished (button enabled) before clicking.
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-cache-size']").text()).toContain(
        "12.0 MB"
      )
    );
    await wrapper.find("[data-testid='mb-btn-clear-all']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.issueClearConfirmation).toHaveBeenCalledWith({
        scope: "all",
      })
    );
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-clear-confirm-dialog']").exists()
      ).toBe(true)
    );
    // The confirmation body shows the size and the preserved-login copy.
    expect(wrapper.text()).toContain("12.0 MB");
    expect(wrapper.text()).toContain("Saved logins are preserved.");

    await wrapper
      .find("[data-testid='mb-btn-clear-confirm-ok']")
      .trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.clearCache).toHaveBeenCalledWith({
        scope: "all",
        activeSessionDecision: "skip_active",
        confirmationId: "conf-1234-abcd",
      })
    );
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-clear-confirm-dialog']").exists()
      ).toBe(false)
    );
  });

  it("shows the disabled note when the effective browser is off", async () => {
    apiMocks.getEffectiveBrowserSettings.mockImplementation(async () => ({
      ...baseSettings,
      browserEnabled: false,
      disabledReasonCode: "user_setting_disabled",
    }));
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-settings-disabled-note']").exists()
      ).toBe(true)
    );
    expect(
      wrapper.find("[data-testid='mb-settings-disabled-note']").text()
    ).toContain("The managed browser is turned off.");
  });
});


// ---------------------------------------------------------------------------
// GAP-09: disabling with an active session requires an explicit decision
// ---------------------------------------------------------------------------

describe("GAP-09 active-session gating on disable", () => {
  it("disables directly when no session is active", async () => {
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(apiMocks.getEffectiveBrowserSettings).toHaveBeenCalled()
    );
    await wrapper
      .find("[data-testid='mb-toggle-browser']")
      .setValue(false as never);
    await vi.waitFor(() =>
      expect(apiMocks.updateBrowserPreferences).toHaveBeenCalledWith({
        browserEnabled: false,
      })
    );
    expect(
      wrapper.find("[data-testid='mb-active-session-dialog']").exists()
    ).toBe(false);
  });

  it("asks finish/stop/cancel when a session is active; cancel restores", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [
      { sessionId: "mb_live0000000001", state: "ready" },
    ]);
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(apiMocks.getEffectiveBrowserSettings).toHaveBeenCalled()
    );
    await wrapper
      .find("[data-testid='mb-toggle-browser']")
      .setValue(false as never);
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-active-session-dialog']").exists()
      ).toBe(true)
    );
    expect(apiMocks.updateBrowserPreferences).not.toHaveBeenCalled();

    await wrapper.find("[data-testid='mb-active-cancel']").trigger("click");
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-active-session-dialog']").exists()
      ).toBe(false)
    );
    expect(apiMocks.updateBrowserPreferences).not.toHaveBeenCalled();
    expect(apiMocks.stopManagedBrowser).not.toHaveBeenCalled();
  });

  it("finish KEEPS the session running and only disables new starts (TODO-MSB-004)", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [
      { sessionId: "mb_live0000000001", state: "handoff" },
    ]);
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(apiMocks.getEffectiveBrowserSettings).toHaveBeenCalled()
    );
    await wrapper
      .find("[data-testid='mb-toggle-browser']")
      .setValue(false as never);
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-active-session-dialog']").exists()
      ).toBe(true)
    );
    await wrapper.find("[data-testid='mb-active-finish']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.updateBrowserPreferences).toHaveBeenCalledWith({
        browserEnabled: false,
      })
    );
    // Finish never terminates the live session.
    expect(apiMocks.stopManagedBrowser).not.toHaveBeenCalled();
  });

  it("stop-now stops with cancelled and persists the disable", async () => {
    apiMocks.listActiveSessions.mockImplementation(async () => [
      { sessionId: "mb_live0000000001", state: "running" },
    ]);
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(apiMocks.getEffectiveBrowserSettings).toHaveBeenCalled()
    );
    await wrapper
      .find("[data-testid='mb-toggle-browser']")
      .setValue(false as never);
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-active-session-dialog']").exists()
      ).toBe(true)
    );
    await wrapper.find("[data-testid='mb-active-stop']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.stopManagedBrowser).toHaveBeenCalledWith(
        "mb_live0000000001",
        "cancelled"
      )
    );
    await vi.waitFor(() =>
      expect(apiMocks.updateBrowserPreferences).toHaveBeenCalledWith({
        browserEnabled: false,
      })
    );
  });
});


describe("TODO-MSB-005 selected-account clear", () => {
  it("the selected account's confirmation id reaches clearCache with the account scope", async () => {
    apiMocks.listEligibleAccounts.mockImplementation(async () => [
      { accountId: 101, platformId: 2, accountLabel: "My Channel" },
    ]);
    apiMocks.issueClearConfirmation.mockImplementation(
      async (input?: { scope?: string }) =>
        input?.scope === "account"
          ? { confirmationId: "conf-acct-001" }
          : { confirmationId: "conf-all-001" }
    );
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(apiMocks.listEligibleAccounts).toHaveBeenCalled()
    );
    // Wait until the account select is populated, then request the clear.
    await vi.waitFor(() =>
      expect(
        (wrapper.find("[data-testid='mb-btn-clear-account']").element as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
    await wrapper.find("[data-testid='mb-btn-clear-account']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.issueClearConfirmation).toHaveBeenCalledWith({
        scope: "account",
        accountId: 101,
      })
    );
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-clear-confirm-dialog']").exists()
      ).toBe(true)
    );
    await wrapper
      .find("[data-testid='mb-btn-clear-confirm-ok']")
      .trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.clearCache).toHaveBeenCalledWith({
        scope: "account",
        accountId: 101,
        activeSessionDecision: "defer",
        confirmationId: "conf-acct-001",
      })
    );
  });

  it("offers stop-and-clear when the selected account's session is live", async () => {
    apiMocks.listEligibleAccounts.mockImplementation(async () => [
      { accountId: 101, platformId: 2, accountLabel: "My Channel" },
    ]);
    apiMocks.listActiveSessions.mockImplementation(async () => [
      { sessionId: "mb_live0000000001", accountId: 101, state: "ready" },
    ]);
    apiMocks.issueClearConfirmation.mockImplementation(async () => ({
      confirmationId: "conf-acct-002",
    }));
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(
        (wrapper.find("[data-testid='mb-btn-clear-account']").element as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
    await wrapper.find("[data-testid='mb-btn-clear-account']").trigger("click");
    await vi.waitFor(() =>
      expect(
        wrapper.find("[data-testid='mb-clear-active-choice']").exists()
      ).toBe(true)
    );
    await wrapper.find("[data-testid='mb-clear-choice-stop']").trigger("click");
    await wrapper
      .find("[data-testid='mb-btn-clear-confirm-ok']")
      .trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.clearCache).toHaveBeenCalledWith({
        scope: "account",
        accountId: 101,
        activeSessionDecision: "stop_and_clear",
        confirmationId: "conf-acct-002",
      })
    );
  });
});
