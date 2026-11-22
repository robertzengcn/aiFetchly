import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N08/Q-01: the per-account AI opt-in in the account editor — loading
 * NEVER writes, the ONLY write path is the user's checkbox toggle, a
 * failed write rolls back without a second write, and the checkbox is
 * inert until the initial read finishes.
 */

const invokeMock = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({ id: "77" }));

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: routeParams, go: vi.fn() }),
  useRouter: () => ({ go: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/views/api/socialaccount", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/views/api/socialaccount")
  >();
  return {
    ...original,
    getSocialaccountinfo: vi.fn(async () => ({
      id: 77,
      user: "someone",
      pass: "",
      status: 1,
      name: "someone",
      social_type_id: 2,
    })),
    saveSocialAccount: vi.fn(async () => ({ id: 77 })),
    getSocialAccountAiUseEnabled: vi.fn(async () => true),
    setSocialAccountAiUseEnabled: vi.fn(async () => undefined),
    listBrowserSites: vi.fn(async () => [
      { id: 2, name: "YouTube", registrableDomain: "youtube.com" },
    ]),
    requireCookiesselecttab: vi.fn(async () => undefined),
    receiveAccountLoginevent: vi.fn(() => () => undefined),
    receiveBrowserImportEvent: vi.fn(() => () => undefined),
    getBrowserImportAvailability: vi.fn(async () => ({ enabled: false })),
    startBrowserImportPairing: vi.fn(async () => ({
      requestId: "r",
      expiresAtMs: 0,
      approvedDomains: [],
      verificationUrl: "",
    })),
    cancelBrowserImport: vi.fn(async () => ({ cancelled: true })),
    getSessionMetadata: vi.fn(async () => ({
      hasCookies: false,
      cookieCount: 0,
      lastUpdatedAt: null,
      importSource: null,
      sessionStatus: "missing",
    })),
  };
});

vi.mock("@/config/generate", () => ({
  SocialPlatformList: [
    { id: 2, name: "YouTube", category: "video", url: "https://youtube.com" },
  ],
}));

vi.mock("@/views/api/managedBrowser", () => ({
  startManagedBrowser: vi.fn(async () => ({ sessionId: "mb_x" })),
  listActiveSessions: vi.fn(async () => []),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      socialaccount: {
        col_id: "ID",
        user: "Username",
        user_hint: "",
        pass: "Password",
        pass_hint: "",
        ai_use_enabled: "AI may use this account",
        ai_use_enabled_hint: "Lets automated browser sign-ins reuse the saved credential.",
        ai_use_failed: "Could not update the AI opt-in",
        form_not_valid: "invalid",
        save_success: "saved",
        save_fail: "failed",
        inactive: "Inactive",
        active: "Active",
        session_proxy_default: "Account default",
        session_proxy_direct: "Direct (no proxy)",
        open_managed_browser_failed: "Opening the managed browser failed. Check the proxy settings and try again.",
      },
      common: {
        status: "Status",
        optional: "optional",
        cancel: "Cancel",
        save: "Save",
        submit: "Submit",
      },
      route: {
        edit_tool_account: "Edit account",
        add_tool_account: "Add account",
        tool_account_list: "Accounts",
      },
    },
  },
});

import SocialAccountDetailPage from "@/views/pages/socialaccount/socialaccountdetail.vue";
import {
  getSocialAccountAiUseEnabled,
  setSocialAccountAiUseEnabled,
} from "@/views/api/socialaccount";

function mountPage() {
  return mount(SocialAccountDetailPage, {
    global: {
      plugins: [i18n],
      stubs: {
        // Vuetify is not installed in the component suite — the checks
        // below assert on the resolved view model, not Vuetify internals.
        "v-sheet": { template: "<div><slot /></div>" },
        "v-form": { template: "<form><slot /></form>", methods: { validate: () => ({ valid: true }) } },
        "v-text-field": { template: "<input />" },
        "v-label": { template: "<label><slot /></label>" },
        "v-btn-toggle": { template: "<div><slot /></div>" },
        "v-btn": { template: "<button><slot /></button>" },
        "v-autocomplete": { template: "<select />" },
        "v-checkbox": {
          template:
            "<input type='checkbox' :checked='modelValue' :disabled='disabled' @change=\"$emit('update:model-value', $event.target.checked)\" />",
          props: ["modelValue", "label", "disabled"],
          emits: ["update:model-value"],
        },
        "v-alert": { template: "<div><slot /></div>" },
        "v-icon": { template: "<i />" },
        "v-divider": { template: "<hr />" },
        "v-row": { template: "<div><slot /></div>" },
        "v-col": { template: "<div><slot /></div>" },
        "v-card": { template: "<div><slot /></div>" },
        "v-card-title": { template: "<div><slot /></div>" },
        "v-card-text": { template: "<div><slot /></div>" },
        "v-card-actions": { template: "<div><slot /></div>" },
        "v-dialog": { template: "<div><slot /></div>" },
        "v-progress-linear": { template: "<div />" },
        AppPageShell: {
          template: "<div><slot name='context' /><slot /></div>",
          props: ["pageId", "titleKey", "contentWidth"],
        },
      },
    },
  });
}

describe("SocialAccountDetailPage AI opt-in (N08/Q-01)", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    routeParams.id = "77";
    vi.clearAllMocks();
  });

  it("loading an enabled account does NOT write (the read is not a toggle)", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(getSocialAccountAiUseEnabled).toHaveBeenCalledWith(77);
    expect(setSocialAccountAiUseEnabled).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("the user's checkbox toggle writes exactly once", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const checkbox = wrapper.find(
      "[data-testid='socialaccount-ai-optin-checkbox']"
    );
    expect(checkbox.exists()).toBe(true);
    // The initial value is loaded true; toggling OFF writes false once.
    await checkbox.setValue(false);
    await flushPromises();
    expect(setSocialAccountAiUseEnabled).toHaveBeenCalledTimes(1);
    expect(setSocialAccountAiUseEnabled).toHaveBeenCalledWith(77, false);
    wrapper.unmount();
  });

  it("two successful toggles in each direction each write and update the ref", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const checkbox = wrapper.find(
      "[data-testid='socialaccount-ai-optin-checkbox']"
    );
    // true → false (writes false, ref updated).
    await checkbox.setValue(false);
    await flushPromises();
    expect(setSocialAccountAiUseEnabled).toHaveBeenCalledWith(77, false);
    // false → true (writes true, ref updated — the dropped-toggle bug).
    await checkbox.setValue(true);
    await flushPromises();
    expect(setSocialAccountAiUseEnabled).toHaveBeenCalledWith(77, true);
    expect(setSocialAccountAiUseEnabled).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("a FAILED opt-in load keeps the checkbox inert and offers a retry (R08/Q-01)", async () => {
    vi.mocked(getSocialAccountAiUseEnabled).mockRejectedValueOnce(
      new Error("storage unavailable")
    );
    const wrapper = mountPage();
    await flushPromises();
    // The failed read is NOT a confirmed disabled state: the checkbox
    // stays disabled (inert) and the load error + retry are shown.
    const checkbox = wrapper.find(
      "[data-testid='socialaccount-ai-optin-checkbox']"
    );
    expect(checkbox.attributes("disabled")).toBeDefined();
    const loadError = wrapper.find(
      "[data-testid='socialaccount-ai-optin-load-error']"
    );
    expect(loadError.exists()).toBe(true);
    expect(loadError.text()).toBe("storage unavailable");
    expect(
      wrapper.find("[data-testid='socialaccount-ai-optin-retry']").exists()
    ).toBe(true);
    expect(setSocialAccountAiUseEnabled).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("the explicit retry performs a read and unlocks editing on success (R08/Q-01)", async () => {
    vi.mocked(getSocialAccountAiUseEnabled)
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce(true);
    const wrapper = mountPage();
    await flushPromises();
    const retry = wrapper.find("[data-testid='socialaccount-ai-optin-retry']");
    expect(retry.exists()).toBe(true);
    await retry.trigger("click");
    await flushPromises();
    // The retry READ (never writes) and a success unlocks editing with
    // the loaded value; the load error clears.
    expect(getSocialAccountAiUseEnabled).toHaveBeenCalledTimes(2);
    expect(setSocialAccountAiUseEnabled).not.toHaveBeenCalled();
    expect(
      wrapper.find("[data-testid='socialaccount-ai-optin-load-error']").exists()
    ).toBe(false);
    const checkbox = wrapper.find(
      "[data-testid='socialaccount-ai-optin-checkbox']"
    );
    expect(checkbox.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("a failed write rolls back without scheduling a second write", async () => {
    vi.mocked(setSocialAccountAiUseEnabled).mockRejectedValueOnce(
      new Error("storage unavailable")
    );
    const wrapper = mountPage();
    await flushPromises();
    const checkbox = wrapper.find(
      "[data-testid='socialaccount-ai-optin-checkbox']"
    );
    await checkbox.setValue(false);
    await flushPromises();
    // Exactly ONE write attempt; the rollback reassigns the ref (no write).
    expect(setSocialAccountAiUseEnabled).toHaveBeenCalledTimes(1);
    const error = wrapper.find("[data-testid='socialaccount-ai-optin-error']");
    expect(error.exists()).toBe(true);
    expect(error.text()).toBe("storage unavailable");
    wrapper.unmount();
  });
});

// ---------------------------------------------------------------------------
// P05/P-FR-01: the session proxy route — the saved-proxy list actually
// LOADS (the schema-valid paging shape), the explicit/direct options are
// translated, and a failed managed-browser start is VISIBLE.
// ---------------------------------------------------------------------------
const proxyApiMock = vi.hoisted(() => ({
  getProxyList: vi.fn(async (_arg?: Record<string, unknown>) => ({
    data: [
      { id: 11, host: "proxy-one.example", port: 8080 },
      { id: 12, host: "proxy-two.example", port: 3128 },
    ],
    total: 2,
  })),
}));
vi.mock("@/views/api/proxy", () => proxyApiMock);

describe("SocialAccountDetailPage session proxy route (P05)", () => {
  beforeEach(() => {
    proxyApiMock.getProxyList.mockClear();
    proxyApiMock.getProxyList.mockImplementation(async () => ({
      data: [
        { id: 11, host: "proxy-one.example", port: 8080 },
        { id: 12, host: "proxy-two.example", port: 3128 },
      ],
      total: 2,
    }));
  });

  it("loads the saved proxies with the SCHEMA-VALID paging shape", async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(proxyApiMock.getProxyList).toHaveBeenCalled();
    const arg = (proxyApiMock.getProxyList.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >)[0]?.[0] as Record<string, unknown>;
    // The strict pagination schema accepts `size` — a `limit` key failed
    // the parse and silently emptied the list.
    expect(arg).toMatchObject({ page: 1, size: 50 });
    expect(arg).not.toHaveProperty("limit");
    // Both saved proxies reached the selection state (the option list is
    // built from it).
    const state = (
      wrapper.vm as unknown as {
        $: { setupState: { savedProxies: Array<{ id: number; label: string }> } };
      }
    ).$.setupState;
    expect(state.savedProxies.map((p) => p.id)).toEqual([11, 12]);
    wrapper.unmount();
  });

  it("the translated explicit and direct options resolve (no raw keys)", async () => {
    const wrapper = mountPage();
    await flushPromises();
    const state = (
      wrapper.vm as unknown as {
        $: { setupState: { sessionProxyChoice: string } };
      }
    ).$.setupState;
    // The default choice is the account default (setupState unwraps
    // template refs).
    expect(state.sessionProxyChoice).toBe("default");
    const html = wrapper.html();
    // The raw i18n keys never leak into the markup.
    expect(html).not.toContain("socialaccount.session_proxy_default");
    expect(html).not.toContain("socialaccount.session_proxy_direct");
    wrapper.unmount();
  });

  it("a failed managed-browser start shows a VISIBLE error alert", async () => {
    const { startManagedBrowser } = await import("@/views/api/managedBrowser");
    (startManagedBrowser as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        throw new Error("proxy_check_failed");
      }
    );
    const wrapper = mountPage();
    await flushPromises();
    const openButton = wrapper.find("[data-testid='open-managed-browser']");
    expect(openButton.exists()).toBe(true);
    await openButton.trigger("click");
    await flushPromises();
    // The v-alert stub always renders a plain div — the VISIBLE failure
    // is the alert CONTENT after the failed click.
    expect(wrapper.html()).toContain(
      "Opening the managed browser failed"
    );
    wrapper.unmount();
  });
});
