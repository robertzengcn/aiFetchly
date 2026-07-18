/**
 * Validation + normalization for AI HTML artifacts.
 *
 * IMPORTANT: this service is a product/performance guard, NOT the primary
 * security boundary. The renderer's sandboxed iframe (`sandbox=""`) is the
 * real boundary that prevents script execution, form submission, and parent
 * navigation. Validation here rejects obviously unsupported patterns so the
 * model gets a clear retry signal and artifacts stay simple — it does not
 * guarantee fully sanitized HTML.
 *
 * @see docs/prd/ai-html-artifacts-technical-design.md §7, §14
 */

/** MVP field-size limits. */
export const AI_HTML_ARTIFACT_MAX_TITLE_LENGTH = 160;
export const AI_HTML_ARTIFACT_MAX_DESCRIPTION_LENGTH = 500;
/** 512 KB is enough for inline CSS + substantial reports. */
export const AI_HTML_ARTIFACT_MAX_HTML_BYTES = 512 * 1024;

/** Validated, normalized payload ready to hand to AIArtifactModule. */
export interface ValidatedHtmlArtifactInput {
  title: string;
  description?: string;
  html: string;
  openImmediately: boolean;
}

/** Discriminated validation result. */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Patterns the MVP does not support. Intentionally conservative: the
 * sandbox is the real guard, so we reject loudly to steer the model rather
 * than attempt silent sanitization.
 */
const DISALLOWED_HTML_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  { pattern: /<script\b/i, reason: "Scripts are not supported in HTML artifacts." },
  { pattern: /\son\w+\s*=/i, reason: "Inline event handlers are not supported." },
  { pattern: /\bjavascript\s*:/i, reason: "javascript: URLs are not supported." },
  { pattern: /<iframe\b/i, reason: "Nested iframes are not supported." },
  { pattern: /<object\b/i, reason: "Object embeds are not supported." },
  { pattern: /<embed\b/i, reason: "Embeds are not supported." },
  {
    pattern: /<link\b[^>]*href\s*=\s*["']?https?:\/\//i,
    reason: "Remote stylesheets are not supported.",
  },
  {
    pattern: /<img\b[^>]*src\s*=\s*["']?https?:\/\//i,
    reason: "Remote images are not supported.",
  },
  {
    pattern: /<audio\b[^>]*src\s*=\s*["']?https?:\/\//i,
    reason: "Remote audio is not supported.",
  },
  {
    pattern: /<video\b[^>]*src\s*=\s*["']?https?:\/\//i,
    reason: "Remote video is not supported.",
  },
  {
    pattern: /<source\b[^>]*src\s*=\s*["']?https?:\/\//i,
    reason: "Remote media sources are not supported.",
  },
  { pattern: /<form\b/i, reason: "Forms are not supported in HTML artifacts." },
  {
    pattern: /\btarget\s*=\s*["']?_parent/i,
    reason: "Parent navigation is not supported.",
  },
  {
    pattern: /\btarget\s*=\s*["']?_top/i,
    reason: "Top navigation is not supported.",
  },
];

/** Escape the five significant HTML characters in a text node/attribute value. */
export function escapeHtmlText(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wrap a bare fragment in a full HTML document. Full documents and fragments
 * that already start with `<!doctype html>` / `<html>` are returned as-is.
 */
export function ensureHtmlDocument(html: string, title: string): string {
  const trimmed = html.trim();
  if (/<!doctype html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtmlText(title)}</title>
</head>
<body>
${trimmed}
</body>
</html>`;
}

/**
 * Validate raw `create_html_artifact` tool arguments.
 *
 * Rules (see tech design §7.2):
 *  - `title` required, non-empty after trim, <= 160 chars
 *  - `description` optional, <= 500 chars
 *  - `html` required, non-empty after trim, UTF-8 byte length <= 512 KB
 *  - `openImmediately` defaults to true
 *  - rejects disallowed patterns (scripts, forms, remote resources, etc.)
 */
export function validateCreateInput(
  args: Record<string, unknown>
): ValidationResult<ValidatedHtmlArtifactInput> {
  if (!args || typeof args !== "object") {
    return { ok: false, error: "Invalid tool arguments." };
  }

  const titleRaw = args.title;
  if (typeof titleRaw !== "string" || titleRaw.trim().length === 0) {
    return { ok: false, error: "A non-empty title is required." };
  }
  const title = titleRaw.trim();
  if (title.length > AI_HTML_ARTIFACT_MAX_TITLE_LENGTH) {
    return {
      ok: false,
      error: `The artifact title must be at most ${AI_HTML_ARTIFACT_MAX_TITLE_LENGTH} characters.`,
    };
  }

  let description: string | undefined;
  const descriptionRaw = args.description;
  if (descriptionRaw !== undefined && descriptionRaw !== null) {
    if (typeof descriptionRaw !== "string") {
      return { ok: false, error: "The artifact description must be a string." };
    }
    if (descriptionRaw.length > AI_HTML_ARTIFACT_MAX_DESCRIPTION_LENGTH) {
      return {
        ok: false,
        error: `The artifact description must be at most ${AI_HTML_ARTIFACT_MAX_DESCRIPTION_LENGTH} characters.`,
      };
    }
    description =
      descriptionRaw.trim().length > 0 ? descriptionRaw.trim() : undefined;
  }

  const htmlRaw = args.html;
  if (typeof htmlRaw !== "string" || htmlRaw.trim().length === 0) {
    return { ok: false, error: "A non-empty HTML body is required." };
  }

  const byteLength = Buffer.byteLength(htmlRaw, "utf8");
  if (byteLength > AI_HTML_ARTIFACT_MAX_HTML_BYTES) {
    return {
      ok: false,
      error: "The HTML artifact exceeds the maximum allowed size.",
    };
  }

  for (const { pattern, reason } of DISALLOWED_HTML_PATTERNS) {
    if (pattern.test(htmlRaw)) {
      return { ok: false, error: reason };
    }
  }

  const openImmediately = args.openImmediately !== false;

  return {
    ok: true,
    value: {
      title,
      description,
      html: ensureHtmlDocument(htmlRaw, title),
      openImmediately,
    },
  };
}

/**
 * Convenience namespace so callers can write `AIArtifactValidationService.validateCreateInput`.
 */
export const AIArtifactValidationService = {
  validateCreateInput,
  ensureHtmlDocument,
  escapeHtmlText,
  DISALLOWED_HTML_PATTERNS,
  MAX_TITLE_LENGTH: AI_HTML_ARTIFACT_MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH: AI_HTML_ARTIFACT_MAX_DESCRIPTION_LENGTH,
  MAX_HTML_BYTES: AI_HTML_ARTIFACT_MAX_HTML_BYTES,
};
