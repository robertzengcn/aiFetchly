// test/vitest/main/service/computerUse/ComputerUseCoordinateTransforms.test.ts
//
// Design §11: anisotropic transform composition, the worked example from
// §11.2, padding rejection, Retina capture→executor mapping, and crop bounds.
import { describe, it, expect } from "vitest";
import {
  buildGroundingTransform,
  mapNormalizedToCapture,
  mapCaptureToNormalized,
  mapCaptureToExecutor,
  validateCropRect,
} from "@/service/computerUse/ComputerUseCoordinateTransforms";
import { ComputerUseError } from "@/entityTypes/computerUseTypes";

describe("ComputerUseCoordinateTransforms", () => {
  it("reproduces the design §11.2 worked example", () => {
    // 1920×1080 capture with a 2,000,000-px budget resizes to 1876×1036
    // (multiples of 28): sx ≈ 0.9771, sy ≈ 0.9593. (0.5, 0.5) maps back to
    // (960, 540) exactly.
    const transform = buildGroundingTransform({
      modelWidth: 1876,
      modelHeight: 1036,
      cropX: 0,
      cropY: 0,
      cropWidth: 1920,
      cropHeight: 1080,
    });
    expect(transform.scaleX).toBeCloseTo(1876 / 1920, 10);
    expect(transform.scaleY).toBeCloseTo(1036 / 1080, 10);
    expect(transform.scaleX).not.toBe(transform.scaleY);

    const point = mapNormalizedToCapture(transform, 0.5, 0.5);
    expect(point.x).toBeCloseTo(960, 6);
    expect(point.y).toBeCloseTo(540, 6);
  });

  it("maps through a crop origin", () => {
    const transform = buildGroundingTransform({
      modelWidth: 280,
      modelHeight: 280,
      cropX: 100,
      cropY: 200,
      cropWidth: 560,
      cropHeight: 560,
    });
    const point = mapNormalizedToCapture(transform, 0.5, 0.25);
    // sx = 280/560 = 0.5: nx 0.5 -> 140 model px -> 280 capture px + origin.
    expect(point.x).toBeCloseTo(100 + 280, 6);
    expect(point.y).toBeCloseTo(200 + 140, 6);
  });

  it("subtracts bucket padding before scaling", () => {
    const transform = buildGroundingTransform({
      modelWidth: 308,
      modelHeight: 308,
      cropX: 0,
      cropY: 0,
      cropWidth: 280,
      cropHeight: 280,
      padX: 28,
      padY: 28,
    });
    // Normalized (0.5, 0.5) is the center of the PADDED image; the unpadded
    // content center is at model pixel (154+140/2? no): padding shifts left.
    const point = mapNormalizedToCapture(transform, 0.5, 0.5);
    // x_model = 154; x_capture = (154 - 28) / (308/280) = 126 / 1.1 = 114.545…
    expect(point.x).toBeCloseTo((154 - 28) / (308 / 280), 6);
    expect(point.y).toBeCloseTo((154 - 28) / (308 / 280), 6);
  });

  it("never clamps a bad prediction — rejects padded/outside points", () => {
    const transform = buildGroundingTransform({
      modelWidth: 308,
      modelHeight: 308,
      cropX: 0,
      cropY: 0,
      cropWidth: 280,
      cropHeight: 280,
      padX: 28,
      padY: 28,
    });
    // x_model = 0.05 * 308 = 15.4 < padX = 28 → invalid.
    expect(() => mapNormalizedToCapture(transform, 0.05, 0.5)).toThrow(
      ComputerUseError
    );
    expect(() => mapNormalizedToCapture(transform, 1.5, 0.5)).toThrow(
      ComputerUseError
    );
    expect(() => mapNormalizedToCapture(transform, Number.NaN, 0.5)).toThrow(
      ComputerUseError
    );
  });

  it("round-trips normalized ↔ capture coordinates", () => {
    const transform = buildGroundingTransform({
      modelWidth: 1876,
      modelHeight: 1036,
      cropX: 12,
      cropY: 34,
      cropWidth: 1908,
      cropHeight: 1046,
    });
    const point = mapNormalizedToCapture(transform, 0.3, 0.72);
    const back = mapCaptureToNormalized(transform, point);
    expect(back.nx).toBeCloseTo(0.3, 9);
    expect(back.ny).toBeCloseTo(0.72, 9);
  });

  it("maps a 2× Retina capture to executor points with window origin", () => {
    const point = mapCaptureToExecutor(
      { scaleX: 0.5, scaleY: 0.5, originX: 100, originY: 50 },
      { x: 1920, y: 1080 }
    );
    expect(point).toEqual({ x: 100 + 960, y: 50 + 540 });
  });

  it("validates crop rectangles against capture bounds", () => {
    expect(() =>
      validateCropRect(1920, 1080, { x: 0, y: 0, width: 1920, height: 1080 })
    ).not.toThrow();
    expect(() =>
      validateCropRect(1920, 1080, { x: 100, y: 0, width: 1821, height: 100 })
    ).toThrow(ComputerUseError);
    expect(() =>
      validateCropRect(1920, 1080, { x: -1, y: 0, width: 10, height: 10 })
    ).toThrow(ComputerUseError);
  });

  it("rejects non-positive geometry when building transforms", () => {
    expect(() =>
      buildGroundingTransform({
        modelWidth: 0,
        modelHeight: 100,
        cropX: 0,
        cropY: 0,
        cropWidth: 10,
        cropHeight: 10,
      })
    ).toThrow(ComputerUseError);
  });
});
