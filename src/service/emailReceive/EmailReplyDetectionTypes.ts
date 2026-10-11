/**
 * Typed reply-detection result contracts (FR-031/FR-032, technical design
 * §4.2). Three states only — `replied`, `not_replied`, `unknown` — and an
 * unknown is NEVER a negative: unsupported protocol, missing identity,
 * partial/failed searches, folder/auth errors, timeouts, and exhausted
 * bounds all surface as typed unknown codes.
 *
 * Pure type + small pure helper module: no DB, no I/O, no Electron.
 */

/** Where a detection outcome came from. */
export type ReplyDetectionSource =
  | "local_state"
  | "mailbox_flag"
  | "sent_search"
  | "unavailable";

/** Why an inconclusive detection is unknown (stable, low-cardinality). */
export type ReplyDetectionUnknownCode =
  | "reply_in_progress"
  | "delivery_unknown"
  | "unsupported_protocol"
  | "missing_message_id"
  | "receive_unavailable"
  | "sent_folder_unavailable"
  | "ambiguous_match"
  | "identity_conflict"
  | "probe_timeout"
  | "probe_limit_exceeded"
  | "probe_failed";

/** Fields shared by every detection result. */
export interface ReplyDetectionBase {
  /**
   * ISO timestamp of the observation this result is based on. Null for local
   * historical state with unknown observation time; a cached result retains
   * its ORIGINAL observation time, not the cache-return time.
   */
  readonly checkedAt: string | null;
  /** True when served from the detection cache / persisted evidence reuse. */
  readonly fromCache: boolean;
  /** Evidence coverage behind this result. */
  readonly coverage: "local_only" | "configured_imap" | "partial";
}

/** The mailbox shows (or local state proves) a reply exists. */
export interface ReplyDetectionReplied extends ReplyDetectionBase {
  readonly state: "replied";
  readonly replied: true;
  readonly source: "local_state" | "mailbox_flag" | "sent_search";
  /** Matched outgoing RFC Message-ID when provided; absence doesn't weaken. */
  readonly matchedMessageId: string | null;
  readonly reasonCode: "already_replied";
}

/** A complete, successful negative across all required sources. */
export interface ReplyDetectionNotReplied extends ReplyDetectionBase {
  readonly state: "not_replied";
  readonly replied: false;
  readonly source: "sent_search";
  readonly matchedMessageId: null;
  readonly reasonCode: "no_reply_observed";
}

/** Inconclusive — never treated as a negative. */
export interface ReplyDetectionUnknown extends ReplyDetectionBase {
  readonly state: "unknown";
  readonly replied: null;
  readonly source: "local_state" | "unavailable";
  readonly matchedMessageId: null;
  readonly reasonCode: ReplyDetectionUnknownCode;
}

/** The three-state detection result (technical design §4.2). */
export type ReplyDetectionResult =
  | ReplyDetectionReplied
  | ReplyDetectionNotReplied
  | ReplyDetectionUnknown;

/**
 * Snake_case DTO for the `check_email_replied` AI tool and the
 * `EMAIL_REPLY_CHECK_REPLIED` IPC channel (FR-032/FR-033). Carries only safe
 * fields — never credentials, raw provider errors, bodies, or internal
 * exception details.
 */
export interface CheckEmailRepliedResult {
  /** The existing `{ success; error }` envelope shape used by AI tools. */
  readonly success: boolean;
  readonly error?: string;
  /** Stored row id the check ran against. */
  readonly message_id: number;
  readonly state: "replied" | "not_replied" | "unknown";
  /** true / false / null (null = inconclusive). */
  readonly replied: boolean | null;
  readonly source: ReplyDetectionSource;
  /** Stable low-cardinality code: already_replied / no_reply_observed / unknown code. */
  readonly reason_code: string;
  readonly matched_message_id: string | null;
  readonly checked_at: string | null;
  readonly from_cache: boolean;
  readonly coverage: "local_only" | "configured_imap" | "partial";
}

/**
 * Map a {@link ReplyDetectionResult} to the snake_case tool/IPC DTO
 * (FR-032). Pure; safe for the renderer (no secrets ever enter a result).
 */
export function toCheckEmailRepliedDto(
  messageId: number,
  result: ReplyDetectionResult
): CheckEmailRepliedResult {
  return {
    success: true,
    message_id: messageId,
    state: result.state,
    replied: result.replied,
    source: result.source,
    reason_code: result.reasonCode,
    matched_message_id: result.matchedMessageId,
    checked_at: result.checkedAt,
    from_cache: result.fromCache,
    coverage: result.coverage,
  };
}
