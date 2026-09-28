import type { DocumentInfo } from "@/views/api/rag";

/**
 * Shape required to render a document row's author and tags columns.
 * Mirrors the subset of {@link DocumentInfo} used by the table display so the
 * helpers stay decoupled from the full entity and are trivially unit-testable.
 */
export interface DocumentTableRow {
  author?: string;
  tags?: string[];
}

/**
 * Default author applied at upload time when the user leaves the field blank.
 * Stored on the document but hidden in the table so the column reads as empty
 * rather than showing the literal word "User" (PRD §8.2.3).
 */
export const DEFAULT_AUTHOR = "User";

/**
 * Default tags applied at upload time when the user leaves tags blank. Stored
 * on the document but hidden in the table so noise chips don't crowd real
 * user tags. They remain stored so the embedding header and filters still see
 * them (PRD §8.2.3).
 */
export const DEFAULT_TAGS: readonly string[] = ["uploaded", "knowledge"];

/**
 * Returns the author to display in the document table, or an empty string
 * when the stored value is the upload default {@link DEFAULT_AUTHOR} or
 * missing. The stored value is never mutated.
 */
export function displayAuthor(doc: DocumentTableRow): string {
  if (!doc.author || doc.author === DEFAULT_AUTHOR) {
    return "";
  }
  return doc.author;
}

/**
 * Returns the tags to render as chips in the document table, filtering out the
 * upload defaults ({@link DEFAULT_TAGS}) case-insensitively. Defaults are
 * hidden unconditionally — not only when they are the sole tags — so a
 * document tagged `["uploaded", "knowledge", "pricing"]` shows just
 * `["pricing"]`. The stored array is never mutated; a new array is returned.
 */
export function visibleTags(doc: DocumentTableRow): string[] {
  const tags: string[] = doc.tags ?? [];
  if (tags.length === 0) {
    return [];
  }
  const hidden = new Set(DEFAULT_TAGS.map((tag) => tag.toLowerCase()));
  return tags.filter((tag) => !hidden.has(tag.toLowerCase()));
}
