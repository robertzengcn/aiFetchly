import {
  sanitizeEmailHtml,
  htmlToPlainText,
} from "@/service/emailReceive/EmailHtmlSanitizer";

/**
 * Safe inbound-body normalization (technical design §8, FR-020). Pure — the
 * receive-sync path feeds raw parts in and gets the normalized representation
 * out. Remote images, scripts, and active content are never loaded; HTML is
 * sanitized before conversion; truncation preserves recent content and
 * detected questions rather than always taking the first characters.
 */

export interface NormalizedEmailBody {
  readonly safeText: string;
  readonly newContentText: string;
  readonly quotedTextRemoved: boolean;
  readonly signatureRemoved: boolean;
  readonly source: "plain" | "html" | "empty";
  readonly truncated: boolean;
}

/** Conservative quote-boundary and signature detection (same rules as §9). */
function stripQuotedAndSignature(text: string): {
  text: string;
  quotedRemoved: boolean;
  signatureRemoved: boolean;
} {
  let quotedRemoved = false;
  let signatureRemoved = false;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^--\s?$/.test(line)) {
      signatureRemoved = true;
      break;
    }
    if (/^on .+ wrote:\s*$/i.test(line.trim())) {
      quotedRemoved = true;
      break;
    }
    if (/^\s*>/.test(line)) {
      quotedRemoved = true;
      continue;
    }
    kept.push(line);
  }
  return { text: kept.join("\n").trim(), quotedRemoved, signatureRemoved };
}

/**
 * Convert already-sanitized HTML to text with the project's structured
 * html-to-text converter (no regex as the primary parser — §8 step 3).
 */
export function htmlToText(html: string): string {
  return htmlToPlainText(html);
}

/** Truncate preserving the TAIL (recent content) and any question sentences. */
export function truncatePreservingRecentAndQuestions(
  text: string,
  maxChars: number
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const tail = text.slice(-maxChars);
  // Pull question sentences from the dropped head so detected questions survive.
  const head = text.slice(0, text.length - maxChars);
  const questions = head.match(/[^.!?\n]*\?[^.!?\n]*/g) ?? [];
  const questionBlock = questions.length
    ? questions.slice(-3).join(" ").trim()
    : "";
  const merged = questionBlock ? `${questionBlock}\n…\n${tail}` : `…\n${tail}`;
  return { text: merged.slice(0, maxChars + 200), truncated: true };
}

/**
 * Normalize one inbound message body. Prefers a meaningful plain-text part;
 * converts sanitized HTML when only HTML exists; splits quoted history from
 * newly-written content conservatively.
 */
export function normalizeEmailBody(input: {
  plainText?: string | null;
  sanitizedHtml?: string | null;
  maxChars?: number;
}): NormalizedEmailBody {
  const maxChars = input.maxChars ?? 20000;
  const plain = (input.plainText ?? "").trim();
  const html = (input.sanitizedHtml ?? "").trim();

  if (!plain && !html) {
    return {
      safeText: "",
      newContentText: "",
      quotedTextRemoved: false,
      signatureRemoved: false,
      source: "empty",
      truncated: false,
    };
  }

  let safeText: string;
  let source: "plain" | "html";
  if (plain) {
    safeText = plain;
    source = "plain";
  } else {
    // HTML-only: sanitize defensively, then convert with the structured walk.
    safeText = htmlToText(sanitizeEmailHtml(html) ?? "");
    source = "html";
  }

  // Normalize line endings + strip dangerous control characters.
  safeText = safeText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

  const truncatedResult = truncatePreservingRecentAndQuestions(
    safeText,
    maxChars
  );
  const stripped = stripQuotedAndSignature(truncatedResult.text);

  return {
    safeText: truncatedResult.text,
    newContentText: stripped.text,
    quotedTextRemoved: stripped.quotedRemoved,
    signatureRemoved: stripped.signatureRemoved,
    source,
    truncated: truncatedResult.truncated,
  };
}
