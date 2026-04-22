/**
 * Type definitions for AI File Tools.
 *
 * Covers parameter schemas, result shapes, path validation,
 * and configuration structures for file_read, file_write,
 * file_edit, glob_files, and grep_files.
 */

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

export interface PathValidationResult {
  readonly safe: boolean;
  readonly resolvedPath: string;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

export interface FileReadParams {
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly encoding?: string;
}

export interface FileWriteParams {
  readonly path: string;
  readonly content: string;
  readonly mode?: "create" | "overwrite";
}

export interface FileEditParams {
  readonly path: string;
  readonly old_string: string;
  readonly new_string: string;
  readonly replace_all?: boolean;
}

export interface GlobFilesParams {
  readonly pattern: string;
  readonly cwd?: string;
  readonly ignore?: readonly string[];
  readonly head_limit?: number;
}

export interface GrepFilesParams {
  readonly pattern: string;
  readonly path?: string;
  readonly glob?: string;
  readonly output_mode?: "content" | "files_with_matches" | "count";
  readonly context_before?: number;
  readonly context_after?: number;
  readonly case_insensitive?: boolean;
  readonly head_limit?: number;
}

// ---------------------------------------------------------------------------
// Shared result envelope
// ---------------------------------------------------------------------------

export interface FileToolResult {
  readonly success: boolean;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Tool-specific result schemas
// ---------------------------------------------------------------------------

export interface FileReadResult extends FileToolResult {
  readonly path: string;
  readonly content?: string;
  readonly isBinary?: boolean;
  readonly binaryMetadata?: {
    readonly size: number;
    readonly mimeType?: string;
  };
  readonly truncated: boolean;
  readonly totalLines?: number;
  readonly linesShown?: number;
}

export interface FileWriteResult extends FileToolResult {
  readonly path: string;
  readonly bytesWritten: number;
  readonly mode: "created" | "overwritten";
}

export interface FileEditResult extends FileToolResult {
  readonly path: string;
  readonly replacements: number;
  readonly diff?: string;
}

export interface GlobFilesResult extends FileToolResult {
  readonly matches: readonly string[];
  readonly total: number;
  readonly truncated: boolean;
}

export interface GrepContentMatch {
  readonly file: string;
  readonly line: number;
  readonly content: string;
  readonly contextBefore?: readonly string[];
  readonly contextAfter?: readonly string[];
}

export interface GrepCountEntry {
  readonly file: string;
  readonly count: number;
}

export interface GrepFilesResult extends FileToolResult {
  readonly outputMode: "content" | "files_with_matches" | "count";
  readonly matches:
    | readonly GrepContentMatch[]
    | readonly string[]
    | readonly GrepCountEntry[];
  readonly total: number;
  readonly truncated: boolean;
}

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

export interface DenyListConfig {
  readonly patterns: readonly string[];
  readonly description: string;
}

export interface FileToolSizeLimits {
  readonly maxReadBytes: number;
  readonly maxGrepOutputBytes: number;
  readonly defaultHeadLimit: number;
}

export interface FileToolRateLimitConfig {
  readonly maxPerMinute: number;
  readonly maxConcurrent: number;
  readonly cooldownMs: number;
}
