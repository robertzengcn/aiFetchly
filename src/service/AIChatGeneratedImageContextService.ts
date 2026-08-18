/**
 * Appends generated-image references to an assistant message's text content
 * so the LLM can see — in subsequent turns — which images it previously
 * produced and where they live on disk.
 *
 * WHY THIS EXISTS
 * When the AI generates an image, the image descriptor (protocol URL,
 * local_path, file_name) is stored in the message row's `metadata.generatedImages`
 * JSON column, NOT in the `content` text. The conversation-history builder
 * ({@link AIChatContextAssembler}) only sends `content` to the model, so on
 * the next turn the model has no idea where the image was saved and falls
 * back to `glob_files` / `shell_execute` filesystem searches that fail
 * (the image is under Electron userData, not the workspace).
 *
 * This helper parses the metadata JSON and, when `generatedImages` is
 * present, appends a compact `<generated_images>` block to the content
 * **for the model request only**. The stored DB row is never modified.
 *
 * Security: only the `aifetchly-generated-image://` protocol URL and
 * `file_name` are exposed to the model. The `local_path` is included so
 * the model can reason about the file, but `attach_local_images` enforces
 * workspace containment independently — the model cannot use a userData
 * path to bypass the workspace guard.
 */

const GENERATED_IMAGES_MARKER = "<generated_images>";

export interface GeneratedImageContextImage {
  readonly url: string;
  readonly file_name?: string;
  readonly local_path?: string;
}

/**
 * Parse the metadata JSON string from a chat message row and return the
 * `generatedImages` array if present. Returns `null` on any parse error
 * or when the field is absent/empty.
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
      local_path:
        typeof img.local_path === "string" ? img.local_path : undefined,
    });
  }
  return images.length > 0 ? images : null;
}

/**
 * Build the `<generated_images>` annotation block appended to the
 * assistant message content for the model request.
 */
export function buildGeneratedImagesAnnotation(
  images: readonly GeneratedImageContextImage[]
): string {
  const lines = images.map((img, i) => {
    const parts = [`[${i + 1}] ${img.url}`];
    if (img.file_name) parts.push(`file: ${img.file_name}`);
    if (img.local_path) parts.push(`local: ${img.local_path}`);
    return `  ${parts.join(" | ")}`;
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
 * @param content   The stored `content` text of the message row.
 * @param role      The role of the message row ("user" | "assistant" | "system").
 * @param metadata  The raw metadata JSON string from the message row.
 */
export function augmentContentWithGeneratedImages(
  content: string,
  role: string,
  metadata: string | undefined | null
): string {
  if (role !== "assistant") return content;
  if (content && content.includes(GENERATED_IMAGES_MARKER)) return content;
  const images = parseGeneratedImagesFromMetadata(metadata);
  if (!images) return content;
  const annotation = buildGeneratedImagesAnnotation(images);
  return content && content.length > 0
    ? `${content}\n\n${annotation}`
    : annotation;
}
