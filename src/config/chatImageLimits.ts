/**
 * Shared image-attachment limit constants.
 *
 * Pure primitives only — no imports from main-process-only modules — so this
 * file can be imported by BOTH the main process (the `attach_local_images`
 * tool service and normalizer) and the renderer bundle (the user-selected
 * attachment path). Keeping the count and total-target values in one place
 * guarantees both paths enforce compatible limits.
 *
 * Values mirror the AI server contract and the existing renderer normalization
 * policy. See `docs/prd/ai-chat-llm-image-attachment-tool-prd.md` (Image Limits).
 */
export const CHAT_IMAGE_LIMITS = Object.freeze({
  /** Maximum images per single outgoing AI request (server MAX_IMAGES_PER_REQUEST). */
  maxImagesPerRequest: 3,
  /** Maximum raw on-disk file size accepted as tool input (matches attachment policy). */
  maxRawFileBytes: 5 * 1024 * 1024,
  /** Target size for a single prepared (encoded) image. */
  targetPreparedImageBytes: Math.floor(1.5 * 1024 * 1024),
  /** Maximum long edge (px) of a prepared image (matches renderer normalization). */
  maxLongEdge: 1568,
  /** Initial JPEG encoding quality (0-100). */
  initialJpegQuality: 82,
  /** Floor JPEG quality before shrinking dimensions instead. */
  minJpegQuality: 60,
  /** Minimum acceptable long edge (px) when shrinking to meet the byte target. */
  minLongEdge: 768,
  /** Bounded number of encoding attempts per image. */
  maxEncodingAttempts: 6,
  /** Client target for the sum of all data-URL characters in one request. */
  targetTotalDataUrlChars: 6_000_000,
  /**
   * Maximum on-disk size accepted for an AI-chat-generated source image.
   * Matches the storage service cap so every stored generated image remains
   * admissible as an edit input.
   */
  maxGeneratedSourceBytes: 20 * 1024 * 1024,
});

/** Decoder safety guard: reject any single input dimension above this (px). */
export const MAX_INPUT_DIMENSION = 16_384;

/** Decoder safety guard: reject images whose pixel count exceeds this. */
export const MAX_INPUT_PIXELS = 64_000_000;
