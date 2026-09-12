import { describe, it, expect } from "vitest";
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

/**
 * Relabeled identity-field keys (P0.2). The From label must NOT read
 * "sender account" anymore, and the hints must use From-address / mailbox
 * login wording rather than generic "input email sender account" text.
 */
const RELABEL_KEYS = [
  "from",
  "from_hint",
  "smtp_username_hint",
  "reply_to_hint",
];

/**
 * PRD §15 validation and approval category keys added by P0.2. These surface
 * validation/approval outcomes rather than provider SMTP responses.
 */
const IDENTITY_CATEGORY_KEYS = [
  "identity_missing_smtp_username",
  "identity_from_invalid",
  "identity_reply_to_invalid",
  "identity_changed_after_approval",
  "identity_import_password_required",
  "identity_header_break_forbidden",
];

describe("email service identity i18n completeness (P0.2, PRD §15)", () => {
  for (const [locale, dict] of Object.entries(locales)) {
    describe(`${locale} locale`, () => {
      for (const key of RELABEL_KEYS) {
        it(`has emailservice.${key}`, () => {
          const value = getPath(dict, ["emailservice", key]);
          expect(typeof value, `${locale} missing emailservice.${key}`).toBe(
            "string"
          );
          expect((value as string).length).toBeGreaterThan(0);
        });

        it(`emailservice.${key} is not stale "sender account" copy`, () => {
          const value = getPath(dict, ["emailservice", key]) as string;
          // The relabel must drop the old "sender account" / generic-input
          // wording everywhere except the smtp_username label itself
          // (which legitimately says "SMTP username").
          expect(value.toLowerCase()).not.toContain("sender account");
        });
      }

      for (const key of IDENTITY_CATEGORY_KEYS) {
        it(`has emailservice.${key}`, () => {
          const value = getPath(dict, ["emailservice", key]);
          expect(typeof value, `${locale} missing emailservice.${key}`).toBe(
            "string"
          );
          expect((value as string).length).toBeGreaterThan(0);
        });
      }

      it("smtp_username_hint uses mailbox-login wording, not 'From' fallback", () => {
        const value = getPath(dict, [
          "emailservice",
          "smtp_username_hint",
        ]) as string;
        // The hint must explain the username is the mailbox login, and must
        // NOT frame it as "defaults to the From address" (that fallback is a
        // backend concern, not user-facing copy).
        expect(value.toLowerCase()).not.toContain("default");
      });

      it("reply_to_hint mentions replies going to the address", () => {
        const value = getPath(dict, [
          "emailservice",
          "reply_to_hint",
        ]) as string;
        expect(value.toLowerCase()).toMatch(
          /repl|respuest|répons|antwort|返信|回复/
        );
      });

      it("from_hint mentions the provider allowing the address", () => {
        const value = getPath(dict, ["emailservice", "from_hint"]) as string;
        expect(value.toLowerCase()).toMatch(
          /provider|proveedor|fournisseur|anbieter|プロバイダ|服务商/
        );
      });
    });
  }
});
