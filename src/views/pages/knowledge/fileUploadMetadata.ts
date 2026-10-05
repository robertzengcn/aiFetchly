export interface FileUploadMetadataInput {
  author: string;
  description: string;
  tags: readonly unknown[];
}

export interface FileUploadMetadata {
  title: string;
  description: string;
  tags: string[];
  author: string;
}

export const MAX_AUTHOR_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 64;
const DEFAULT_TAGS: string[] = ["uploaded", "knowledge"];
const DEFAULT_AUTHOR = "User";

/**
 * Error codes thrown by upload metadata normalization. These are stable
 * identifiers the UI maps to translated messages via
 * `t('knowledge.tag_error_<code>', params)` — they are never shown raw to the
 * user. Keeping them as codes (instead of English prose) lets the dialog show
 * the active UI language (PRD §9 / technical design §4.1).
 */
export type FileUploadMetadataErrorCode =
  | "tag_too_long"
  | "too_many_tags"
  | "author_too_long"
  | "description_too_long";

export interface FileUploadMetadataErrorParams {
  /** 1-based index of the offending tag within the user's input list. */
  readonly index?: number;
  /** The offending tag value (already trimmed). */
  readonly tag?: string;
  /** The applicable maximum length. */
  readonly max?: number;
  /** The applicable maximum count. */
  readonly maxCount?: number;
}

export class FileUploadMetadataError extends Error {
  readonly code: FileUploadMetadataErrorCode;
  readonly params: FileUploadMetadataErrorParams;

  constructor(
    code: FileUploadMetadataErrorCode,
    params: FileUploadMetadataErrorParams = {}
  ) {
    super(code);
    this.name = "FileUploadMetadataError";
    this.code = code;
    this.params = params;
  }
}

export function normalizeUploadTags(tags: readonly unknown[]): string[] {
  const kept: string[] = [];
  const seenLower = new Set<string>();
  let inputIndex = 0;
  for (const entry of tags) {
    const trimmed: string = String(entry ?? "").trim();
    if (trimmed.length === 0) {
      inputIndex++;
      continue;
    }
    if (trimmed.length > MAX_TAG_LENGTH) {
      throw new FileUploadMetadataError("tag_too_long", {
        index: inputIndex + 1,
        tag: trimmed,
        max: MAX_TAG_LENGTH,
      });
    }
    inputIndex++;
    const folded: string = trimmed.toLowerCase();
    if (seenLower.has(folded)) {
      continue;
    }
    seenLower.add(folded);
    kept.push(trimmed);
    if (kept.length > MAX_TAGS) {
      throw new FileUploadMetadataError("too_many_tags", {
        maxCount: MAX_TAGS,
      });
    }
  }
  return kept;
}

function stemFileName(fileName: string): string {
  const stem: string = fileName.replace(/\.[^/.]+$/, "");
  return stem.length > 0 ? stem : fileName;
}

export function buildFileUploadMetadata(
  fileName: string,
  input: FileUploadMetadataInput
): FileUploadMetadata {
  const authorTrimmed: string = input.author.trim();
  if (authorTrimmed.length > MAX_AUTHOR_LENGTH) {
    throw new FileUploadMetadataError("author_too_long", {
      max: MAX_AUTHOR_LENGTH,
    });
  }
  const descriptionTrimmed: string = input.description.trim();
  if (descriptionTrimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new FileUploadMetadataError("description_too_long", {
      max: MAX_DESCRIPTION_LENGTH,
    });
  }
  const tags: string[] = normalizeUploadTags(input.tags);
  return {
    title: stemFileName(fileName),
    description:
      descriptionTrimmed.length > 0
        ? descriptionTrimmed
        : `Uploaded document: ${fileName}`,
    tags: tags.length > 0 ? tags : [...DEFAULT_TAGS],
    author: authorTrimmed.length > 0 ? authorTrimmed : DEFAULT_AUTHOR,
  };
}

/**
 * Resolve a {@link FileUploadMetadataError} (or any thrown value) into a
 * translated, user-facing message. Returns the translated "Upload failed"
 * message when the error is not a recognized metadata error.
 */
export function resolveUploadErrorMessage(
  error: unknown,
  translate: (key: string, params?: Record<string, unknown>) => string,
  uploadFailedKey = "knowledge.upload_failed"
): string {
  const prefix: string = translate(uploadFailedKey);
  if (error instanceof FileUploadMetadataError) {
    const key = `knowledge.tag_error_${error.code}`;
    const message: string = translate(key, {
      index: error.params.index,
      tag: error.params.tag,
      max: error.params.max,
      maxCount: error.params.maxCount,
    });
    // If the translation is missing, vue-i18n returns the key itself. Fall
    // back to the generic upload-failed message so the user never sees a raw
    // code string.
    if (message && message !== key) {
      return `${prefix}: ${message}`;
    }
    return prefix;
  }
  return `${prefix}: ${
    error instanceof Error ? error.message : "Unknown error"
  }`;
}
