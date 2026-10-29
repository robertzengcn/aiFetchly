/**
 * Appends generated-image references to an assistant message's text content
 * so the LLM can see — in subsequent turns — which images it previously
 * produced.
 *
 * WHY THIS EXISTS
 * When the AI generates an image, the image descriptor (protocol URL,
 * file_name) is stored in the message row's `metadata.generatedImages`
 * JSON column, NOT in the `content` text. The conversation-history builder
 * ({@link AIChatContextAssembler}) only sends `content` to the model, so on
 * the next turn the model has no idea which images it produced earlier.
 *
 * This helper parses the metadata JSON and, when `generatedImages` is
 * present, appends a compact `<generated_images>` block to the content
 * **for the model request only**. The stored DB row is never modified.
 *
 * Context hygiene (TD-9): descriptors are compact semantic markers —
 * `[N] message=<id> image=<zero-based index> [file=<name>]` — never local
 * paths or protocol URLs. Explicit selection performs attachment elsewhere,
 * so the model only needs stable identifiers to refer to prior images.
 */

const GENERATED_IMAGES_MARKER = "<generated_images>";

const MAX_ANNOTATED_IMAGES = 10;

export interface GeneratedImageContextImage {
  readonly url: string;
  readonly file_name?: string;
}

/**
 * Parse the metadata JSON string from a chat message row and return the
 * `generatedImages` array if present. Returns `null` on any parse error
 * or when the field is absent/empty. Tolerant of legacy rows that carry
 * extra descriptor fields — unknown fields are ignored.
 */
export function parseGeneratedImagesFromMetadata(
  metadataJson: string | undefined | null
): GeneratedImageContextImage[] | null {
  if (!metadataJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const raw = record.generatedImages;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const images: GeneratedImageContextImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const img = item as Record<string, unknown>;
    const url = typeof img.url === "string" ? img.url : undefined;
    if (!url) continue;
    images.push({
      url,
      file_name: typeof img.file_name === "string" ? img.file_name : undefined,
    });
  }
  return images.length > 0 ? images : null;
}

/**
 * Build the `<generated_images>` annotation block appended to the
 * assistant message content for the model request. One compact semantic
 * marker per image, capped at {@link MAX_ANNOTATED_IMAGES} descriptors.
 * Never emits URLs or local paths.
 */
export function buildGeneratedImagesAnnotation(
  images: readonly GeneratedImageContextImage[],
  sourceMessageId?: string
): string {
  const lines = images.slice(0, MAX_ANNOTATED_IMAGES).map((img, i) => {
    const parts = [`[${i + 1}]`];
    if (sourceMessageId) parts.push(`message=${sourceMessageId}`);
    parts.push(`image=${i}`);
    if (img.file_name) parts.push(`file=${img.file_name}`);
    return `  ${parts.join(" ")}`;
  });
  return `${GENERATED_IMAGES_MARKER}\n${lines.join("\n")}\n</generated_images>`;
}

/**
 * Augment a message row's text content with generated-image references
 * for the model request. Returns the original content unchanged when:
 *   - the row is not an assistant message
 *   - metadata is absent or has no `generatedImages`
 *   - the content already contains the marker (idempotent)
 *
 * @param content          The stored `content` text of the message row.
 * @param role             The role of the message row ("user" | "assistant" | "system").
 * @param metadata         The raw metadata JSON string from the message row.
 * @param sourceMessageId  Optional row message id threaded into each marker.
 */
export function augmentContentWithGeneratedImages(
  content: string,
  role: string,
  metadata: string | undefined | null,
  sourceMessageId?: string
): string {
  if (role !== "assistant") return content;
  if (content && content.includes(GENERATED_IMAGES_MARKER)) return content;
  const images = parseGeneratedImagesFromMetadata(metadata);
  if (!images) return content;
  const annotation = buildGeneratedImagesAnnotation(images, sourceMessageId);
  return content && content.length > 0
    ? `${content}\n\n${annotation}`
    : annotation;
}
