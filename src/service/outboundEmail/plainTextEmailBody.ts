import { htmlToPlainText } from "@/service/emailReceive/EmailHtmlSanitizer";

/**
 * Tags a model is likely to wrap around an outbound body when it treats the
 * message as HTML. Deliberately excludes bare angle brackets such as
 * `<https://example.com>` so a plain-text link is not rewritten.
 */
const OUTBOUND_HTML_MARKUP =
  /<\/?(?:html|head|body|div|p|br|span|a|table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|strong|em|b|i|u|img|style|font|center|blockquote|hr|pre|code)\b[^>]*>/i;

/**
 * Outbound mail is text/plain by default. Real plain text is returned
 * unchanged, including line breaks. HTML markup is reduced to text so
 * recipients do not see tags and no HTML MIME part is created.
 */
export function coerceOutboundEmailBodyToPlainText(content: string): string {
  const trimmed = content.trim();
  if (!OUTBOUND_HTML_MARKUP.test(trimmed)) {
    return trimmed;
  }
  const plain = htmlToPlainText(trimmed);
  if (plain.length > 0) {
    return plain;
  }
  const stripped = trimmed
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 0 ? stripped : trimmed;
}

/**
 * Prefer the plain-text `email_content` argument. `email_html_content` remains
 * accepted for older callers; markup in either field is sent as text.
 */
export function resolveInlineOutboundBody(input: {
  email_content?: string | null;
  email_html_content?: string | null;
}): string | undefined {
  const preferred = input.email_content?.trim() ?? "";
  const legacy = input.email_html_content?.trim() ?? "";
  const raw = preferred.length > 0 ? preferred : legacy;
  if (raw.length === 0) {
    return undefined;
  }
  return coerceOutboundEmailBodyToPlainText(raw);
}
