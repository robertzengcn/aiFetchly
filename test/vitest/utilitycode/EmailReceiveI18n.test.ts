import { describe, it, expect } from "vitest";
import en from "@/views/lang/en";
import zh from "@/views/lang/zh";
import es from "@/views/lang/es";
import fr from "@/views/lang/fr";
import de from "@/views/lang/de";
import ja from "@/views/lang/ja";

const locales: Record<string, unknown> = { en, zh, es, fr, de, ja };

/** Required keys added by the email receive/reply feature. */
const REQUIRED_ROUTE_KEYS = [
  "email_receive",
  "email_receive_detail",
  "ai_auto_replies",
  "ai_auto_reply_detail",
];

const REQUIRED_EMAIL_RECEIVE_KEYS = [
  "receive_settings",
  "receive_enabled",
  "receive_disabled",
  "receive_protocol",
  "folder",
  "imap_host",
  "imap_port",
  "imap_ssl",
  "pop3_host",
  "pop3_port",
  "pop3_ssl",
  "receive_username",
  "receive_password",
  "test_connection",
  "test_save_first",
  "test_connection_success",
  "test_connection_failed",
  "messages_title",
  "sync",
  "reply_status",
  "subject",
  "from",
  "received_at",
  "unread",
  "unread_unavailable_pop3",
  "classification",
  "reply_to",
  "body_html",
  "body_text",
];

const REQUIRED_AUDIT_KEYS = [
  "title",
  "detail_title",
  "decision_status",
  "classification",
  "created_at",
  "confidence",
  "requires_approval",
  "reason",
  "knowledge_query",
  "knowledge_source_count",
  "generated_subject",
  "generated_body_preview",
  "sent_subject",
  "sent_body_preview",
];

const REQUIRED_AUDIT_STATUS_KEYS = [
  "draft_created",
  "approval_required",
  "auto_sent",
  "blocked",
  "skipped",
  "failed",
  "needs_human_review",
];

function getPath(obj: unknown, path: string[]): unknown {
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

describe("email receive/reply i18n completeness", () => {
  for (const [locale, dict] of Object.entries(locales)) {
    describe(`${locale} locale`, () => {
      for (const key of REQUIRED_ROUTE_KEYS) {
        it(`has route.${key}`, () => {
          expect(getPath(dict, ["route", key])).toBeTruthy();
        });
      }
      for (const key of REQUIRED_EMAIL_RECEIVE_KEYS) {
        it(`has emailReceive.${key}`, () => {
          expect(getPath(dict, ["emailReceive", key])).toBeTruthy();
        });
      }
      for (const key of REQUIRED_AUDIT_KEYS) {
        it(`has emailAutoReplyAudit.${key}`, () => {
          expect(getPath(dict, ["emailAutoReplyAudit", key])).toBeTruthy();
        });
      }
      for (const key of REQUIRED_AUDIT_STATUS_KEYS) {
        it(`has emailAutoReplyAudit.status.${key}`, () => {
          expect(getPath(dict, ["emailAutoReplyAudit", "status", key])).toBeTruthy();
        });
      }
    });
  }
});
