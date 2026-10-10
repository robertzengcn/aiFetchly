/**
 * Portable-memory i18n parity test (FR-066) — the `portableMemory` group
 * consumed by the portable-memory UI (PortableMemoryEnableDialog,
 * PortableMemoryConflictDialog, PortableMemoryDiagnosticsDialog,
 * WorkspaceMemoryPanel portable banner) must exist in ALL SIX supported
 * language files with identical key sets and non-empty string values.
 *
 * This locks the contract so a developer cannot add a key to one lang file
 * without updating the other five (the most common i18n regression).
 */

import { describe, it, expect } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

type LangMessages = Record<string, Record<string, unknown>>;

const LANGS: Record<string, LangMessages> = { en, zh, es, fr, de, ja };

/** Recursively collect all leaf key paths under a group. */
function collectKeyPaths(obj: Record<string, unknown>, prefix: string): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...collectKeyPaths(value as Record<string, unknown>, path));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

describe("FR-066 — portableMemory i18n parity across all six languages", () => {
  // First, establish the canonical key set from English (the fallback source).
  const enKeys = collectKeyPaths(
    en.portableMemory as Record<string, unknown>,
    ""
  );
  expect(enKeys.length, "en portableMemory must have keys").toBeGreaterThan(0);
  const enKeySet = enKeys.join(",");

  for (const [code, lang] of Object.entries(LANGS)) {
    describe(`${code}: portableMemory group`, () => {
      it("has a non-empty portableMemory object", () => {
        expect(typeof lang.portableMemory).toBe("object");
        expect(lang.portableMemory).not.toBeNull();
      });

      it("matches the English key set exactly (no missing, no extra)", () => {
        const langKeys = collectKeyPaths(
          lang.portableMemory as Record<string, unknown>,
          ""
        );
        const langKeySet = langKeys.join(",");
        expect(langKeySet, `${code} must match en portableMemory keys`).toBe(
          enKeySet
        );
      });

      it("has non-empty string values for every leaf key", () => {
        const langKeys = collectKeyPaths(
          lang.portableMemory as Record<string, unknown>,
          ""
        );
        for (const keyPath of langKeys) {
          const parts = keyPath.split(".");
          let value: unknown = lang.portableMemory;
          for (const part of parts) {
            value = (value as Record<string, unknown>)?.[part];
          }
          expect(
            typeof value === "string" && value.length > 0,
            `${code}.${keyPath} must be a non-empty string`
          ).toBe(true);
        }
      });
    });
  }
});
