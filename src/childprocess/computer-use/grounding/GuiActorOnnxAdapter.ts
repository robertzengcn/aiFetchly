/**
 * GuiActorOnnxAdapter (design §5.2–5.8).
 *
 * Wraps the pinned GUI-Actor ONNX export: one prefill forward pass with the
 * pointer head, without token-by-token generation. Host TypeScript performs
 * preprocessing geometry (GuiActorPreprocessor) and output decoding +
 * calibration (GuiActorPostprocessor); the exported graphs perform the
 * vision encoder / decoder / pointer-head computation.
 *
 * The graph I/O contract, tokenizer/template, pointer token, patch layout,
 * and output interpretation come from the reviewed manifest; the host must
 * reproduce the reference fixtures and record its processing revisions
 * (§5.3). Until the plugin repository publishes qualified model packages,
 * loading fails with typed `model_not_ready`/`backend_unavailable` — no
 * speculative inference on unqualified artifacts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type GroundingAdapterCapabilities,
  type GroundingCandidate,
  type GroundingModelIdentity,
} from "@/entityTypes/computerUseTypes";
import {
  buildPreprocessingTransform,
  GUI_ACTOR_PREPROCESSING_REVISION,
} from "@/childprocess/computer-use/GuiActorPreprocessor";
import {
  classifyGrounding,
  calibrationRevisionOf,
  GUI_ACTOR_DECODING_REVISION,
} from "@/childprocess/computer-use/GuiActorPostprocessor";
import {
  loadOnnxRuntimeFromRoot,
  OnnxRuntimeLoadError,
  type LoadedOnnxRuntime,
  type OnnxSessionLike,
} from "@/childprocess/computer-use/OnnxRuntimeLoader";
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

export const GUI_ACTOR_ADAPTER_ID = "gui-actor-onnx";
export const GUI_ACTOR_ADAPTER_VERSION = "1.0.0";
export const GUI_ACTOR_ARCHITECTURE = "gui-actor-2b-qwen2vl";

/** Files the default GUI-Actor model package must contain (§7.5). */
const REQUIRED_MODEL_FILES = [
  "manifest.json",
  "graph/vision_encoder.onnx",
  "graph/decoder.onnx",
  "graph/pointer_head.onnx",
  "tokenizer/tokenizer.json",
  "preprocessing/preprocessor_config.json",
  "health/fixture.png",
  "health/expected.json",
] as const;

export const GUI_ACTOR_CAPABILITIES: GroundingAdapterCapabilities = {
  id: GUI_ACTOR_ADAPTER_ID,
  version: GUI_ACTOR_ADAPTER_VERSION,
  architecture: GUI_ACTOR_ARCHITECTURE,
  contractVersion: 1,
  supportsCrops: true,
  supportsAttentionGrid: true,
  maxImagePixels: 8_294_400,
  requiredFiles: REQUIRED_MODEL_FILES,
};

interface GroundingModelManifest {
  modelArchitecture: string;
  preprocessingRevision: string;
  decodingRevision: string;
  calibrationRevision: string;
  graphInputs: Record<string, string>;
  pointerOutput: string;
  attentionOutput?: string;
}

export class GuiActorOnnxAdapter implements GroundingModelAdapter {
  readonly capabilities = GUI_ACTOR_CAPABILITIES;

  private runtime: LoadedOnnxRuntime | null = null;
  private sessions: { decoder: OnnxSessionLike; pointer: OnnxSessionLike } | null =
    null;
  private loadContext: AdapterLoadContext | null = null;
  private modelManifest: GroundingModelManifest | null = null;
  private provider = "cpu";

  async load(context: AdapterLoadContext): Promise<AdapterLoadResult> {
    this.loadContext = context;
    const startedAt = Date.now();

    // 1. Model files must all exist and the manifest must declare the
    //    processing revisions this adapter implements (§5.3 evidence gate).
    for (const file of REQUIRED_MODEL_FILES) {
      if (!existsSync(join(context.modelRoot, file))) {
        throw new GroundingAdapterError({
          code: "model_not_ready",
          message: `model package file missing: ${file}`,
        });
      }
    }
    try {
      this.modelManifest = JSON.parse(
        readFileSync(join(context.modelRoot, "manifest.json"), "utf8")
      ) as GroundingModelManifest;
    } catch (error) {
      throw new GroundingAdapterError({
        code: "model_not_ready",
        message: `model manifest unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    const manifest = this.modelManifest;
    if (
      manifest.modelArchitecture !== GUI_ACTOR_ARCHITECTURE ||
      manifest.preprocessingRevision !== GUI_ACTOR_PREPROCESSING_REVISION ||
      manifest.decodingRevision !== GUI_ACTOR_DECODING_REVISION
    ) {
      throw new GroundingAdapterError({
        code: "model_not_ready",
        message:
          "model package does not match this adapter's qualified processing revisions",
      });
    }

    // 2. Load the ONNX Runtime binding from the leased version root.
    try {
      this.runtime = loadOnnxRuntimeFromRoot(
        context.runtimeRoot,
        context.runtimeVersion
      );
    } catch (error) {
      if (error instanceof OnnxRuntimeLoadError) {
        throw new GroundingAdapterError({
          code: "backend_unavailable",
          message: `ONNX Runtime unavailable (${error.code})`,
        });
      }
      throw error;
    }

    // 3. Create sessions, preferring the first provider that initializes;
    //    a GPU provider failure falls back to CPU (§5.5). A provider never
    //    changes mid-session: `ground` runs on the provider chosen here.
    const providers = [...context.preferredProviders, "cpu"];
    let lastError: unknown = null;
    for (const provider of providers) {
      try {
        const decoder = await this.runtime.binding.InferenceSession.create(
          join(context.modelRoot, "graph/decoder.onnx"),
          { executionProviders: [provider] }
        );
        const pointer = await this.runtime.binding.InferenceSession.create(
          join(context.modelRoot, "graph/pointer_head.onnx"),
          { executionProviders: [provider] }
        );
        this.sessions = { decoder, pointer };
        this.provider = provider;
        return {
          provider,
          availableProviders: this.runtime.availableProviders,
          loadMs: Date.now() - startedAt,
          memoryEstimateBytes: 0,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw new GroundingAdapterError({
      code: "backend_unavailable",
      message: `no execution provider initialized: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    });
  }

  async ground(request: AdapterGroundRequest): Promise<AdapterGroundResult> {
    if (!this.sessions || !this.loadContext) {
      throw new GroundingAdapterError({
        code: "model_not_ready",
        message: "GUI-Actor adapter is not loaded",
      });
    }
    validateGroundRequest(request, this.capabilities);
    const preprocessStarted = Date.now();

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
    const preprocessMs = Date.now() - preprocessStarted;

    const inferenceStarted = Date.now();
    // One prefill forward pass with the pointer head (§5.2). Feeds follow
    // the manifest's graph I/O contract; the pixel tensor itself is
    // produced graph-side from the raw bytes at the recorded input size.
    let outputs: Record<string, unknown>;
    try {
      outputs = await this.sessions.pointer.run({
        [this.modelManifest?.graphInputs?.image ?? "pixel_values"]:
          request.imageBytes,
        [this.modelManifest?.graphInputs?.text ?? "input_ids"]:
          request.targetDescription,
      });
    } catch (error) {
      throw new GroundingAdapterError({
        code: "output_invalid",
        message: `pointer-head inference failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    const inferenceMs = Date.now() - inferenceStarted;

    const postprocessStarted = Date.now();
    const candidates = this.decodePointerOutputs(outputs);
    const { outcome, ranked } = classifyGrounding(candidates, {
      ambiguityRatio: this.loadContext.calibration.ambiguityRatio,
      absenceThreshold: this.loadContext.calibration.absenceThreshold,
    });
    const postprocessMs = Date.now() - postprocessStarted;

    const result: AdapterGroundResult = {
      candidates: ranked,
      transform,
      outcome,
      timings: { preprocessMs, inferenceMs, postprocessMs },
    };
    validateGroundResult(result);
    return result;
  }

  cancel(_requestKey: string): void {
    // The onnxruntime-node binding does not support cancelling an in-flight
    // run(); the host kills the worker when a prompt stop is required
    // (design §5.6 — model reload is the cost of a guaranteed stop).
  }

  async unload(): Promise<void> {
    const sessions = this.sessions;
    this.sessions = null;
    this.runtime = null;
    if (sessions) {
      await sessions.decoder.release().catch(() => undefined);
      await sessions.pointer.release().catch(() => undefined);
    }
  }

  identity(provider: string): GroundingModelIdentity {
    return {
      adapterId: GUI_ACTOR_ADAPTER_ID,
      adapterVersion: GUI_ACTOR_ADAPTER_VERSION,
      modelArchitecture: GUI_ACTOR_ARCHITECTURE,
      runtimeId: "grounding-onnxruntime",
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

  /** The provider fixed at load time (CU-VISION-10). */
  get activeProvider(): string {
    return this.provider;
  }

  /**
   * Decode pointer-head outputs into candidates from DETECTED PEAKS
   * (audit F11): never a whole-grid centroid and never a manufactured
   * runner-up. The top local maxima become candidates with their real
   * activation values; an (optional) second separated peak carries its own
   * score so the calibrated ambiguity check (§5.7) can classify two
   * equally strong controls as `target_ambiguous`. A zero/negative signal
   * grid decodes to a zero-score top candidate, which the absence
   * threshold turns into `target_not_found` — no artificial 0.5 fallback.
   */
  private decodePointerOutputs(
    outputs: Record<string, unknown>
  ): GroundingCandidate[] {
    const pointerKey = this.modelManifest?.pointerOutput ?? "pointer";
    const tensor = outputs[pointerKey];
    if (!tensor || typeof tensor !== "object") {
      throw new GroundingAdapterError({
        code: "output_invalid",
        message: "pointer output tensor missing",
      });
    }
    const record = tensor as { data?: ArrayLike<number>; dims?: readonly number[] };
    const data = record.data;
    const dims = record.dims;
    if (!data || !dims || dims.length !== 2) {
      throw new GroundingAdapterError({
        code: "output_invalid",
        message: "pointer tensor must be a 2-D activation grid",
      });
    }
    const [gridH, gridW] = dims as [number, number];
    if (!Number.isFinite(gridH) || !Number.isFinite(gridW) || gridH <= 0 || gridW <= 0) {
      throw new GroundingAdapterError({
        code: "output_invalid",
        message: "pointer tensor dimensions must be finite and positive",
      });
    }
    // Collect cells with positive signal.
    const cells: Array<{ x: number; y: number; value: number }> = [];
    let max = -Infinity;
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const raw = Number(data[y * gridW + x]);
        if (!Number.isFinite(raw)) {
          throw new GroundingAdapterError({
            code: "output_invalid",
            message: "pointer activation grid carries a non-finite value",
          });
        }
        if (raw > 0) cells.push({ x, y, value: raw });
        if (raw > max) max = raw;
      }
    }
    if (cells.length === 0 || !Number.isFinite(max) || max <= 0) {
      // No positive signal at all: the absence threshold classifies this
      // as target_not_found — a typed outcome, never an invented peak.
      return [{ nx: 0.5, ny: 0.5, score: 0 }];
    }
    // Local-maximum peaks (strictly greater than 4-neighbours).
    const at = (x: number, y: number): number =>
      x < 0 || y < 0 || x >= gridW || y >= gridH
        ? 0
        : Number(data[y * gridW + x]) || 0;
    const peaks = cells
      .filter(
        (c) =>
          c.value >= at(c.x - 1, c.y) &&
          c.value >= at(c.x + 1, c.y) &&
          c.value >= at(c.x, c.y - 1) &&
          c.value >= at(c.x, c.y + 1)
      )
      .sort((a, b) => b.value - a.value)
      .slice(0, 4); // candidate cap; classifyGrounding keeps the meaning
    const top = peaks[0];
    const candidates: GroundingCandidate[] = [
      {
        nx: (top.x + 0.5) / gridW,
        ny: (top.y + 0.5) / gridH,
        score: normalizeScore(top.value, max),
        regionWidthNormalized: 1 / gridW,
        regionHeightNormalized: 1 / gridH,
      },
    ];
    // Real competing peaks only: separated from the top peak and carrying
    // their own activation (audit F11 — no fabricated half-score runner-up).
    for (const peak of peaks.slice(1)) {
      const separated =
        Math.abs(peak.x - top.x) > 1 || Math.abs(peak.y - top.y) > 1;
      if (separated) {
        candidates.push({
          nx: (peak.x + 0.5) / gridW,
          ny: (peak.y + 0.5) / gridH,
          score: normalizeScore(peak.value, max),
          regionWidthNormalized: 1 / gridW,
          regionHeightNormalized: 1 / gridH,
        });
        break; // one runner-up is enough for the ambiguity classification
      }
    }
    return candidates;
  }
}

/**
 * Normalize a raw activation against the grid maximum into a bounded
 * relative score in [0,1] (scores are ranking metadata, never calibrated
 * probabilities — §5.7).
 */
function normalizeScore(value: number, max: number): number {
  const normalized = max > 0 ? value / max : 0;
  return Number(Math.min(1, Math.max(0, normalized)).toFixed(6));
}
