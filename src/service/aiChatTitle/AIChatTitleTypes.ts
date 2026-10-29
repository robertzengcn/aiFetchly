/**
 * Pure type contracts for the AI chat automatic-titles feature
 * (docs/prd/ai-chat-automatic-titles-technical-design.md §4, §10.2).
 *
 * This module is intentionally free of Node/Electron imports so it is safe to
 * reference from any layer (entity, model, module, service, renderer).
 */

/** Provenance of a conversation's visible title. */
export type ChatTitleSource =
  | "placeholder"
  | "excerpt"
  | "ai"
  | "user"
  | "legacy";

/** Lifecycle of automatic title generation within one epoch. */
export type ChatTitleGenerationStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "suppressed";

/**
 * Bounded internal outcome codes for diagnostics. These never contain
 * conversation content (PRD §8 privacy: metadata only).
 */
export type ChatTitleFailureCode =
  | "timeout"
  | "invalid_output"
  | "interrupted"
  | "provider_changed"
  | "feature_disabled"
  | "queue_full"
  | "provider_unavailable"
  | "missing_model"
  | "not_ready"
  | "stale"
  | "error";

/**
 * Main→renderer title-only event payload for
 * `AI_CHAT_WORKSPACE_TITLE_UPDATED` (design §10.2). A title update must never
 * carry run/attention/unread metadata (design §10.2, invariant 3).
 */
export interface ChatTitleUpdatedEvent {
  readonly conversationId: string;
  /** Null means a nonmanual title was cleared (history clear). */
  readonly title: string | null;
  readonly titleRevision: number;
  readonly titleSource: ChatTitleSource;
}

/** Authoritative rename result surfaced through IPC after commit. */
export type ManualRenameResult =
  | { readonly outcome: "renamed"; readonly title: string; readonly titleRevision: number }
  | { readonly outcome: "missing" };

/**
 * Result of evaluating the first-three-completed-exchanges window
 * (design §7.1) for one conversation.
 */
export type PreparedTitleCandidate =
  | {
      kind: "eligible";
      /** Sanitized visible user request text of the substantive exchange. */
      userText: string;
      /** Sanitized bounded excerpt of the assistant's visible answer. */
      assistantExcerpt: string;
      /** Conversation epoch/revision captured while preparing input. */
      epoch: number;
      revision: number;
    }
  | {
      /** Fewer than three exchanges, none substantive yet — remain pending. */
      kind: "pending_window";
    }
  | {
      /** Three non-substantive exchanges, attempt consumed, or owned. */
      kind: "suppressed";
    }
  | {
      /** Missing row, archived, or manual ownership — do nothing. */
      kind: "not_ready";
    };
