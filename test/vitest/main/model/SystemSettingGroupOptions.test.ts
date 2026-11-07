import { beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { SystemSettingGroupModel } from "@/model/SystemSettingGroup.model";
import { SystemSettingModel } from "@/model/SystemSetting.model";
import { SystemSettingOptionModel } from "@/model/SystemSettingOption.model";
import { SqliteDb } from "@/config/SqliteDb";
import { SystemSettingOptionEntity } from "@/entity/SystemSettingOption.entity";
import { language_preference } from "@/config/settinggroupInit";
import { SUPPORTED_LANGUAGES } from "@/config/languages";

/**
 * Regression tests for the Language switch in the system settings UI.
 *
 * The select rendered the raw stored value and offered "No data available"
 * because:
 *  1. `system_setting_option` rows for `language_preference` were only
 *     seeded when the setting row was FIRST inserted — any database created
 *     before that code existed never got options (and never re-seeds).
 *  2. Only "en"/"zh" were seeded while the app ships six UI languages.
 *
 * The boot-time seed (`tableInit()`, run from `runafterbootup()`) must
 * self-heal the option rows and cover every supported language.
 */

const tmpDir = path.join(os.tmpdir(), "aifetchly-system-setting-options");

let groupModel: SystemSettingGroupModel;
let settingModel: SystemSettingModel;
let optionModel: SystemSettingOptionModel;

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;

  groupModel = new SystemSettingGroupModel(tmpDir);
  settingModel = new SystemSettingModel(tmpDir);
  optionModel = new SystemSettingOptionModel(tmpDir);
});

async function getLanguageOptions(): Promise<SystemSettingOptionEntity[]> {
  const setting = await settingModel.getSettingItem(language_preference);
  expect(setting, "language_preference row must exist after tableInit").toBeTruthy();
  return optionModel.findOptionBySetting(setting!);
}

describe("SystemSettingGroupModel language option seeding", () => {
  it("seeds every supported language on a fresh database", async () => {
    await SqliteDb.ensureInitialized();
    await groupModel.tableInit();

    const options = await getLanguageOptions();
    const values = options.map((o) => o.value).sort();
    expect(values).toEqual(
      SUPPORTED_LANGUAGES.map((l) => l.code).sort()
    );
    // Labels must be human-readable (that is what the dropdown displays).
    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.label).not.toBe(option.value);
    }
  });

  it("restores missing options for an existing language row (legacy DB self-heal)", async () => {
    await SqliteDb.ensureInitialized();
    await groupModel.tableInit();

    // Simulate a DB created before option seeding existed: wipe the options.
    const connection = SqliteDb.getInstance(tmpDir).connection;
    const optionRepo = connection.getRepository(SystemSettingOptionEntity);
    await optionRepo.clear();
    expect(await getLanguageOptions()).toHaveLength(0);

    // The next boot re-runs tableInit() — options must come back.
    await groupModel.tableInit();
    const options = await getLanguageOptions();
    expect(options.map((o) => o.value).sort()).toEqual(
      SUPPORTED_LANGUAGES.map((l) => l.code).sort()
    );
  });

  it("does not duplicate options when tableInit runs repeatedly", async () => {
    await SqliteDb.ensureInitialized();
    await groupModel.tableInit();
    await groupModel.tableInit();
    await groupModel.tableInit();

    const options = await getLanguageOptions();
    expect(options).toHaveLength(SUPPORTED_LANGUAGES.length);
  });
});
