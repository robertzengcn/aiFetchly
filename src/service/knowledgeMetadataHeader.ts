export interface EmbeddingHeaderSource {
  fileName: string;
  title?: string;
  author?: string;
  tags?: string[];
  description?: string;
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
  if (lines.length === 0) {
    return chunkContent;
  }
  return `${lines.join("\n")}\n\n${chunkContent}`;
}
