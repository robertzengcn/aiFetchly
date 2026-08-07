import { describe, expect, it } from "vitest";
import {
  CHAT_IMAGE_LIMITS,
  MAX_INPUT_DIMENSION,
  MAX_INPUT_PIXELS,
} from "@/config/chatImageLimits";

describe("CHAT_IMAGE_LIMITS", () => {
  it("locks the PRD-mandated image-count and size boundaries", () => {
    // These values are security/contract-relevant: changing them silently would
    // either breach the server image cap or bloat requests. Assert them exactly.
    expect(CHAT_IMAGE_LIMITS.maxImagesPerRequest).toBe(3);
    expect(CHAT_IMAGE_LIMITS.maxRawFileBytes).toBe(5 * 1024 * 1024);
    expect(CHAT_IMAGE_LIMITS.targetPreparedImageBytes).toBe(
      Math.floor(1.5 * 1024 * 1024)
    );
    expect(CHAT_IMAGE_LIMITS.maxLongEdge).toBe(1568);
    expect(CHAT_IMAGE_LIMITS.initialJpegQuality).toBe(82);
    expect(CHAT_IMAGE_LIMITS.minJpegQuality).toBe(60);
    expect(CHAT_IMAGE_LIMITS.minLongEdge).toBe(768);
    expect(CHAT_IMAGE_LIMITS.maxEncodingAttempts).toBe(6);
    expect(CHAT_IMAGE_LIMITS.targetTotalDataUrlChars).toBe(6_000_000);
  });

  it("is frozen so limits cannot be mutated at runtime", () => {
    expect(Object.isFrozen(CHAT_IMAGE_LIMITS)).toBe(true);
    expect(() => {
      // @ts-expect-error -- deliberately mutating a frozen object
      CHAT_IMAGE_LIMITS.maxImagesPerRequest = 99;
    }).toThrow();
  });

  it("keeps a single image at the per-image target well under the total request budget", () => {
    // base64 inflates by ~4/3; one image at target stays far below the total.
    const oneAtTargetDataUrlChars = Math.ceil(
      CHAT_IMAGE_LIMITS.targetPreparedImageBytes * (4 / 3)
    );
    expect(oneAtTargetDataUrlChars).toBeLessThan(
      CHAT_IMAGE_LIMITS.targetTotalDataUrlChars
    );
  });

  it("documents why the cumulative char budget is enforced separately from the per-image target", () => {
    // Three images at the per-image TARGET would, after base64 inflation,
    // exceed the total data-URL budget. This is intentional: the per-image
    // target is not a guarantee that any three images fit. The tool must
    // measure the real final data-URL length and enforce the cumulative
    // budget (see AIImageAttachmentToolService).
    const threeAtTargetDataUrlChars = Math.ceil(
      3 * CHAT_IMAGE_LIMITS.targetPreparedImageBytes * (4 / 3)
    );
    expect(threeAtTargetDataUrlChars).toBeGreaterThan(
      CHAT_IMAGE_LIMITS.targetTotalDataUrlChars
    );
  });

  it("defines decoder safety guards against decompression bombs", () => {
    expect(MAX_INPUT_DIMENSION).toBe(16_384);
    expect(MAX_INPUT_PIXELS).toBe(64_000_000);
  });
});
