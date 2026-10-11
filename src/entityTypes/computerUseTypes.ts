/**
 * Computer Use — strict type contracts for the host-owned subsystem.
 *
 * The AiFetchly main process owns sessions, the target store, coordinate
 * transforms, action grants, the desktop lease, and stop. No plugin, adapter,
 * or worker process can authorize input; these types make that boundary
 * explicit by keeping authority-bearing fields host-side only.
 *
 * See docs/prd/computer-use-aifetchly-technical-design.md §9.2, §10, §11.
 */

/** Supervisor session states (design §10.1). Adapters are authority-stateless. */
export type ComputerUseSessionState =
  | "STARTING"
  | "READY"
  | "OBSERVING"
  | "GROUNDING"
  | "AWAITING_AUTHORIZATION"
  | "EXECUTING"
  | "VERIFYING"
  | "PAUSED"
  | "HANDOFF"
  | "STOPPING"
  | "STOPPED"
  | "FAILED";

/** Monotonic per-session generation; increments on stop/restart/handoff/planner-mode change. */
export type ComputerUseSessionGeneration = number;

/** Opaque host-minted handle. Model-visible; never convertible back to authority. */
export type ComputerUseTargetHandle = string;

/** Opaque observation id bound to a capture and a generation. */
export type ComputerUseObservationId = string;

/** Planner routing modes (PRD §6.4). */
export type ComputerUsePlannerMode = "local_only" | "visual";

/** Authorization classes derived from the PRD W-1 table and CU-PERM-04. */
export type ComputerUseActionClass =
  | "read_only"
  | "within_task"
  | "confirmation_required"
  | "consequential";

/** Action kinds the supervisor can dispatch through a desktop adapter. */
export type ComputerUseActionKind =
  | "click"
  | "double_click"
  | "right_click"
  | "move_pointer"
  | "drag"
  | "type_text"
  | "key"
  | "hotkey"
  | "scroll";

/**
 * Stable, user-safe error codes shared across supervisor, adapters, worker,
 * and IPC boundaries (design §9.3). Renderer text is localized from the code.
 */
export type ComputerUseErrorCode =
  | "desktop_busy"
  | "session_invalid"
  | "session_state_invalid"
  | "unsupported_target"
  | "own_window"
  | "elevated_window"
  | "host_elevated"
  | "stop_hotkey_unavailable"
  | "target_not_found"
  | "target_ambiguous"
  | "target_stale"
  | "coordinates_invalid"
  | "grant_invalid"
  | "permission_denied"
  | "planner_mode_unavailable"
  | "model_not_ready"
  | "backend_unavailable"
  | "execution_uncertain"
  | "verification_failed"
  | "ai_disabled"
  | "unknown_error";

/** Retry classification carried by normalized errors (design §9.3). */
export type ComputerUseRetryClassification =
  | "never"
  | "after_reobserve"
  | "after_user_action"
  | "immediate";

/** Typed error thrown/returned across Computer Use boundaries. */
export class ComputerUseError extends Error {
  readonly code: ComputerUseErrorCode;
  readonly retry: ComputerUseRetryClassification;
  /** Correlation id for traces; never contains paths or secrets. */
  readonly correlationId?: string;

  constructor(
    code: ComputerUseErrorCode,
    message: string,
    retry: ComputerUseRetryClassification = "never",
    correlationId?: string
  ) {
    super(message);
    this.name = "ComputerUseError";
    this.code = code;
    this.retry = retry;
    this.correlationId = correlationId;
  }
}

/** Native window identity as reported by a desktop adapter (untrusted text). */
export interface ComputerUseWindowInfo {
  readonly windowId: string;
  readonly title: string;
  readonly processName: string;
  readonly processId: number;
  readonly bounds: ComputerUseRect;
}

/** Device-independent rectangle used for window bounds and masking. */
export interface ComputerUseRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Metadata bound to every observation (staleness contract, design §11.4). */
export interface ComputerUseObservationMetadata {
  readonly observationId: ComputerUseObservationId;
  readonly generation: ComputerUseSessionGeneration;
  /** Monotonic capture timestamp (ms, main-process clock). */
  readonly capturedAt: number;
  readonly targetWindowId: string;
  readonly foregroundWindowId: string | null;
  readonly targetBounds: ComputerUseRect;
  readonly displayConfigurationKey: string;
  /** Observation expiry (ms epoch); expired observations never dispatch. */
  readonly expiresAt: number;
}

/** Structured observation normalized from accessibility data. Untrusted text. */
export interface ComputerUseObservation {
  readonly metadata: ComputerUseObservationMetadata;
  /** Bounded accessibility text; never expanded into authority. */
  readonly structuredText: string;
  readonly elements: readonly ComputerUseUiElement[];
}

/** One normalized accessibility element. */
export interface ComputerUseUiElement {
  readonly elementId: string;
  readonly role: string;
  readonly name: string;
  readonly bounds: ComputerUseRect;
  readonly value?: string;
  readonly disabled?: boolean;
}

/** Preprocessing transform record accompanying a grounding result (design §11.2). */
export interface GroundingTransform {
  /** Model-input image size after smart_resize (px). */
  readonly modelWidth: number;
  readonly modelHeight: number;
  /** Crop origin in original capture pixels. */
  readonly cropX: number;
  readonly cropY: number;
  /** Per-axis scales from crop pixels to model pixels (anisotropic). */
  readonly scaleX: number;
  readonly scaleY: number;
  /** Left/top padding inside the model input (px), if any. */
  readonly padX: number;
  readonly padY: number;
}

/** A grounding candidate point in normalized model-output coordinates. */
export interface GroundingCandidate {
  /** Normalized [0,1] over the model-input image. */
  readonly nx: number;
  readonly ny: number;
  /** Model-specific activation score; NOT a probability. */
  readonly score: number;
  readonly regionWidthNormalized?: number;
  readonly regionHeightNormalized?: number;
}

/** Model/adapter identity recorded with every grounding result (CU-VISION-15). */
export interface GroundingModelIdentity {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly modelArchitecture: string;
  readonly runtimeId: string;
  readonly runtimeVersion: string;
  readonly preprocessingRevision: string;
  readonly decodingRevision: string;
  readonly calibrationRevision: string;
  readonly executionProvider: string;
}

/** Result of a grounding call after worker-boundary validation. */
export interface GroundingResult {
  readonly requestKey: string;
  readonly generation: ComputerUseSessionGeneration;
  readonly observationId: ComputerUseObservationId;
  readonly candidates: readonly GroundingCandidate[];
  readonly transform: GroundingTransform;
  readonly identity: GroundingModelIdentity;
  readonly timings: {
    readonly preprocessMs: number;
    readonly inferenceMs: number;
    readonly postprocessMs: number;
  };
  readonly outcome: GroundingOutcome;
}

/** Calibrated outcome classification (design §5.7). */
export type GroundingOutcome =
  | "resolved"
  | "target_ambiguous"
  | "target_not_found";

/** Host-resolved target stored in the supervisor's target store. */
export interface ComputerUseResolvedTarget {
  readonly handle: ComputerUseTargetHandle;
  readonly generation: ComputerUseSessionGeneration;
  readonly observationId: ComputerUseObservationId;
  /** Resolved point in capture pixels. */
  readonly capturePoint: { readonly x: number; readonly y: number };
  readonly region: ComputerUseRect;
  readonly source: "accessibility" | "grounding";
  readonly grounding?: GroundingResult;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** Outcome of a dispatched action (CU-VISION-06: injection ≠ completion). */
export interface ComputerUseActionOutcome {
  readonly actionId: string;
  readonly generation: ComputerUseSessionGeneration;
  readonly dispatchedAt: number;
  readonly outcome:
    | "succeeded"
    | "failed"
    | "uncertain"
    | "rejected"
    | "cancelled";
  readonly verification?:
    | { readonly verified: true }
    | { readonly verified: false; readonly reason: string };
  readonly errorCode?: ComputerUseErrorCode;
}

/** Host-minted authorization grant (design §10.3). Never model-supplied. */
export interface ComputerUseActionGrant {
  readonly sessionId: string;
  readonly generation: ComputerUseSessionGeneration;
  readonly actionId: string;
  /** SHA-256 of the normalized action payload. */
  readonly actionHash: string;
  readonly targetHandle: ComputerUseTargetHandle;
  readonly observationId: ComputerUseObservationId;
  readonly actionClass: ComputerUseActionClass;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** Input to grant validation — the action exactly as it will be dispatched. */
export interface ComputerUseActionRequest {
  readonly actionKind: ComputerUseActionKind;
  readonly targetHandle: ComputerUseTargetHandle;
  readonly observationId: ComputerUseObservationId;
  readonly point?: { readonly x: number; readonly y: number };
  readonly text?: string;
  readonly key?: string;
  readonly modifiers?: readonly string[];
}

/** One dispatched action recorded for audit/trace. */
export interface ComputerUseActionRecord {
  readonly actionId: string;
  readonly sessionId: string;
  readonly generation: ComputerUseSessionGeneration;
  readonly request: ComputerUseActionRequest;
  readonly actionClass: ComputerUseActionClass;
  readonly grantIssuedAt: number;
  readonly outcome: ComputerUseActionOutcome;
}

/** Renderer-visible session snapshot. No paths, argv, or image bytes. */
export interface ComputerUseSessionSummary {
  readonly sessionId: string;
  readonly state: ComputerUseSessionState;
  readonly generation: ComputerUseSessionGeneration;
  readonly targetWindow: ComputerUseWindowInfo | null;
  readonly plannerMode: ComputerUsePlannerMode;
  readonly groundingModelRuntimeId: string | null;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly stopHotkey: string | null;
}

/** Grounding readiness computed from runtime+model statuses (design §7.8). */
export type GroundingReadiness =
  | "unsupported_target"
  | "insufficient_memory"
  | "not_installed"
  | "runtime_required"
  | "model_required"
  | "model_incompatible"
  | "installing"
  | "ready"
  | "update_available"
  | "repair_required";

/** User-facing Computer Use settings (validated with Zod at load). */
export interface ComputerUseSettings {
  readonly localVisionEnabled: boolean;
  /** Selected grounding model runtime id; only installed+compatible ids. */
  readonly groundingModelRuntimeId: string | null;
  readonly visualPlannerEnabled: boolean;
  /** Electron accelerator with at least two modifiers (open decision 8). */
  readonly stopHotkey: string;
  readonly debugCaptureEnabled: boolean;
  readonly debugRetentionDays: number;
}

export const DEFAULT_COMPUTER_USE_STOP_HOTKEY = "Ctrl+Alt+Shift+S";

export const DEFAULT_COMPUTER_USE_SETTINGS: ComputerUseSettings = {
  localVisionEnabled: false,
  groundingModelRuntimeId: null,
  visualPlannerEnabled: false,
  stopHotkey: DEFAULT_COMPUTER_USE_STOP_HOTKEY,
  debugCaptureEnabled: false,
  debugRetentionDays: 14,
};

/** Measurement harness metric names (design §10.5.5). */
export type ComputerUseMetricName =
  | "stop_acknowledgment_ms"
  | "last_input_after_stop_ms"
  | "stop_completion_ms"
  | "observation_latency_ms"
  | "grounding_latency_warm_ms"
  | "worker_cold_start_ms";

/** One recorded measurement sample. */
export interface ComputerUseMeasurement {
  readonly metric: ComputerUseMetricName;
  readonly sessionId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
}

/* ------------------------------------------------------------------------- */
/* Grounding worker protocol (design §5.6). Image bytes travel as ArrayBuffer */
/* over the worker port and are never logged.                                */
/* ------------------------------------------------------------------------- */

/** Worker load request: identity + resolved paths from the main process. */
export interface GroundingWorkerLoadRequest {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly runtimeRoot: string;
  readonly runtimeVersion: string;
  readonly modelRoot: string;
  readonly modelVersion: string;
  readonly preferredProviders: readonly string[];
  readonly calibration: {
    readonly ambiguityRatio: number;
    readonly absenceThreshold: number;
  };
  /** Maximum model-input pixels (pixel budget; runtime parameter). */
  readonly maxPixels: number;
}

/** Worker load reply: effective capabilities after probing. */
export interface GroundingWorkerLoadResult {
  readonly adapterId: string;
  readonly provider: string;
  readonly availableProviders: readonly string[];
  readonly loadMs: number;
  readonly memoryEstimateBytes: number;
}

/** One grounding request. Single in flight; queue depth 1. */
export interface GroundingWorkerGroundRequest {
  readonly requestKey: string;
  readonly generation: ComputerUseSessionGeneration;
  readonly observationId: ComputerUseObservationId;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly targetDescription: string;
  readonly crop?: ComputerUseRect;
}

/** Typed worker failures (shared error meanings across OS adapters). */
export type GroundingWorkerErrorCode =
  | "adapter_not_found"
  | "model_not_ready"
  | "backend_unavailable"
  | "request_invalid"
  | "output_invalid"
  | "cancelled"
  | "timeout"
  | "memory";

export interface GroundingWorkerError {
  readonly requestKey: string;
  readonly code: GroundingWorkerErrorCode;
  readonly message: string;
}

export type GroundingWorkerInboundMessage =
  | { readonly type: "load"; readonly payload: GroundingWorkerLoadRequest }
  | { readonly type: "ground"; readonly payload: GroundingWorkerGroundRequest }
  | { readonly type: "cancel"; readonly requestKey: string }
  | { readonly type: "unload" };

export type GroundingWorkerOutboundMessage =
  | {
      readonly type: "loaded";
      readonly payload: GroundingWorkerLoadResult;
    }
  | {
      readonly type: "result";
      readonly payload: GroundingResult;
    }
  | {
      readonly type: "error";
      readonly payload: GroundingWorkerError;
    }
  | { readonly type: "unloaded" };

/** Adapter capabilities declared at registration (design §5.9.1). */
export interface GroundingAdapterCapabilities {
  readonly id: string;
  readonly version: string;
  readonly architecture: string;
  readonly contractVersion: number;
  readonly supportsCrops: boolean;
  readonly supportsAttentionGrid: boolean;
  readonly maxImagePixels: number;
  readonly requiredFiles: readonly string[];
}
