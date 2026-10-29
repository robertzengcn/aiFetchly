import {
  UI_CHAT_FONT_SIZE_SETTING_KEY,
  UI_FONT_SCALE_SETTING_KEY,
  applyStoredUiChatFontSize,
  applyStoredUiFontScale,
  currentChatFontWriteEpoch,
  currentFontScaleWriteEpoch,
  writeStoredUiChatFontSize,
  writeStoredUiFontScale,
} from "@/views/utils/fontScale";
import { getSystemSettinglist } from "@/views/api/systemsetting";

/**
 * Apply the profile-local sizes immediately, then replace each one with the
 * signed-in user's system setting when that read finishes. A save that
 * lands while the read is in flight keeps the newer value for that setting.
 */
export async function initializeSavedFontScale(): Promise<void> {
  applyStoredUiFontScale();
  applyStoredUiChatFontSize();
  const layoutEpoch = currentFontScaleWriteEpoch();
  const chatEpoch = currentChatFontWriteEpoch();
  try {
    const groups = await getSystemSettinglist();
    let layoutValue: string | null | undefined;
    let chatValue: string | null | undefined;
    for (const group of groups) {
      for (const item of group.items) {
        if (item.key === UI_FONT_SCALE_SETTING_KEY) {
          layoutValue = item.value;
        }
        if (item.key === UI_CHAT_FONT_SIZE_SETTING_KEY) {
          chatValue = item.value;
        }
      }
    }
    if (
      layoutValue !== undefined &&
      currentFontScaleWriteEpoch() === layoutEpoch
    ) {
      writeStoredUiFontScale(layoutValue);
    }
    if (chatValue !== undefined && currentChatFontWriteEpoch() === chatEpoch) {
      writeStoredUiChatFontSize(chatValue);
    }
  } catch {
    // Settings are unavailable before login. Keep the stored sizes.
  }
}
