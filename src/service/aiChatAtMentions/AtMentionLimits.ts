/**
 * Shared constants and limits for AI Chat V2 @-mention context.
 *
 * Ignore patterns are for suggestion/search ergonomics only.
 * FilePathGuard remains the security gate for path validation.
 */

import {
  FILE_TOOL_SIZE_LIMITS,
  DEFAULT_IGNORE_PATTERNS,
} from "@/config/fileToolConfig";
import type { ChatV2AtMentionStatus } from "@/entityTypes/aiChatAtMentionTypes";

/**
 * Mention statuses that surface as compact warnings (to the model context
 * block and the UI). Canonical single source — services and the context
 * builder must agree on this set, so it lives here rather than being copied.
 */
export const MENTION_WARNING_STATUSES: ReadonlySet<ChatV2AtMentionStatus> =
  new Set<ChatV2AtMentionStatus>([
    "workspace_required",
    "missing",
    "rejected",
    "invalid_line_range",
    "too_large",
    "binary",
    "read_error",
    "too_many_mentions",
  ]);

/** Maximum suggestion rows returned to the renderer. */
export const AT_MENTION_MAX_SUGGESTIONS = 50;

/** Maximum query length accepted by the suggestion IPC. */
export const AT_MENTION_MAX_QUERY_CHARS = 256;

/** Maximum distinct mentions resolved per message. */
export const AT_MENTION_MAX_MENTIONS_PER_MESSAGE = 10;

/** Maximum lines injected for an explicit `#L` line range. */
export const AT_MENTION_MAX_LINE_RANGE_LINES = 200;

/** Maximum bytes injected for a single mention's content. */
export const AT_MENTION_MAX_CONTENT_BYTES_PER_MENTION = Math.min(
  FILE_TOOL_SIZE_LIMITS.maxReadBytes,
  32 * 1024
);

/** Maximum total injected mention content bytes per message. */
export const AT_MENTION_MAX_TOTAL_CONTEXT_BYTES = 64 * 1024;

/** Maximum shallow directory entries included in the model context. */
export const AT_MENTION_MAX_DIRECTORY_ENTRIES = 30;

/** Glob ignore patterns applied to mention suggestion search. */
export const AT_MENTION_IGNORE_PATTERNS: readonly string[] = [
  ...DEFAULT_IGNORE_PATTERNS,
  ".git/**",
  ".env",
  ".env.*",
  "**/.DS_Store",
];
