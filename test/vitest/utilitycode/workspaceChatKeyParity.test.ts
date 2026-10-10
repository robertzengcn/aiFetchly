import { describe, expect, it } from "vitest";

const LANG_FILES = ["en", "zh", "es", "fr", "de", "ja"] as const;

function flatten(obj: unknown, prefix = ""): string[] {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(
      ([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key)
    );
  }
  return [prefix];
}

async function loadWorkspaceChatKeys(lang: string): Promise<string[]> {
  const modules: Record<
    string,
    () => Promise<{ default: Record<string, unknown> }>
  > = {
    en: () => import("@/views/lang/en"),
    zh: () => import("@/views/lang/zh"),
    es: () => import("@/views/lang/es"),
    fr: () => import("@/views/lang/fr"),
    de: () => import("@/views/lang/de"),
    ja: () => import("@/views/lang/ja"),
  };
  const mod = await modules[lang]();
  return flatten(mod.default?.workspaceChat).sort();
}

describe("workspaceChat recursive key-parity (FR-040)", () => {
  it("all six languages expose the identical workspaceChat key tree", async () => {
    const byLang: Record<string, string[]> = {};
    for (const lang of LANG_FILES) {
      byLang[lang] = await loadWorkspaceChatKeys(lang);
    }
    const baseline = byLang.en;
    expect(baseline.length).toBeGreaterThan(50);
    for (const lang of LANG_FILES) {
      expect(byLang[lang]).toEqual(baseline);
    }
  });

  it("covers every header/overflow key the shell consumes", async () => {
    const keys = await loadWorkspaceChatKeys("en");
    for (const required of [
      "header.overflow",
      "header.rename",
      "header.renamePrompt",
      "header.compact",
      "header.clear",
      "header.clearConfirm",
      "header.delete",
      "header.export",
      "header.duplicate",
      "header.deleteConfirm",
    ]) {
      expect(keys).toContain(required);
    }
  });

  it("all values are non-empty strings (no regression fallback risk)", async () => {
    for (const lang of LANG_FILES) {
      const modules: Record<
        string,
        () => Promise<{ default: Record<string, unknown> }>
      > = {
        en: () => import("@/views/lang/en"),
        zh: () => import("@/views/lang/zh"),
        es: () => import("@/views/lang/es"),
        fr: () => import("@/views/lang/fr"),
        de: () => import("@/views/lang/de"),
        ja: () => import("@/views/lang/ja"),
      };
      const mod = await modules[lang]();
      const ws = mod.default?.workspaceChat as Record<string, unknown>;
      const header = ws?.header as Record<string, unknown> | undefined;
      expect(header).toBeDefined();
      for (const [, val] of Object.entries(header!)) {
        expect(typeof val).toBe("string");
        expect((val as string).length).toBeGreaterThan(0);
      }
    }
  });
});
