import { describe, expect, it } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

type UnknownRecord = Record<string, unknown>;

function leafKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }
  const record = value as UnknownRecord;
  return Object.entries(record).flatMap(([key, inner]) =>
    leafKeys(inner, prefix ? `${prefix}.${key}` : key)
  );
}

describe("chat-titles translations (AC-14)", () => {
  const locales: Array<[string, UnknownRecord]> = [
    ["zh", zh as UnknownRecord],
    ["es", es as UnknownRecord],
    ["fr", fr as UnknownRecord],
    ["de", de as UnknownRecord],
    ["ja", ja as UnknownRecord],
  ];

  it("every chat-titles key in en exists in all five other languages", () => {
    const enKeys = new Set(leafKeys(en));
    const chatTitleKeys = [...enKeys].filter(
      (key) =>
        key.startsWith("workspaceChat.renameDialog") ||
        key.startsWith("aiProvider.chatTitles")
    );
    // Contract guard: the feature actually shipped its keys.
    expect(chatTitleKeys.length).toBeGreaterThanOrEqual(
      13 + 6 // renameDialog(13) + chatTitles(6)
    );
    for (const [locale, messages] of locales) {
      const localeKeys = new Set(leafKeys(messages));
      const missing = chatTitleKeys.filter((key) => !localeKeys.has(key));
      expect(missing, `${locale} missing keys: ${missing.join(", ")}`).toEqual(
        []
      );
    }
  });

  it("translations are non-empty strings (not copied placeholder keys)", () => {
    for (const [locale, messages] of locales) {
      const dialog = (messages.workspaceChat as UnknownRecord)
        .renameDialog as UnknownRecord;
      expect(String(dialog.title).length, `${locale} title empty`).toBeGreaterThan(0);
      const chatTitles = (messages.aiProvider as UnknownRecord)
        .chatTitles as UnknownRecord;
      expect(String(chatTitles.autoToggle).length).toBeGreaterThan(0);
    }
  });
});
