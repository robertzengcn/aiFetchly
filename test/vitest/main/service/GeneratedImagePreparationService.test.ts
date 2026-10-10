import { describe, expect, it, vi } from "vitest";
import { GeneratedImagePreparationService } from "@/service/GeneratedImagePreparationService";
import type { ImageNormalizerPort } from "@/service/AIImageAttachmentToolService";
import {
  ImageNormalizationError,
  type NormalizeOptions,
  type NormalizedImage,
} from "@/service/AIImageNormalizer";
import { CHAT_IMAGE_LIMITS } from "@/config/chatImageLimits";
import type {
  PreparedImageMimeType,
  SupportedImageMimeType,
} from "@/entityTypes/aiImageAttachmentToolTypes";

// ---------------------------------------------------------------------------
// Fake normalizer + canned NormalizedImage
// ---------------------------------------------------------------------------

interface RecordedNormalizeCall {
  readonly buffer: Buffer;
  readonly mime: SupportedImageMimeType;
  readonly opts: NormalizeOptions;
}

function makeCannedNormalizedImage(
  mimeType: PreparedImageMimeType = "image/jpeg"
): NormalizedImage {
  const buffer = Buffer.alloc(120, 0xcd);
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  return {
    buffer,
    mimeType,
    width: 640,
    height: 480,
    sha256: "a".repeat(64),
    dataUrl,
    dataUrlChars: dataUrl.length,
  };
}

function makeFakeNormalizer(
  result: NormalizedImage = makeCannedNormalizedImage(),
  error?: unknown
): ImageNormalizerPort & { recorded: () => readonly RecordedNormalizeCall[] } {
  const recorded: RecordedNormalizeCall[] = [];
  return {
    normalize: vi.fn(async (buffer, mime, opts) => {
      recorded.push({ buffer, mime, opts });
      if (error !== undefined) throw error;
      return result;
    }),
    recorded: () => recorded,
  };
}

describe("GeneratedImagePreparationService", () => {
  // --- prepare() ---
  it("builds NormalizeOptions purely from CHAT_IMAGE_LIMITS", async () => {
    const normalizer = makeFakeNormalizer();
    const svc = new GeneratedImagePreparationService({ normalizer });
    await svc.prepare(Buffer.alloc(4, 0x01), "image/png", "auto");
    expect(normalizer.recorded()).toHaveLength(1);
    expect(normalizer.recorded()[0]?.opts).toEqual({
      targetBytes: CHAT_IMAGE_LIMITS.targetPreparedImageBytes,
      maxLongEdge: CHAT_IMAGE_LIMITS.maxLongEdge,
      initialJpegQuality: CHAT_IMAGE_LIMITS.initialJpegQuality,
      minJpegQuality: CHAT_IMAGE_LIMITS.minJpegQuality,
      minLongEdge: CHAT_IMAGE_LIMITS.minLongEdge,
      maxEncodingAttempts: CHAT_IMAGE_LIMITS.maxEncodingAttempts,
      signal: undefined,
    });
  });

  it("forwards source bytes, detected mime type, and abort signal", async () => {
    const normalizer = makeFakeNormalizer();
    const svc = new GeneratedImagePreparationService({ normalizer });
    const controller = new AbortController();
    const source = Buffer.from([1, 2, 3, 4]);
    await svc.prepare(source, "image/webp", "high", controller.signal);
    const call = normalizer.recorded()[0];
    expect(call?.buffer).toBe(source);
    expect(call?.mime).toBe("image/webp");
    expect(call?.opts.signal).toBe(controller.signal);
  });

  it("maps NormalizedImage into the PreparedModelImage shape", async () => {
    const canned = makeCannedNormalizedImage();
    const svc = new GeneratedImagePreparationService({
      normalizer: makeFakeNormalizer(canned),
    });
    const result = await svc.prepare(Buffer.alloc(8, 0x02), "image/jpeg", "low");
    expect(result).toEqual({
      mimeType: "image/jpeg",
      width: canned.width,
      height: canned.height,
      preparedSizeBytes: canned.buffer.length,
      dataUrl: canned.dataUrl,
    });
    expect(result.preparedSizeBytes).toBe(canned.buffer.length);
  });

  it("passes through PNG prepared output unchanged", async () => {
    const canned = makeCannedNormalizedImage("image/png");
    const svc = new GeneratedImagePreparationService({
      normalizer: makeFakeNormalizer(canned),
    });
    const result = await svc.prepare(Buffer.alloc(8, 0x03), "image/png", "auto");
    expect(result.mimeType).toBe("image/png");
    expect(result.dataUrl).toBe(canned.dataUrl);
  });

  it("rejects when the normalizer rejects", async () => {
    const failure = new ImageNormalizationError(
      "image_payload_too_large",
      "too big"
    );
    const svc = new GeneratedImagePreparationService({
      normalizer: makeFakeNormalizer(undefined, failure),
    });
    await expect(
      svc.prepare(Buffer.alloc(4, 0x04), "image/gif", "auto")
    ).rejects.toBe(failure);
  });

  it("constructs with default dependencies (codec lazy-loaded)", () => {
    expect(() => new GeneratedImagePreparationService()).not.toThrow();
  });

  // --- errorCodeForNormalizationError ---
  describe("errorCodeForNormalizationError", () => {
    type NormalizationCode = ConstructorParameters<
      typeof ImageNormalizationError
    >[0];

    it.each([
      ["image_processing_failed", "generated_image_unsupported_type"],
      ["image_dimensions_too_large", "generated_image_dimension_limit"],
      ["image_payload_too_large", "generated_image_too_large"],
    ] as ReadonlyArray<readonly [NormalizationCode, string]>)(
      "maps %s to %s",
      (code, expected) => {
        expect(
          GeneratedImagePreparationService.errorCodeForNormalizationError(
            new ImageNormalizationError(code, "boom")
          )
        ).toBe(expected);
      }
    );

    it("rethrows an AbortError for cancelled normalization", () => {
      let caught: unknown;
      try {
        GeneratedImagePreparationService.errorCodeForNormalizationError(
          new ImageNormalizationError("cancelled", "Normalization cancelled.")
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).name).toBe("AbortError");
      expect((caught as Error).message).toBe("Normalization cancelled.");
    });

    it.each([
      ["a plain Error", new Error("boom")],
      ["null", null],
      ["undefined", undefined],
      ["a string", "boom"],
      ["an object", { code: "image_payload_too_large" }],
    ] as ReadonlyArray<readonly [string, unknown]>)(
      "falls back to generated_image_unsupported_type for %s",
      (_label, err) => {
        expect(
          GeneratedImagePreparationService.errorCodeForNormalizationError(err)
        ).toBe("generated_image_unsupported_type");
      }
    );
  });
});
