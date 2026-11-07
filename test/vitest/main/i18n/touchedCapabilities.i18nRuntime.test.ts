/**
 * Six-language runtime/error i18n check for the touched capability surface
 * (the workspace shell components under aiChatWorkspace/ and aiChatV2/).
 *
 * Unlike the per-namespace parity tests (which pin explicit key lists), this
 * test extracts every statically referenced `t("...")` literal from the two
 * component directories AT TEST TIME and asserts, for each of the six
 * supported locales, that the REAL vue-i18n runtime instance:
 *   1. knows the key for that locale (`te(key, { locale })` — no silent
 *      English fallback), and
 *   2. renders a non-empty mapped string through `t(key)` that is not the
 *      raw key itself.
 *
 * Dynamic keys (template-literal prefixes like
 * `t(`managedBrowser.handoff.reasons.${x}`)`) cannot be extracted statically
 * and are skipped by design; their surrounding static labels are covered.
 */
import { describe, it, expect } from "vitest";
import { createI18n } from "vue-i18n";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

type LangMessages = Record<string, Record<string, unknown>>;
const LANGS: Record<string, LangMessages> = { en, zh, es, fr, de, ja };

const COMPONENT_DIRS = [
  "src/views/components/aiChatWorkspace",
  "src/views/components/aiChatV2",
] as const;

function extractStaticKeys(): string[] {
  const keys = new Set<string>();
  const patSingle = /(?:^|[^a-zA-Z0-9_$'"])t\('([a-zA-Z0-9_.]+)'/;
  const patDouble = /(?:^|[^a-zA-Z0-9_$"'])t\("([a-zA-Z0-9_.]+)"/;
  for (const dir of COMPONENT_DIRS) {
    expect(existsSync(dir), `${dir} must exist`).toBe(true);
    for (const name of readdir(dir)) {
      const path = join(dir, name);
      if (!path.endsWith(".vue")) continue;
      for (const raw of readFileSync(path, "utf8").split("\n")) {
        const trimmed = raw.trim();
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("<!--") ||
          trimmed.startsWith("i18n:")
        ) {
          continue;
        }
        const single = patSingle.exec(raw);
        if (single && !/\/\*|\*\//.test(raw.slice(0, single.index))) {
          keys.add(single[1]);
        }
        const double = patDouble.exec(raw);
        if (double && !/\/\*|\*\//.test(raw.slice(0, double.index))) {
          keys.add(double[1]);
        }
      }
    }
  }
  return [...keys].filter((k) => !k.endsWith(".")).sort();
}

import { readdirSync as readdir } from "node:fs";

function probe(locale: string, messages: LangMessages): (key: string) => string {
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: "",
    messages: { [locale]: messages },
  });
  const t = i18n.global.t as (key: string) => string;
  const te = i18n.global.te as (key: string, locale: string) => boolean;
  return (key: string): string => {
    if (!te(key, locale)) {
      expect.fail(
        `${locale} is missing key: ${key} (the component falls back to inline English)`
      );
    }
    const rendered = t(key);
    expect(
      rendered.length,
      `${locale}: rendered string for ${key} must be non-empty`
    ).toBeGreaterThan(0);
    if (rendered === key) {
      expect.fail(`${locale}: t(${key}) returned the raw key`);
    }
    return rendered;
  };
}

describe("touched capability components — six-language runtime i18n", () => {
  const staticKeys = extractStaticKeys();

  it("extracts a meaningful static key set", () => {
    expect(
      staticKeys.length,
      "extraction must keep finding several hundred keys"
    ).toBeGreaterThanOrEqual(400);
  });

  for (const [code, messages] of Object.entries(LANGS)) {
    describe(`${code}`, () => {
      const check = probe(code, messages);
      it("maps every statically referenced key at runtime", () => {
        const unresolved: string[] = [];
        for (const key of staticKeys) {
          try {
            check(key);
          } catch (error) {
            unresolved.push(key);
            if (unresolved.length >= 12) {
              break;
            }
          }
        }
        expect(
          unresolved,
          `${code}: ${unresolved.length} of ${staticKeys.length} static keys missing`
        ).toEqual([]);
      });
    });
  }
});
