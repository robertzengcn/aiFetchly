import { describe, expect, it } from "vitest";
import {
  smtpFailureI18nKey,
  SMTP_ERROR_KEY_PREFIX,
} from "@/service/emailService/SmtpFailureMessageMap";
import type { SmtpFailureCode } from "@/modules/lib/smtpErrorClassifier";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

const locales: Record<string, unknown> = { en, zh, es, fr, de, ja };

/** Traverse a dotted i18n key path against a locale object. */
function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (
      cur &&
      typeof cur === "object" &&
      seg in (cur as Record<string, unknown>)
    ) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

describe("smtpFailureI18nKey", () => {
  it("maps each failure code to a distinct emailservice.smtp_error_* key", () => {
    const cases: Array<[SmtpFailureCode, string]> = [
      ["smtp_auth_failed", "auth_failed"],
      ["smtp_from_rejected", "from_rejected"],
      ["smtp_recipient_rejected", "recipient_rejected"],
      ["smtp_tls_failed", "tls_failed"],
      ["smtp_connection_failed", "connection_failed"],
      ["smtp_submission_failed", "submission_failed"],
      ["delivery_unknown", "unknown"],
    ];
    for (const [code, suffix] of cases) {
      expect(smtpFailureI18nKey(code)).toBe(
        `${SMTP_ERROR_KEY_PREFIX}${suffix}`
      );
    }
  });

  it("returns null for null (resolution/setup errors are not categorized)", () => {
    expect(smtpFailureI18nKey(null)).toBeNull();
  });

  it("every mapped key exists in all six language files (PRD §15, DoD)", () => {
    const codes: SmtpFailureCode[] = [
      "smtp_auth_failed",
      "smtp_from_rejected",
      "smtp_recipient_rejected",
      "smtp_tls_failed",
      "smtp_connection_failed",
      "smtp_submission_failed",
      "delivery_unknown",
    ];
    for (const code of codes) {
      const key = smtpFailureI18nKey(code) as string;
      const segments = key.split(".");
      for (const [lang, dict] of Object.entries(locales)) {
        const value = getPath(dict, segments);
        expect(typeof value, `${lang} missing ${key}`).toBe("string");
        expect(
          (value as string).length,
          `${lang} empty ${key}`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("From-alias rejection guidance tells the user to verify the alias with their provider (PRD §15)", () => {
    const key = smtpFailureI18nKey("smtp_from_rejected") as string;
    const segments = key.split(".");
    for (const [, dict] of Object.entries(locales)) {
      const value = getPath(dict, segments) as string;
      // The From-alias message must mention verifying the alias is allowed.
      // It must NOT recommend changing TLS settings (that is a different code).
      expect(value.toLowerCase()).toMatch(
        /verif|verify|prueba|compruebe|vérif|prüfen|確認|确认|验证|확인/
      );
    }
  });
});
