/**
 * Image-scaling helpers for AI Chat V2 attachments.
 *
 * Uploaded images are inlined into the chat-completions POST body as base64
 * `data:` URLs (see `AIChatQueryEngine.prepareAttachmentContent`). A multi-
 * megabyte photo becomes several MB of base64 and trips the remote AI
 * server's request-body limit (HTTP 413 "Request Entity Too Large").
 *
 * Vision models tokenize images at fixed tile sizes, so multi-megapixel
 * input yields no quality benefit. We therefore downscale on the client
 * before encoding: long edge capped at {@link IMAGE_MAX_LONG_EDGE}, PNG
 * preserved (for transparency), everything else re-encoded as JPEG.
 */

/** Maximum long-edge dimension (px) for an uploaded image. */
export const IMAGE_MAX_LONG_EDGE = 1568;

/** JPEG quality used when re-encoding non-PNG images. */
export const IMAGE_JPEG_QUALITY = 0.82;

// Dimension math and output-MIME policy are shared with the main-process
// `attach_local_images` tool via the runtime-neutral module below, so the
// user-selected and LLM-selected paths apply identical normalization.
import {
  computeScaledDimensions,
  pickImageOutputMimeType,
} from "@/utils/imageScaling";
export { computeScaledDimensions, pickImageOutputMimeType };

/**
 * Resolve a best-effort image MIME type for a file, falling back to the
 * extension and finally to `image/jpeg` when unknown.
 */
function resolveImageMime(file: File): string {
  if (file.type && file.type.startsWith("image/")) {
    return file.type;
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/**
 * Encode an ArrayBuffer as a base64 string. Uses the renderer's `btoa`.
 * Exported so the composer can reuse it for non-image (document) attachments.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Promisified `HTMLCanvasElement.toBlob`. */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number
): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

export interface DownscaledImage {
  contentBase64: string;
  mimeType: string;
  /** Exact decoded byte length; matches `Buffer.from(b64, "base64").length`. */
  sizeBytes: number;
}

/**
 * Downscale and re-compress an image File for inline base64 transport.
 *
 * On any canvas failure (e.g. unsupported source, tainted bitmap), falls
 * back to the original bytes so uploads never hard-break.
 *
 * Renderer-only — relies on `createImageBitmap`, `document.createElement`,
 * and `HTMLCanvasElement`.
 */
export async function downscaleImageAttachment(
  file: File
): Promise<DownscaledImage> {
  const originalMime = resolveImageMime(file);
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = computeScaledDimensions(
      bitmap.width,
      bitmap.height,
      IMAGE_MAX_LONG_EDGE
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("canvas 2d context unavailable");
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const outputMime = pickImageOutputMimeType(originalMime);
    const blob = await canvasToBlob(canvas, outputMime, IMAGE_JPEG_QUALITY);
    if (!blob) {
      throw new Error("canvas.toBlob returned null");
    }
    const buffer = await blob.arrayBuffer();
    return {
      contentBase64: arrayBufferToBase64(buffer),
      mimeType: outputMime,
      sizeBytes: blob.size,
    };
  } catch (err) {
    console.warn(
      "[AiChatV2] image downscale failed, using original bytes:",
      err
    );
    const buffer = await file.arrayBuffer();
    return {
      contentBase64: arrayBufferToBase64(buffer),
      mimeType: originalMime,
      sizeBytes: file.size,
    };
  }
}
