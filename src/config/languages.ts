/**
 * Canonical list of UI languages supported by the app (src/views/lang/*).
 *
 * Single source of truth shared by the renderer (language switch UI) and the
 * main process (`SystemSettingOptionModel` seeds these as
 * `system_setting_option` rows for the `language_preference` setting).
 */

export interface LanguageOptionDef {
    /** BCP-47-ish code stored in the system_setting value and cookies. */
    readonly code: string;
    /** Native endonym shown in the language dropdown. */
    readonly label: string;
    readonly description: string;
}

export const SUPPORTED_LANGUAGES: readonly LanguageOptionDef[] = [
    { code: "en", label: "English", description: "English language" },
    { code: "zh", label: "中文", description: "Chinese language" },
    { code: "es", label: "Español", description: "Spanish language" },
    { code: "fr", label: "Français", description: "French language" },
    { code: "de", label: "Deutsch", description: "German language" },
    { code: "ja", label: "日本語", description: "Japanese language" },
] as const;

export const LANGUAGE_CODES: readonly string[] = SUPPORTED_LANGUAGES.map(
    (language) => language.code
);

export function isSupportedLanguageCode(code: string): boolean {
    return SUPPORTED_LANGUAGES.some((language) => language.code === code);
}
