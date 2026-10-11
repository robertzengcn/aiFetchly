/**
 * GUI-Actor preprocessing (design §5.4): the exact `smart_resize` geometry
 * ported from Qwen2-VL, plus the transform record that lets the host map
 * normalized model output back to capture pixels.
 *
 * Values come from the pinned `preprocessor_config.json` of GUI-Actor-2B:
 * patch_size 14, merge_size 2 (factor 28), min_pixels 3136,
 * max_pixels 5,720,064. The pixel budget is the main latency lever and is a
 * RUNTIME parameter — changing it never changes the download identity.
 */
import {
  ComputerUseError,
  type GroundingTransform,
} from "@/entityTypes/computerUseTypes";

export interface SmartResizeConfig {
  /** patch_size × merge_size (default 28). */
  readonly factor: number;
  readonly minPixels: number;
  readonly maxPixels: number;
}

export const GUI_ACTOR_DEFAULT_SMART_RESIZE: SmartResizeConfig = {
  factor: 28,
  minPixels: 3_136,
  maxPixels: 5_720_064,
};

/**
 * Round each dimension independently to a multiple of `factor` within the
 * pixel budget. Each axis is rounded separately, so the resize is slightly
 * ANISOTROPIC; callers must store separate sx and sy (§11.2).
 */
export function smartResize(
  height: number,
  width: number,
  config: SmartResizeConfig = GUI_ACTOR_DEFAULT_SMART_RESIZE
): { height: number; width: number } {
  if (height <= 0 || width <= 0) {
    throw new ComputerUseError(
      "coordinates_invalid",
      "smart_resize requires positive dimensions"
    );
  }
  const { factor, minPixels, maxPixels } = config;
  let hBar = Math.round(height / factor) * factor;
  let wBar = Math.round(width / factor) * factor;
  if (hBar * wBar > maxPixels || hBar * wBar < minPixels) {
    const bound = hBar * wBar > maxPixels ? maxPixels : minPixels;
    const beta = Math.sqrt((height * width) / bound);
    hBar = Math.floor(height / beta / factor) * factor;
    wBar = Math.floor(width / beta / factor) * factor;
    // Keep within the budget after floor rounding.
    if (hBar * wBar > maxPixels) {
      hBar = Math.max(factor, Math.floor(hBar / factor - 1) * factor);
    }
  }
  return { height: hBar, width: wBar };
}

/**
 * Build the preprocessing transform for a capture/crop: smart_resize the
 * source to the model input, record per-axis scales and any padding.
 */
export function buildPreprocessingTransform(input: {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly cropX: number;
  readonly cropY: number;
  readonly pixelBudget: number;
  readonly padX?: number;
  readonly padY?: number;
}): GroundingTransform {
  const resized = smartResize(input.sourceHeight, input.sourceWidth, {
    ...GUI_ACTOR_DEFAULT_SMART_RESIZE,
    maxPixels: input.pixelBudget,
  });
  return {
    modelWidth: resized.width,
    modelHeight: resized.height,
    cropX: input.cropX,
    cropY: input.cropY,
    scaleX: resized.width / input.sourceWidth,
    scaleY: resized.height / input.sourceHeight,
    padX: input.padX ?? 0,
    padY: input.padY ?? 0,
  };
}

/**
 * Full pixel preprocessing pipeline (rescale → normalize → temporal
 * duplication → patchify → merge order) is executed by the ONNX graphs or
 * by the adapter when golden fixtures demand host-side tensors. The host
 * record of that pipeline is the revision string below; it must match the
 * model package manifest before the adapter loads (§5.3).
 */
export const GUI_ACTOR_PREPROCESSING_REVISION = "qwen2vl-smartresize-v1";

/**
 * Normalize raw [0,255] RGBA/RGB pixels into the model's normalized planar
 * layout (CLIP mean/std). Used by the health probe and offline replay with
 * golden fixtures; production decoding stays graph-side.
 */
export function normalizeRgbPlanar(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: 3 | 4,
  mean: readonly [number, number, number],
  std: readonly [number, number, number]
): Float32Array {
  const out = new Float32Array(3 * width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels;
      const dst = (y * width + x);
      for (let c = 0; c < 3; c++) {
        out[c * width * height + dst] =
          (pixels[src + c] / 255 - mean[c]) / std[c];
      }
    }
  }
  return out;
}

/** CLIP mean/std from the pinned GUI-Actor-2B preprocessor config. */
export const GUI_ACTOR_CLIP_MEAN: readonly [number, number, number] = [
  0.4814546616895105,
  0.45782751560783386,
  0.4082107342675059,
];
export const GUI_ACTOR_CLIP_STD: readonly [number, number, number] = [
  0.2686295339669678,
  0.2613025965200948,
  0.2757711146893859,
];
