/**
 * Renderer-safe image-URL allowlist (review fix 2026-10-17).
 *
 * Tool-result metadata (generatedImages[].url) is model-influenced data:
 * binding it straight into <img src> lets a crafted tool result load
 * file:// pages or ping arbitrary origins from the renderer. The legacy
 * Chat V2 tile path (AiChatV2Message.vue) has always gated this; the
 * workspace transcript's semantic image row must enforce the SAME
 * contract — one shared helper, both surfaces.
 */

const GENERATED_IMAGE_PROTOCOL = "aifetchly-generated-image:";

export function isAllowedImageUrl(url: string): boolean {
  if (url.startsWith("data:image/")) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === GENERATED_IMAGE_PROTOCOL
    );
  } catch {
    return false;
  }
}
