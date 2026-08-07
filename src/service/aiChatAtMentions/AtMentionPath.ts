import type { ChatV2AtMentionKind } from "@/entityTypes/aiChatAtMentionTypes";

/**
 * Path normalization and mention-syntax helpers for @-mentions.
 *
 * Pure string utilities — no filesystem access. All real path validation
 * goes through FilePathGuard in the main-process services.
 */

export type PathNormalizeResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: "empty" | "control_chars" };

/**
 * Normalize a parsed mention path for validation.
 *
 * Rules (technical design §7.1):
 *  - reject empty / whitespace-only input
 *  - reject null bytes and control characters (defense before FilePathGuard)
 *  - convert backslashes to forward slashes
 *  - trim a leading `./`
 *  - keep absolute paths as supplied (FilePathGuard decides if they escape)
 *  - do NOT expand `~` in Phase 1
 */
export function normalizePathText(input: string): PathNormalizeResult {
  if (typeof input !== "string") return { ok: false, error: "empty" };
  if (input.includes("\0")) return { ok: false, error: "control_chars" };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(input)) {
    return { ok: false, error: "control_chars" };
  }

  let p = input.trim();
  if (p.length === 0) return { ok: false, error: "empty" };

  p = p.replace(/\\/g, "/");
  while (p.startsWith("./")) {
    p = p.slice(2);
  }
  if (p.length === 0) return { ok: false, error: "empty" };

  return { ok: true, path: p };
}

/**
 * Build the composer insertion text for a resolved suggestion.
 *
 * Paths containing whitespace are wrapped in double quotes. Directories get
 * a trailing `/`. Never includes a line range — the user types `#L..` later.
 */
export function buildInsertText(
  relativePath: string,
  kind: ChatV2AtMentionKind
): string {
  let p = relativePath;
  if (kind === "directory" && !p.endsWith("/")) {
    p = `${p}/`;
  }
  return /\s/.test(p) ? `@"${p}"` : `@${p}`;
}

/** Render a compact, user-facing label for a mention (no leading `@`). */
export function buildDisplayText(
  relativePath: string,
  kind: ChatV2AtMentionKind
): string {
  let p = relativePath;
  if (kind === "directory" && !p.endsWith("/")) {
    p = `${p}/`;
  }
  return p;
}

/** Escape fast-glob magic characters in a user query so it matches literally. */
const GLOB_SPECIAL_CHARS = /[*?[\]{}!()]/g;
export function escapeGlob(segment: string): string {
  return segment.replace(GLOB_SPECIAL_CHARS, (ch) => `[${ch}]`);
}
