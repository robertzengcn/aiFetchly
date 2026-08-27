/**
 * Portable workspace memory shared type contracts.
 *
 * Pure data contracts for the portable-memory stack (design §6 of
 * docs/prd/portable-workspace-memory-technical-design.md). This module is the
 * single source of truth shared by the worker scanner (via type-only imports),
 * the main-process format/validator services, the sync coordinator, IPC
 * schemas, and the renderer. It must stay dependency-free: only type imports
 * and locally defined constants — no Electron, TypeORM, Vue, or service
 * runtime imports — so it can be imported from any process context.
 */

import type {
  AIWorkspaceMemoryStatus,
  AIWorkspaceMemoryType,
  AIWorkspaceMemoryView,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import type { AIFetchlyConfigDiagnostic } from "@/entityTypes/aifetchlyConfigTypes";

// ---------------------------------------------------------------------------
// File-format contracts (PRD §9)
// ---------------------------------------------------------------------------

export type PortableMemorySchema = "aifetchly.memory/v1";

export type PortableMemoryVisibility = "local" | "team";

export type PortableMemoryCreatedBy =
  | "user"
  | "aifetchly"
  | "external-agent"
  | "import";

export const PORTABLE_MEMORY_SCHEMA: readonly PortableMemorySchema[] = [
  "aifetchly.memory/v1",
] as const;

export const PORTABLE_MEMORY_VISIBILITIES: readonly PortableMemoryVisibility[] =
  ["local", "team"] as const;

export const PORTABLE_MEMORY_CREATED_BY_VALUES: readonly PortableMemoryCreatedBy[] =
  ["user", "aifetchly", "external-agent", "import"] as const;

export function isPortableMemoryVisibility(
  v: unknown
): v is PortableMemoryVisibility {
  return (
    typeof v === "string" &&
    (PORTABLE_MEMORY_VISIBILITIES as readonly string[]).includes(v)
  );
}

export function isPortableMemoryCreatedBy(
  v: unknown
): v is PortableMemoryCreatedBy {
  return (
    typeof v === "string" &&
    (PORTABLE_MEMORY_CREATED_BY_VALUES as readonly string[]).includes(v)
  );
}

/** v1 record id: `wmem-` + UUID (any RFC-4122 variant nibble). */
export const PORTABLE_MEMORY_ID_PATTERN =
  /^wmem-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Portable workspace identity: `ws-` + UUID. */
export const PORTABLE_WORKSPACE_ID_PATTERN =
  /^ws-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPortableMemoryId(v: unknown): v is string {
  return typeof v === "string" && PORTABLE_MEMORY_ID_PATTERN.test(v);
}

export function isPortableWorkspaceId(v: unknown): v is string {
  return typeof v === "string" && PORTABLE_WORKSPACE_ID_PATTERN.test(v);
}

/** Resource limits (PRD §15.5 recommended v1 limits). */
export const PORTABLE_MEMORY_LIMITS = {
  /** Max record file size in bytes. */
  maxFileBytes: 16 * 1024,
  /** Max memory body length in characters. */
  maxContentChars: 8000,
  /** Max title length in characters. */
  maxTitleChars: 200,
  /** Max portable records per workspace. */
  maxRecordsPerWorkspace: 1000,
  /** Max files parsed concurrently by the worker. */
  workerConcurrency: 8,
  /** Max tags per record. */
  maxTagsPerRecord: 20,
  /** Max superseded ids per record. */
  maxSupersedesPerRecord: 20,
  /** Max generated INDEX.md size in bytes. */
  maxIndexBytes: 512 * 1024,
  /** Max total record bytes a single scan will read. */
  maxTotalScanBytes: 16 * 1024 * 1024,
  /** Max reviewedBy length. */
  maxReviewedByChars: 100,
  /** Max memoryId / id length. */
  maxIdChars: 100,
} as const;

/** Fully validated portable document produced by the format parser. */
export interface PortableMemoryFrontmatterV1 {
  readonly schema: PortableMemorySchema;
  readonly id: string;
  readonly type: AIWorkspaceMemoryType;
  readonly status: AIWorkspaceMemoryStatus;
  readonly confidence: number;
  readonly visibility: PortableMemoryVisibility;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: PortableMemoryCreatedBy;
  readonly supersedes?: readonly string[];
  readonly tags?: readonly string[];
  readonly reviewedAt?: string;
  readonly reviewedBy?: string;
}

export interface PortableMemoryDocumentV1 {
  readonly frontmatter: PortableMemoryFrontmatterV1;
  readonly title: string;
  readonly content: string;
  readonly relativePath: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
}

// ---------------------------------------------------------------------------
// Workspace identity contracts (PRD §8.1)
// ---------------------------------------------------------------------------

export interface PortableWorkspaceIdentityV1 {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly name: string;
  readonly createdAt: string;
}

/** Worker-produced bounded draft of `.aifetchly/workspace.json`. */
export interface PortableWorkspaceIdentityDraft {
  readonly relativePath: ".aifetchly/workspace.json";
  readonly raw: unknown;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
}

// ---------------------------------------------------------------------------
// Worker scan contracts (design §6.3 / §12)
// ---------------------------------------------------------------------------

/**
 * Bounded worker draft of one memory record file. The worker performs NO
 * semantic validation — frontmatter is parsed syntactically only and shipped
 * as `unknown`; the main process owns schema validation and trust.
 */
export interface PortableMemoryFileDraft {
  readonly relativePath: string;
  readonly fileName: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly rawFrontmatter: unknown;
  readonly markdownBody: string;
  readonly syntaxError?: string;
  readonly isSymbolicLink: boolean;
}

export interface PortableMemoryScanSnapshot {
  readonly schemaVersion: 1;
  readonly directoryPresent: boolean;
  /**
   * True when directory enumeration and every required lstat/bounded read
   * completed. A syntactically invalid record still allows `complete: true`;
   * an I/O failure that hides directory contents forces `complete: false`.
   */
  readonly complete: boolean;
  readonly identity?: PortableWorkspaceIdentityDraft;
  readonly records: readonly PortableMemoryFileDraft[];
  /** Every observed relative path under memory/, including rejected ones. */
  readonly seenRelativePaths: readonly string[];
  readonly readmeHash?: string;
  readonly indexHash?: string;
  readonly totalBytes: number;
  readonly diagnostics: readonly AIFetchlyConfigDiagnostic[];
}

// ---------------------------------------------------------------------------
// Local view contracts (design §6.4)
// ---------------------------------------------------------------------------

export type PortableMemoryStorageMode =
  | "private"
  | "portable-local"
  | "portable-team";

export type PortableMemorySyncState =
  | "private"
  | "synced"
  | "pending-review"
  | "rejected"
  | "conflicted"
  | "missing"
  | "detached";

export type PortableMemoryImportPolicy =
  | "automatic"
  | "review-new"
  | "review-all";

export type PortableMemoryDefaultStorageMode =
  | "private-only"
  | "portable-local"
  | "portable-team"
  | "ask-each-time";

/** New workspaces enable portable file storage unless the user disables it. */
export const PORTABLE_MEMORY_DEFAULT_ENABLED = true;

/** New memories write `.aifetchly/memory` files that stay local (not git/team). */
export const PORTABLE_MEMORY_DEFAULT_STORAGE_MODE: PortableMemoryDefaultStorageMode =
  "portable-local";

export const PORTABLE_MEMORY_SYNC_STATES: readonly PortableMemorySyncState[] = [
  "private",
  "synced",
  "pending-review",
  "rejected",
  "conflicted",
  "missing",
  "detached",
] as const;

export const PORTABLE_MEMORY_IMPORT_POLICIES: readonly PortableMemoryImportPolicy[] =
  ["automatic", "review-new", "review-all"] as const;

export function isPortableMemoryImportPolicy(
  v: unknown
): v is PortableMemoryImportPolicy {
  return (
    typeof v === "string" &&
    (PORTABLE_MEMORY_IMPORT_POLICIES as readonly string[]).includes(v)
  );
}

export function isPortableMemoryDefaultStorageMode(
  v: unknown
): v is PortableMemoryDefaultStorageMode {
  return (
    typeof v === "string" &&
    [
      "private-only",
      "portable-local",
      "portable-team",
      "ask-each-time",
    ].includes(v)
  );
}

/** Memory row view enriched with portable storage/sync information. */
export interface PortableWorkspaceMemoryView extends AIWorkspaceMemoryView {
  readonly scopeId: string;
  readonly portableWorkspaceId?: string;
  readonly storageMode: PortableMemoryStorageMode;
  readonly visibility?: PortableMemoryVisibility;
  readonly syncState: PortableMemorySyncState;
  readonly relativePath?: string;
  readonly portableUpdatedAt?: string;
  readonly diagnostic?: PortableMemoryDiagnosticView;
}

/**
 * Per-row memory view for the portable-aware list (FR-061): a compact row
 * carrying the portable storage/sync badges the UI renders per memory.
 */
export interface PortableMemoryRowView {
  readonly memoryId: string;
  readonly type: AIWorkspaceMemoryType;
  readonly title: string;
  readonly content: string;
  readonly status: AIWorkspaceMemoryStatus;
  readonly confidence: number;
  readonly updatedAt: string;
  readonly storageMode: PortableMemoryStorageMode;
  readonly syncState?: PortableMemorySyncState;
  readonly relativePath?: string;
  readonly visibility?: PortableMemoryVisibility;
  readonly portableUpdatedAt?: string;
  readonly diagnostic?: PortableMemoryDiagnosticView;
}

/**
 * A pending external record awaiting user review (FR-042/FR-063). The UI
 * groups these by kind (new / edit / deletion) and shows a bounded preview.
 */
export interface PortableMemoryReviewEntry {
  readonly memoryId: string;
  readonly relativePath: string;
  readonly syncState: string;
  readonly message: string;
  readonly title?: string;
  /** Bounded preview of the file content (first 500 chars), if readable. */
  readonly preview?: string;
  readonly parseable: boolean;
}

// ---------------------------------------------------------------------------
// Diagnostics (design §6.5)
// ---------------------------------------------------------------------------

export type PortableMemoryDiagnosticCode =
  | "memory-file-too-large"
  | "memory-count-cap"
  | "memory-frontmatter-invalid"
  | "memory-schema-unsupported"
  | "memory-id-invalid"
  | "memory-id-path-mismatch"
  | "memory-id-duplicate"
  | "memory-field-invalid"
  | "memory-content-invalid"
  | "memory-secret-rejected"
  | "memory-symlink-rejected"
  | "memory-scan-incomplete"
  | "memory-conflict"
  | "workspace-identity-invalid"
  | "workspace-identity-collision"
  | "memory-index-write-failed";

export interface PortableMemoryDiagnosticView {
  readonly code: PortableMemoryDiagnosticCode;
  readonly relativePath: string;
  readonly message: string;
  readonly recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Sync audit + status contracts
// ---------------------------------------------------------------------------

export type PortableMemoryAuditAction =
  | "scan"
  | "import"
  | "export"
  | "create"
  | "update"
  | "archive"
  | "delete"
  | "reject"
  | "conflict"
  | "resolve"
  | "promote"
  | "privatize"
  | "enable"
  | "disable"
  | "identity-regenerate";

export type PortableMemoryAuditActor =
  | "user"
  | "aifetchly"
  | "external"
  | "import"
  | "system";

export type PortableMemoryAuditOutcome =
  | "completed"
  | "skipped"
  | "rejected"
  | "conflicted"
  | "failed";

export interface PortableMemoryAuditView {
  readonly eventId: string;
  readonly scopeId: string;
  readonly memoryId?: string;
  readonly relativePath?: string;
  readonly action: PortableMemoryAuditAction;
  readonly actor: PortableMemoryAuditActor;
  readonly outcome: PortableMemoryAuditOutcome;
  readonly diagnosticCode?: string;
  readonly message?: string;
  readonly createdAt: string;
}

/** Summary emitted to the renderer after each reconciliation. */
export interface PortableMemorySyncSummary {
  readonly scopeId: string;
  readonly scanId?: string;
  readonly complete: boolean;
  readonly imported: number;
  readonly unchanged: number;
  readonly rejected: number;
  readonly conflicted: number;
  readonly pendingReview: number;
  readonly deleted: number;
  readonly diagnostics: readonly PortableMemoryDiagnosticView[];
}

export interface PortableWorkspaceStatusView {
  readonly enabled: boolean;
  readonly portableWorkspaceId?: string;
  readonly defaultStorageMode: PortableMemoryDefaultStorageMode;
  readonly importPolicy: PortableMemoryImportPolicy;
  readonly syncState: "idle" | "scanning" | "error";
  readonly lastCompleteScanAt?: string;
  readonly privateCount: number;
  readonly portableCount: number;
  readonly rejectedCount: number;
  readonly conflictCount: number;
  readonly pendingReviewCount: number;
  readonly gitTrackingState: PortableMemoryGitTrackingState;
}

export type PortableMemoryGitTrackingState =
  | "not-a-repository"
  | "ignored"
  | "untracked"
  | "partially-tracked"
  | "tracked"
  | "unknown";

/** Typed operation outcome (design §22.2). */
export type PortableMemoryOperationStatus =
  | "completed"
  | "completed-index-pending"
  | "completed-projection-pending"
  | "conflict"
  | "rejected"
  | "workspace-required"
  | "workspace-untrusted"
  | "identity-invalid"
  | "write-failed"
  | "database-failed";

/** Trusted scope context handed to Modules/Services (design §10.2). */
export interface WorkspaceMemoryScopeContext {
  readonly scopeId: string;
  readonly workspaceKey: string;
  readonly workspaceRoot: string;
  readonly displayName: string;
  readonly portableWorkspaceId?: string;
  readonly portableEnabled: boolean;
  readonly defaultStorageMode: PortableMemoryDefaultStorageMode;
  readonly importPolicy: PortableMemoryImportPolicy;
}
