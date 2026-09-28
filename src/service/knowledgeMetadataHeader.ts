import {
  KNOWLEDGE_CUSTOM_METADATA_KEYS,
  type KnowledgeCustomMetadata,
} from "@/schemas/knowledge/customMetadata";

export interface EmbeddingHeaderSource {
  fileName: string;
  title?: string;
  author?: string;
  tags?: string[];
  description?: string;
  // Phase 3 metadata. Optional; included only when present.
  language?: string;
  documentDate?: string;
  customMetadata?: KnowledgeCustomMetadata;
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function isDefaultTags(tags: string[] | undefined): boolean {
  if (!tags || tags.length === 0) {
    return true;
  }
  const folded: string[] = tags
    .map((t: string) => t.trim().toLowerCase())
    .filter((t: string) => t.length > 0);
  if (folded.length === 0) {
    return true;
  }
  if (folded.length !== 2) {
    return false;
  }
  return folded.includes("uploaded") && folded.includes("knowledge");
}

/**
 * Capitalize the first letter of a custom-metadata key for the header label
 * ("product" -> "Product"). The allowlist keys are all lowercase ASCII.
 */
function labelize(key: string): string {
  if (key.length === 0) {
    return key;
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function buildEmbeddingInput(
  source: EmbeddingHeaderSource,
  chunkContent: string
): string {
  const lines: string[] = [];
  const title: string = (source.title ?? "").trim();
  if (title.length > 0) {
    lines.push(`Title: ${singleLine(title)}`);
  }
  const author: string = (source.author ?? "").trim();
  if (author.length > 0 && author !== "User") {
    lines.push(`Author: ${singleLine(author)}`);
  }
  if (!isDefaultTags(source.tags)) {
    const tags: string[] = (source.tags ?? [])
      .map((t: string) => singleLine(t))
      .filter((t: string) => t.length > 0);
    if (tags.length > 0) {
      lines.push(`Tags: ${tags.join(", ")}`);
    }
  }
  const description: string = (source.description ?? "").trim();
  const defaultDescription = `Uploaded document: ${source.fileName}`;
  if (description.length > 0 && description !== defaultDescription) {
    lines.push(`Description: ${singleLine(description)}`);
  }
  // Phase 3 header lines. Each is collapsed to a single line and omitted when
  // empty, so a description cannot smuggle extra header lines (technical
  // design §7: header labels are fixed constants, user text is one line).
  const language: string = (source.language ?? "").trim();
  if (language.length > 0) {
    lines.push(`Language: ${singleLine(language)}`);
  }
  const documentDate: string = (source.documentDate ?? "").trim();
  if (documentDate.length > 0) {
    lines.push(`Document date: ${singleLine(documentDate)}`);
  }
  if (source.customMetadata) {
    // Iterate the fixed allowlist in its declared order so the header is
    // deterministic regardless of object key order.
    for (const key of KNOWLEDGE_CUSTOM_METADATA_KEYS) {
      const value = source.customMetadata[key];
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          lines.push(`${labelize(key)}: ${singleLine(trimmed)}`);
        }
      }
    }
  }
  if (lines.length === 0) {
    return chunkContent;
  }
  return `${lines.join("\n")}\n\n${chunkContent}`;
}
