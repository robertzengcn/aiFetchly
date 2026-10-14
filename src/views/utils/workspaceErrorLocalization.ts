/**
 * Central workspace error localization (B15, FR-QUE-014, FR-REC-004, PRD §16).
 *
 * Main-process `userSafeError` preserves typed queue/preparation/terminal
 * errors as `[CODE] english guidance`. This module maps those bounded codes
 * to six-language UI copy. Unknown codes and prefix-less messages pass
 * through unchanged (explicit unknown-error fallback); the English guidance
 * after the prefix is the fallback when a key is missing — the user never
 * loses the reason or the unblock action.
 *
 * Codes carry no prompts, file content/paths, tokens, or payloads — only
 * the stable code travels, so localization never leaks private detail.
 */

const CODE_PREFIX_PATTERN = /^\[([A-Z_]+)\]\s?/;

/** Renderer i18n key per bounded main-process error code. */
const CODE_TO_I18N_KEY: Readonly<Record<string, string>> = {
  QUEUE_LIMIT_REACHED: "workspaceChat.errors.queueLimit",
  CONTENT_TOO_LONG: "workspaceChat.errors.contentTooLong",
  EMPTY_MESSAGE: "workspaceChat.errors.emptyMessage",
  PREPARATION_FAILED: "workspaceChat.errors.preparationFailed",
  QUEUE_DISABLED: "workspaceChat.errors.queueDisabled",
  AI_FEATURE_DISABLED: "workspaceChat.errors.aiDisabled",
  INVALID_REQUEST: "workspaceChat.errors.invalidRequest",
  PENDING_NOT_FOUND: "workspaceChat.errors.pendingNotFound",
  PENDING_NOT_CLAIMABLE: "workspaceChat.errors.pendingNotClaimable",
  CONVERSATION_MISMATCH: "workspaceChat.errors.conversationMismatch",
  IDEMPOTENCY_CONFLICT: "workspaceChat.errors.idempotencyConflict",
  ATTACHMENTS_NOT_STEERABLE: "workspaceChat.errors.attachmentsNotSteerable",
  STEERING_DISABLED: "workspaceChat.errors.steeringDisabled",
  TURN_NOT_STEERABLE: "workspaceChat.errors.turnNotSteerable",
  STEERING_COMMIT_RACE: "workspaceChat.errors.steeringCommitRace",
  RUN_ENVELOPE_FAILED: "workspaceChat.errors.runEnvelopeFailed",
  DISPATCH_PROMOTE_FAILED: "workspaceChat.errors.dispatchPromoteFailed",
  RUN_TERMINAL_PERSIST_FAILED: "workspaceChat.errors.runTerminalPersistFailed",
};

/** English guidance per code (fallback when the locale key is missing). */
const CODE_TO_ENGLISH: Readonly<Record<string, string>> = {
  QUEUE_LIMIT_REACHED:
    "The message queue is full. Wait for the current reply or stop it before sending again.",
  CONTENT_TOO_LONG: "The message is too long. Shorten it and try again.",
  EMPTY_MESSAGE: "The message is empty. Type something before sending.",
  PREPARATION_FAILED:
    "The message could not be prepared. Check the attachments and try again.",
  QUEUE_DISABLED: "The message queue is disabled. Sending is unavailable.",
  AI_FEATURE_DISABLED:
    "AI features are not enabled on this plan. Your draft was kept.",
  INVALID_REQUEST: "The request was invalid. Check the message and try again.",
  PENDING_NOT_FOUND: "The queued message was not found. It may have been removed.",
  PENDING_NOT_CLAIMABLE:
    "The queued message can no longer be sent. Please resend it.",
  CONVERSATION_MISMATCH:
    "The queued message belongs to a different conversation.",
  IDEMPOTENCY_CONFLICT:
    "This message was already sent. Check the conversation before resending.",
  ATTACHMENTS_NOT_STEERABLE:
    "Messages with attachments cannot steer a running reply.",
  STEERING_DISABLED: "Follow-up steering is disabled.",
  TURN_NOT_STEERABLE: "There is no running reply to steer right now.",
  STEERING_COMMIT_RACE: "Another action claimed this message first.",
  RUN_ENVELOPE_FAILED:
    "The execution could not start. Please try again in a moment.",
  DISPATCH_PROMOTE_FAILED:
    "The message could not be dispatched. Please try again.",
  RUN_TERMINAL_PERSIST_FAILED:
    "The reply finished but could not be saved. It will recover on reload.",
};

export interface WorkspaceErrorLocalization {
  /** The bounded code when the message carries one, else null. */
  readonly code: string | null;
  /** Localized actionable copy (or the unknown-error fallback). */
  readonly text: string;
}

/**
 * Map a workspace IPC denial message to localized copy. `translate` is the
 * surface's `t()` (returns falsy when the key is missing); the English
 * guidance (prefix stripped) is the fallback, and prefix-less or
 * unknown-code messages pass through byte-identical.
 */
export function localizeWorkspaceError(
  message: string,
  translate: (key: string) => unknown
): WorkspaceErrorLocalization {
  const match = CODE_PREFIX_PATTERN.exec(message);
  if (!match) {
    return { code: null, text: message };
  }
  const code = match[1];
  const key = CODE_TO_I18N_KEY[code];
  if (key) {
    const translated = translate(key);
    if (typeof translated === "string" && translated.length > 0) {
      return { code, text: translated };
    }
    const english = CODE_TO_ENGLISH[code];
    if (english) {
      return { code, text: english };
    }
  }
  // Unknown code: keep the full message (never drop the reason).
  return { code, text: message };
}
