import { describe, expect, it } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

/**
 * i18n parity test (PRD FR-08 / AC-12): the applicationLifecycle namespace
 * must define the SAME key set in all six supported languages.
 */

const LOCALES: Record<string, Record<string, unknown>> = {
  en: en as unknown as Record<string, unknown>,
  zh: zh as unknown as Record<string, unknown>,
  es: es as unknown as Record<string, unknown>,
  fr: fr as unknown as Record<string, unknown>,
  de: de as unknown as Record<string, unknown>,
  ja: ja as unknown as Record<string, unknown>,
};

const EXPECTED_KEYS = [
  "closeTitle",
  "closeDescription",
  "activeTasks",
  "keepRunning",
  "exitApplication",
  "cancel",
  "exiting",
  "stoppingTasks",
  "trayUnavailable",
  "trayOpen",
  "trayExit",
  "trayTooltip",
] as const;

describe("applicationLifecycle i18n parity (FR-08, AC-12)", () => {
  it("defines the namespace in every supported language", () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      const namespace = messages.applicationLifecycle as
        | Record<string, unknown>
        | undefined;
      expect(namespace, `${locale} is missing applicationLifecycle`).toBeDefined();
    }
  });

  it("has every expected key with a non-empty value in every language", () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      const namespace = messages.applicationLifecycle as Record<string, unknown>;
      for (const key of EXPECTED_KEYS) {
        const value = namespace[key];
        expect(
          typeof value === "string" && value.length > 0,
          `${locale}.applicationLifecycle.${key} must be a non-empty string`
        ).toBe(true);
      }
    }
  });
});
