import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createI18n } from "vue-i18n";

const getloginUserInfoMock = vi.fn();
const signoutMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@/views/api/users", () => ({
  GetloginUserInfo: (...args: unknown[]) => getloginUserInfoMock(...args),
  Signout: (...args: unknown[]) => signoutMock(...args),
}));

vi.mock("@/views/utils/ipcTransport", () => ({
  getIpcTransport: () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
    receive: vi.fn(),
    removeListener: vi.fn(),
  }),
}));

import AccountMenu from "@/views/components/appShell/AccountMenu.vue";
import { USER_OPEN_PRICING_PLAN } from "@/config/channellist";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      layout: {
        upgrade_plan: "Upgrade",
        system_setting: "System Setting",
        login_out: "Login Out",
      },
    },
  },
});

async function mountMenu() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/systemsetting/index", component: { template: "<div />" } },
      { path: "/login", component: { template: "<div />" } },
    ],
  });
  const wrapper = mount(AccountMenu, {
    global: {
      plugins: [i18n, router],
      stubs: {
        "v-menu": {
          template: '<div><slot name="activator" /><slot /></div>',
        },
        "v-list": { template: "<div><slot /></div>" },
        "v-list-item": {
          template:
            '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
          emits: ["click"],
        },
        "v-avatar": { template: "<div><slot /></div>" },
        "v-icon": true,
      },
    },
  });
  await router.isReady();
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.clearAllMocks();
  getloginUserInfoMock.mockResolvedValue({
    name: "Test User",
    email: "t@example.com",
    plans: [],
  });
  signoutMock.mockResolvedValue(undefined);
  invokeMock.mockResolvedValue({ status: true, msg: "", data: null });
});

describe("AccountMenu (shell footer account zone)", () => {
  it("renders the user email after loading user info", async () => {
    const { wrapper } = await mountMenu();
    expect(getloginUserInfoMock).toHaveBeenCalled();
    expect(
      wrapper.get('[data-testid="account-menu-activator"]').text()
    ).toContain("t@example.com");
  });

  it("shows the plan label without an upgrade row for a paid plan", async () => {
    getloginUserInfoMock.mockResolvedValue({
      name: "Test User",
      email: "t@example.com",
      plans: [{ planName: "Plus", planId: "PLUS", status: "active" }],
    });
    const { wrapper } = await mountMenu();
    expect(wrapper.find('[data-testid="account-plan"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="account-upgrade"]').exists()).toBe(
      false
    );
  });

  it("shows upgrade for a free plan and opens pricing on click", async () => {
    getloginUserInfoMock.mockResolvedValue({
      name: "Test User",
      email: "t@example.com",
      plans: [{ planName: "Community", status: "active" }],
    });
    const { wrapper } = await mountMenu();
    const upgrade = wrapper.get('[data-testid="account-upgrade"]');
    await upgrade.trigger("click");
    expect(invokeMock).toHaveBeenCalledWith(USER_OPEN_PRICING_PLAN);
  });

  it("navigates to system settings on settings click", async () => {
    const { wrapper, router } = await mountMenu();
    await wrapper.get('[data-testid="account-settings"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/systemsetting/index");
  });

  it("signs out and navigates to login on sign-out click", async () => {
    const { wrapper, router } = await mountMenu();
    await wrapper.get('[data-testid="account-signout"]').trigger("click");
    await flushPromises();
    expect(signoutMock).toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/login");
  });
});
