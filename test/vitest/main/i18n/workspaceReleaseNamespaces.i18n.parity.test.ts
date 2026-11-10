/**
 * Workspace release namespaces i18n parity (R8 §2 "Localization test lock").
 *
 * Locks the namespaces the R8 audit found present but unlocked:
 * `outboundEmail`, `aiConversationReport`, `workspaceMemory`, and the whole
 * `aiChatV2` tree (`voice` / `toolOutput` have their own narrower locks;
 * this whole-tree lock is strictly stronger and includes them).
 *
 * A key missing from a non-English locale degrades to the English fallback;
 * a key missing from `en` shows the raw key path. This test fails when a
 * developer adds/moves a key in one lang file without updating the other
 * five, and asserts every leaf value is a non-empty string.
 */
import { describe, it, expect } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

// Lang files are default-exported message objects. Index dynamically with a
// permissive record type so minor structural drift elsewhere does not
// produce spurious TS errors here.
type LangMessages = Record<string, Record<string, unknown>>;

const LANGS: Record<string, LangMessages> = { en, zh, es, fr, de, ja };

const NAMESPACES = [
  "outboundEmail",
  "aiConversationReport",
  "workspaceMemory",
  "aiChatV2",
] as const;

type Namespace = (typeof NAMESPACES)[number];

function section(lang: LangMessages, ns: Namespace): unknown {
  return lang[ns];
}

/** Sorted key paths of the whole (possibly nested) section. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }
  const out: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object") {
      out.push(...keyPaths(child, path));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

/** Every leaf must be a non-empty string (interpolation tokens included). */
function nonStringLeaves(
  value: unknown,
  prefix = ""
): Array<{ path: string; type: string }> {
  const bad: Array<{ path: string; type: string }> = [];
  if (value === null || typeof value !== "object") {
    if (typeof value !== "string" || value.length === 0) {
      bad.push({ path: prefix || "<root>", type: typeof value });
    }
    return bad;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    bad.push(
      ...nonStringLeaves(child, prefix ? `${prefix}.${key}` : key)
    );
  }
  return bad;
}

describe("workspace release namespaces i18n parity (R8)", () => {
  for (const ns of NAMESPACES) {
    describe(ns, () => {
      it("exists in all six languages", () => {
        for (const [code, lang] of Object.entries(LANGS)) {
          const value = section(lang, ns);
          expect(
            value !== undefined && value !== null,
            `${ns} section missing in ${code}`
          ).toBe(true);
        }
      });

      it("every leaf is a non-empty string", () => {
        for (const [code, lang] of Object.entries(LANGS)) {
          const bad = nonStringLeaves(section(lang, ns));
          expect(
            bad,
            `${code}.${ns} has non-string/empty leaves: ${JSON.stringify(
              bad.slice(0, 10)
            )}`
          ).toEqual([]);
        }
      });

      it("key tree is identical across en/zh/es/fr/de/ja", () => {
        const reference = keyPaths(section(en, ns)).join("\n");
        expect(
          reference.length,
          `en.${ns} key tree must not be empty`
        ).toBeGreaterThan(0);
        for (const [code, lang] of Object.entries(LANGS)) {
          if (code === "en") continue;
          const actual = keyPaths(section(lang, ns)).join("\n");
          expect(
            actual,
            `${code}.${ns} key tree mismatch — run the en tree against this locale and add the missing keys`
          ).toBe(reference);
        }
      });
    });
  }
});
