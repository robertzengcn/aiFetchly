import { describe, expect, it } from "vitest";

/**
 * Shared-key parity check (design §21.2, IPR-048): the ui.* convergence
 * namespace must exist with identical key trees in all six language files.
 */

const LANG_FILES = ["en", "zh", "es", "fr", "de", "ja"] as const;

function flatten(obj: unknown, prefix = ""): string[] {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(
      ([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key)
    );
  }
  return [prefix];
}

async function loadUiKeys(lang: string): Promise<string[]> {
  // Static map avoids Vite's unknown-variable dynamic-import error.
  const modules: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
    en: () => import("@/views/lang/en"),
    zh: () => import("@/views/lang/zh"),
    es: () => import("@/views/lang/es"),
    fr: () => import("@/views/lang/fr"),
    de: () => import("@/views/lang/de"),
    ja: () => import("@/views/lang/ja"),
  };
  const mod = await modules[lang]();
  const ui = mod.default?.ui;
  return flatten(ui).sort();
}

describe("ui.* translation parity (IPR-048)", () => {
  it("all six files expose the identical ui.* key tree", async () => {
    const byLang: Record<string, string[]> = {};
    for (const lang of LANG_FILES) {
      byLang[lang] = await loadUiKeys(lang);
    }
    const baseline = byLang.en;
    expect(baseline.length).toBeGreaterThan(30);
    for (const lang of LANG_FILES) {
      expect(byLang[lang]).toEqual(baseline);
    }
  });

  it("covers every shared-state key the templates consume", async () => {
    const keys = await loadUiKeys("en");
    // flatten() is seeded with the `ui` object, so keys are relative to it.
    for (const required of [
      "state.loading",
      "state.emptyTitle",
      "state.noResultsTitle",
      "state.clearFilters",
      "state.errorTitle",
      "state.forbiddenTitle",
      "actions.retry",
      "actions.cancel",
      "inspector.region",
      "inspector.close",
      "task.viewActivity",
      "settings.saved",
      "settings.saveFailed",
      "landing.continue",
      "landing.attention",
    ]) {
      expect(keys).toContain(required);
    }
  });
});
