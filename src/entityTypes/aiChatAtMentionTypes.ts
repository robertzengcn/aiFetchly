/**
 * Pure TypeScript types for AI Chat V2 @-mention context.
 *
 * This file is shared between the main process, the renderer, and tests.
 * It MUST NOT import Electron, Vue, TypeORM, `fs`, `path`, `os`, or any
 * service — it is a pure type contract only.
 *
 * Source: docs/prd/ai-chat-at-mention-context-technical-design.md §4-5.
 */

/** Whether a mentioned path resolved to a file or a directory. */
export type ChatV2AtMentionKind = "file" | "directory";

/**
 * Resolution status for a single mention.
 *
 * - `resolved`            : path exists and was read/listed successfully
 * - `workspace_required`  : no approved workspace for the conversation
 * - `missing`             : path does not exist under the workspace
 * - `rejected`            : path failed FilePathGuard (escape/deny/malformed)
 * - `invalid_line_range`  : `#L` fragment malformed (e.g. start > end)
 * - `too_large`           : file exceeds the injection byte/line budget
 * - `binary`              : file is binary; content not injected
 * - `too_many_mentions`   : per-message mention cap exceeded
 * - `read_error`          : unexpected read/stat failure
 */
export type ChatV2AtMentionStatus =
  | "resolved"
  | "workspace_required"
  | "missing"
  | "rejected"
  | "invalid_line_range"
  | "too_large"
  | "binary"
  | "too_many_mentions"
  | "read_error";

/** Options for the pure mention parser. */
export interface AtMentionParserOptions {
  readonly maxMentions?: number;
}

/** A single mention extracted from raw message text. No filesystem work. */
export interface ChatV2AtMentionParsed {
  /** Full original text including the leading `@` (and quotes if quoted). */
  readonly rawText: string;
  /** Path text only — no `@`, no surrounding quotes, no `#L` line fragment. */
  readonly pathText: string;
  /** True when the mention was written as a quoted mention `@"..."`. */
  readonly quoted: boolean;
  /** Inclusive start offset of `rawText` within the source message. */
  readonly startIndex: number;
  /** Exclusive end offset of `rawText` within the source message. */
  readonly endIndex: number;
  /** Parsed `#L<start>` line number, when present. */
  readonly lineStart?: number;
  /** Parsed `#L<start>-<end>` end line, when present. */
  readonly lineEnd?: number;
  /** Set when the `#L` fragment is syntactically invalid. */
  readonly parseError?: "invalid_line_range";
}

export interface ChatV2AtMentionParseResult {
  readonly mentions: readonly ChatV2AtMentionParsed[];
  /** True when the per-message mention cap was reached. */
  readonly truncated: boolean;
}

/** Renderer request for @-mention autocomplete suggestions. */
export interface ChatV2AtMentionSuggestionRequest {
  readonly conversationId?: string;
  readonly query: string;
  readonly limit?: number;
}

/**
 * Renderer-safe suggestion view.
 *
 * Contains no file content, no stack traces, no raw `fs.Stats`, and no
 * absolute paths.
 */
export interface ChatV2AtMentionSuggestionView {
  readonly id: string;
  readonly displayText: string;
  /** Valid mention syntax to insert into the composer (quotes paths w/ spaces). */
  readonly insertText: string;
  /** Path relative to the workspace root. */
  readonly relativePath: string;
  readonly kind: ChatV2AtMentionKind;
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
}

export interface ChatV2AtMentionSuggestionResponse {
  readonly suggestions: readonly ChatV2AtMentionSuggestionView[];
  /** True when there is no approved workspace (renderer shows a prompt). */
  readonly workspaceRequired: boolean;
  readonly truncated: boolean;
}

/** Persisted per-mention metadata. Never stores file content. */
export interface ChatV2AtMentionMetadata {
  readonly rawText: string;
  readonly relativePath: string;
  readonly kind?: ChatV2AtMentionKind;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly status: ChatV2AtMentionStatus;
  readonly sizeBytes?: number;
  readonly truncated?: boolean;
  /** FilePathGuard code or short machine-readable reason (never a stack trace). */
  readonly errorCode?: string;
  /** Optional user-facing message key suffix or English fallback. */
  readonly message?: string;
}

/** Internal resolution of one mention. `absolutePath` never leaves the main process. */
export interface ChatV2AtMentionResolution {
  readonly parsed: ChatV2AtMentionParsed;
  readonly metadata: ChatV2AtMentionMetadata;
  /** Absolute resolved path — main-process internal only. */
  readonly absolutePath?: string;
  readonly relativePath?: string;
  /** Bounded file content to inject into the model context, when allowed. */
  readonly contentForModel?: string;
  /** Shallow directory entries to inject, for directory mentions. */
  readonly directoryEntriesForModel?: readonly string[];
}

export interface ChatV2AtMentionResolutionResult {
  /** Original user-visible message text (preserved for display/persistence). */
  readonly originalMessage: string;
  /** Message text enriched with the model-facing mention context block. */
  readonly modelMessage: string;
  readonly metadata: readonly ChatV2AtMentionMetadata[];
  /** Non-resolved mentions surfaced as compact warnings. */
  readonly warnings: readonly ChatV2AtMentionMetadata[];
  readonly hasResolvedMentions: boolean;
}

export interface ChatV2AtMentionContextBuildResult {
  readonly modelMessage: string;
  readonly contextBlock: string;
  readonly truncated: boolean;
}
