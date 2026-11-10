import { describe, expect, it } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

/**
 * T9/D4 (audit): the shared generated-image dialogs render
 * `t("aiChatV2.cancel")` — the key was missing from every locale file, so
 * the Cancel button fell back to English in five languages. This test pins
 * the keys BOTH shared dialogs use so a future `t("aiChatV2.*")` addition
 * fails when any language file lacks it (PRD §16 / acceptance 25).
 */

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["en", en as unknown as Record<string, unknown>],
  ["zh", zh as unknown as Record<string, unknown>],
  ["es", es as unknown as Record<string, unknown>],
  ["fr", fr as unknown as Record<string, unknown>],
  ["de", de as unknown as Record<string, unknown>],
  ["ja", ja as unknown as Record<string, unknown>],
];

/** Keys referenced by GeneratedImageChooserDialog + GeneratedImageBatchConfirmDialog. */
const REQUIRED_KEYS: ReadonlyArray<string> = [
  "aiChatV2.cancel",
  "aiChatV2.generatedImageRefs.referenceTrayTitle",
  "aiChatV2.generatedImageRefs.errors.generated_image_ambiguous",
  "aiChatV2.generatedImageRefs.batchConfirmTitle",
  "aiChatV2.generatedImageRefs.batchConfirmBody",
  "aiChatV2.generatedImageRefs.send",
  "aiChatV2.generatedImageRefs.useAsReference",
];

function resolve(locale: Record<string, unknown>, key: string): unknown {
  let node: unknown = locale;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe("generated-image dialog locale parity (T9/D4)", () => {
  for (const key of REQUIRED_KEYS) {
    it(`has "${key}" in every locale`, () => {
      for (const [name, locale] of LOCALES) {
        const value = resolve(locale, key);
        expect(
          typeof value === "string" && value.length > 0,
          `${name} is missing "${key}"`
        ).toBe(true);
      }
    });
  }

  it("aiChatV2.cancel is actually translated per locale (not the English fallback)", () => {
    const cancelByLocale = new Map<string, string>();
    for (const [name, locale] of LOCALES) {
      cancelByLocale.set(name, String(resolve(locale, "aiChatV2.cancel")));
    }
    // Distinct translations exist (not six copies of "Cancel").
    expect(new Set(cancelByLocale.values()).size).toBeGreaterThanOrEqual(4);
  });
});
