/**
 * Recoverable large tool results — type contracts (technical design §4.1–§4.2).
 *
 * These types encode the design's central invariant: the operation outcome,
 * the producer's own completeness, what the capture layer actually preserved,
 * and whether the preview is partial are FOUR INDEPENDENT FACTS. A tool can
 * succeed while its output was only partially captured, and a storage failure
 * must never be reported as a tool failure.
 *
 * Everything crossing a process or tool boundary is validated with
 * `@/schemas/toolResult` before being trusted; these interfaces describe the
 * shapes those schemas produce.
 */

/** Trusted operation status of a completed tool attempt. */
export type ToolOperationStatus =
  | "success"
  | "error"
  | "partial"
  | "cancelled"
  | "blocked"
  | "pending"
  | "permission_required"
  | "unknown";

/** Whether the PRODUCER itself delivered everything (AC-15). */
export type SourceCompleteness = "complete" | "partial" | "unknown";

/** Whether the CAPTURE LAYER preserved everything it received. */
export type OutputPreservation = "complete" | "partial" | "unavailable";

/** Where the captured bytes physically live. */
export type ToolOutputBackend = "file" | "legacy_message";

/** Captured representation format. */
export type ToolOutputFormat = "text" | "json" | "jsonl" | "binary";

/** Registry lifecycle state (technical design §5.3). */
export type ToolOutputState =
  | "writing"
  | "staged"
  | "committed"
  | "unavailable"
  | "failed"
  | "deleting"
  | "deleted";

/** Result-delivery policy selected by the preparer. */
export type ToolResultDelivery = "normal" | "bounded_reader" | "source_reference";

/** Preview construction strategy. */
export type ToolResultPreviewKind = "text" | "records" | "head_tail";

/**
 * Trusted execution identity.
 *
 * Produced by the main process BEFORE the tool runs and carried through async
 * jobs, permission pauses, and resume. A model-generated tool_call_id is NOT an
 * execution identity: a permission placeholder has a different phase, and a
 * deliberate re-execution gets a new id even if the caller reused a call id.
 */
export interface TrustedToolOutputContext {
  readonly profileId: string;
  readonly conversationId: string;
  readonly conversationEpoch: string;
  readonly turnId: string;
  readonly executionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly ownerAgentId?: string;
  readonly signal: AbortSignal;
}

/** Public descriptor for one preserved output stream (design §4.2). */
export interface StoredToolOutputRef {
  readonly outputId: string;
  readonly revision: number;
  readonly storageBackend: ToolOutputBackend;
  readonly format: ToolOutputFormat;
  readonly mediaType: string;
  readonly capturedBytes: number;
  readonly originalBytes?: number;
  /** Required for the file backend once committed; absent for legacy rows. */
  readonly sha256?: string;
  readonly preservation: "complete" | "partial";
  readonly sourceCompleteness: SourceCompleteness;
  readonly incompleteReason?: string;
}

/**
 * Bounded, immutable description of one tool outcome.
 *
 * This is the ONLY tool-result representation that is persisted into message
 * content, model projections, and renderer events for an externalized result.
 * It never contains the bulk output.
 */
export interface ToolResultReceipt {
  readonly schemaVersion: 1;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly operationStatus: ToolOperationStatus;
  readonly success: boolean;
  readonly executionTimeMs: number;
  readonly summary?: string;
  /**
   * Validated, bounded control fields (permission state, job ids, exit code,
   * batch ids, totals, cursors, ...). NOT an unchecked copy of the result.
   */
  readonly control: Readonly<Record<string, unknown>>;
  readonly outputs: readonly StoredToolOutputRef[];
  readonly preview: string;
  readonly previewComplete: boolean;
  readonly storageErrorCode?: string;
}

/** Effective per-result policy for one preparation decision. */
export interface ToolResultOutputPolicy {
  readonly maxInlineBytes: number;
  readonly maxInlineTokens: number;
  readonly previewKind: ToolResultPreviewKind;
  readonly delivery: ToolResultDelivery;
}

/**
 * Bounded machine failure codes (technical design §12).
 *
 * Every one of these is surfaced to the UI as a translated message; the raw
 * code is what crosses the boundary. `OUTPUT_NOT_AVAILABLE` deliberately
 * covers both "missing" and "unauthorized" so existence is never leaked.
 */
export type ToolResultErrorCode =
  | "OUTPUT_SERIALIZATION_FAILED"
  | "ARTIFACT_LIMIT_REACHED"
  | "OUTPUT_QUOTA_EXCEEDED"
  | "OUTPUT_DISK_FULL"
  | "OUTPUT_WRITE_FAILED"
  | "OUTPUT_PUBLICATION_FAILED"
  | "OUTPUT_NOT_AVAILABLE"
  | "OUTPUT_CHANGED"
  | "OUTPUT_INTEGRITY_FAILED"
  | "OUTPUT_FORMAT_UNSUPPORTED"
  | "INVALID_OUTPUT_CURSOR"
  | "MODEL_BUDGET_UNAVAILABLE"
  | "RETRIEVAL_BUDGET_EXHAUSTED"
  | "CONTEXT_REQUIRED_CONTENT_TOO_LARGE"
  | "REQUEST_BODY_TOO_LARGE"
  | "RETRIEVAL_UNSUPPORTED_BY_HOST";

/** Mode carried by a retrieval cursor. A search cursor is not a read cursor. */
export type ToolResultCursorMode = "read" | "search";

/** Internal cursor fields, authenticated by ToolResultCursorCodec. */
export interface ToolResultCursorPayload {
  readonly v: 1;
  readonly outputId: string;
  readonly revision: number;
  readonly mode: ToolResultCursorMode;
  /** Next unexamined byte offset. */
  readonly position: number;
  /** Digest of the literal search query; absent for read cursors. */
  readonly queryDigest?: string;
  /** End of the last committed match, used to suppress boundary duplicates. */
  readonly lastMatchEnd?: number;
  readonly policyVersion: string;
}

/** One page of a bounded read. */
export interface ToolResultReadPage {
  readonly outputId: string;
  readonly text: string;
  readonly startByte: number;
  readonly endByte: number;
  readonly totalBytes: number;
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

/** One match inside a bounded search response. */
export interface ToolResultSearchMatch {
  readonly startByte: number;
  readonly endByte: number;
  readonly excerpt: string;
  readonly readCursor: string;
}

/** A bounded search response. */
export interface ToolResultSearchPage {
  readonly outputId: string;
  readonly matches: readonly ToolResultSearchMatch[];
  /**
   * True only when EVERY byte of the captured representation was examined.
   * It never means the producer's own output was complete (AC-15).
   */
  readonly scanComplete: boolean;
  readonly nextCursor: string | null;
  readonly sourceCompleteness: SourceCompleteness;
}

/** Public descriptor returned by the get/read/search IPC surface. */
export interface ToolOutputPublicDescriptor {
  readonly outputId: string;
  readonly toolName: string;
  readonly format: ToolOutputFormat;
  readonly mediaType: string;
  readonly capturedBytes: number;
  readonly originalBytes?: number;
  readonly preservation: "complete" | "partial";
  readonly sourceCompleteness: SourceCompleteness;
  readonly incompleteReason?: string;
  readonly state: ToolOutputState;
  readonly recordCount?: number;
}

/** Result of decoding an opaque retrieval cursor. */
export type ToolResultCursorDecodeResult =
  | { ok: true; payload: ToolResultCursorPayload }
  | { ok: false; code: "INVALID_OUTPUT_CURSOR" };


/**
 * Output of the single shared preparation boundary.
 *
 * `canonicalMessageContent` is persisted once as the message content.
 * `modelContent` is the budget-adjusted projection for one provider request.
 * `uiMetadata` holds bounded display/control fields with no bulk source data.
 */
export interface PreparedToolResult {
  readonly receipt?: ToolResultReceipt;
  readonly canonicalMessageContent: string;
  readonly modelContent: string;
  readonly uiMetadata: Readonly<Record<string, unknown>>;
  readonly serializedBytes: number;
  readonly accountedTokens: number;
}
