import { describe, expect, it } from "vitest";

import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

/**
 * Managed-browser i18n parity (CLAUDE.md mandate): every user-facing key
 * under `managedBrowser.*` plus the `route.managed_browser` title must exist
 * in ALL six supported languages with identical key structure.
 */

type Dict = Record<string, unknown>;

const LANGS: Dict = { en, zh, es, fr, de, ja };

function flatKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return [prefix];
  }
  const dict = value as Dict;
  return Object.keys(dict).flatMap((key) =>
    flatKeys(dict[key], prefix ? `${prefix}.${key}` : key)
  );
}

function managedBlock(lang: unknown): unknown {
  return (lang as { managedBrowser?: unknown }).managedBrowser;
}

describe("managedBrowser i18n parity", () => {
  it("every language defines the full managedBrowser block", () => {
    for (const [name, lang] of Object.entries(LANGS)) {
      const block = managedBlock(lang as Dict);
      expect(block, `${name} missing managedBrowser`).toBeDefined();
    }
  });

  it("key structure matches English exactly across all languages", () => {
    const enKeys = flatKeys(managedBlock(en as Dict), "managedBrowser").sort();
    expect(enKeys.length).toBeGreaterThan(60);
    for (const [name, lang] of Object.entries(LANGS)) {
      if (name === "en") {
        continue;
      }
      const keys = flatKeys(
        managedBlock(lang as Dict),
        "managedBrowser"
      ).sort();
      expect(keys, `${name} key set differs from en`).toEqual(enKeys);
    }
  });

  it("every language defines route.managed_browser", () => {
    for (const [name, lang] of Object.entries(LANGS)) {
      const route = (lang as { route?: Dict }).route;
      expect(route?.managed_browser, `${name} missing route.managed_browser`)
        .toBeTruthy();
    }
  });
});
