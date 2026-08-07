import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SystemSettingDisplay,
  SystemSettingGroupDisplay,
} from "@/entityTypes/systemsettingType";
import SystemSettingPage from "@/views/pages/systemsetting/index.vue";
import { getSystemSettinglist } from "@/views/api/systemsetting";

vi.mock("@/views/api/systemsetting", () => ({
  getSystemSettinglist: vi.fn(),
  updateSystemSetting: vi.fn(),
  updateSystemSettingWithValidation: vi.fn(),
}));

vi.mock("@/views/api/language", () => ({
  updateLanguagePreference: vi.fn(),
}));

vi.mock("@/views/api/common", () => ({
  chooseFileDialog: vi.fn(),
}));

const routerPush = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPush,
  }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      system_settings: {
        title: "System Settings",
      },
    },
  },
});

const vuetifySlotStubs = [
  "VContainer",
  "VRow",
  "VCol",
  "VCard",
  "VCardTitle",
  "VCardText",
  "VList",
  "VListItem",
  "VListItemContent",
  "VListItemTitle",
  "VListItemSubtitle",
  "VRadioGroup",
  "VAlert",
];

const globalStubs = Object.fromEntries(
  vuetifySlotStubs.map((name) => [name, { template: "<div><slot /></div>" }])
);

function makeSetting(
  id: number,
  key: string,
  type: SystemSettingDisplay["type"] = "input"
): SystemSettingDisplay {
  return {
    id,
    key,
    value: "",
    description: `${key}-description`,
    type,
  };
}

function makeGroupsWithCollidingIds(): SystemSettingGroupDisplay[] {
  return [
    {
      id: 1,
      name: "2captcha-group",
      description: "2captcha-description",
      items: [
        makeSetting(2, "2captcha-token"),
        makeSetting(3, "2captcha-enabled", "toggle"),
      ],
    },
    {
      id: 2,
      name: "embedding_group",
      description: "embedding_group_description",
      items: [makeSetting(4, "default_embedding_model", "select")],
    },
    {
      id: 3,
      name: "external_system",
      description: "external-system-group-description",
      items: [makeSetting(5, "chrome_path", "file")],
    },
  ];
}

function mountPage() {
  return mount(SystemSettingPage, {
    global: {
      plugins: [i18n],
      stubs: {
        ...globalStubs,
        VTreeview: true,
        VDivider: true,
        VBtn: { template: "<button><slot /></button>" },
        VIcon: true,
        VTextField: true,
        VSelect: true,
        VRadio: true,
        VCheckbox: true,
        VSwitch: true,
        VTextarea: true,
        DiagnosticsSection: true,
      },
    },
  });
}

interface SystemSettingPageVm {
  activeGroups: string[];
  groupItems: Array<{
    id: string;
    children?: Array<{ id: string }>;
  }>;
  selectedGroup: SystemSettingGroupDisplay | null;
  settinglist: SystemSettingDisplay[];
}

describe("SystemSettingPage tree selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSystemSettinglist).mockResolvedValue(
      makeGroupsWithCollidingIds()
    );
  });

  it("keeps group and setting tree values distinct when database IDs collide", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const vm = wrapper.vm as unknown as SystemSettingPageVm;

    expect(vm.groupItems[0].children?.[0].id).toBe("setting:2");
    expect(vm.groupItems[1].id).toBe("group:2");
    expect(vm.groupItems[2].id).toBe("group:3");
  });

  it("selects the clicked group instead of a setting with the same numeric ID", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const vm = wrapper.vm as unknown as SystemSettingPageVm;

    vm.activeGroups = ["group:2"];
    await flushPromises();

    expect(vm.selectedGroup?.name).toBe("embedding_group");
    expect(vm.settinglist.map((setting) => setting.key)).toEqual([
      "default_embedding_model",
    ]);

    vm.activeGroups = ["group:3"];
    await flushPromises();

    expect(vm.selectedGroup?.name).toBe("external_system");
    expect(vm.settinglist.map((setting) => setting.key)).toEqual([
      "chrome_path",
    ]);
  });
});
