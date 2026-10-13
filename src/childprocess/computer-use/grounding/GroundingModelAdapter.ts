/**
 * Grounding model adapter contract (design §5.9.1).
 *
 * The plugin repository owns the versioned schema and conformance fixtures;
 * AiFetchly implements adapters inside its worker behind a compile-time
 * registry. The adapter answers "where is this described control in this
 * image?" — nothing else. It cannot execute desktop input, access the
 * database, authorize actions, send network requests, or convert to desktop
 * coordinates.
 */
import type {
  ComputerUseSessionGeneration,
  GroundingAdapterCapabilities,
  GroundingCandidate,
  GroundingModelIdentity,
  GroundingOutcome,
  GroundingTransform,
} from "@/entityTypes/computerUseTypes";

/** Request bound to an image, description, crop, observation, generation. */
export interface AdapterGroundRequest {
  readonly requestKey: string;
  readonly generation: ComputerUseSessionGeneration;
  readonly observationId: string;
  /** Raw image bytes (PNG); never logged, never persisted. */
  readonly imageBytes: ArrayBuffer;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly targetDescription: string;
  readonly crop?: { x: number; y: number; width: number; height: number };
  /** Runtime pixel budget for this call (latency lever, not identity). */
  readonly maxPixels: number;
}

/** Adapter result before host-boundary validation. */
export interface AdapterGroundResult {
  readonly candidates: readonly GroundingCandidate[];
  readonly transform: GroundingTransform;
  readonly outcome: GroundingOutcome;
  readonly timings: {
    readonly preprocessMs: number;
    readonly inferenceMs: number;
    readonly postprocessMs: number;
  };
  /** Optional attention grid for diagnostics (CU-VISION-15). */
  readonly attentionGrid?: { width: number; height: number; values: Float32Array };
}

export interface AdapterLoadContext {
  /** Version roots resolved by LocalAiRuntimeResolver in the main process. */
  readonly runtimeRoot: string;
  readonly runtimeVersion: string;
  readonly modelRoot: string;
  readonly modelVersion: string;
  readonly preferredProviders: readonly string[];
  readonly calibration: {
    readonly ambiguityRatio: number;
    readonly absenceThreshold: number;
  };
}

export interface AdapterLoadResult {
  readonly provider: string;
  readonly availableProviders: readonly string[];
  readonly loadMs: number;
  readonly memoryEstimateBytes: number;
}

/** Typed adapter failure (shared error meanings, design §5.9.2). */
export type AdapterError =
  | { readonly code: "model_not_ready"; readonly message: string }
  | { readonly code: "backend_unavailable"; readonly message: string }
  | { readonly code: "request_invalid"; readonly message: string }
  | { readonly code: "output_invalid"; readonly message: string }
  | { readonly code: "cancelled"; readonly message: string }
  | { readonly code: "timeout"; readonly message: string }
  | { readonly code: "memory"; readonly message: string };

export class GroundingAdapterError extends Error {
  readonly adapterError: AdapterError;
  constructor(adapterError: AdapterError) {
    super(adapterError.message);
    this.name = "GroundingAdapterError";
    this.adapterError = adapterError;
  }
}

/** The versioned contract every adapter implements. */
export interface GroundingModelAdapter {
  readonly capabilities: GroundingAdapterCapabilities;
  load(context: AdapterLoadContext): Promise<AdapterLoadResult>;
  ground(request: AdapterGroundRequest): Promise<AdapterGroundResult>;
  /** Discard the result for a request key; terminate the run if possible. */
  cancel(requestKey: string): void;
  unload(): Promise<void>;
  /** Complete model identity for traces (CU-VISION-15). */
  identity(provider: string): GroundingModelIdentity;
}

/* --------------------------- boundary validation --------------------------- */

/**
 * Worker-boundary validation (design §5.9.2): request IDs present, image
 * byte/dimension limits, crop bounds, candidate counts, finite geometry,
 * declared coordinate space (normalized), and a preprocessing transform.
 */
export function validateGroundRequest(
  request: AdapterGroundRequest,
  capabilities: GroundingAdapterCapabilities
): void {
  const fail = (message: string): never => {
    throw new GroundingAdapterError({ code: "request_invalid", message });
  };
  if (!request.requestKey || request.requestKey.length > 200) {
    fail("requestKey missing or oversized");
  }
  if (!request.observationId || request.observationId.length > 200) {
    fail("observationId missing or oversized");
  }
  if (
    !Number.isInteger(request.generation) ||
    request.generation <= 0
  ) {
    fail("generation must be a positive integer");
  }
  if (request.imageBytes.byteLength === 0) {
    fail("image bytes are empty");
  }
  if (request.imageBytes.byteLength > 64 * 1024 * 1024) {
    fail("image exceeds the 64 MiB transport cap");
  }
  // Audit F08: NaN/Infinity geometry fails closed — comparisons with NaN
  // are false, so finite checks must come first.
  if (
    !Number.isFinite(request.imageWidth) ||
    !Number.isFinite(request.imageHeight) ||
    request.imageWidth <= 0 ||
    request.imageHeight <= 0
  ) {
    fail("image dimensions must be finite and positive");
  }
  if (
    request.imageWidth * request.imageHeight >
    capabilities.maxImagePixels
  ) {
    fail("image exceeds the adapter pixel cap");
  }
  if (request.crop) {
    const { x, y, width, height } = request.crop;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > request.imageWidth ||
      y + height > request.imageHeight
    ) {
      fail("crop rect must be finite and inside image bounds");
    }
  }
  if (
    !request.targetDescription ||
    request.targetDescription.length === 0 ||
    request.targetDescription.length > 4_000
  ) {
    fail("targetDescription must be 1..4000 chars");
  }
  if (!Number.isFinite(request.maxPixels) || request.maxPixels <= 0) {
    fail("maxPixels must be positive");
  }
}

/** Result-side validation before the worker replies to the host. */
export function validateGroundResult(result: AdapterGroundResult): void {
  const fail = (message: string): never => {
    throw new GroundingAdapterError({ code: "output_invalid", message });
  };
  if (result.candidates.length > 8) {
    fail("candidate count exceeds the contract maximum");
  }
  for (const candidate of result.candidates) {
    if (
      !Number.isFinite(candidate.nx) ||
      !Number.isFinite(candidate.ny) ||
      !Number.isFinite(candidate.score)
    ) {
      fail("candidate geometry/score must be finite");
    }
    if (
      candidate.regionWidthNormalized !== undefined &&
      (!Number.isFinite(candidate.regionWidthNormalized) ||
        candidate.regionWidthNormalized < 0) ||
      candidate.regionHeightNormalized !== undefined &&
      (!Number.isFinite(candidate.regionHeightNormalized) ||
        candidate.regionHeightNormalized < 0)
    ) {
      fail("candidate region extents must be finite and non-negative");
    }
    if (candidate.nx < 0 || candidate.nx > 1 || candidate.ny < 0 || candidate.ny > 1) {
      fail("candidate normalized coordinates must lie in [0,1]");
    }
  }
  const t = result.transform;
  if (
    !Number.isFinite(t.modelWidth) ||
    !Number.isFinite(t.modelHeight) ||
    t.modelWidth <= 0 ||
    t.modelHeight <= 0 ||
    !Number.isFinite(t.scaleX) ||
    t.scaleX <= 0 ||
    !Number.isFinite(t.scaleY) ||
    t.scaleY <= 0
  ) {
    fail("transform geometry invalid");
  }
  if (result.outcome === "resolved" && result.candidates.length === 0) {
    fail("resolved outcome requires at least one candidate");
  }
}
