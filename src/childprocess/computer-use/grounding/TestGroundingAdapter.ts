/**
 * Test-only second grounding adapter (design §5.9.3, CU-VISION-12).
 *
 * Exercises interchangeability without promising a second production model:
 * the same host contract suite runs against this adapter and the GUI-Actor
 * adapter. It performs no inference; deterministic fixtures are selected by
 * the target description:
 *
 *   "absent: <anything>"   → target_not_found
 *   "ambiguous: <anything>" → target_ambiguous
 *   "slow: <anything>"      → resolves after an artificial delay (cancel tests)
 *   anything else           → a resolved candidate at a deterministic point
 *                             derived from the image dimensions.
 */
import {
  type GroundingAdapterCapabilities,
  type GroundingModelIdentity,
} from "@/entityTypes/computerUseTypes";
import {
  buildPreprocessingTransform,
  GUI_ACTOR_PREPROCESSING_REVISION,
} from "@/childprocess/computer-use/GuiActorPreprocessor";
import {
  classifyGrounding,
  GUI_ACTOR_DECODING_REVISION,
  calibrationRevisionOf,
} from "@/childprocess/computer-use/GuiActorPostprocessor";
import {
  GroundingAdapterError,
  validateGroundRequest,
  validateGroundResult,
  type AdapterGroundRequest,
  type AdapterGroundResult,
  type AdapterLoadContext,
  type AdapterLoadResult,
  type GroundingModelAdapter,
} from "@/childprocess/computer-use/grounding/GroundingModelAdapter";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const TEST_GROUNDING_ADAPTER_ID = "test-fixture";
export const TEST_GROUNDING_ADAPTER_VERSION = "1.0.0";

export class TestGroundingAdapter implements GroundingModelAdapter {
  readonly capabilities: GroundingAdapterCapabilities = {
    id: TEST_GROUNDING_ADAPTER_ID,
    version: TEST_GROUNDING_ADAPTER_VERSION,
    architecture: "test-fixture-arch",
    contractVersion: 1,
    supportsCrops: true,
    supportsAttentionGrid: true,
    maxImagePixels: 8_294_400, // 4K
    requiredFiles: [],
  };

  private loaded = false;
  private loadContext: AdapterLoadContext | null = null;
  private cancelled = new Set<string>();
  private artificialDelayMs = 0;

  async load(context: AdapterLoadContext): Promise<AdapterLoadResult> {
    this.loadContext = context;
    this.loaded = true;
    this.cancelled.clear();
    return {
      provider: "cpu",
      availableProviders: ["cpu"],
      loadMs: 1,
      memoryEstimateBytes: 0,
    };
  }

  /** Test hook: make subsequent ground() calls slow (cancel/kill tests). */
  setArtificialDelay(ms: number): void {
    this.artificialDelayMs = ms;
  }

  async ground(request: AdapterGroundRequest): Promise<AdapterGroundResult> {
    if (!this.loaded) {
      throw new GroundingAdapterError({
        code: "model_not_ready",
        message: "test adapter is not loaded",
      });
    }
    validateGroundRequest(request, this.capabilities);
    const crop = request.crop ?? {
      x: 0,
      y: 0,
      width: request.imageWidth,
      height: request.imageHeight,
    };
    const transform = buildPreprocessingTransform({
      sourceWidth: crop.width,
      sourceHeight: crop.height,
      cropX: crop.x,
      cropY: crop.y,
      pixelBudget: request.maxPixels,
    });

    if (this.artificialDelayMs > 0) {
      await sleep(this.artificialDelayMs);
      if (this.cancelled.has(request.requestKey)) {
        throw new GroundingAdapterError({
          code: "cancelled",
          message: "ground request was cancelled",
        });
      }
    }

    const description = request.targetDescription;
    let candidates;
    if (description.startsWith("absent:")) {
      candidates = [{ nx: 0.5, ny: 0.5, score: 0.01 }];
    } else if (description.startsWith("ambiguous:")) {
      candidates = [
        { nx: 0.3, ny: 0.3, score: 0.9, regionWidthNormalized: 0.1, regionHeightNormalized: 0.1 },
        { nx: 0.7, ny: 0.7, score: 0.88 },
      ];
    } else {
      // Deterministic point from the crop geometry: golden-ratio offsets so
      // tests can assert exact mapped coordinates.
      const nx = 0.618;
      const ny = 0.382;
      candidates = [
        { nx, ny, score: 0.95, regionWidthNormalized: 0.05, regionHeightNormalized: 0.05 },
        { nx: nx + 0.001, ny, score: 0.3 }, // inside the top region → not ambiguous
      ];
    }

    const { outcome, ranked } = classifyGrounding(
      candidates,
      this.loadContext?.calibration
        ? {
            ambiguityRatio: this.loadContext.calibration.ambiguityRatio,
            absenceThreshold: this.loadContext.calibration.absenceThreshold,
          }
        : undefined
    );
    const result: AdapterGroundResult = {
      candidates: ranked,
      transform,
      outcome,
      timings: { preprocessMs: 0, inferenceMs: 0, postprocessMs: 0 },
      attentionGrid: { width: 8, height: 8, values: new Float32Array(64) },
    };
    validateGroundResult(result);
    if (this.cancelled.has(request.requestKey)) {
      throw new GroundingAdapterError({
        code: "cancelled",
        message: "ground request was cancelled",
      });
    }
    return result;
  }

  cancel(requestKey: string): void {
    this.cancelled.add(requestKey);
  }

  async unload(): Promise<void> {
    this.loaded = false;
    this.cancelled.clear();
  }

  identity(provider: string): GroundingModelIdentity {
    return {
      adapterId: TEST_GROUNDING_ADAPTER_ID,
      adapterVersion: TEST_GROUNDING_ADAPTER_VERSION,
      modelArchitecture: this.capabilities.architecture,
      runtimeId: "test-runtime",
      runtimeVersion: this.loadContext?.runtimeVersion ?? "0",
      preprocessingRevision: GUI_ACTOR_PREPROCESSING_REVISION,
      decodingRevision: GUI_ACTOR_DECODING_REVISION,
      calibrationRevision: calibrationRevisionOf({
        ambiguityRatio: this.loadContext?.calibration.ambiguityRatio ?? 0.85,
        absenceThreshold: this.loadContext?.calibration.absenceThreshold ?? 0.2,
      }),
      executionProvider: provider,
    };
  }
}

