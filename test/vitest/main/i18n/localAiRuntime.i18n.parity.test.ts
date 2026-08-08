import { describe, expect, test } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

type Lang = { localAiRuntime: Record<string, unknown> };

const langs: Record<string, Lang> = { en, zh, es, fr, de, ja };

const REQUIRED_KEYS = [
  "title",
  "embedding_title",
  "voice_title",
  "not_installed",
  "ready",
  "incompatible",
  "corrupted",
  "install",
  "repair",
  "remove",
  "check_update",
  "download_size",
  "installed_size",
  "downloading",
  "verifying",
  "extracting",
  "testing",
  "activating",
  "cancel",
  "retry",
  "remove_models",
  "install_confirm",
  "remove_confirm",
];

const REQUIRED_ERROR_KEYS = [
  "catalog_unavailable",
  "download_failed",
  "checksum_mismatch",
  "archive_unsafe",
  "incompatible",
  "health_check_failed",
  "busy",
  "remove_failed",
];

describe("localAiRuntime i18n parity across all six languages", () => {
  test("every language defines the localAiRuntime group", () => {
    for (const [name, lang] of Object.entries(langs)) {
      expect(lang.localAiRuntime, `${name} missing localAiRuntime group`).toBeDefined();
    }
  });

  test("every language defines all required localAiRuntime keys", () => {
    for (const [name, lang] of Object.entries(langs)) {
      for (const key of REQUIRED_KEYS) {
        const value = lang.localAiRuntime[key];
        expect(typeof value === "string" && value.length > 0, `${name}.${key} missing/empty`).toBe(true);
      }
    }
  });

  test("every language defines all required localAiRuntime.errors keys", () => {
    for (const [name, lang] of Object.entries(langs)) {
      const errors = lang.localAiRuntime.errors as Record<string, unknown> | undefined;
      expect(errors, `${name} missing errors group`).toBeDefined();
      for (const key of REQUIRED_ERROR_KEYS) {
        const value = errors?.[key];
        expect(typeof value === "string" && value.length > 0, `${name}.errors.${key} missing/empty`).toBe(true);
      }
    }
  });

  test("no language leaves an English placeholder untranslated in core keys", () => {
    // A light heuristic: non-English files should not equal the English value
    // for the title (guards against copy-paste without translation).
    const englishTitle = en.localAiRuntime.title;
    for (const name of ["zh", "es", "fr", "de", "ja"]) {
      expect((langs[name].localAiRuntime.title as string) === englishTitle, `${name} title not translated`).toBe(false);
    }
  });
});
