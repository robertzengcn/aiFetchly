/**
 * Computer Use coordinate transforms (design §11).
 *
 * Spaces:
 *  1. Executor desktop units (adapter-defined).
 *  2. Original capture pixels.
 *  3. Crop pixels relative to the capture.
 *  4. Model-input pixels after smart_resize (plus any bucket padding).
 *  5. Normalized model output in [0,1] over the model-input image.
 *
 * Composition (§11.2):
 *   x_model = nx × Wm          x_capture = cx + (x_model - px) / sx
 *   y_model = ny × Hm          y_capture = cy + (y_model - py) / sy
 *   [x_executor, y_executor, 1]ᵀ = T_capture_to_executor × [x_capture, y_capture, 1]ᵀ
 *
 * smart_resize rounds each axis independently (anisotropic): sx ≠ sy in
 * general and must never be assumed equal. Points outside the unpadded image
 * or crop are INVALID — never clamped onto another control.
 */
import {
  ComputerUseError,
  type GroundingTransform,
} from "@/entityTypes/computerUseTypes";

/** Parameters to build a transform record from a crop + resize. */
export interface TransformBuildParams {
  /** Model-input size after smart_resize (px). */
  modelWidth: number;
  modelHeight: number;
  /** Crop origin in capture pixels (0,0 when no crop). */
  cropX: number;
  cropY: number;
  /** Crop size in capture pixels (equals the pre-resize source size). */
  cropWidth: number;
  cropHeight: number;
  /** Optional left/top padding inside the model input (px). */
  padX?: number;
  padY?: number;
}

/**
 * Build the transform record. Scales are stored in full precision; rounding
 * happens only at the executor boundary.
 */
export function buildGroundingTransform(
  params: TransformBuildParams
): GroundingTransform {
  const {
    modelWidth,
    modelHeight,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    padX = 0,
    padY = 0,
  } = params;
  if (!Number.isFinite(modelWidth) || modelWidth <= 0) {
    throw new ComputerUseError("coordinates_invalid", "modelWidth must be positive");
  }
  if (!Number.isFinite(modelHeight) || modelHeight <= 0) {
    throw new ComputerUseError("coordinates_invalid", "modelHeight must be positive");
  }
  if (!Number.isFinite(cropWidth) || cropWidth <= 0) {
    throw new ComputerUseError("coordinates_invalid", "cropWidth must be positive");
  }
  if (!Number.isFinite(cropHeight) || cropHeight <= 0) {
    throw new ComputerUseError("coordinates_invalid", "cropHeight must be positive");
  }
  if (cropX < 0 || cropY < 0 || padX < 0 || padY < 0) {
    throw new ComputerUseError("coordinates_invalid", "crop/padding must be non-negative");
  }
  return {
    modelWidth,
    modelHeight,
    cropX,
    cropY,
    scaleX: modelWidth / cropWidth,
    scaleY: modelHeight / cropHeight,
    padX,
    padY,
  };
}

/** Point in capture pixels. */
export interface CapturePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Map a normalized model-output point to capture pixels. Rejects points
 * outside the unpadded model input (never clamps a bad prediction).
 */
export function mapNormalizedToCapture(
  transform: GroundingTransform,
  nx: number,
  ny: number
): CapturePoint {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    throw new ComputerUseError("coordinates_invalid", "normalized coordinates must be finite");
  }
  const xModel = nx * transform.modelWidth;
  const yModel = ny * transform.modelHeight;
  const unpaddedWidth = transform.modelWidth - transform.padX;
  const unpaddedHeight = transform.modelHeight - transform.padY;
  if (xModel < transform.padX || xModel > unpaddedWidth) {
    throw new ComputerUseError(
      "coordinates_invalid",
      "predicted x lies in padded space or outside the image"
    );
  }
  if (yModel < transform.padY || yModel > unpaddedHeight) {
    throw new ComputerUseError(
      "coordinates_invalid",
      "predicted y lies in padded space or outside the image"
    );
  }
  const xCapture = transform.cropX + (xModel - transform.padX) / transform.scaleX;
  const yCapture = transform.cropY + (yModel - transform.padY) / transform.scaleY;
  return { x: xCapture, y: yCapture };
}

/** Map a capture point back to normalized model coordinates (inverse). */
export function mapCaptureToNormalized(
  transform: GroundingTransform,
  point: CapturePoint
): { nx: number; ny: number } {
  const xCrop = point.x - transform.cropX;
  const yCrop = point.y - transform.cropY;
  if (xCrop < 0 || yCrop < 0) {
    throw new ComputerUseError("coordinates_invalid", "point lies before the crop origin");
  }
  if (xCrop > (transform.modelWidth - transform.padX) / transform.scaleX) {
    throw new ComputerUseError("coordinates_invalid", "point lies beyond the crop width");
  }
  if (yCrop > (transform.modelHeight - transform.padY) / transform.scaleY) {
    throw new ComputerUseError("coordinates_invalid", "point lies beyond the crop height");
  }
  return {
    nx: (transform.padX + xCrop * transform.scaleX) / transform.modelWidth,
    ny: (transform.padY + yCrop * transform.scaleY) / transform.modelHeight,
  };
}

/**
 * Capture→executor transform: scale (Retina downsampling) plus translation
 * (window origin). Executor units are defined by the adapter; the host never
 * assumes a global multiplier.
 */
export interface CaptureToExecutorTransform {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly originX: number;
  readonly originY: number;
}

/** Apply the capture→executor mapping, rounding only at this boundary. */
export function mapCaptureToExecutor(
  captureToExecutor: CaptureToExecutorTransform,
  point: CapturePoint
): { x: number; y: number } {
  return {
    x: Math.round(
      captureToExecutor.originX + point.x * captureToExecutor.scaleX
    ),
    y: Math.round(
      captureToExecutor.originY + point.y * captureToExecutor.scaleY
    ),
  };
}

/** Validate that a capture-space rect lies within the capture bounds. */
export function validateCropRect(
  captureWidth: number,
  captureHeight: number,
  crop: { x: number; y: number; width: number; height: number }
): void {
  if (
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > captureWidth ||
    crop.y + crop.height > captureHeight
  ) {
    throw new ComputerUseError("coordinates_invalid", "crop rect outside capture bounds");
  }
}
