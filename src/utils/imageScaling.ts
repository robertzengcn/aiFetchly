/**
 * Runtime-neutral image-scaling pure helpers.
 *
 * Shared by the RENDERER user-selected attachment path
 * (`views/components/aiChatV2/imageScaleUtil.ts`, canvas-based) and the MAIN
 * process `attach_local_images` tool (`service/AIImageNormalizer.ts`,
 * nativeImage-based). Keeping the dimension math and output-MIME policy in one
 * place guarantees both paths apply the SAME normalization policy to
 * user-selected and LLM-selected images (PRD Goal 6, design §10.3).
 *
 * No browser or Electron APIs here — safe for any process.
 */
import type { PreparedImageMimeType } from "@/entityTypes/aiImageAttachmentToolTypes";

/**
 * Compute output dimensions for an image, preserving aspect ratio and capping
 * the long edge at `maxLongEdge`. Images already within the cap are returned
 * unchanged (never upscaled). Dimensions never fall below 1px.
 */
export function computeScaledDimensions(
  width: number,
  height: number,
  maxLongEdge: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return { width, height };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Choose the prepared output MIME type. PNG is preserved (so transparency is
 * not lost); all other supported inputs (JPEG/WebP/GIF) are re-encoded as JPEG,
 * which is dramatically smaller for photographic content.
 */
export function pickImageOutputMimeType(
  originalMime: string
): PreparedImageMimeType {
  return originalMime === "image/png" ? "image/png" : "image/jpeg";
}
