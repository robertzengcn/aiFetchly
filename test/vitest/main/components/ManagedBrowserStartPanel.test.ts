import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, nextTick } from "vue";
import ManagedBrowserStartPanel from "@/views/components/aiChatV2/ManagedBrowserStartPanel.vue";

/**
 * ManagedBrowserStartPanel (GAP-07): the saved-account selection + start
 * flow. Renders only when NO session is active; requires an account and a
 * purpose; start goes through an explicit confirmation dialog.
 */

const apiMocks = vi.hoisted(() => ({
  listEligibleAccounts: vi.fn(async (): Promise<unknown[]> => []),
  listActiveSessions: vi.fn(async (): Promise<unknown[]> => []),
  onManagedBrowserStatusChanged: vi.fn(
    (_cb: (s: unknown) => void): (() => void) => () => undefined
  ),
  startManagedBrowser: vi.fn(async (): Promise<unknown> => ({
    sessionId: "mb_new0000000001",
  })),
}));
vi.mock("@/views/api/managedBrowser", () => apiMocks);

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { cancel: "Cancel" },
      managedBrowser: {
        platform_fallback: "Social",
        start: {
          title: "Start managed browser",
          empty: "No eligible social accounts yet.",
          account_label: "Account",
          purpose_placeholder: "What should the browser do?",
          start: "Start browser",
          confirm_title: "Start managed browser?",
          confirm_body: "A window will open for {account}.",
        },
      },
    },
  },
});

const VBtn = defineComponent({
  props: { disabled: { type: Boolean, default: false } },
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
const VCard = { template: "<div><slot /></div>" };
const VCardTitle = { template: "<div><slot /></div>" };
const VCardText = { template: "<div><slot /></div>" };
const VCardActions = { template: "<div><slot /></div>" };
const VIcon = { template: "<i><slot /></i>" };
const VSpacer = { template: "<span />" };

function mountPanel() {
  return mount(ManagedBrowserStartPanel, {
    global: {
      plugins: [i18n],
      stubs: {
        "v-btn": VBtn,
        "v-dialog": VDialog,
        "v-card": VCard,
        "v-card-title": VCardTitle,
        "v-card-text": VCardText,
        "v-card-actions": VCardActions,
        "v-icon": VIcon,
        "v-spacer": VSpacer,
      },
    },
  });
}

function lastCall(
  mock: ReturnType<typeof vi.fn>
): (payload: unknown) => void {
  return mock.mock.calls[mock.mock.calls.length - 1][0] as (
    payload: unknown
  ) => void;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listActiveSessions.mockImplementation(async () => []);
  apiMocks.listEligibleAccounts.mockImplementation(async () => [
    { accountId: 101, platformId: 2, accountLabel: "My Channel" },
    { accountId: 102, platformId: 2, accountLabel: "Second Channel" },
  ]);
});

describe("ManagedBrowserStartPanel (GAP-07)", () => {
  it("renders the eligible accounts with safe labels and hides when a session is active", async () => {
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-start-panel']").exists()).toBe(
        true
      )
    );
    const select = wrapper.find("[data-testid='mb-start-account-select']");
    await vi.waitFor(() => {
      const options = (select.element as HTMLSelectElement).options;
      expect(options.length).toBe(2);
    });
    expect(
      (select.element as HTMLSelectElement).options[0].textContent
    ).toContain("My Channel");

    // A live session hides the start panel (the session card owns that state).
    apiMocks.listActiveSessions.mockImplementation(async () => [
      { sessionId: "mb_live0000000001", state: "ready" },
    ]);
    lastCall(apiMocks.onManagedBrowserStatusChanged)({ state: "ready" });
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-start-panel']").exists()).toBe(
        false
      )
    );
  });

  it("shows the empty state when no eligible accounts exist", async () => {
    apiMocks.listEligibleAccounts.mockImplementation(async () => []);
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-start-empty']").exists()).toBe(
        true
      )
    );
  });

  it("requires a purpose before start is enabled", async () => {
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-start-confirm']").exists()).toBe(
        true
      )
    );
    expect(
      (wrapper.find("[data-testid='mb-start-confirm']").element as HTMLButtonElement)
        .disabled
    ).toBe(true);
    await wrapper.find("[data-testid='mb-start-purpose']").setValue("check comments");
    expect(
      (wrapper.find("[data-testid='mb-start-confirm']").element as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("starts through the confirmation dialog with the selected account", async () => {
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-start-confirm']").exists()).toBe(
        true
      )
    );
    await wrapper.find("[data-testid='mb-start-purpose']").setValue("check comments");
    (
      wrapper.find("[data-testid='mb-start-account-select']").element as HTMLSelectElement
    ).value = "102";
    await wrapper
      .find("[data-testid='mb-start-account-select']")
      .setValue("102");
    await wrapper.find("[data-testid='mb-start-confirm']").trigger("click");
    await nextTick();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-start-dialog']").exists()).toBe(
        true
      )
    );
    expect(wrapper.text()).toContain("Second Channel");
    await wrapper.find("[data-testid='mb-start-dialog-ok']").trigger("click");
    await vi.waitFor(() =>
      expect(apiMocks.startManagedBrowser).toHaveBeenCalledWith({
        accountId: 102,
        purpose: "check comments",
      })
    );
  });

  it("surfaces safe error codes when the start is rejected", async () => {
    apiMocks.startManagedBrowser.mockRejectedValueOnce(
      new Error("account_in_use")
    );
    const wrapper = mountPanel();
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-start-confirm']").exists()).toBe(
        true
      )
    );
    await wrapper.find("[data-testid='mb-start-purpose']").setValue("x");
    await wrapper.find("[data-testid='mb-start-confirm']").trigger("click");
    await nextTick();
    await wrapper.find("[data-testid='mb-start-dialog-ok']").trigger("click");
    await vi.waitFor(() =>
      expect(wrapper.find("[data-testid='mb-start-error']").text()).toContain(
        "account_in_use"
      )
    );
  });
});
