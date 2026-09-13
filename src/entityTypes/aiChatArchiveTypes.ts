/**
 * Type definitions for the recoverable-history archive. These mirror the
 * contracts in technical-design §4 and §6. Internal-only; references returned
 * to the model/UI are opaque source IDs resolved by the backend.
 */
export interface HistorySourceRef {
  readonly epoch: string;
  readonly revision: number;
  readonly rowId: number;
  readonly messageId: string;
  readonly timestampMs: number;
  readonly field: "content" | "tool_receipt";
  readonly startCodePoint: number;
  readonly endCodePoint: number;
}

export interface HistoryOrderKey {
  readonly timestampMs: number;
  readonly rowId: number;
}

export interface HistoryExcerpt {
  readonly sourceId: string;
  readonly messageId: string;
  readonly role: string;
  readonly timestamp: string;
  readonly text: string;
  readonly exact: boolean;
  readonly redacted: boolean;
  readonly hasMore: boolean;
}

export interface ArchiveReadPage {
  readonly records: readonly HistoryExcerpt[];
  readonly nextCursor: string | null;
  readonly truncated: boolean;
  readonly sourceRevision: number;
}

export interface ArchivePageRequest {
  readonly conversationId: string;
  readonly cursor?: string;
  readonly maxRows: number;
  readonly maxCodePoints: number;
}

export interface CompactionClaim {
  readonly runId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly fence: number;
}

export type ArchiveTurnStatus =
  | "open"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";

export type CompactionRunState =
  | "queued"
  | "running"
  | "paused"
  | "cancelled"
  | "failed"
  | "completed";

export type CompactionSectionStatus = "staged" | "published" | "invalidated";

export type ContextGenerationStatus =
  | "active"
  | "superseded"
  | "invalidated";

export type ArchiveIndexState = "absent" | "indexing" | "complete" | "stale";

/** Opaque source ID encoding (versioned, not an authorization credential). */
export interface OpaqueSourceIdPayload {
  readonly v: 1;
  readonly epoch: string;
  readonly revision: number;
  readonly rowId: number;
  readonly field: "content" | "tool_receipt";
  readonly startCodePoint: number;
  readonly endCodePoint: number;
}

export interface SummaryFact {
  readonly text: string;
  readonly status: "proposed" | "accepted" | "superseded" | "uncertain";
  readonly sourceIds: readonly string[];
}

export interface SectionSummaryV1 {
  readonly version: 1;
  readonly synopsis: string;
  readonly decisions: readonly SummaryFact[];
  readonly constraints: readonly SummaryFact[];
  readonly pending: readonly SummaryFact[];
  readonly toolOutcomes: readonly SummaryFact[];
  readonly topics: readonly string[];
}

/** Error codes (technical-design §16). */
export type RecoverableHistoryErrorCode =
  | "HISTORY_NO_MATCH"
  | "HISTORY_PARTIAL_SCAN"
  | "SOURCE_CHANGED"
  | "SOURCE_UNAVAILABLE"
  | "HISTORY_SCOPE_INVALID"
  | "COMPACTION_BUSY"
  | "COMPACTION_OUTPUT_INVALID"
  | "COMPACTION_CONTEXT_REJECTED"
  | "COMPACTION_STALE_CLAIM"
  | "COMPACTION_STORAGE_FAILED"
  | "CONTEXT_REQUIRED_CONTENT_TOO_LARGE"
  | "MODEL_BUDGET_UNAVAILABLE";

export class RecoverableHistoryError extends Error {
  readonly code: RecoverableHistoryErrorCode;
  constructor(code: RecoverableHistoryErrorCode, message: string) {
    super(message);
    this.name = "RecoverableHistoryError";
    this.code = code;
  }
}
