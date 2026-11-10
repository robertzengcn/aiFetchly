import { beforeEach, describe, expect, it, vi } from "vitest";
import { user_preferences } from "@/config/settinggroupInit";
import type { SystemSettingGroupEntity } from "@/entity/SystemSettingGroup.entity";

/**
 * The system settings page's left menu renders groups in the order returned
 * by `SystemSettingController.selectAllSystemSettings()` (currently the DB's
 * `id ASC`). Existing installs already seeded group rows in the historical
 * order, so reordering `settinggroupInit` alone cannot change their menu.
 * The controller must apply the canonical display order so that
 * "User Preferences" is always the first entry.
 */

const mocks = vi.hoisted(() => ({
  groupEnsureConnection: vi.fn(),
  settingEnsureConnection: vi.fn(),
  optionEnsureConnection: vi.fn(),
  listall: vi.fn(),
  tableInit: vi.fn(),
  findOptionBySetting: vi.fn(),
}));

vi.mock("@/modules/SystemSettingGroupModule", () => ({
  SystemSettingGroupModule: class {
    constructor() {
      return {
        ensureConnection: mocks.groupEnsureConnection,
        listall: mocks.listall,
        tableInit: mocks.tableInit,
      };
    }
  },
}));

vi.mock("@/modules/SystemSettingModule", () => ({
  SystemSettingModule: class {
    constructor() {
      return {
        ensureConnection: mocks.settingEnsureConnection,
      };
    }
  },
}));

vi.mock("@/modules/SystemSettingOptionModule", () => ({
  SystemSettingOptionModule: class {
    constructor() {
      return {
        ensureConnection: mocks.optionEnsureConnection,
        findOptionBySetting: mocks.findOptionBySetting,
      };
    }
  },
}));

import { SystemSettingController } from "@/controller/SystemSettingController";

/** A group row with the given id and no settings. */
function group(id: number, name: string): SystemSettingGroupEntity {
  return {
    id,
    name,
    description: `${name}-description`,
    settings: [],
  } as unknown as SystemSettingGroupEntity;
}

describe("SystemSettingController group display order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.groupEnsureConnection.mockResolvedValue(undefined);
    mocks.settingEnsureConnection.mockResolvedValue(undefined);
    mocks.optionEnsureConnection.mockResolvedValue(undefined);
    mocks.tableInit.mockResolvedValue(undefined);
    mocks.findOptionBySetting.mockResolvedValue([]);
  });

  it("puts user_preferences first even when the DB ids keep the historical order", async () => {
    // Stale seeded ids: managed browser was seeded first, user_prefs later.
    mocks.listall.mockResolvedValue([
      group(1, "managed-browser-group"),
      group(2, "2captcha-group"),
      group(3, "embedding_group"),
      group(4, "external_system"),
      group(5, user_preferences),
      group(6, "ai_preferences"),
    ]);

    const controller = new SystemSettingController();
    const result = await controller.selectAllSystemSettings();

    expect(result[0].name).toBe(user_preferences);
    // Known groups keep the canonical (settinggroupInit) relative order.
    expect(result.map((g) => g.name).slice(1)).toEqual([
      "managed-browser-group",
      "2captcha-group",
      "embedding_group",
      "external_system",
      "ai_preferences",
    ]);
  });

  it("keeps the order stable for groups unknown to settinggroupInit", async () => {
    mocks.listall.mockResolvedValue([
      group(7, "future-group"),
      group(8, user_preferences),
      group(9, "another-future-group"),
    ]);

    const controller = new SystemSettingController();
    const result = await controller.selectAllSystemSettings();

    // Known groups are reordered to the canonical position; unknown groups
    // stay stable (original relative order) after the known ones.
    expect(result.map((g) => g.name)).toEqual([
      user_preferences,
      "future-group",
      "another-future-group",
    ]);
  });

  it("does not disturb rows when the list is already in canonical order", async () => {
    mocks.listall.mockResolvedValue([
      group(2, user_preferences),
      group(1, "managed-browser-group"),
      group(3, "2captcha-group"),
    ]);

    const controller = new SystemSettingController();
    const result = await controller.selectAllSystemSettings();

    expect(result.map((g) => g.name)).toEqual([
      user_preferences,
      "managed-browser-group",
      "2captcha-group",
    ]);
    // The display payload itself must stay intact.
    expect(result[0].description).toBe(`${user_preferences}-description`);
  });
});
