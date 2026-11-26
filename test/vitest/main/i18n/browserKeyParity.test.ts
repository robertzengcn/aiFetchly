import { describe, expect, it } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

/**
 * Release evidence: the browser-decision UI namespaces must have the SAME
 * key set in every supported language (paired outcome checks, six
 * languages) — a missing key silently falls back to English in one locale.
 */

const BROWSER_NAMESPACES = [
  "browserSignIn",
  "browserTasks",
  "browserSite",
] as const;

type Locale = Record<string, unknown>;

function flattenKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") {
    return prefix === "" ? [] : [prefix];
  }
  const record = node as Record<string, unknown>;
  const keys: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    keys.push(...flattenKeys(value, prefix === "" ? key : `${prefix}.${key}`));
  }
  return keys.sort();
}

describe("browser decision i18n key parity (six languages)", () => {
  const locales: Array<{ name: string; locale: Locale }> = [
    { name: "zh", locale: zh as unknown as Locale },
    { name: "es", locale: es as unknown as Locale },
    { name: "fr", locale: fr as unknown as Locale },
    { name: "de", locale: de as unknown as Locale },
    { name: "ja", locale: ja as unknown as Locale },
  ];

  for (const namespace of BROWSER_NAMESPACES) {
    it(`namespace ${namespace} has identical keys in all six languages`, () => {
      const enKeys = flattenKeys(
        (en as unknown as Locale)[namespace]
      ).sort();
      expect(enKeys.length).toBeGreaterThan(0);
      for (const { name, locale } of locales) {
        const keys = flattenKeys(locale[namespace]).sort();
        expect(keys, `${name}.${namespace}`).toEqual(enKeys);
      }
    });
  }
});
