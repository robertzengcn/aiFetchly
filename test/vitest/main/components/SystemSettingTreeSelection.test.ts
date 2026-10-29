import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SystemSettingDisplay,
  SystemSettingGroupDisplay,
} from "@/entityTypes/systemsettingType";
import SystemSettingPage from "@/views/pages/systemsetting/index.vue";
import {
  getSystemSettinglist,
  updateSystemSetting,
  updateSystemSettingWithValidation,
} from "@/views/api/systemsetting";

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
        ui_font_scale_decrease: "Decrease font size",
        ui_font_scale_increase: "Increase font size",
        ui_font_scale_reset: "Reset",
        ui_font_scale_smaller: "Smaller",
        ui_font_scale_default: "Default",
        ui_font_scale_larger: "Larger",
        ui_font_scale_large: "Large",
        ui_font_scale_largest: "Largest",
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
        VSelect: {
          name: "VSelect",
          props: ["items", "value", "variant", "density", "itemTitle", "itemValue", "loading"],
          template: "<div class='vselect-stub'></div>",
        },
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

describe("SystemSettingPage layout width", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSystemSettinglist).mockResolvedValue(
      makeGroupsWithCollidingIds()
    );
  });

  it("renders at full page width so the left tree-nav column is not squeezed", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const shell = wrapper.find('[data-testid="app-page-shell"]');
    expect(shell.exists()).toBe(true);
    // Two-column master-detail layout must use the full-width contract.
    // The 700px `width-form` contract squeezes the 3/12 nav column below
    // its minimum, clipping the tree labels and nav buttons.
    expect(shell.classes()).toContain("width-full");
    expect(shell.classes()).not.toContain("width-form");
  });
});

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

/**
 * Regression: the Language switch rendered only the raw stored value and
 * offered "No data available" when clicked. Two causes — the options never
 * reached the select as usable items, and the select mapped object items
 * without item-title/item-value (so even loaded options rendered blank and
 * selecting wrote the whole object instead of the value string).
 */
describe("SystemSettingPage language select", () => {
  function makeGroupWithLanguageSelect(): SystemSettingGroupDisplay[] {
    return [
      {
        id: 5,
        name: "user_preferences",
        description: "user-preferences-group-description",
        items: [
          {
            id: 50,
            key: "language_preference",
            value: "en",
            description: "language-preference-description",
            type: "select",
            options: [
              { id: 1, optionValue: "en", optionLabel: "English" },
              { id: 2, optionValue: "zh", optionLabel: "中文" },
              { id: 3, optionValue: "es", optionLabel: "Español" },
              { id: 4, optionValue: "fr", optionLabel: "Français" },
              { id: 5, optionValue: "de", optionLabel: "Deutsch" },
              { id: 6, optionValue: "ja", optionLabel: "日本語" },
            ],
          },
        ],
      },
    ];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSystemSettinglist).mockResolvedValue(
      makeGroupWithLanguageSelect()
    );
  });

  it("maps option objects to their label/value fields", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const vm = wrapper.vm as unknown as SystemSettingPageVm;
    vm.activeGroups = ["group:5"];
    await flushPromises();

    const vselect = wrapper.findComponent({ name: "VSelect" });
    expect(vselect.exists()).toBe(true);
    expect(vselect.props("itemTitle")).toBe("optionLabel");
    expect(vselect.props("itemValue")).toBe("optionValue");
    expect(vselect.props("items")).toHaveLength(6);
    expect(vselect.props("items")[0]).toEqual({
      id: 1,
      optionValue: "en",
      optionLabel: "English",
    });
  });

  it("persists the chosen value string, not the option object", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const vm = wrapper.vm as unknown as SystemSettingPageVm;
    vm.activeGroups = ["group:5"];
    await flushPromises();

    const vselect = wrapper.findComponent({ name: "VSelect" });
    vselect.vm.$emit("update:model-value", "zh");
    await flushPromises();

    expect(vi.mocked(updateSystemSettingWithValidation)).toHaveBeenCalledWith(
      50,
      "zh",
      "language_preference"
    );
    // The legacy defect emitted the whole option object into the save path.
    expect(vi.mocked(updateSystemSetting)).not.toHaveBeenCalled();
  });
});

describe("SystemSettingPage font scale stepper", () => {
  function fontScaleGroup(value: string): SystemSettingGroupDisplay[] {
    return [
      {
        id: 5,
        name: "user_preferences",
        description: "user-preferences-group-description",
        items: [
          {
            id: 51,
            key: "ui_font_scale",
            value,
            description: "ui-font-scale-description",
            type: "stepper",
          },
        ],
      },
    ];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.style.fontSize = "";
    document.documentElement.style.removeProperty("--app-font-scale");
    vi.mocked(getSystemSettinglist).mockResolvedValue(fontScaleGroup("1"));
    vi.mocked(updateSystemSetting).mockResolvedValue(true);
  });

  async function mountFontScale(): Promise<ReturnType<typeof mountPage>> {
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as SystemSettingPageVm;
    vm.activeGroups = ["group:5"];
    await flushPromises();
    return wrapper;
  }

  it("saves the next larger step and applies it to the document", async () => {
    const wrapper = await mountFontScale();

    expect(wrapper.get("[data-testid='ui-font-scale-label']").text()).toBe(
      "Default"
    );
    await wrapper.get("[aria-label='Increase font size']").trigger("click");
    await flushPromises();

    expect(vi.mocked(updateSystemSetting)).toHaveBeenCalledWith(51, "1.125");
    expect(wrapper.get("[data-testid='ui-font-scale-label']").text()).toBe(
      "Larger"
    );
    expect(document.documentElement.style.getPropertyValue("--app-font-scale")).toBe(
      "1.125"
    );
    expect(document.documentElement.style.fontSize).toBe("18px");
    expect(localStorage.getItem("aifetchly.ui_font_scale")).toBe("1.125");
  });

  it("does not save when decrease is already at the smallest step", async () => {
    vi.mocked(getSystemSettinglist).mockResolvedValue(fontScaleGroup("0.875"));
    const wrapper = await mountFontScale();

    const decrease = wrapper.get("[aria-label='Decrease font size']");
    expect(decrease.attributes("disabled")).toBeDefined();
    await decrease.trigger("click");
    await flushPromises();

    expect(vi.mocked(updateSystemSetting)).not.toHaveBeenCalled();
    expect(localStorage.getItem("aifetchly.ui_font_scale")).toBeNull();
  });

  it("resets a larger size back to the default step", async () => {
    vi.mocked(getSystemSettinglist).mockResolvedValue(fontScaleGroup("1.25"));
    const wrapper = await mountFontScale();

    await wrapper.get("[aria-label='Reset']").trigger("click");
    await flushPromises();

    expect(vi.mocked(updateSystemSetting)).toHaveBeenCalledWith(51, "1");
    expect(wrapper.get("[data-testid='ui-font-scale-label']").text()).toBe(
      "Default"
    );
    expect(document.documentElement.style.fontSize).toBe("16px");
  });

  it("keeps the current size when the save fails", async () => {
    vi.mocked(updateSystemSetting).mockRejectedValueOnce(new Error("save failed"));
    const wrapper = await mountFontScale();

    await wrapper.get("[aria-label='Increase font size']").trigger("click");
    await flushPromises();

    expect(wrapper.get("[data-testid='ui-font-scale-label']").text()).toBe(
      "Default"
    );
    expect(localStorage.getItem("aifetchly.ui_font_scale")).toBeNull();
  });
});
