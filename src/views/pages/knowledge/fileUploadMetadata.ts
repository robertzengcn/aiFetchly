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

const MAX_AUTHOR_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 64;
const DEFAULT_TAGS: string[] = ["uploaded", "knowledge"];
const DEFAULT_AUTHOR = "User";

export function normalizeUploadTags(tags: readonly unknown[]): string[] {
  const kept: string[] = [];
  const seenLower = new Set<string>();
  for (const entry of tags) {
    const trimmed: string = String(entry ?? "").trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.length > MAX_TAG_LENGTH) {
      throw new Error(`Tag exceeds ${MAX_TAG_LENGTH} characters: ${trimmed}`);
    }
    const folded: string = trimmed.toLowerCase();
    if (seenLower.has(folded)) {
      continue;
    }
    seenLower.add(folded);
    kept.push(trimmed);
    if (kept.length > MAX_TAGS) {
      throw new Error(`Too many tags (max ${MAX_TAGS})`);
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
    throw new Error(`Author exceeds ${MAX_AUTHOR_LENGTH} characters`);
  }
  const descriptionTrimmed: string = input.description.trim();
  if (descriptionTrimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
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
