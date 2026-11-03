import { ui_chat_font_size, ui_font_scale } from "@/config/settinggroupInit";

/**
 * Closed set of root font scales. "1" is 16px on `html`.
 * index.html mirrors UI_FONT_SCALE_STORAGE_KEY and these step values so the
 * preference applies before the Vue bundle loads.
 */
export const UI_FONT_SCALE_STORAGE_KEY = "aifetchly.ui_font_scale";
export const UI_FONT_SCALE_SETTING_KEY = ui_font_scale;
export const UI_FONT_SCALE_ROOT_PX = 16;
export const UI_FONT_SCALE_STEPS = ["0.875", "1", "1.125", "1.25", "1.5"] as const;
export type UiFontScaleStep = (typeof UI_FONT_SCALE_STEPS)[number];
export const UI_FONT_SCALE_DEFAULT: UiFontScaleStep = "1";

const LABEL_KEYS: Record<UiFontScaleStep, string> = {
  "0.875": "ui_font_scale_smaller",
  "1": "ui_font_scale_default",
  "1.125": "ui_font_scale_larger",
  "1.25": "ui_font_scale_large",
  "1.5": "ui_font_scale_largest",
};

let appliedScale: UiFontScaleStep = UI_FONT_SCALE_DEFAULT;
let fontScaleWriteEpoch = 0;

export function isUiFontScaleStep(value: string): value is UiFontScaleStep {
  return (UI_FONT_SCALE_STEPS as readonly string[]).includes(value);
}

export function normalizeUiFontScale(
  value: string | null | undefined
): UiFontScaleStep {
  if (value !== null && value !== undefined && isUiFontScaleStep(value)) {
    return value;
  }
  return UI_FONT_SCALE_DEFAULT;
}

export function stepUiFontScale(
  value: string | null | undefined,
  direction: -1 | 1
): UiFontScaleStep {
  const current = normalizeUiFontScale(value);
  const index = UI_FONT_SCALE_STEPS.indexOf(current);
  const nextIndex = Math.min(
    UI_FONT_SCALE_STEPS.length - 1,
    Math.max(0, index + direction)
  );
  return UI_FONT_SCALE_STEPS[nextIndex];
}

export function isUiFontScaleAtMin(value: string | null | undefined): boolean {
  return normalizeUiFontScale(value) === UI_FONT_SCALE_STEPS[0];
}

export function isUiFontScaleAtMax(value: string | null | undefined): boolean {
  return (
    normalizeUiFontScale(value) ===
    UI_FONT_SCALE_STEPS[UI_FONT_SCALE_STEPS.length - 1]
  );
}

export function isUiFontScaleDefault(value: string | null | undefined): boolean {
  return normalizeUiFontScale(value) === UI_FONT_SCALE_DEFAULT;
}

/** i18n key under `system_settings` for the current step label. */
export function uiFontScaleLabelKey(value: string | null | undefined): string {
  return `system_settings.${LABEL_KEYS[normalizeUiFontScale(value)]}`;
}

export function currentFontScaleWriteEpoch(): number {
  return fontScaleWriteEpoch;
}

export function getAppliedUiFontScale(): UiFontScaleStep {
  return appliedScale;
}

export function applyUiFontScale(
  value: string | null | undefined
): UiFontScaleStep {
  const scale = normalizeUiFontScale(value);
  appliedScale = scale;
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.style.setProperty("--app-font-scale", scale);
    document.documentElement.style.fontSize = `${
      UI_FONT_SCALE_ROOT_PX * Number(scale)
    }px`;
  }
  return scale;
}

export function readStoredUiFontScale(): UiFontScaleStep {
  try {
    if (typeof localStorage === "undefined") {
      return UI_FONT_SCALE_DEFAULT;
    }
    return normalizeUiFontScale(localStorage.getItem(UI_FONT_SCALE_STORAGE_KEY));
  } catch {
    return UI_FONT_SCALE_DEFAULT;
  }
}

export function writeStoredUiFontScale(
  value: string | null | undefined
): UiFontScaleStep {
  const scale = normalizeUiFontScale(value);
  fontScaleWriteEpoch += 1;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(UI_FONT_SCALE_STORAGE_KEY, scale);
    }
  } catch {
    // Storage can be unavailable; the in-document scale still applies.
  }
  return applyUiFontScale(scale);
}

/** Apply the last scale saved in this browser profile. */
export function applyStoredUiFontScale(): UiFontScaleStep {
  return applyUiFontScale(readStoredUiFontScale());
}

/** Chat reading and typing size, in whole pixels. index.html mirrors these bounds. */
export const UI_CHAT_FONT_SIZE_STORAGE_KEY = "aifetchly.ui_chat_font_size";
export const UI_CHAT_FONT_SIZE_SETTING_KEY = ui_chat_font_size;
export const UI_CHAT_FONT_SIZE_MIN = 10;
export const UI_CHAT_FONT_SIZE_MAX = 32;
export const UI_CHAT_FONT_SIZE_DEFAULT = 14;

let appliedChatFontPx = UI_CHAT_FONT_SIZE_DEFAULT;
let chatFontWriteEpoch = 0;

export function currentChatFontWriteEpoch(): number {
  return chatFontWriteEpoch;
}

export function getAppliedUiChatFontSize(): number {
  return appliedChatFontPx;
}

/** Accept a committed pixel size. Out-of-range and non-integers are rejected. */
export function parseUiChatFontSizeInput(
  value: string | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const px = Number(trimmed);
  if (px < UI_CHAT_FONT_SIZE_MIN || px > UI_CHAT_FONT_SIZE_MAX) {
    return null;
  }
  return px;
}

/** Stored values that are not a valid pixel size fall back to the default. */
export function normalizeUiChatFontSize(
  value: string | null | undefined
): number {
  return parseUiChatFontSizeInput(value) ?? UI_CHAT_FONT_SIZE_DEFAULT;
}

export function applyUiChatFontSize(
  value: string | null | undefined
): number {
  const px = normalizeUiChatFontSize(value);
  appliedChatFontPx = px;
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.style.setProperty("--app-chat-font-size", `${px}px`);
  }
  return px;
}

export function readStoredUiChatFontSize(): number {
  try {
    if (typeof localStorage === "undefined") {
      return UI_CHAT_FONT_SIZE_DEFAULT;
    }
    return normalizeUiChatFontSize(
      localStorage.getItem(UI_CHAT_FONT_SIZE_STORAGE_KEY)
    );
  } catch {
    return UI_CHAT_FONT_SIZE_DEFAULT;
  }
}

export function writeStoredUiChatFontSize(
  value: string | null | undefined
): number {
  const px = normalizeUiChatFontSize(value);
  chatFontWriteEpoch += 1;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(UI_CHAT_FONT_SIZE_STORAGE_KEY, String(px));
    }
  } catch {
    // Storage can be unavailable; the in-document size still applies.
  }
  return applyUiChatFontSize(String(px));
}

export function applyStoredUiChatFontSize(): number {
  return applyUiChatFontSize(String(readStoredUiChatFontSize()));
}
