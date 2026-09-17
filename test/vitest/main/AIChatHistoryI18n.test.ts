import { describe, expect, it } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

/**
 * Six-language coverage for recoverable-history UI strings (AC-24).
 *
 * Every `aiChatHistory` / `aiChatCompaction` key present in English must
 * exist — non-empty — in Chinese, Spanish, French, German, and Japanese.
 * Missing keys silently fall back to English at runtime; this test makes the
 * fallback impossible to ship unnoticed.
 */

const LOCALES: Record<string, unknown> = { en, zh, es, fr, de, ja };

function sectionKeys(locale: unknown, section: string): string[] {
  const root = locale as Record<string, unknown>;
  const part = root[section];
  expect(part, `missing section ${section}`).toBeTypeOf("object");
  return Object.keys(part as Record<string, unknown>);
}

describe.each(["aiChatHistory", "aiChatCompaction"])(
  "locale coverage for %s",
  (section) => {
    it("defines the same keys in all six languages", () => {
      const expected = sectionKeys(en, section).sort();
      expect(expected.length).toBeGreaterThan(0);
      for (const [name, locale] of Object.entries(LOCALES)) {
        expect(sectionKeys(locale, section).sort(), name).toEqual(expected);
      }
    });

    it("has no empty translations in any language", () => {
      for (const [name, locale] of Object.entries(LOCALES)) {
        const part = (locale as Record<string, Record<string, unknown>>)[
          section
        ];
        for (const [key, value] of Object.entries(part)) {
          expect(
            typeof value === "string" && value.trim().length > 0,
            `${name}.${section}.${key}`
          ).toBe(true);
        }
      }
    });
  }
);
