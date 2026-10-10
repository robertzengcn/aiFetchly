import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import AboutPage from "@/views/pages/systemsetting/about.vue";
import { AIFETCHLY_WEBSITE_URL } from "@/config/appInfo";
import type { AppInfo } from "@/entityTypes/appInfo-type";
import type { UpdateStatusSnapshot } from "@/entityTypes/updateStatus-type";

const appApiMocks = vi.hoisted(() => ({
  getAppInfoMock: vi.fn(),
  getUpdateStatusMock: vi.fn(),
  checkForUpdatesMock: vi.fn(),
  installUpdateMock: vi.fn(),
  onUpdateStatusMock: vi.fn(),
  offUpdateStatusMock: vi.fn(),
}));

vi.mock("@/views/api/app", () => ({
  getAppInfo: (...args: unknown[]) => appApiMocks.getAppInfoMock(...args),
  openWebsite: vi.fn(),
  getUpdateStatus: (...args: unknown[]) =>
    appApiMocks.getUpdateStatusMock(...args),
  checkForUpdates: (...args: unknown[]) =>
    appApiMocks.checkForUpdatesMock(...args),
  installUpdate: (...args: unknown[]) =>
    appApiMocks.installUpdateMock(...args),
  onUpdateStatus: (...args: unknown[]) =>
    appApiMocks.onUpdateStatusMock(...args),
  offUpdateStatus: (...args: unknown[]) =>
    appApiMocks.offUpdateStatusMock(...args),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: {} },
});

const stubs = {
  VContainer: { template: "<div><slot /></div>" },
  VCard: { template: "<div><slot /></div>" },
  VCardTitle: { template: "<div><slot /></div>" },
  VCardText: { template: "<div><slot /></div>" },
  VDivider: true,
  VRow: { template: "<div><slot /></div>" },
  VCol: { template: "<div><slot /></div>" },
  VBtn: { template: "<button><slot /></button>" },
  VIcon: true,
  VChip: { template: "<span><slot /></span>" },
  VProgressCircular: true,
  VSnackbar: { template: "<div><slot /></div>" },
};

const APP_INFO: AppInfo = {
  name: "ai-fetchly",
  version: "1.2.3",
  description: "test",
  author: "test",
};

const UPDATE_IDLE: UpdateStatusSnapshot = {
  state: "idle",
  currentVersion: "1.2.3",
};

function mountAboutPage() {
  return mount(AboutPage, {
    global: { plugins: [i18n], stubs },
  });
}

describe("AboutPage website URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("displays the website URL from VITE_LOGIN_URL (.env)", async () => {
    vi.stubEnv("VITE_LOGIN_URL", "https://about-test.example.com");
    appApiMocks.getAppInfoMock.mockResolvedValue(APP_INFO);
    appApiMocks.getUpdateStatusMock.mockResolvedValue(UPDATE_IDLE);
    appApiMocks.onUpdateStatusMock.mockImplementation(() => vi.fn());

    const wrapper = mountAboutPage();
    await flushPromises();

    expect(wrapper.text()).toContain("https://about-test.example.com");
    wrapper.unmount();
  });

  it("falls back to the default website when VITE_LOGIN_URL is empty", async () => {
    vi.stubEnv("VITE_LOGIN_URL", "");
    appApiMocks.getAppInfoMock.mockResolvedValue(APP_INFO);
    appApiMocks.getUpdateStatusMock.mockResolvedValue(UPDATE_IDLE);
    appApiMocks.onUpdateStatusMock.mockImplementation(() => vi.fn());

    const wrapper = mountAboutPage();
    await flushPromises();

    expect(wrapper.text()).toContain(AIFETCHLY_WEBSITE_URL);
    wrapper.unmount();
  });
});
