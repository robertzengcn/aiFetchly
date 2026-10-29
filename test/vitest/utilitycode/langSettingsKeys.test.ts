import { describe, expect, it } from "vitest";
import { settinggroupInit } from "@/config/settinggroupInit";
import enLocale from "@/views/lang/en";
import zhLocale from "@/views/lang/zh";
import esLocale from "@/views/lang/es";
import frLocale from "@/views/lang/fr";
import deLocale from "@/views/lang/de";
import jaLocale from "@/views/lang/ja";

/**
 * Guard against untranslated system-setting rows.
 *
 * The system settings page renders group names, item labels and descriptions
 * as `t('system_settings.' + key)` where the keys come from the settings DB
 * (settinggroupInit.ts). When a row is registered there without a matching
 * `system_settings.*` translation in a language file, the UI falls back to
 * the raw key path (e.g. "system_settings.managed-browser-group").
 *
 * This test walks every key reachable from settinggroupInit (plus the static
 * keys referenced by src/views/pages/systemsetting/index.vue) and asserts a
 * non-empty translated value exists in ALL supported languages.
 */

const LOCALE_NAMES = ["en", "zh", "es", "fr", "de", "ja"] as const;

const LOCALES: Record<(typeof LOCALE_NAMES)[number], unknown> = {
  en: enLocale,
  zh: zhLocale,
  es: esLocale,
  fr: frLocale,
  de: deLocale,
  ja: jaLocale,
};

/** Keys referenced statically by src/views/pages/systemsetting/index.vue. */
const STATIC_PAGE_KEYS: readonly string[] = [
  "title",
  "no_setting_item_found_exit",
  "no_description",
  "choose_file",
  "manage_mcp_tools",
  "manage_skills",
  "manage_ai_memories",
  "manage_ai_provider",
  "manage_hooks",
  "manage_subagents",
  "ai-custom-context-directive-placeholder",
];

/** Every group/item label key the settings page resolves through t(). */
function extractExpectedKeys(): readonly string[] {
  const keys = new Set<string>(STATIC_PAGE_KEYS);
  for (const group of settinggroupInit) {
    keys.add(group.name);
    if (group.description) keys.add(group.description);
    for (const item of group.items) {
      keys.add(item.key);
      if (item.description) keys.add(item.description);
    }
  }
  return [...keys].sort();
}

const EXPECTED_KEYS: readonly string[] = extractExpectedKeys();

describe.each(LOCALE_NAMES)("system_settings translations (%s)", (localeName) => {
  const localeMessages = LOCALES[localeName] as Record<string, unknown> | null;

  it("default-exports a system_settings section", () => {
    expect(localeMessages).toBeTruthy();
    const section = localeMessages?.["system_settings"];
    expect(section).toBeTruthy();
  });

  it.each(EXPECTED_KEYS)("translates %s", (key) => {
    const section = localeMessages?.["system_settings"] as
      | Record<string, unknown>
      | undefined;
    const entry = section?.[key];
    expect(typeof entry).toBe("string");
    const text = entry as string;
    expect(text.length).toBeGreaterThan(0);
    // vue-i18n surfaces the full lookup path when the key is missing — the
    // stored value must never be that same unresolved path.
    expect(text.startsWith("system_settings.")).toBe(false);
  });

  it("provides the nested hooks section used by Hooks.vue", () => {
    const section = localeMessages?.["system_settings"] as
      | Record<string, unknown>
      | undefined;
    const hooks = section?.["hooks"] as Record<string, unknown> | undefined;
    expect(hooks).toBeTruthy();
    for (const path of ["field.command", "field.event", "button.save", "toast.saved"]) {
      const [head, tail] = path.split(".");
      const nested = hooks?.[head] as Record<string, unknown> | undefined;
      expect(typeof nested?.[tail]).toBe("string");
    }
  });
});
