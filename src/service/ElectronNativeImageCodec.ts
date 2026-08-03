/**
 * Production {@link ImageCodec} backed by Electron's `nativeImage`.
 *
 * Used by the main-process `attach_local_images` tool to decode/resize/re-encode
 * images without a browser canvas. `nativeImage` is lazy-required inside each
 * operation so that importing this module never throws in environments where
 * Electron is unavailable (e.g. unit tests, which inject a fake codec instead).
 *
 * Behaviour matches the design §TD4 / §10:
 *   - GIF uses the first decoded frame (nativeImage default).
 *   - PNG bytes are re-encoded via toPNG() so transparency is preserved.
 *   - JPEG/WebP/GIF are re-encoded via toJPEG().
 *
 * `hasAlpha` is advisory only (the PNG encoding loop preserves transparency
 * natively regardless of this flag).
 */
import type { NativeImage } from "electron";
import type { DecodedImage, ImageCodec } from "@/service/AIImageNormalizer";
import { detectImageSignature } from "@/service/AIImageSignature";

/** Lazily load nativeImage from Electron (available only in the main process). */
function loadNativeImage(): NonNullable<NativeImage>["constructor"] {
  // `require` (not import) so this runs only when the codec is actually used.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electron = require("electron") as typeof import("electron");
  return electron.nativeImage;
}

/**
 * Adapter wrapping a NativeImage instance in the codec's DecodedImage shape.
 * Every mutating call returns a new adapter over the new NativeImage.
 */
class NativeImageDecoded implements DecodedImage {
  constructor(
    private readonly image: NativeImage,
    readonly width: number,
    readonly height: number,
    readonly hasAlpha: boolean
  ) {}

  resize(width: number, height: number): DecodedImage {
    const resized = this.image.resize({ width, height, quality: "good" });
    const size = resized.getSize();
    return new NativeImageDecoded(resized, size.width, size.height, this.hasAlpha);
  }

  toPng(): Buffer {
    return this.image.toPNG();
  }

  toJpeg(quality: number): Buffer {
    return this.image.toJPEG(quality);
  }
}

/** Electron-native production codec. */
export class ElectronNativeImageCodec implements ImageCodec {
  decode(buffer: Buffer): DecodedImage {
    const nativeImage = loadNativeImage();
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) {
      throw new Error("nativeImage could not decode the buffer (empty result)");
    }
    const size = image.getSize();
    // hasAlpha is advisory; PNG input may carry transparency.
    const detected = detectImageSignature(buffer);
    const hasAlpha = detected?.mimeType === "image/png";
    return new NativeImageDecoded(
      image,
      size.width || 0,
      size.height || 0,
      hasAlpha
    );
  }
}
