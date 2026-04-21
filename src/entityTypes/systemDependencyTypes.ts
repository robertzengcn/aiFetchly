/**
 * Type definitions for the System Dependency Installation feature.
 *
 * Covers the full lifecycle: diagnosis → advisory resolution →
 * user-approved installation → retry → audit logging.
 */

// ---------------------------------------------------------------------------
// Platform identifiers
// ---------------------------------------------------------------------------

/** Supported OS platforms matching Node.js `process.platform`. */
export type DependencyPlatform = "darwin" | "linux" | "win32";

// ---------------------------------------------------------------------------
// Dependency Catalog (loaded from JSON config)
// ---------------------------------------------------------------------------

/** Per-platform install candidate from the dependency catalog. */
export interface PlatformCandidate {
  /** Package manager command (e.g. "brew", "apt", "winget"). */
  readonly manager: string;
  /** Package name for that manager (e.g. "poppler", "poppler-utils"). */
  readonly package: string;
}

/** A single entry in the dependency catalog. */
export interface DependencyCatalogEntry {
  /** Normalized identifier (e.g. "poppler"). */
  readonly dependency_id: string;
  /** Binary to probe on PATH (e.g. "pdfinfo"). */
  readonly probe: string;
  /** Human-readable description. */
  readonly description: string;
  /** Per-platform install information. */
  readonly platforms: Partial<Record<DependencyPlatform, PlatformCandidate>>;
}

/** Top-level catalog structure loaded from JSON. */
export interface DependencyCatalog {
  /** Schema version for forward compatibility. */
  readonly version: number;
  /** Dependency entries keyed by normalized dependency_id. */
  readonly dependencies: Record<string, Omit<DependencyCatalogEntry, "dependency_id">>;
}

// ---------------------------------------------------------------------------
// Install result status
// ---------------------------------------------------------------------------

/**
 * Typed outcome of an install attempt.
 *
 * - `installed`            — Binary now available after install.
 * - `already_installed`    — Binary was already on PATH.
 * - `permission_denied`    — User denied the install.
 * - `installer_not_found`  — Package manager not available.
 * - `unsupported_platform` — No candidate for current OS.
 * - `path_issue`           — Install succeeded but binary not in PATH.
 * - `installation_failed`  — Package manager returned an error.
 */
export type InstallResultStatus =
  | "installed"
  | "already_installed"
  | "permission_denied"
  | "installer_not_found"
  | "unsupported_platform"
  | "path_issue"
  | "installation_failed";

// ---------------------------------------------------------------------------
// Resolver (advisory — no side effects)
// ---------------------------------------------------------------------------

/** Input to the advisory resolver. */
export interface ResolveSystemDependencyInput {
  /** Raw stderr from the failed skill execution. */
  readonly stderr: string;
  /** Skill manifest containing system dependency declarations. */
  readonly manifest?: import("@/entityTypes/skillTypes").SkillManifest;
  /** Current platform. */
  readonly platform: NodeJS.Platform;
}

/** Output from the advisory resolver. */
export interface ResolveSystemDependencyOutput {
  /** Whether a dependency could be identified. */
  readonly resolved: boolean;
  /** Normalized dependency ID matching a catalog entry. */
  readonly dependency_id?: string;
  /** The binary that was not found. */
  readonly missing_binary?: string;
  /** Confidence score 0–1. */
  readonly confidence: number;
  /** Human-readable reason for the match. */
  readonly reason: string;
  /** Per-platform install candidates from the catalog. */
  readonly platform_candidates?: Record<string, PlatformCandidate>;
  /** True if confidence is below the auto-suggest threshold (0.8). */
  readonly requires_manual_review: boolean;
}

// ---------------------------------------------------------------------------
// Install request / response (IPC boundary)
// ---------------------------------------------------------------------------

/** User-approved request to install a dependency. */
export interface InstallSystemDependencyRequest {
  /** Dependency ID from resolver output. */
  readonly dependency_id: string;
  /** Why the install is needed. */
  readonly reason: string;
  /** Conversation context for audit. */
  readonly conversation_id: string;
  /** Skill that triggered the need. */
  readonly skill_name: string;
}

/** Detailed install result data returned via IPC. */
export interface InstallResultData {
  /** Typed install outcome. */
  readonly install_status: InstallResultStatus;
  /** Dependency that was processed. */
  readonly dependency_id: string;
  /** Binary that was probed after install. */
  readonly probe?: string;
  /** Human-readable details. */
  readonly details?: string;
  /** Whether the skill should be retried. */
  readonly should_retry: boolean;
}

/** IPC response envelope for install. */
export interface InstallSystemDependencyResponse {
  /** Whether the IPC call succeeded. */
  readonly status: boolean;
  /** Human-readable message. */
  readonly msg: string;
  /** Install result details. */
  readonly data: InstallResultData | null;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/** User decision on an install prompt. */
export type AuditUserDecision = "approved" | "denied";

/** Request to query audit log entries. */
export interface GetAuditLogRequest {
  /** Filter by conversation ID. */
  readonly conversation_id?: string;
  /** Filter by dependency ID. */
  readonly dependency_id?: string;
  /** Pagination limit. */
  readonly limit?: number;
  /** Pagination offset. */
  readonly offset?: number;
}

/** A single audit log entry returned to the renderer. */
export interface AuditLogEntry {
  readonly id: number;
  readonly conversation_id: string;
  readonly skill_name: string;
  readonly dependency_id: string;
  readonly missing_binary: string;
  readonly suggested_by_ai: boolean;
  readonly user_decision: AuditUserDecision;
  readonly installer_backend: string | null;
  readonly package_name: string | null;
  readonly execution_status: InstallResultStatus | null;
  readonly execution_duration_ms: number | null;
  readonly stderr_sanitized: string | null;
  readonly created_at: string;
}

/** IPC response envelope for audit log queries. */
export interface GetAuditLogResponse {
  readonly status: boolean;
  readonly data: readonly AuditLogEntry[];
  readonly total: number;
}
