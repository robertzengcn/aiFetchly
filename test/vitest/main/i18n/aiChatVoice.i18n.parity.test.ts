/**
 * aiChatV2.voice i18n group parity test (TODO P1-i18n).
 *
 * The local voice chat feature (PRD docs/prd/local-sherpa-onnx-voice-chat-prd.md)
 * reads these keys via `t('aiChatV2.voice.<key>')` with English fallbacks across
 * AiChatV2Composer.vue, AiChatVoiceSettingsPanel.vue, and AiChatV2.vue. A key
 * missing from a non-English locale degrades to the English fallback; a key
 * missing from `en` shows the raw key path (visible breakage). This test locks
 * cross-language parity so a developer cannot add a key to one lang file
 * without updating the other five, and asserts every value is a non-empty
 * string. Mirrors the workspaceTrust parity test (Plan 14-05).
 */
import { describe, it, expect } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

// Lang files are default-exported message objects. Index dynamically with a
// permissive record type so minor structural drift elsewhere does not produce
// spurious TS errors here.
type LangMessages = Record<string, Record<string, unknown>>;

const LANGS: Record<string, LangMessages> = { en, zh, es, fr, de, ja };

function voiceKeys(lang: LangMessages): string[] {
  const aiChatV2 = lang.aiChatV2 as Record<string, unknown> | undefined;
  const voice = aiChatV2?.voice as Record<string, unknown> | undefined;
  return Object.keys(voice ?? {}).sort();
}

describe("aiChatV2.voice i18n group parity across all six languages", () => {
  for (const [code, lang] of Object.entries(LANGS)) {
    describe(`${code}: voice group`, () => {
      it("has a non-empty aiChatV2.voice object", () => {
        const voice = (lang.aiChatV2 as Record<string, unknown> | undefined)
          ?.voice;
        expect(typeof voice).toBe("object");
        expect(voice).not.toBeNull();
      });

      it("every voice value is a non-empty string", () => {
        const voice = (lang.aiChatV2 as Record<string, unknown> | undefined)
          ?.voice as Record<string, unknown> | undefined;
        if (!voice) {
          expect.fail(`aiChatV2.voice group missing in ${code}`);
        }
        for (const [key, value] of Object.entries(voice)) {
          expect(
            typeof value,
            `${code}.aiChatV2.voice.${key} must be a string`
          ).toBe("string");
          expect(
            (value as string).length,
            `${code}.aiChatV2.voice.${key} must be non-empty`
          ).toBeGreaterThan(0);
        }
      });
    });
  }

  it("voice key sets are identical across en/zh/es/fr/de/ja", () => {
    const reference = voiceKeys(en).join(",");
    expect(reference.length, "en voice group must not be empty").toBeGreaterThan(0);
    for (const [code, lang] of Object.entries(LANGS)) {
      if (code === "en") continue;
      const set = voiceKeys(lang).join(",");
      expect(
        set,
        `${code} aiChatV2.voice keys mismatch (expected ${reference}, got ${set})`
      ).toBe(reference);
    }
  });
});
