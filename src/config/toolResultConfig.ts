/**
 * Central configuration for recoverable large tool results (technical design §13.1).
 *
 * The values here mirror the PRD §8 defaults table. They are deliberately
 * conservative and are the SINGLE source of truth for every byte/token
 * ceiling in the feature: preparation, the aggregate budget, retrieval pages,
 * storage, and the renderer viewer all read this one object so no layer can
 * approve data that another layer counts differently.
 *
 * Rollout is flag-gated (see `src/config/featureFlags.ts`) and read live from
 * the Token store so support staff can toggle a stage without a restart.
 * Turning capture OFF does not unregister readers for existing references and
 * does not erase artifacts (AC-27).
 */

/** Bumped whenever a ceiling or accounting rule changes in a way that makes
 * previously derived projections stale. Recorded on receipts and cursors. */
export const TOOL_RESULT_POLICY_VERSION = "tool-result-policy-v1";

/** Immutable defaults. Overrides are validated, never blindly trusted. */
export const TOOL_RESULT_DEFAULTS = {
  /** Largest inline text/JSON body before it becomes a saved result. */
  inlineMaxBytes: 16 * 1024,
  inlineMaxTokens: 2000,

  /** Whole saved receipt, including descriptors, control, and preview. */
  receiptMaxBytes: 4 * 1024,

  /** Preview is the last thing allocated space, so it shrinks first. */
  previewMaxBytes: 2 * 1024,
  previewMaxTokens: 512,

  /** One read/search response, envelope included. */
  readMaxBytes: 8 * 1024,
  readMaxTokens: 2000,

  /** Validated control payload ceiling inside a receipt. */
  controlMaxBytes: 1024,

  /** Combined model allocation for ALL tool results in one request. */
  resultInputFraction: 0.25,
  /** Per-result share of usable input, before aggregate pressure. */
  inlineTokenFraction: 0.1,

  /** Per-artifact / per-stream capture ceiling. */
  artifactMaxBytes: 64 * 1024 * 1024,

  conversationQuotaBytes: 1024 * 1024 * 1024,
  profileQuotaBytes: 5 * 1024 * 1024 * 1024,
  minimumFreeDiskBytes: 128 * 1024 * 1024,

  /** Unknown-length streams reserve in this increment and grow atomically. */
  reservationIncrementBytes: 1024 * 1024,
  captureConcurrency: 2,

  /** Cumulative retrieval work per assistant turn, shared by read + search. */
  retrievalMaxCalls: 32,
  retrievalMaxTokensPerTurn: 32_000,

  searchMaxScanBytes: 8 * 1024 * 1024,
  searchMaxMs: 100,
  searchDefaultMaxMatches: 10,
  searchMaxMatches: 20,
  searchQueryMaxChars: 200,

  /** Renderer page ceiling for one read/search response. */
  uiReadMaxBytes: 32 * 1024,

  /** Crash residue is reclaimed only after this grace, and only when the
   * writing lease has expired. Active leases are always protected. */
  orphanGraceHours: 24,

  /** Unknown-transport request-body ceiling; a model context size is NOT a
   * transport-size limit. */
  unknownTransportMaxBytes: 8 * 1024 * 1024,

  /** JSON walker bounds. */
  maxJsonDepth: 128,
  serializerYieldBytes: 64 * 1024,
  serializerYieldMs: 10,

  /** Bounded list/shape limits for the validated control object. */
  controlMaxKeys: 48,
  controlMaxArrayItems: 64,
  controlMaxStringChars: 1024,

  /** Viewer keeps at most this many recently visited pages in memory. */
  viewerPageCacheSize: 5,
} as const;

/** Fully resolved configuration. All fields are positive finite values. */
export type ToolResultConfig = {
  -readonly [K in keyof typeof TOOL_RESULT_DEFAULTS]: number;
};

/** Partial override input. Invalid values are rejected, not coerced. */
export type ToolResultConfigOverrides = Partial<
  Record<keyof typeof TOOL_RESULT_DEFAULTS, unknown>
>;

/** Outcome of resolving overrides against the defaults. */
export interface ResolvedToolResultConfig {
  readonly config: ToolResultConfig;
  /** Keys whose supplied value was rejected and the default was kept. */
  readonly rejectedKeys: readonly string[];
}

/**
 * Resolve overrides, rejecting anything that is not a positive finite integer
 * (or, for the two fractions, a finite number in (0, 1]).
 *
 * Rejecting rather than clamping keeps a misconfigured deployment loud in
 * tests while never letting a bad value widen a ceiling at runtime.
 */
export function resolveToolResultConfig(
  overrides: ToolResultConfigOverrides = {}
): ResolvedToolResultConfig {
  const resolved: Record<string, number> = {
    ...(TOOL_RESULT_DEFAULTS as unknown as Record<string, number>),
  };
  const rejectedKeys: string[] = [];

  for (const key of Object.keys(
    TOOL_RESULT_DEFAULTS
  ) as Array<keyof typeof TOOL_RESULT_DEFAULTS>) {
    const raw = overrides[key];
    if (raw === undefined) continue;
    const isFraction =
      key === "resultInputFraction" || key === "inlineTokenFraction";
    const acceptable = isFraction
      ? typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw <= 1
      : typeof raw === "number" &&
        Number.isFinite(raw) &&
        Number.isInteger(raw) &&
        raw > 0;
    if (!acceptable) {
      rejectedKeys.push(String(key));
      continue;
    }
    resolved[key] = raw as number;
  }

  return {
    config: resolved as unknown as ToolResultConfig,
    rejectedKeys,
  };
}

/** The default configuration. Callers that do not need overrides use this. */
export const TOOL_RESULT_CONFIG: ToolResultConfig =
  resolveToolResultConfig().config;

/**
 * Rollout flag keys (Token values). All three default OFF and fail closed:
 * a broken Token store must never silently enable capture, model-visible
 * references, or the new viewer.
 *
 * 1. capture   — additive schema/read support plus new file capture.
 * 2. modelRefs — emitting model-readable output references (retrieval tools).
 * 3. ui        — the paged result viewer. Disabling it never widens the old
 *                viewer, which receives bounded content regardless.
 */
export const TOOL_RESULT_FLAGS = {
  capture: "ai_tool_output_capture_enabled",
  modelRefs: "ai_tool_output_model_refs_enabled",
  ui: "ai_tool_output_ui_enabled",
} as const;

/** File extension per captured format. Fixed mapping, never producer input. */
export const TOOL_OUTPUT_FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  text: "txt",
  json: "json",
  jsonl: "jsonl",
  binary: "bin",
};

/** Media type per captured format. */
export const TOOL_OUTPUT_MEDIA_TYPES: Readonly<Record<string, string>> = {
  text: "text/plain; charset=utf-8",
  json: "application/json",
  jsonl: "application/x-ndjson",
  binary: "application/octet-stream",
};

/** Maximum output descriptors carried by one receipt (design §5.1). */
export const MAX_OUTPUT_DESCRIPTORS_PER_RECEIPT = 8;
