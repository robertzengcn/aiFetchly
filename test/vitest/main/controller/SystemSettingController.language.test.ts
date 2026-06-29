import { beforeEach, describe, expect, it, vi } from "vitest";
import { language_preference, user_preferences } from "@/config/settinggroupInit";
import type { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity";

const mocks = vi.hoisted(() => ({
  groupEnsureConnection: vi.fn(),
  settingEnsureConnection: vi.fn(),
  optionEnsureConnection: vi.fn(),
  listall: vi.fn(),
  tableInit: vi.fn(),
  updateSystemSetting: vi.fn(),
  findOptionBySetting: vi.fn(),
}));

vi.mock("@/modules/SystemSettingGroupModule", () => ({
  SystemSettingGroupModule: vi.fn().mockImplementation(() => ({
    ensureConnection: mocks.groupEnsureConnection,
    listall: mocks.listall,
    tableInit: mocks.tableInit,
  })),
}));

vi.mock("@/modules/SystemSettingModule", () => ({
  SystemSettingModule: vi.fn().mockImplementation(() => ({
    ensureConnection: mocks.settingEnsureConnection,
    updateSystemSetting: mocks.updateSystemSetting,
  })),
}));

vi.mock("@/modules/SystemSettingOptionModule", () => ({
  SystemSettingOptionModule: vi.fn().mockImplementation(() => ({
    ensureConnection: mocks.optionEnsureConnection,
    findOptionBySetting: mocks.findOptionBySetting,
  })),
}));

import { SystemSettingController } from "@/controller/SystemSettingController";

function systemSettingsWithLanguage(language: string): SystemSettingGroupEntity[] {
  return [
    {
      id: 1,
      name: user_preferences,
      description: "user-preferences-group-description",
      settings: [
        {
          id: 42,
          key: language_preference,
          value: language,
          description: "language-preference-description",
          type: "select",
        },
      ],
    },
  ] as unknown as SystemSettingGroupEntity[];
}

function systemSettingsMissingLanguage(): SystemSettingGroupEntity[] {
  return [
    {
      id: 1,
      name: user_preferences,
      description: "user-preferences-group-description",
      settings: [],
    },
  ] as unknown as SystemSettingGroupEntity[];
}

describe("SystemSettingController language preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.groupEnsureConnection.mockResolvedValue(undefined);
    mocks.settingEnsureConnection.mockResolvedValue(undefined);
    mocks.optionEnsureConnection.mockResolvedValue(undefined);
    mocks.tableInit.mockResolvedValue(undefined);
    mocks.findOptionBySetting.mockResolvedValue([]);
    mocks.updateSystemSetting.mockResolvedValue({ id: 42, value: "zh" });
  });

  it("initializes missing built-in settings before updating language preference", async () => {
    mocks.listall
      .mockResolvedValueOnce(systemSettingsMissingLanguage())
      .mockResolvedValueOnce(systemSettingsWithLanguage("en"));

    const controller = new SystemSettingController();
    const updated = await controller.updateLanguagePreference("zh");

    expect(updated).toBe(true);
    expect(mocks.tableInit).toHaveBeenCalledOnce();
    expect(mocks.updateSystemSetting).toHaveBeenCalledWith(42, "zh");
  });
});
