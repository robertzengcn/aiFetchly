import { v4 as uuidv4 } from "uuid";
import type {
  BrowserChatNoticeType,
  SafeBrowserChatNotice,
} from "@/entityTypes/managedBrowserTypes";

/**
 * Browser chat-notice publisher (technical design §18.2).
 *
 * Converts authoritative MAIN-process transitions into safe conversation
 * events. The worker cannot write chat messages. Deduplication key is
 * `conversationId/sessionId/type/transitionNonce` so replayed worker events
 * or redirect storms produce exactly ONE visible notice (FR-HANDOFF-005).
 *
 * Allowed message args are an allow-list of safe scalars (labels, counts,
 * sessionSaved, reason codes) — page text, entered values, OAuth params,
 * provider data, cookies, and secrets are rejected before emission.
 */

export interface BrowserChatNoticeInput {
  readonly sessionId: string;
  readonly conversationId: string;
  readonly type: BrowserChatNoticeType;
  readonly transitionNonce: string;
  readonly messageArgs?: Readonly<Record<string, string | number | boolean>>;
  readonly requiresUserAction: boolean;
}

export interface BrowserChatNoticeSink {
  (notice: SafeBrowserChatNotice & {
    readonly messageArgs: Readonly<Record<string, string | number | boolean>>;
  }): void;
}

/** Arg keys permitted in notices — safe scalars only. */
const ALLOWED_ARG_KEYS: ReadonlySet<string> = new Set([
  "accountLabel",
  "platformLabel",
  "cookieCount",
  "sessionSaved",
  "reasonCode",
  "minutes",
]);

const SEVERITY_BY_TYPE: Readonly<Record<BrowserChatNoticeType, SafeBrowserChatNotice["severity"]>> = {
  login_required: "warning",
  login_verifying: "info",
  login_verified: "success",
  login_verification_failed: "warning",
  session_persistence_failed: "warning",
  challenge_detected: "warning",
  challenge_provider_started: "info",
  challenge_resolved: "success",
  challenge_failed: "error",
  challenge_manual_action_required: "warning",
  task_resuming: "info",
  browser_crashed: "error",
  cache_clear_deferred: "info",
  cache_clear_completed: "success",
  cache_clear_failed: "error",
  browser_state_blocked: "warning",
};

const REQUIRES_ACTION_TYPES: ReadonlySet<BrowserChatNoticeType> = new Set([
  "login_required",
  "login_verification_failed",
  "challenge_manual_action_required",
]);

const MAX_DEDUP_KEYS = 500;

export class BrowserChatNoticePublisher {
  private readonly sink: BrowserChatNoticeSink;
  private readonly seenDedupKeys = new Set<string>();

  constructor(sink: BrowserChatNoticeSink) {
    this.sink = sink;
  }

  /**
   * Publish one deduplicated notice. Returns the notice (or null when the
   * transition was already published for this session).
   */
  public publish(input: BrowserChatNoticeInput): SafeBrowserChatNotice | null {
    const dedupKey = `${input.conversationId}/${input.sessionId}/${input.type}/${input.transitionNonce}`;
    if (this.seenDedupKeys.has(dedupKey)) {
      return null;
    }
    if (this.seenDedupKeys.size >= MAX_DEDUP_KEYS) {
      this.seenDedupKeys.clear();
    }
    this.seenDedupKeys.add(dedupKey);

    const notice: SafeBrowserChatNotice & {
      messageArgs: Readonly<Record<string, string | number | boolean>>;
    } = {
      eventId: uuidv4(),
      sessionId: input.sessionId,
      type: input.type,
      messageKey: `managedBrowser.notice.${input.type}`,
      severity: SEVERITY_BY_TYPE[input.type],
      requiresUserAction:
        input.requiresUserAction || REQUIRES_ACTION_TYPES.has(input.type),
      createdAt: new Date().toISOString(),
      messageArgs: sanitizeNoticeArgs(input.messageArgs),
    };
    this.sink(notice);
    return notice;
  }
}

/** Drop any argument key outside the allow-list (defense in depth). */
export function sanitizeNoticeArgs(
  args: Readonly<Record<string, string | number | boolean>> | undefined
): Readonly<Record<string, string | number | boolean>> {
  if (!args) {
    return {};
  }
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(args)) {
    if (ALLOWED_ARG_KEYS.has(key) && typeof value !== "object") {
      out[key] = value;
    }
  }
  return out;
}
