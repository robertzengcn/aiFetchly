/**
 * aiChatV2.pastedText i18n group parity test (TODO i18n-tests).
 *
 * This test locks cross-language parity so a developer cannot add a new key
 * to the pasted-text UI without updating all other six locales.
 */
import { describe, it, expect } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

type LangMessages = Record<string, Record<string, unknown>>;
const LANGS: Record<string, LangMessages> = { en, zh, es, fr, de, ja };

function pastedTextKeys(lang: LangMessages): string[] {
  const aiChatV2 = lang.aiChatV2 as Record<string, unknown> | undefined;
  const pastedText = aiChatV2?.pastedText as
    | Record<string, unknown>
    | undefined;
  return Object.keys(pastedText ?? {}).sort();
}

describe("aiChatV2.pastedText i18n group parity across all six languages", () => {
  for (const [code, lang] of Object.entries(LANGS)) {
    describe(`${code}: pastedText group`, () => {
      it("has a non-empty aiChatV2.pastedText object", () => {
        const aiChatV2 = lang.aiChatV2 as Record<string, unknown> | undefined;
        const pastedText = aiChatV2?.pastedText as
          | Record<string, unknown>
          | undefined;
        expect(typeof pastedText).toBe("object");
        expect(pastedText).not.toBeNull();
        expect(Object.keys(pastedText ?? {}).length).toBeGreaterThan(0);
      });

      it("every pastedText value is a non-empty string", () => {
        const aiChatV2 = lang.aiChatV2 as Record<string, unknown> | undefined;
        const pastedText = aiChatV2?.pastedText as
          | Record<string, unknown>
          | undefined;
        if (!pastedText) {
          expect.fail(`aiChatV2.pastedText group missing in ${code}`);
        }
        for (const [key, value] of Object.entries(pastedText)) {
          expect(
            typeof value,
            `${code}.aiChatV2.pastedText.${key} must be a string`
          ).toBe("string");
          expect(
            (value as string).length,
            `${code}.aiChatV2.pastedText.${key} must be non-empty`
          ).toBeGreaterThan(0);
        }
      });
    });
  }

  it("pastedText key sets are identical across en/zh/es/fr/de/ja", () => {
    const reference = pastedTextKeys(en).join(",");
    expect(reference.length).toBeGreaterThan(0);
    for (const [code, lang] of Object.entries(LANGS)) {
      if (code === "en") continue;
      const set = pastedTextKeys(lang).join(",");
      expect(
        set,
        `${code} aiChatV2.pastedText keys mismatch (expected ${reference}, got ${set})`
      ).toBe(reference);
    }
  });
});
