/**
 * Full-tree i18n parity test for the image-tool surfaces.
 *
 * Locks cross-language parity so a developer cannot add or remove any
 * `aiChatV2.imageTool.*` or `aiChatV2.generatedImageRefs.*` key without
 * updating ALL six locales: the key SETS must match English exactly, and
 * every leaf must be a non-empty string.
 *
 * Runs under the main vitest config (type-checked) like the other i18n
 * parity suites.
 */
import { describe, it, expect } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

type LangMessages = Record<string, unknown>;

const LANGS: Record<string, LangMessages> = { en, zh, es, fr, de, ja };
const SECTIONS = ["imageTool", "generatedImageRefs"] as const;

/** Flatten a section tree into dotted leaf paths (e.g. "errors.tooLarge"). */
function flattenLeaves(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(
    ([key, value]) => flattenLeaves(value, prefix ? `${prefix}.${key}` : key)
  );
}

function sectionLeaves(
  lang: LangMessages,
  section: (typeof SECTIONS)[number]
): string[] {
  const aiChatV2 = lang.aiChatV2 as Record<string, unknown> | undefined;
  return flattenLeaves(aiChatV2?.[section]);
}

function leafValue(
  lang: LangMessages,
  section: string,
  dottedPath: string
): unknown {
  const aiChatV2 = lang.aiChatV2 as Record<string, unknown> | undefined;
  let node: unknown = (aiChatV2 as Record<string, unknown> | undefined)?.[
    section
  ];
  for (const part of dottedPath.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe("aiChatV2 image-tool i18n parity across all six languages", () => {
  for (const section of SECTIONS) {
    it(`en exposes a non-empty ${section} tree`, () => {
      const leaves = sectionLeaves(en, section);
      expect(leaves.length).toBeGreaterThan(0);
    });

    for (const [code, lang] of Object.entries(LANGS)) {
      it(`${code}.${section} has exactly the same key set as en`, () => {
        const expected = [...sectionLeaves(en, section)].sort();
        const actual = [...sectionLeaves(lang, section)].sort();
        const missing = expected.filter((key) => !actual.includes(key));
        const extra = actual.filter((key) => !expected.includes(key));
        expect(
          missing,
          `${code}.${section} missing keys: ${missing.join(", ")}`
        ).toEqual([]);
        expect(
          extra,
          `${code}.${section} has keys unknown to en: ${extra.join(", ")}`
        ).toEqual([]);
      });

      it(`${code}.${section} leaves are all non-empty strings`, () => {
        for (const leaf of sectionLeaves(lang, section)) {
          const value = leafValue(lang, section, leaf);
          expect(
            typeof value,
            `${code}.${section}.${leaf} must be a string`
          ).toBe("string");
          expect(
            (value as string).length,
            `${code}.${section}.${leaf} must not be empty`
          ).toBeGreaterThan(0);
        }
      });
    }
  }

  it("interpolated labels keep their placeholders in every locale", () => {
    // Placeholders referenced by components must survive translation.
    for (const [code, lang] of Object.entries(LANGS)) {
      const retry = leafValue(lang, "generatedImageRefs", "retryFailed");
      expect(retry, `${code}.retryFailed`).toContain("{count}");
      const progress = leafValue(lang, "generatedImageRefs", "progressSummary");
      expect(progress, `${code}.progressSummary`).toContain("{completed}");
    }
  });
});
