import {
  UI_FONT_SCALE_SETTING_KEY,
  applyStoredUiFontScale,
  currentFontScaleWriteEpoch,
  writeStoredUiFontScale,
} from "@/views/utils/fontScale";
import { getSystemSettinglist } from "@/views/api/systemsetting";

/**
 * Apply the profile-local scale immediately, then replace it with the
 * signed-in user's system setting when that read finishes. A save that
 * lands while the read is in flight keeps the newer value.
 */
export async function initializeSavedFontScale(): Promise<void> {
  applyStoredUiFontScale();
  const epochAtStart = currentFontScaleWriteEpoch();
  try {
    const groups = await getSystemSettinglist();
    if (currentFontScaleWriteEpoch() !== epochAtStart) {
      return;
    }
    for (const group of groups) {
      for (const item of group.items) {
        if (item.key === UI_FONT_SCALE_SETTING_KEY) {
          writeStoredUiFontScale(item.value);
          return;
        }
      }
    }
  } catch {
    // Settings are unavailable before login. Keep the stored scale.
  }
}
