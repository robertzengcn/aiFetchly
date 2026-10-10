import { describe, expect, it } from "vitest";
import {
  replyBindingI18nKey,
  REPLY_BINDING_KEY_PREFIX,
} from "@/service/emailReply/ReplyBindingMessageMap";
import type { SendBindingErrorCode } from "@/service/emailReply/EmailReplySendBinding";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

const locales: Record<string, unknown> = { en, zh, es, fr, de, ja };

/** All 12 binding codes — every one must map to a distinct i18n key (P1.2, FR-013). */
const ALL_CODES: SendBindingErrorCode[] = [
  "draft_token_mismatch",
  "approval_stale",
  "hash_mismatch",
  "revision_hash_mismatch",
  "mailbox_mismatch",
  "service_inactive",
  "service_missing",
  "sender_mismatch",
  "recipient_mismatch",
  "smtp_username_mismatch",
  "reply_to_mismatch",
  "legacy_reply_identity_requires_review",
];

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

describe("replyBindingI18nKey", () => {
  it("maps each binding code to a distinct emailReplyBinding.* key", () => {
    const keys = ALL_CODES.map((code) => replyBindingI18nKey(code));
    for (const [i, code] of ALL_CODES.entries()) {
      expect(keys[i]).toBe(`${REPLY_BINDING_KEY_PREFIX}${code}`);
    }
    // No two codes may share a key — the whole point of P1.2 is that each
    // failed binding check gets its own message.
    expect(new Set(keys).size).toBe(ALL_CODES.length);
  });

  it("returns null for null and undefined codes", () => {
    expect(replyBindingI18nKey(null)).toBeNull();
    expect(replyBindingI18nKey(undefined)).toBeNull();
  });

  it("every mapped key exists in all six language files (P1.2 depends on P0.2)", () => {
    for (const code of ALL_CODES) {
      const key = replyBindingI18nKey(code) as string;
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

  it("the three v2 identity codes are distinct keys present in all six locales", () => {
    const identityCodes: SendBindingErrorCode[] = [
      "smtp_username_mismatch",
      "sender_mismatch",
      "reply_to_mismatch",
    ];
    for (const code of identityCodes) {
      const key = replyBindingI18nKey(code) as string;
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

  it("identity mismatch messages tell the user to re-review/re-approve the draft", () => {
    const identityCodes: SendBindingErrorCode[] = [
      "smtp_username_mismatch",
      "sender_mismatch",
      "reply_to_mismatch",
    ];
    for (const code of identityCodes) {
      const key = replyBindingI18nKey(code) as string;
      const segments = key.split(".");
      for (const [lang, dict] of Object.entries(locales)) {
        const value = getPath(dict, segments) as string;
        // en: "...review and approve the draft again..."
        expect(value, `${lang} ${key} must mention review/approval`).toMatch(
          /review|revis|prüf|genehmig|確認|确认|校验|审核|审批|確認し|검토|approuv|aprob|批准|承認|approve|revisi|prue/i
        );
      }
    }
  });
});
