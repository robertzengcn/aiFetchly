import { describe, expect, it } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

/**
 * Localization parity for the AI-content-report feature (PRD §11.8, §18.4).
 *
 * Asserts every required key under `aiContentReport.*` exists in all six
 * supported language files. This catches translation omissions that would
 * otherwise fall back to English at runtime.
 */

const LANGS: Record<string, unknown> = { en, zh, es, fr, de, ja };

const REQUIRED_TOP_KEYS = [
  "action",
  "actionAriaLabel",
  "dialogTitle",
  "outputPreview",
  "imagesLabel",
  "imageAlt",
  "categoryLabel",
  "commentLabel",
  "consent",
  "privacyPolicy",
  "submit",
  "cancel",
  "tryAgain",
  "copyReference",
  "success",
  "reported",
  "imageUnavailable",
  "categories",
  "errors",
] as const;

const REQUIRED_ERROR_CODES = [
  "network",
  "auth_failed",
  "invalid_evidence",
  "payload_too_large",
  "rate_limited",
  "service_disabled",
  "server_error",
  "unknown",
  "categoryRequired",
  "imageRequired",
  "noEvidence",
] as const;

const REQUIRED_CATEGORIES = [
  "hate_or_harassment",
  "sexual_content",
  "violence_or_self_harm",
  "child_safety",
  "illegal_or_dangerous",
  "privacy_or_personal_data",
  "misinformation_or_deception",
  "copyright_or_ownership",
  "other",
] as const;

/** Read a possibly-nested key path from a language object. */
function readPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

describe("AI content report i18n parity", () => {
  for (const [langCode, langObj] of Object.entries(LANGS)) {
    describe(`lang ${langCode}`, () => {
      it("has the aiContentReport top-level block", () => {
        const block = readPath(langObj, ["aiContentReport"]);
        expect(block, `${langCode} missing aiContentReport block`).toBeDefined();
        expect(typeof block).toBe("object");
      });

      for (const key of REQUIRED_TOP_KEYS) {
        it(`has aiContentReport.${key}`, () => {
          const val = readPath(langObj, ["aiContentReport", key]);
          expect(val, `${langCode} missing aiContentReport.${key}`).toBeDefined();
        });
      }

      for (const code of REQUIRED_ERROR_CODES) {
        it(`has aiContentReport.errors.${code}`, () => {
          const val = readPath(langObj, ["aiContentReport", "errors", code]);
          expect(val, `${langCode} missing aiContentReport.errors.${code}`).toBeDefined();
          expect(typeof val).toBe("string");
          expect((val as string).length).toBeGreaterThan(0);
        });
      }

      for (const cat of REQUIRED_CATEGORIES) {
        it(`has aiContentReport.categories.${cat}`, () => {
          const val = readPath(langObj, ["aiContentReport", "categories", cat]);
          expect(val, `${langCode} missing aiContentReport.categories.${cat}`).toBeDefined();
          expect(typeof val).toBe("string");
          expect((val as string).length).toBeGreaterThan(0);
        });
      }
    });
  }
});
