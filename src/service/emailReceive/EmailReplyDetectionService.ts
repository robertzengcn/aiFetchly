/**
 * Central mailbox reply-detection service (FR-031, technical design §7.1).
 *
 * Pure decision logic + bounded IMAP orchestration. Returns the three-state
 * {@link ReplyDetectionResult} (§4.2). NEVER writes refusal audit rows — the
 * one-audit-owner rule (§9.2/§10) keeps that responsibility in the outer
 * generation/delivery service. This service owns only evidence/cache writes via
 * the targeted `updateReplyEvidence` model method (sticky-positive-safe).
 *
 * Algorithm (§7.1 steps 1–7):
 *   1. Local-first: load message + canonical cluster, inspect local sent /
 *      in-flight / delivery-unknown records. No mailbox round trip.
 *   2. Sticky positive: persisted `replyDetectedAt` settles `replied` from cache.
 *   3. Negative reuse (draft checks only, NOT forceRefresh): age 0–60s + matching
 *      context hash → `not_replied` from cache.
 *   4. POP3 / config-unavailable / missing RFC ID → typed `unknown`. Never
 *      construct an IMAP client from POP3 credentials.
 *   5. Connect via the service's stored receive config; UID-scoped flag refresh
 *      (namespaced rows) — `\Answered` settles `replied` (`mailbox_flag`).
 *      Legacy/expunged rows cannot complete the flag side but may still match
 *      in Sent search.
 *   6. Resolve Sent folders (≤5), search each (≤200 candidate fetches total),
 *      verify exact direct parent + configured sending identity. A verified
 *      match settles `replied` (`sent_search`); ambiguity/incomplete → unknown.
 *   7. Before persisting a negative, confirm the account context is unchanged
 *      since the probe began; if it changed, return `identity_conflict` and do
 *      not persist. Close the IMAP connection in `finally`.
 *
 * In-memory cache, single-flight per message/context, one probe per mailbox,
 * and the 15s probe deadline are implemented in this class (§7.3): negative
 * entries expire at {@link NEGATIVE_CACHE_TTL_MS}; positive entries are sticky.
 */
import { createHash } from "node:crypto";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";
import type { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import type { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import type { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import type {
  RefreshedFlags,
  ReplyHeaderCandidate,
  ReplyHeaderSearchResult,
  SentFolder,
} from "@/service/emailReceive/EmailReceiveClient";
import {
  hasNamespaceConflict,
  normalizeStoredMessageId,
  normalizedIdsMatch,
  parseNamespacedProviderUid,
} from "@/service/emailReceive/EmailReplyIdentity";
import {
  isAttemptInFlight,
  isLiveDraftStatus,
} from "@/model/replyClusterEvidence";
import {
  normalizeMessageId,
  parseReferenceChain,
} from "@/service/emailReceive/EmailThreadResolver";
import {
  normalizeReceiveConnectionConfig,
  validateReceiveEndpointConfig,
} from "@/service/emailReceive/EmailReceiveSyncService";
import {
  startGenerationDeadline,
  type GenerationDeadline,
} from "@/service/emailReply/EmailReplyGenerationBudget";
import {
  incrementReplyMetric,
  timedReplyStage,
} from "@/service/emailReply/EmailReplyMetrics";
import type {
  ReplyDetectionResult,
  ReplyDetectionReplied,
  ReplyDetectionNotReplied,
  ReplyDetectionUnknown,
} from "@/service/emailReceive/EmailReplyDetectionTypes";
import { toCheckEmailRepliedDto } from "@/service/emailReceive/EmailReplyDetectionTypes";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { ImapEmailReceiveClient } from "@/service/emailReceive/ImapEmailReceiveClient";

// Re-export the result union + guards so callers (Module, tests, future wire-up
// in generation/delivery services) can import them from a single entry point.
export type {
  ReplyDetectionResult,
  ReplyDetectionReplied,
  ReplyDetectionNotReplied,
  ReplyDetectionUnknown,
} from "@/service/emailReceive/EmailReplyDetectionTypes";

/**
 * Detector version stamped into the context hash (§7.3). Bump when the
 * algorithm, matching rules, or bounds change so prior negatives are
 * invalidated and re-probed against the new logic.
 *
 * v2 (G01/N04): the probe's negative-persistence semantics changed — an
 * abandoned timed-out probe no longer persists fresh negative evidence, and
 * the persisted `checkedAt`/timestamp is the actual mailbox observation time
 * rather than the delayed write time. Pre-v2 negatives were stamped with the
 * write time, so a late write could pass the 5s freshness fence with a stale
 * observation. Bumping invalidates those rows (hash mismatch → re-probe,
 * fail-closed) instead of trusting them.
 */
export const REPLY_DETECTOR_VERSION = "reply-detection-v2";

/** Negative cache TTL (§7.3): a complete negative is reusable for 60s. */
const NEGATIVE_CACHE_TTL_MS = 60_000;

/**
 * Overall probe deadline (§7.3): one mailbox probe must complete within 15s,
 * including any queue wait while a prior probe on the same mailbox holds the
 * single-flight lock. A probe whose result resolves after the deadline is
 * discarded and the caller receives `probe_timeout`.
 */
const PROBE_DEADLINE_MS = 15_000;

/** At most this many Sent folders are searched (§7.3). */
const MAX_SENT_FOLDERS = 5;

/** At most this many candidate header fetches across all Sent folders (§7.3). */
const MAX_CANDIDATE_FETCHES = 200;

// ---------------------------------------------------------------------------
// Narrow port interfaces — the real Modules/Client satisfy these structurally,
// tests inject behavioral fakes. No `any`, no concrete-class coupling.
// ---------------------------------------------------------------------------

/** Reply-evidence + cluster reads the detector needs from the message store. */
export interface ReplyDetectionMessagePort {
  read(id: number): Promise<EmailReceivedMessageEntity | null>;
  findCanonicalEquivalents(
    seed: EmailReceivedMessageEntity
  ): Promise<EmailReceivedMessageEntity[]>;
  updateReplyEvidence(input: {
    id: number;
    replyDetectedAt?: Date | null;
    replyDetectionSource?: string | null;
    replyMatchedMessageId?: string | null;
    replyNegativeCheckAt?: Date | null;
    replyNegativeContextHash?: string | null;
    isAnswered?: number;
    answeredFlagCheckedAt?: Date | null;
  }): Promise<boolean>;
  /**
   * F03: void a negative write that completed after its probe expired.
   * Required on every port — a store that cannot void cannot safely serve
   * expired probes, so the detector treats a missing implementation as a
   * port error (fail-closed), never as a persisted negative.
   */
  voidExpiredNegativeWrite(input: {
    id: number;
    observedAt: Date;
  }): Promise<boolean>;
}

/** Draft lifecycle reads (cluster inspection) the detector needs. */
export interface ReplyDetectionDraftPort {
  listByMessages(messageIds: number[]): Promise<EmailReplyDraftEntity[]>;
}

/** Send-attempt ledger reads (cluster inspection) the detector needs. */
export interface ReplyDetectionAttemptPort {
  listByMessages(messageIds: number[]): Promise<EmailReplySendAttemptEntity[]>;
}

/** Receive-config + identity reads the detector needs from the service store. */
export interface ReplyDetectionEmailServicePort {
  getEmailServiceReceiveConfig(
    id: number
  ): Promise<EmailReceiveConnectionConfig | null>;
  readIdentity(id: number): Promise<{
    smtpUsername: string;
    fromAddress: string;
    replyToAddress: string | null;
    receiveUsername: string;
  } | null>;
}

/** IMAP probe primitives (§7.1 steps 5–6). The real client satisfies this. */
export interface ReplyDetectionImapPort {
  refreshMessageFlags(input: {
    config: EmailReceiveConnectionConfig;
    folder: string;
    uidValidity: string;
    uid: string;
    /**
     * Review D9.2: when the probe deadline elapses, the caller aborts this
     * signal; the implementation tears down the in-flight IMAP socket
     * (`client.close()`) instead of letting it linger until the server
     * responds.
     */
    signal?: AbortSignal;
  }): Promise<RefreshedFlags | null>;
  discoverSentFolders(
    config: EmailReceiveConnectionConfig,
    signal?: AbortSignal
  ): Promise<SentFolder[]>;
  searchReplyHeaders(input: {
    config: EmailReceiveConnectionConfig;
    folder: string;
    originalMessageId: string;
    cap: number;
    signal?: AbortSignal;
  }): Promise<ReplyHeaderSearchResult | false>;
}

/** What a candidate-matching pass concluded about one candidate. */
type CandidateMatch =
  | { kind: "direct"; matchedMessageId: string | null }
  | { kind: "ambiguous" }
  | { kind: "no_match" };

/**
 * One cached detection entry. Negatives expire at 60s; positives are sticky
 * (no expiry). The cache key is `${messageId}:${contextHash}` — the context
 * hash invalidates the entry when the account endpoint/protocol/username,
 * configured sender, or detector version changes (§7.3).
 */
interface CachedDetection {
  readonly result: ReplyDetectionResult;
  readonly observedAt: number;
  readonly contextHash: string;
}

/**
 * Shared mailbox reply-detection service. The class is stateful (in-memory
 * cache + single-flight + per-mailbox probe serialization), so a single
 * instance per process preserves its guarantees; the generation and delivery
 * services construct it lazily through a factory getter.
 */
export class EmailReplyDetectionService {
  private readonly messagePort: ReplyDetectionMessagePort;
  private readonly draftPort: ReplyDetectionDraftPort;
  private readonly attemptPort: ReplyDetectionAttemptPort;
  private readonly emailServicePort: ReplyDetectionEmailServicePort;
  private readonly imapPort: ReplyDetectionImapPort;
  private readonly now: () => number;

  /**
   * In-memory detection cache (§7.3): key = `${messageId}:${contextHash}`.
   * Negatives expire at {@link NEGATIVE_CACHE_TTL_MS}; positives are sticky.
   * `forceRefresh: true` skips the negative cache but still honors sticky
   * positives (a known positive short-circuits — no repeated network scan).
   */
  private readonly cache: Map<string, CachedDetection> = new Map();

  /**
   * Single-flight (§7.3): one in-flight probe per `(messageId, contextHash)`.
   * A forced send check may JOIN a live network probe begun for the same
   * unchanged context during that send invocation, but never a cached
   * pre-invocation negative. Keyed identically to {@link cache}.
   */
  private readonly inFlight: Map<
    string,
    Promise<ReplyDetectionResult>
  > = new Map();

  /**
   * One active IMAP probe per mailbox (§7.3): key = `emailServiceId`. The
   * value is a **release token** (`Promise<void>`), NOT a result promise — it
   * resolves when the current lock holder's mailbox work is fully done, so the
   * next queued caller may begin. Each caller installs its OWN token
   * synchronously (before any await) so the next caller chains onto THIS token,
   * forming an unbreakable A→B→C chain (R07: the old snapshot-await pattern
   * awaited the predecessor before installing a node, so B and C both observed
   * A and fanned out together when A settled). A probe for a different mailbox
   * proceeds without waiting.
   */
  private readonly mailboxInFlight: Map<
    number,
    Promise<void>
  > = new Map();

  constructor(options?: {
    messagePort?: ReplyDetectionMessagePort;
    draftPort?: ReplyDetectionDraftPort;
    attemptPort?: ReplyDetectionAttemptPort;
    emailServicePort?: ReplyDetectionEmailServicePort;
    imapPort?: ReplyDetectionImapPort;
    now?: () => number;
  }) {
    // Lazy at construction time (runtime, not module eval) — matches the
    // EmailReplyPolicyOrchestrator pattern. Tests override every port.
    this.messagePort =
      options?.messagePort ?? new DefaultMessagePort();
    this.draftPort = options?.draftPort ?? new DefaultDraftPort();
    this.attemptPort =
      options?.attemptPort ?? new DefaultAttemptPort();
    this.emailServicePort =
      options?.emailServicePort ?? new DefaultEmailServicePort();
    this.imapPort = options?.imapPort ?? new DefaultImapPort();
    this.now = options?.now ?? ((): number => Date.now());
  }

  /**
   * Run the full §7.1 detection algorithm for one stored message.
   *
   * @param input.messageId stored `email_received_message.id` to check.
   * @param input.forceRefresh delivery (pre-SMTP) checks pass `true` to skip
   *   the 60s negative cache (§7.3). Sticky positives are still honored.
   * @param input.excludeDraftId R12 §9.4 item 4 — the claiming operation's
   *   own draft id. Only the excluded draft is ignored in the local-first
   *   in-flight/sending check so a post-claim refresh can re-probe the
   *   mailbox instead of short-circuiting on its own `sending` draft. Every
   *   OTHER pending/sent/unknown record still blocks.
   * @param input.excludeAttemptId R12 §9.4 item 4 — the claiming operation's
   *   own attempt id. Only the excluded attempt is ignored in the local-first
   *   in-flight check. The exact-attempt ownership handle is internal to the
   *   delivery service; it is never a tool/IPC bypass parameter.
   */
  async detect(input: {
    messageId: number;
    forceRefresh?: boolean;
    excludeDraftId?: number;
    excludeAttemptId?: number;
  }): Promise<ReplyDetectionResult> {
    const forceRefresh = input.forceRefresh === true;
    const message = await this.messagePort.read(input.messageId);
    if (!message) {
      return this.unknown("probe_failed");
    }

    // Step 1 — local-first (no mailbox round trip).
    const localState = await this.inspectLocalState(message, {
      excludeDraftId: input.excludeDraftId,
      excludeAttemptId: input.excludeAttemptId,
    });
    if (localState) return localState;

    // Step 2 — sticky positive evidence reuse.
    if (message.replyDetectedAt != null) {
      const source = (message.replyDetectionSource ?? "mailbox_flag") as
        | "mailbox_flag"
        | "sent_search";
      incrementReplyMetric("detection_cache", {
        hit: true,
        kind: "persisted_positive",
      });
      return this.repliedFromCache(source, message.replyMatchedMessageId);
    }

    // Step 4 — POP3 / config-unavailable / missing inbound RFC ID → unknown.
    // The stored column is a persistence boundary — re-normalize rather than
    // trust it, so a legacy/bracketed value cannot silently break token
    // equality (parseReferenceChain strips brackets; a stored
    // `<id@host>` would otherwise never match its own `id@host` token).
    const normalizedId =
      normalizeStoredMessageId(message.normalizedMessageId) ??
      normalizeStoredMessageId(message.messageId);
    if (!normalizedId) {
      return this.unknown("missing_message_id");
    }
    const config = await this.emailServicePort.getEmailServiceReceiveConfig(
      message.emailServiceId
    );
    if (!config) {
      return this.unknown("receive_unavailable");
    }
    if (config.protocol !== "imap") {
      // POP3 has no `\Answered` flag and no Sent-folder search; never
      // construct an IMAP client from POP3 credentials (§7.1 step 3).
      return this.unknown("unsupported_protocol");
    }

    // Step 3 — negative reuse (draft checks only; age 0–60s + matching hash).
    // Runs AFTER the config + identity resolution so the stored context hash
    // can be recomputed from the CURRENT account context and compared (D5):
    // a presence-only check served a stale negative for up to 60s after the
    // account was reconfigured (new endpoint/username/sender/detector
    // version), enabling a duplicate reply. Both reads are local (config +
    // identity rows), never a mailbox round trip, so the cache still avoids
    // the network probe it exists for.
    const normalizedConfig = normalizeReceiveConnectionConfig(config);
    const identity = await this.emailServicePort.readIdentity(
      message.emailServiceId
    );
    if (!forceRefresh) {
      const cached = this.readCachedNegative(
        message,
        normalizedConfig,
        identity?.fromAddress ?? null
      );
      if (cached) {
        incrementReplyMetric("detection_cache", {
          hit: true,
          kind: "persisted_negative",
        });
        return cached;
      }
    }

    // Steps 5–7 — bounded mailbox probe, routed through the in-memory cache
    // + single-flight + 15s deadline layer (§7.3). The persisted negative
    // cache (Step 3 above) covers cross-process/cross-restart reuse; the
    // in-memory layer coalesces concurrent calls within this process.
    return this.runCachedProbe(message, normalizedConfig, normalizedId, forceRefresh, identity);
  }

  /**
   * In-memory cache + single-flight + 15s deadline wrapper around
   * {@link probeMailbox} (§7.3). Computes a pre-probe context hash to key
   * the cache + in-flight map, checks the in-memory cache (negative ≤60s,
   * positive sticky; `forceRefresh` skips the negative), joins a live probe
   * for the same `(messageId, contextHash)` if one is in flight, otherwise
   * runs the probe under the mailbox-level single-flight lock + 15s deadline.
   * Late results (probe resolves after the deadline) are discarded and the
   * caller receives `probe_timeout`.
   */
  private async runCachedProbe(
    message: EmailReceivedMessageEntity,
    normalizedConfig: EmailReceiveConnectionConfig,
    normalizedId: string,
    forceRefresh: boolean,
    identity: {
      smtpUsername: string;
      fromAddress: string;
      replyToAddress: string | null;
      receiveUsername: string;
    } | null
  ): Promise<ReplyDetectionResult> {
    const validationError =
      validateReceiveEndpointConfig(normalizedConfig);
    if (validationError) {
      return this.unknown("receive_unavailable");
    }

    if (!identity) {
      return this.unknown("receive_unavailable");
    }

    // Pre-probe context hash: the cache key (§7.3). Sent scope is unknown
    // before discovery, so the pre-probe hash uses an empty scope; this is
    // stable across calls under the same account/identity/detector-version,
    // and changes when any of those change (invalidating the entry). The
    // post-probe re-check inside `probeMailbox` recomputes WITH the resolved
    // scope to isolate scope changes from account changes. `persistNegative`
    // stores this SAME empty-scope pre-probe hash so `readCachedNegative` can
    // recompute it cheaply (config + identity only) and compare exactly (D5).
    const contextHash = this.hashContext(
      normalizedConfig,
      identity.fromAddress,
      "" // pre-probe: Sent scope unknown
    );
    const cacheKey = `${message.id}:${contextHash}`;

    // Sticky positive short-circuit (§7.3: "Sticky positive observations need
    // no repeated network scan"). Honored even under forceRefresh — a known
    // positive is authoritative.
    const cached = this.cache.get(cacheKey);
    if (cached) {
      const ageMs = this.now() - cached.observedAt;
      const isPositive = cached.result.state === "replied";
      const negativeLive =
        !isPositive && ageMs >= 0 && ageMs <= NEGATIVE_CACHE_TTL_MS;
      if (isPositive) {
        incrementReplyMetric("detection_cache", { hit: true, kind: "positive" });
        return this.repliedFromCache(
          cached.result.source === "mailbox_flag"
            ? "mailbox_flag"
            : "sent_search",
          cached.result.matchedMessageId
        );
      }
      if (!forceRefresh && negativeLive) {
        incrementReplyMetric("detection_cache", { hit: true, kind: "negative" });
        // Serve from the in-memory cache with fromCache: true (mirror the
        // persisted-cache path in readCachedNegative). The cached result's
        // original fromCache was false (probeMailbox sets it on first
        // observation); a cache HIT must report fromCache: true. Construct a
        // fresh immutable copy — never mutate the cached entry.
        return this.notRepliedFromCache(cached.result.checkedAt);
      }
      if (!isPositive && !negativeLive) {
        // Expired negative — drop the stale entry. This is an expired-entry
        // fall-through, not a cold miss; the `expired` counter already
        // distinguishes it.
        this.cache.delete(cacheKey);
        incrementReplyMetric("detection_cache", { hit: false, expired: true });
        return this.runFreshProbe(message, cacheKey, contextHash, normalizedConfig, normalizedId, identity.fromAddress);
      }
    }

    // Cold miss: no cache entry at all (fresh probe path). The hit-rate for
    // the in-process layer is computable from the hit/expired counters above
    // plus this miss counter.
    incrementReplyMetric("detection_cache", { hit: false, kind: "miss" });
    return this.runFreshProbe(message, cacheKey, contextHash, normalizedConfig, normalizedId, identity.fromAddress);
  }

  /**
   * Fresh probe path shared by the cold-miss and expired-negative branches
   * (§7.3): join a live probe for the same `(messageId, contextHash)` if one
   * is in flight; a forced send check MAY join a probe begun for the same
   * unchanged context during that send invocation, but never a cached
   * pre-invocation negative. Otherwise start the 15s deadline (before
   * acquiring, so queue wait is included) and run the probe under the
   * mailbox-level single-flight lock.
   */
  private async runFreshProbe(
    message: EmailReceivedMessageEntity,
    cacheKey: string,
    contextHash: string,
    normalizedConfig: EmailReceiveConnectionConfig,
    normalizedId: string,
    configuredSender: string
  ): Promise<ReplyDetectionResult> {
    const live = this.inFlight.get(cacheKey);
    if (live) {
      incrementReplyMetric("detection_cache", { hit: true, kind: "inflight" });
      return live;
    }

    const deadline = startGenerationDeadline({
      now: this.now,
      budgetMs: PROBE_DEADLINE_MS,
    });

    const probe = this.runProbeUnderMailboxLock(
      cacheKey,
      contextHash,
      message,
      normalizedConfig,
      normalizedId,
      configuredSender,
      deadline
    );
    this.inFlight.set(cacheKey, probe);
    try {
      const result = await probe;
      return result;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  /**
   * Acquire the mailbox-level single-flight lock, run the probe, and apply
   * the 15s deadline. If the probe is still running when the deadline elapses,
   * the caller receives `probe_timeout` and the late result is discarded (not
   * cached). A successful (on-time) result is cached: positives sticky,
   * negatives for 60s.
   */
  private async runProbeUnderMailboxLock(
    cacheKey: string,
    contextHash: string,
    message: EmailReceivedMessageEntity,
    normalizedConfig: EmailReceiveConnectionConfig,
    normalizedId: string,
    configuredSender: string,
    deadline: GenerationDeadline
  ): Promise<ReplyDetectionResult> {
    const mailboxId = normalizedConfig.emailServiceId;
    // R07 — synchronously-chained mailbox queue (no fan-out). Each caller
    // installs its OWN release token into the map BEFORE awaiting anything, so
    // the next caller chains onto THIS token, forming an unbreakable A→B→C
    // chain. The previous snapshot-await pattern read the predecessor and
    // awaited it before installing a node — so B and C both observed A and
    // fanned out together when A settled (max active probes > 1). Here the
    // token is installed synchronously; a concurrent C reads B's token, not
    // A's. The deadline was started before this call, so queue wait is counted
    // against the 15s budget.
    let releaseToken!: () => void;
    const myTurn = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    const predecessor = this.mailboxInFlight.get(mailboxId);
    // Install synchronously — the next caller for this mailbox chains onto
    // `myTurn`, never `predecessor`.
    this.mailboxInFlight.set(mailboxId, myTurn);
    if (predecessor) {
      try {
        await predecessor;
      } catch {
        // A predecessor's failure must not abort this probe; the deadline is
        // the only thing that decides whether THIS probe proceeds.
      }
      // Re-check the deadline after the queue wait — if exhausted, the caller
      // gets probe_timeout without opening a connection. The token is still
      // released below so the chain does not stall.
      if (deadline.expired()) {
        incrementReplyMetric("detection_outcome", {
          state: "unknown",
          reason: "probe_timeout",
          stage: "queue_wait",
        });
        releaseToken();
        return this.unknown("probe_timeout");
      }
    }

    try {
      // If the deadline already elapsed during queue wait, do not open a
      // connection — return probe_timeout immediately.
      if (deadline.expired()) {
        return this.unknown("probe_timeout");
      }
      // Race the probe against the deadline. The probe resolves with a
      // result; the deadline-racer resolves with `null` when the budget
      // is exhausted. whichever resolves first wins; the other is
      // discarded. Review D9.2: the racer owns an AbortController and
      // aborts the signal on timeout so the in-flight IMAP socket is torn
      // down (`client.close()`) instead of lingering until the server
      // responds.
      const result = await this.raceProbeAgainstDeadline(
        (signal) =>
          timedReplyStage(
            "detection",
            (): Promise<ReplyDetectionResult> =>
              this.probeMailbox(
                message,
                normalizedConfig,
                normalizedId,
                configuredSender,
                contextHash,
                signal,
                deadline
              ),
            { state: "probe" }
          ),
        deadline
      );
      // Cache the result. Only positives and COMPLETE negatives are cacheable
      // (§7.3: "no cacheable negative on timeout/unsupported/partial/false-
      // search/folder-auth"). `probe_timeout`, `probe_failed`,
      // `sent_folder_unavailable`, `ambiguous_match`, `probe_limit_exceeded`,
      // `identity_conflict`, etc. are `unknown`-state outcomes that must NOT
      // be cached — the next caller must re-probe. A late result (probe
      // resolved after the deadline) returns probe_timeout here and is also
      // not cached; the underlying probe's resolution is discarded by
      // `Promise.race` in `raceProbeAgainstDeadline`.
      if (result.state === "replied" || result.state === "not_replied") {
        this.cache.set(cacheKey, {
          result,
          observedAt: this.now(),
          contextHash,
        });
      }
      return result;
    } finally {
      // Release the mailbox lock so the next queued caller may begin. Always
      // release — even on timeout/exception — so the chain never stalls. A
      // successor that installed its own token while this holder was running
      // is already chained onto `myTurn`; releasing here wakes it.
      releaseToken();
      // If no successor installed a token, drop the stale entry so the next
      // caller does not await an already-resolved token unnecessarily.
      if (this.mailboxInFlight.get(mailboxId) === myTurn) {
        this.mailboxInFlight.delete(mailboxId);
      }
    }
  }

  /**
   * Race a probe promise against the deadline. If the probe resolves first,
   * return its result. If the deadline elapses first, return `probe_timeout`.
   *
   * Review D9.2: on timeout the racer aborts the AbortController, which the
   * probe passed into every IMAP port call. The port's `abortIfSignaled`
   * helper calls `client.close()` (immediate socket tear-down) so the
   * in-flight `mailboxOpen`/`search`/`fetchOne` rejects promptly instead of
   * lingering until the server responds. The probe's eventual resolution is
   * discarded by `Promise.race` and never cached. If the probe wins, the
   * controller is never aborted (the `finally` clears the timer and the
   * controller is GC'd once the probe settles).
   */
  private async raceProbeAgainstDeadline(
    probe: (signal: AbortSignal) => Promise<ReplyDetectionResult>,
    deadline: GenerationDeadline
  ): Promise<ReplyDetectionResult> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const timeout = new Promise<ReplyDetectionResult>((resolve) => {
      const remaining = deadline.remainingMs();
      // setTimeout clamps to 1ms minimum; a 0 remaining still fires the
      // timeout on the next tick, giving the probe one microtask to win.
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve(this.unknown("probe_timeout"));
      }, Math.max(1, remaining));
    });
    const probePromise = probe(controller.signal);
    // Review D9.2: the racer aborts the signal on timeout, the IMAP port's
    // abort listener calls `client.close()`, and the in-flight IMAP operation
    // rejects shortly after. By then `Promise.race` has already resolved with
    // `probe_timeout`; without this no-op catch that late rejection would
    // surface as an unhandled promise rejection. If the probe WINS the race
    // (resolves or rejects before the timeout), this catch is inert — the
    // probe's own resolution flows through `Promise.race` unchanged.
    probePromise.catch(() => {});
    try {
      return await Promise.race([probePromise, timeout]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Thin IPC/tool-facing wrapper (FR-032): run {@link detect} and map the
   * typed result to the snake_case {@link CheckEmailRepliedResult} DTO.
   * Ordinary cache behavior (no forceRefresh) per §7.3.
   */
  async checkReply(input: {
    messageId: number;
    forceRefresh?: boolean;
  }): Promise<{
    success: boolean;
    error?: string;
    result?: ReturnType<typeof toCheckEmailRepliedDto>;
  }> {
    try {
      const result = await this.detect(input);
      return {
        success: true,
        result: toCheckEmailRepliedDto(input.messageId, result),
      };
    } catch (error) {
      return {
        success: false,
        error: sanitizeDetectionError(error),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step 1 — local-first state inspection (mirrors the orchestrator's
  // evaluateMessageLevelState precedence, §7.1 step 1).
  // -------------------------------------------------------------------------

  private async inspectLocalState(
    seed: EmailReceivedMessageEntity,
    exclude?: { excludeDraftId?: number; excludeAttemptId?: number }
  ): Promise<ReplyDetectionResult | null> {
    const clusterRows = await this.messagePort.findCanonicalEquivalents(seed);
    const rowIds = clusterRows.map((r) => r.id);

    // One batched query per table for the whole cluster (not one query per
    // row) — the cluster sweep runs on every gate pass (pre-draft, post-gen
    // recheck, pre-send).
    const [drafts, attempts] = await Promise.all([
      this.draftPort.listByMessages(rowIds),
      this.attemptPort.listByMessages(rowIds),
    ]);

    // R12 §9.4 item 4 — the claiming operation's own draft/attempt are the
    // current owner during a post-claim refresh. Only the excluded records
    // are ignored in the in-flight/sending check so the refresh can re-probe
    // the mailbox instead of short-circuiting on its own `sending` draft /
    // `submitted` attempt. Every OTHER pending/sent/unknown record still
    // blocks. This mirrors the production cluster-evidence ownership semantic
    // (replyClusterEvidence.clusterEvidenceBlocksSend excludes the claiming
    // draft's own records by draftId). The exclude ids are internal to the
    // delivery service; they are never a tool/IPC bypass parameter.
    const isExcludedDraft = (d: { id: number }): boolean =>
      exclude?.excludeDraftId !== undefined &&
      d.id === exclude.excludeDraftId;
    const isExcludedAttempt = (a: { id: number }): boolean =>
      exclude?.excludeAttemptId !== undefined &&
      a.id === exclude.excludeAttemptId;

    const liveDrafts = drafts.filter(
      (d) => isLiveDraftStatus(d.status) && !isExcludedDraft(d)
    );
    const sentDrafts = drafts.filter((d) => d.status === "sent");
    const unknownDrafts = drafts.filter(
      (d) => d.status === "delivery_unknown"
    );
    const sentAttempts = attempts.filter((a) => a.status === "sent");
    const unknownAttempts = attempts.filter(
      (a) => a.status === "delivery_unknown"
    );
    const inFlightAttempts = attempts.filter(
      (a) => isAttemptInFlight(a.status) && !isExcludedAttempt(a)
    );

    // Namespace conflict across a multi-row cluster cannot be safely merged.
    // This is a local-state finding (no mailbox round trip), so it surfaces
    // with source `local_state` and `local_only` coverage, not as a mailbox
    // `unavailable` outcome.
    if (clusterRows.length > 1 && hasNamespaceConflict(clusterRows)) {
      return this.unknownLocal("identity_conflict");
    }

    // R03: aggregate row-level positive evidence across every cluster row,
    // not just the seed. A sibling row may carry `replyDetectedAt` (sticky
    // mailbox flag / verified Sent search) or `replyStatus=sent` (historical
    // app delivery) that the seed's own columns do not reflect. Without this,
    // local-first detection returns eligible/negative for the same inbound
    // identity that already has authoritative reply history on a sibling.
    //
    // The SEED's own `replyDetectedAt` is deliberately EXCLUDED here: step 2
    // (sticky-positive reuse) owns it and preserves the persisted fidelity —
    // recorded source (`mailbox_flag`/`sent_search`), `matchedMessageId`, and
    // the `persisted_positive` cache metric. Intercepting it at step 1 would
    // downgrade a verified Sent-search positive to an anonymous `local_state`.
    // The seed's own `replyStatus=sent` IS still settled here (checked
    // directly below), so only the sticky-positive column is seed-excluded.
    const clusterHasPositive =
      clusterRows.some((r) => r.id !== seed.id && r.replyDetectedAt != null) ||
      clusterRows.some((r) => r.replyStatus === "sent");
    const replyStatus = seed.replyStatus;

    // 1. Already replied: explicit message state OR a cluster row positive OR
    //    a sent draft OR a sent attempt (the ledger is authoritative even if
    //    the draft row is gone).
    if (
      replyStatus === "sent" ||
      clusterHasPositive ||
      sentDrafts.length > 0 ||
      sentAttempts.length > 0
    ) {
      const replied: ReplyDetectionReplied = {
        state: "replied",
        replied: true,
        source: "local_state",
        matchedMessageId: null,
        reasonCode: "already_replied",
        checkedAt: null,
        fromCache: true,
        coverage: "local_only",
      };
      return replied;
    }

    // 2. Ambiguous delivery on a prior attempt.
    if (unknownDrafts.length > 0 || unknownAttempts.length > 0) {
      return this.unknownLocal("delivery_unknown");
    }

    // 3. In-flight send.
    if (liveDrafts.some((d) => d.status === "sending") || inFlightAttempts.length > 0) {
      return this.unknownLocal("reply_in_progress");
    }

    // 4. Contradictory records: multiple live (editable, non-sent) drafts
    //    across the cluster with no namespace conflict — the local state
    //    itself is contradictory. Treat as review-required, not eligible.
    if (liveDrafts.length > 1) {
      return this.unknownLocal("identity_conflict");
    }

    // No local state settles the outcome — proceed to mailbox evidence.
    return null;
  }

  // -------------------------------------------------------------------------
  // Steps 5–7 — bounded mailbox probe.
  // -------------------------------------------------------------------------

  private async probeMailbox(
    message: EmailReceivedMessageEntity,
    normalizedConfig: EmailReceiveConnectionConfig,
    normalizedId: string,
    configuredSender: string,
    preProbeContextHash: string,
    /**
     * Review D9.2: abort signal from the deadline racer. When the 15s budget
     * elapses, the racer aborts this signal; the IMAP port tears down the
     * in-flight socket (`client.close()`) instead of lingering. Passed to
     * every port call so an abort between sub-steps also short-circuits.
     */
    signal?: AbortSignal,
    /**
     * N04: invocation deadline owning this probe. Checked after every awaited
     * closing step (mailbox reads, config/identity reread, persistence) so an
     * abandoned timed-out probe never persists fresh negative evidence.
     */
    deadline?: { expired(): boolean; remainingMs(): number }
  ): Promise<ReplyDetectionResult> {
    // Config normalization + identity resolution happened in runCachedProbe
    // (the cache key needs the pre-probe context hash, which needs both).
    // The post-probe context re-check (§7.1 step 7) is recomputed below
    // WITH the resolved Sent scope to isolate scope changes from account
    // changes — see `probeStartRehashed` vs `probeEndContextHash`.
    // `preProbeContextHash` is the EMPTY-scope hash `runCachedProbe` keyed
    // the cache on; `persistNegative` stores it so `readCachedNegative` can
    // recompute + compare against the CURRENT context (D5).

    // Step 5 — UID-scoped flag refresh (namespaced rows only). Legacy bare-UID
    // rows have no folder/UIDVALIDITY provenance — their flag side is
    // unresolved; they can still settle a positive via Sent search but cannot
    // contribute a complete negative (§7.1 step 5).
    let flagSideComplete = false;
    let isAnswered = false;
    let answeredCheckedAt: Date | null = null;
    // Namespaced providerUid = `imap:<folderHash>:<uidValidity>:<uid>`. The
    // folderHash is a one-way hash, so the original folder path is NOT
    // recoverable from the providerUid; the stored `providerFolder` column
    // is the authoritative source. Legacy bare-UID rows have no namespaced
    // provenance — their flag side stays incomplete (§7.1 step 5).
    const parsed = parseNamespacedProviderUid(message.providerUid);
    const folder = message.providerFolder;
    const uidValidity =
      message.providerUidValidity ?? parsed?.uidValidity ?? null;
    const uid = parsed?.uid ?? null;

    if (folder && uidValidity && uid) {
      try {
        const flags = await this.imapPort.refreshMessageFlags({
          config: normalizedConfig,
          folder,
          uidValidity,
          uid,
          signal,
        });
        if (flags) {
          flagSideComplete = true;
          isAnswered = flags.isAnswered;
          answeredCheckedAt = flags.checkedAt;
          if (isAnswered) {
            // A positive `\Answered` flag settles replied (§7.1 step 5).
            const persisted = await this.persistPositive(message, {
              source: "mailbox_flag",
              matchedMessageId: null,
              isAnswered: 1,
              answeredCheckedAt,
            });
            if (!persisted) {
              // D1b/R09: evidence write failed or was rejected (0 rows) —
              // reread the store and return the CURRENT evidence (a concurrent
              // positive) or unknown. Never a replied the store does not back.
              return await this.resolveRejectedWrite(message);
            }
            return this.repliedFresh(
              "mailbox_flag",
              null,
              answeredCheckedAt
            );
          }
        }
        // flags === null → source message expunged/moved/UIDVALIDITY changed.
        // Flag side is incomplete; Sent search may still settle a positive.
      } catch {
        // Flag-refresh failure does NOT collapse to no-matches; the flag side
        // stays incomplete and the outcome must be unknown unless Sent search
        // settles a verified positive (§7.3: no cacheable negative on partial).
        flagSideComplete = false;
      }
    }

    // Step 6 — Sent-folder header search.
    const sentResult = await this.searchSentForReply(
      message,
      normalizedConfig,
      normalizedId,
      configuredSender,
      signal
    );

    if (sentResult.kind === "replied") {
      // A verified direct match settles replied even if the flag side or other
      // folders were unavailable (§7.1 step 6).
      const persisted = await this.persistPositive(message, {
        source: "sent_search",
        matchedMessageId: sentResult.matchedMessageId,
        isAnswered: isAnswered ? 1 : 0,
        answeredCheckedAt,
      });
      if (!persisted) {
        // D1b/R09: evidence write failed or was rejected (0 rows) — reread the
        // store and return the CURRENT evidence (a concurrent positive) or
        // unknown. Never a replied the store does not back.
        return await this.resolveRejectedWrite(message);
      }
      return this.repliedFresh(
        "sent_search",
        sentResult.matchedMessageId,
        new Date(this.now())
      );
    }

    if (sentResult.kind === "ambiguous") {
      // Ambiguity is never a negative.
      return this.unknown("ambiguous_match");
    }

    if (sentResult.kind === "unavailable") {
      return this.unknown("sent_folder_unavailable");
    }

    if (sentResult.kind === "limit_exceeded") {
      return this.unknown("probe_limit_exceeded");
    }

    if (sentResult.kind === "probe_failed") {
      return this.unknown("probe_failed");
    }

    // No verified match. A complete negative requires ALL required sources to
    // have completed: flag side observed (not expunged/legacy) AND every Sent
    // folder searched without a `false`/throw (§7.1 step 6).
    if (!flagSideComplete || !sentResult.allFoldersComplete) {
      return this.unknown("probe_failed");
    }

    // N04: capture the actual mailbox observation time NOW (when mailbox reads
    // finished), not at the delayed write time. A later fence expiry must not
    // rewrite this timestamp with the late write time.
    const mailboxObservedAtMs = this.now();
    // N04: mailbox I/O finished — if the probe already lost the deadline race,
    // do not proceed to closing reads/persistence. The caller already received
    // probe_timeout; persisting now would create usable negative evidence from
    // an expired probe.
    if (signal?.aborted || deadline?.expired()) {
      return this.unknown("probe_timeout");
    }

    // Step 7 — before persisting a negative, confirm the account context is
    // unchanged since the probe began (§7.1 step 7). Reread BOTH the receive
    // config AND the sender identity (R10): the probe matched candidates
    // against `configuredSender`, so a mid-probe readIdentity().fromAddress
    // change invalidates the comparison even when the receive host/login are
    // untouched. A context change means the negative is not safely
    // attributable — the safe outcome is `identity_conflict` (review, not
    // negative).
    const [freshConfig, freshIdentity] = await Promise.all([
      this.emailServicePort.getEmailServiceReceiveConfig(
        normalizedConfig.emailServiceId
      ),
      this.emailServicePort.readIdentity(normalizedConfig.emailServiceId),
    ]);
    // N04: check cancellation/expiry AFTER every awaited closing step. The
    // closing config/identity read may resolve after the 15s deadline — the
    // caller already received probe_timeout and the queue released. Persisting
    // now would violate unknown/freshness semantics.
    if (signal?.aborted || deadline?.expired()) {
      return this.unknown("probe_timeout");
    }
    if (!freshConfig) {
      // Config vanished during I/O — the account was reconfigured or disabled.
      return this.unknown("identity_conflict");
    }
    if (!freshIdentity) {
      // Identity row vanished during I/O — the configured sender is no longer
      // resolvable, so the probe's sender matching cannot be trusted.
      return this.unknown("identity_conflict");
    }
    const freshNormalized = normalizeReceiveConnectionConfig(freshConfig);
    const probeEndContextHash = this.hashContext(
      freshNormalized,
      freshIdentity.fromAddress,
      sentResult.sentScope
    );
    // The probe-start hash used an empty sentScope (scope unknown until
    // discoverSentFolders resolved) and the ORIGINAL identity. Compare the
    // non-scope fields by recomputing the start hash with the SAME (now-
    // known) scope — isolating account/sender changes from scope changes.
    // `configuredSender` is the identity the probe actually matched against;
    // `freshIdentity.fromAddress` is what the account resolves to now.
    const probeStartRehashed = this.hashContext(
      normalizedConfig,
      configuredSender,
      sentResult.sentScope
    );
    if (probeStartRehashed !== probeEndContextHash) {
      // Account endpoint / protocol / username / configured sender changed
      // during the probe — the negative is not safely attributable.
      return this.unknown("identity_conflict");
    }

    // Persist the PRE-PROBE (empty-scope) context hash, not the probe-end
    // hash: `readCachedNegative` runs before any mailbox I/O and cannot know
    // the resolved Sent scope, so it recomputes this exact empty-scope hash
    // from config + identity and compares (D5). The mid-probe conflict check
    // above keeps its own scope-resolved comparison and is unaffected.
    // N04: final expiry fence immediately before the awaited write. A check
    // before an awaited write alone is insufficient if that write can complete
    // late — persistNegative rechecks ownership/expiry internally and the
    // write stamps mailboxObservedAtMs (actual observation time), not the
    // delayed write time.
    if (signal?.aborted || deadline?.expired()) {
      return this.unknown("probe_timeout");
    }
    const persisted = await this.persistNegative(
      message,
      preProbeContextHash,
      {
        isAnswered: isAnswered ? 1 : 0,
        answeredCheckedAt,
      },
      {
        observedAtMs: mailboxObservedAtMs,
        signal,
        isExpired: () => deadline?.expired() ?? false,
      }
    );
    // N04: the awaited write itself may have completed after expiry — if so,
    // treat as expired (no usable negative) even if the store write succeeded.
    // The write path already refuses late writes when it can; this covers a
    // write that slipped through before the timer fired.
    if (signal?.aborted || deadline?.expired()) {
      return this.unknown("probe_timeout");
    }
    if (!persisted) {
      // D1b/R09: the negative write failed OR was rejected by the sticky-
      // positive guard (0 rows — a concurrent positive landed first). Reread
      // the store: return the concurrent positive when one exists; otherwise
      // unknown(probe_failed). The rejected negative must NOT be reported or
      // cached — it would hide live positive evidence for a full TTL window
      // and the claim-side fence (D1a) would fail-close on the null
      // replyNegativeCheckAt anyway.
      return await this.resolveRejectedWrite(message);
    }

    const negative: ReplyDetectionNotReplied = {
      state: "not_replied",
      replied: false,
      source: "sent_search",
      matchedMessageId: null,
      reasonCode: "no_reply_observed",
      checkedAt: new Date(mailboxObservedAtMs).toISOString(),
      fromCache: false,
      coverage: "configured_imap",
    };
    return negative;
  }

  /**
   * Search resolved Sent folders for a verified direct reply (§7.1 step 6,
   * §7.2 matching rules). Bounds: ≤5 folders, ≤200 candidate fetches total.
   */
  private async searchSentForReply(
    message: EmailReceivedMessageEntity,
    config: EmailReceiveConnectionConfig,
    originalMessageId: string,
    configuredSender: string,
    signal?: AbortSignal
  ): Promise<
    | { kind: "replied"; matchedMessageId: string | null }
    | { kind: "ambiguous" }
    | { kind: "unavailable" }
    | { kind: "limit_exceeded" }
    | { kind: "probe_failed" }
    | { kind: "no_match"; allFoldersComplete: boolean; sentScope: string }
  > {
    let folders: SentFolder[];
    try {
      folders = await this.imapPort.discoverSentFolders(config, signal);
    } catch {
      // Auth/permission/connection failures during LIST must NOT collapse to
      // folder absence (§7.2) — propagate as probe_failed (unknown upstream).
      return { kind: "probe_failed" };
    }
    if (folders.length === 0) {
      return { kind: "unavailable" };
    }
    // R05: slicing to the folder bound leaves Sent folders unexamined — the
    // probe can never settle a complete negative in that case (the reply may
    // live in a dropped folder). A verified direct match found in the
    // searched scope still settles `replied`.
    const foldersTruncated = folders.length > MAX_SENT_FOLDERS;
    const boundedFolders = folders.slice(0, MAX_SENT_FOLDERS);
    const sentScope = boundedFolders
      .map((f) => f.folder)
      .sort()
      .join(",");

    const senderLower = configuredSender.toLowerCase();
    let allComplete = true;
    let ambiguity = false;
    let candidatesTruncated = false;
    let fetchesRemaining = MAX_CANDIDATE_FETCHES;

    for (const f of boundedFolders) {
      if (fetchesRemaining <= 0) {
        // Cap exhausted without a verified match (§7.3).
        return { kind: "limit_exceeded" };
      }
      let candidates: ReplyHeaderCandidate[];
      let folderTruncated = false;
      let failedFetchCount = 0;
      try {
        const result = await this.imapPort.searchReplyHeaders({
          config,
          folder: f.folder,
          originalMessageId,
          cap: fetchesRemaining,
          signal,
        });
        if (result === false) {
          // A failed/incomplete search does not collapse to no-matches (§7.2).
          allComplete = false;
          continue;
        }
        candidates = result.candidates;
        folderTruncated = result.truncated;
        failedFetchCount = result.failedFetchCount;
      } catch {
        allComplete = false;
        continue;
      }

      // R06: attempted-but-failed fetches (expunged/malformed mid-probe)
      // consumed a network round-trip. They count toward the shared budget
      // even though no candidate DTO was parsed — total attempted header
      // fetches can never silently exceed the cap — and they mark this
      // folder's coverage incomplete.
      fetchesRemaining -= failedFetchCount;
      if (failedFetchCount > 0) {
        allComplete = false;
      }
      // R05: the server returned more candidates than the remaining budget
      // allowed — at least one candidate was never examined.
      if (folderTruncated) {
        candidatesTruncated = true;
      }

      for (const c of candidates) {
        if (fetchesRemaining <= 0) {
          // Cap exhausted mid-batch without a verified match (§7.3). The
          // caller maps this to `probe_limit_exceeded` — a bounded probe
          // never silently scans an unbounded candidate set.
          return { kind: "limit_exceeded" };
        }
        fetchesRemaining -= 1;
        const match = classifyCandidate(c, originalMessageId, senderLower);
        if (match.kind === "direct") {
          // Verified direct match takes precedence over any ambiguity,
          // truncation, or incompleteness (§7.2) — a settled positive is
          // valid within the searched scope.
          return { kind: "replied", matchedMessageId: match.matchedMessageId };
        }
        if (match.kind === "ambiguous") {
          ambiguity = true;
        }
        // `no_match` candidates (substring false positives with no header
        // token at all) are skipped silently — they neither settle a reply
        // nor inflate the ambiguity signal (§7.2).
      }
    }

    // R05: unexamined folders or candidates mean the probe cannot settle a
    // complete negative — the unexamined set may contain the verified direct
    // reply. Bounds-exhaustion precedes ambiguity (§7.3): an ambiguous
    // candidate is unknown either way, and the truncation code is the more
    // actionable signal for operators.
    if (foldersTruncated || candidatesTruncated) {
      return { kind: "limit_exceeded" };
    }
    if (ambiguity) return { kind: "ambiguous" };
    return { kind: "no_match", allFoldersComplete: allComplete, sentScope };
  }

  // -------------------------------------------------------------------------
  // Cache + persistence helpers.
  // -------------------------------------------------------------------------

  /**
   * Step 3 — read a reusable cached negative (age 0–60s + matching context
   * hash). D5: the stored hash is recomputed from the CURRENT account context
   * (config + configured sender, empty pre-probe Sent scope) and compared —
   * presence-only checking served a stale negative for up to 60s after an
   * account reconfiguration. A mismatch falls through to a fresh probe under
   * the new context, which persists a new hash (the write is the cleanup).
   */
  private readCachedNegative(
    message: EmailReceivedMessageEntity,
    normalizedConfig: EmailReceiveConnectionConfig,
    configuredSender: string | null
  ): ReplyDetectionNotReplied | null {
    if (!message.replyNegativeCheckAt || !message.replyNegativeContextHash) {
      return null;
    }
    // Future timestamps are invalid (clock skew) — never reuse.
    const observedAt = message.replyNegativeCheckAt.getTime();
    const ageMs = this.now() - observedAt;
    if (ageMs < 0 || ageMs > NEGATIVE_CACHE_TTL_MS) return null;

    // Recompute the pre-probe context hash under the CURRENT config +
    // identity. `persistNegative` stores this same empty-scope pre-probe
    // hash, so the comparison is exact. Without an identity the context is
    // unresolvable — never reuse the cached negative on an incomplete read.
    if (!configuredSender) {
      incrementReplyMetric("detection_cache", {
        hit: false,
        context_mismatch: true,
      });
      return null;
    }
    const currentHash = this.hashContext(
      normalizedConfig,
      configuredSender,
      "" // pre-probe: Sent scope unknown — same scope persisted
    );
    if (currentHash !== message.replyNegativeContextHash) {
      // Account reconfigured (endpoint/username/sender) or the detector
      // version changed since the observation — the negative is not
      // attributable to the current context. Do NOT serve it.
      incrementReplyMetric("detection_cache", {
        hit: false,
        context_mismatch: true,
      });
      return null;
    }

    const negative: ReplyDetectionNotReplied = {
      state: "not_replied",
      replied: false,
      source: "sent_search",
      matchedMessageId: null,
      reasonCode: "no_reply_observed",
      checkedAt: message.replyNegativeCheckAt.toISOString(),
      fromCache: true,
      coverage: "configured_imap",
    };
    return negative;
  }

  /**
   * Persist a positive observation. Returns true on success, false on failure.
   *
   * D1b (adversarial finding #2): a verified-positive observation whose
   * persistence threw MUST NOT produce a `replied` result that lacks persisted
   * evidence. The claim-side freshness fence reads `replyDetectedAt`; if the
   * persist failed, that column is null, the fence fail-closes (D1a), and the
   * send is refused — but the probe must also surface `unknown(probe_failed)`
   * so the upstream pre-send gate refuses before the claim even opens. A
   * swallowed persist error that returns `replied` defeats the no-duplicate-
   * reply guarantee (the upstream gate trusts the probe's state).
   *
   * R09: the conditional write's boolean is honored, not just its throw path.
   * The positive UPDATE is `COALESCE(replyDetectedAt, :detectedAt)` guarded by
   * `id = :id` — 0 affected rows means the row was deleted (or otherwise
   * vanished) mid-probe; the caller then rereads and surfaces unknown.
   */
  private async persistPositive(
    message: EmailReceivedMessageEntity,
    evidence: {
      source: "mailbox_flag" | "sent_search";
      matchedMessageId: string | null;
      isAnswered: number;
      answeredCheckedAt: Date | null;
    }
  ): Promise<boolean> {
    try {
      const written = await this.messagePort.updateReplyEvidence({
        id: message.id,
        replyDetectedAt: new Date(this.now()),
        replyDetectionSource: evidence.source,
        replyMatchedMessageId: evidence.matchedMessageId,
        isAnswered: evidence.isAnswered,
        answeredFlagCheckedAt: evidence.answeredCheckedAt,
      });
      if (!written) {
        // R09: 0 rows affected — the guarded positive write was rejected (the
        // row is gone). Report failure so the caller rereads the store and
        // returns the truthful outcome; a silently-successful return here
        // would claim replied with zero persisted evidence.
        incrementReplyMetric("detection_persist_failure", {
          kind: "positive",
          rejected: true,
        });
        return false;
      }
      return true;
    } catch (error) {
      // Persistence failure does not downgrade a verified-positive observation
      // (§5.1: a sticky positive protects the next probe), but it DOES surface
      // as unknown(probe_failed) so the upstream send gate refuses — a `replied`
      // result here would skip the pre-send probe (§8.1/§9.2) entirely.
      incrementReplyMetric("detection_persist_failure", {
        kind: "positive",
      });
      console.error(
        `[EmailReplyDetection] persistPositive failed for message ${message.id}:`,
        error
      );
      return false;
    }
  }

  /**
   * Persist a negative observation. Returns true on success, false on failure.
   *
   * D1b: a decisive `not_replied` returned while the evidence write silently
   * failed leaves `replyNegativeCheckAt` null — the claim-side fence (D1a)
   * fail-closes, but the probe must NOT report `not_replied` (the upstream
   * pre-send gate trusts the probe's state and would let the send proceed to
   * the claim, where the fence then triggers the delayed-refresh path). Surface
   * `unknown(probe_failed)` instead so the gate refuses before the claim.
   *
   * R09: the conditional write's boolean is honored, not just its throw path.
   * The negative UPDATE is guarded by `id = :id AND replyDetectedAt IS NULL`;
   * 0 affected rows means another request persisted positive evidence between
   * the probe and this write (the sticky-positive fence rejected the negative).
   * The caller must NOT report or cache `not_replied` — it rereads the row and
   * returns the CURRENT evidence (the concurrent positive) or unknown.
   */
  private async persistNegative(
    message: EmailReceivedMessageEntity,
    contextHash: string,
    flags: { isAnswered: number; answeredCheckedAt: Date | null },
    fence?: {
      observedAtMs: number;
      signal?: AbortSignal;
      isExpired?: () => boolean;
    }
  ): Promise<boolean> {
    // N04: expiry fence before the awaited write. An abandoned timed-out probe
    // must never persist fresh negative evidence — the caller already received
    // probe_timeout and the queue released.
    if (fence?.signal?.aborted || fence?.isExpired?.()) {
      return false;
    }
    // F03: the observation instant this write carries (also the exact key
    // the expiry-void matches on — the same Date value must flow to both the
    // write and a later void so only this observation is ever removed).
    const observedAt = new Date(fence?.observedAtMs ?? this.now());
    try {
      const written = await this.messagePort.updateReplyEvidence({
        id: message.id,
        // N04: stamp the actual mailbox observation time, not the delayed
        // write time. A late write must not manufacture fresh evidence.
        replyNegativeCheckAt: observedAt,
        replyNegativeContextHash: contextHash,
        isAnswered: flags.isAnswered,
        answeredFlagCheckedAt: flags.answeredCheckedAt,
      });
      // F03/N04: the awaited write itself may have completed after expiry — a
      // write finishing past the deadline inside the 60s TTL would otherwise
      // leave a reusable negative for a later invocation to trust. Void
      // exactly this observation (conditional timestamp match: a newer
      // probe's negative or a sticky positive is untouched) and report
      // failure so the caller returns unknown instead of a decisive
      // negative from an expired probe.
      if (fence?.signal?.aborted || fence?.isExpired?.()) {
        try {
          await this.messagePort.voidExpiredNegativeWrite({
            id: message.id,
            observedAt,
          });
        } catch (voidError) {
          incrementReplyMetric("detection_persist_failure", {
            kind: "negative_void",
          });
          console.error(
            `[EmailReplyDetection] voidExpiredNegativeWrite failed for message ${message.id}:`,
            voidError
          );
        }
        return false;
      }
      if (!written) {
        // R09: 0 rows affected — the sticky-positive guard rejected the
        // negative (a concurrent positive landed first) or the row vanished.
        // Report failure so the caller rereads; caching/reporting the rejected
        // negative would hide live positive evidence for a full TTL window.
        incrementReplyMetric("detection_persist_failure", {
          kind: "negative",
          rejected: true,
        });
        return false;
      }
      return true;
    } catch (error) {
      incrementReplyMetric("detection_persist_failure", {
        kind: "negative",
      });
      console.error(
        `[EmailReplyDetection] persistNegative failed for message ${message.id}:`,
        error
      );
      return false;
    }
  }

  /**
   * R09 — resolve the outcome after a REJECTED (0-row) evidence write: reread
   * the row and return its CURRENT evidence. A concurrent positive wins
   * (return replied from the persisted sticky positive); a deleted or
   * unreadable row means no evidence exists — return unknown(probe_failed),
   * never a decisive state the store does not back.
   */
  private async resolveRejectedWrite(
    message: EmailReceivedMessageEntity
  ): Promise<ReplyDetectionResult> {
    const current = await this.messagePort.read(message.id);
    if (
      current &&
      current.replyDetectedAt &&
      (current.replyDetectionSource === "mailbox_flag" ||
        current.replyDetectionSource === "sent_search")
    ) {
      // A concurrent writer persisted positive evidence — it is authoritative
      // (§5.1 sticky positive). Return it fresh (fromCache: false — it was
      // just reread from the store, not served from a cache).
      return this.repliedFresh(
        current.replyDetectionSource,
        current.replyMatchedMessageId ?? null,
        current.replyDetectedAt
      );
    }
    // Row gone / no positive evidence — the truthful outcome is unknown; the
    // next probe re-runs from scratch.
    return this.unknown("probe_failed");
  }

  /**
   * Pure (no I/O) computation of the §7.3 context hash: sha256 over account
   * endpoint + protocol + username + sent scope + configured sender + detector
   * version. Passwords are never part of the hash. Called twice in
   * {@link probeMailbox} — once before any I/O (with the scope known so far)
   * and once after — to detect account reconfiguration during the probe
   * (§7.1 step 7).
   */
  private hashContext(
    config: EmailReceiveConnectionConfig,
    configuredSender: string,
    sentScope: string
  ): string {
    const endpoint = `${config.host}:${config.port}`;
    const material = [
      endpoint,
      config.protocol,
      config.username,
      sentScope,
      configuredSender.toLowerCase(),
      REPLY_DETECTOR_VERSION,
    ].join("|");
    return sha256Hex(material);
  }

  // -------------------------------------------------------------------------
  // Result constructors.
  // -------------------------------------------------------------------------

  private repliedFromCache(
    source: "mailbox_flag" | "sent_search",
    matchedMessageId: string | null
  ): ReplyDetectionReplied {
    return {
      state: "replied",
      replied: true,
      source,
      matchedMessageId,
      reasonCode: "already_replied",
      checkedAt: null,
      fromCache: true,
      coverage: "configured_imap",
    };
  }

  /**
   * Serve a complete negative from the in-memory cache. `checkedAt` retains
   * the ORIGINAL observation time (§4.2: "a cached result retains its
   * ORIGINAL observation time, not the cache-return time"); `fromCache: true`
   * marks it as a cache hit (the probe path sets fromCache: false).
   */
  private notRepliedFromCache(checkedAt: string | null): ReplyDetectionNotReplied {
    return {
      state: "not_replied",
      replied: false,
      source: "sent_search",
      matchedMessageId: null,
      reasonCode: "no_reply_observed",
      checkedAt,
      fromCache: true,
      coverage: "configured_imap",
    };
  }

  private repliedFresh(
    source: "mailbox_flag" | "sent_search",
    matchedMessageId: string | null,
    checkedAt: Date
  ): ReplyDetectionReplied {
    return {
      state: "replied",
      replied: true,
      source,
      matchedMessageId,
      reasonCode: "already_replied",
      checkedAt: checkedAt.toISOString(),
      fromCache: false,
      coverage: "configured_imap",
    };
  }

  private unknown(
    code: ReplyDetectionUnknown["reasonCode"]
  ): ReplyDetectionUnknown {
    return {
      state: "unknown",
      replied: null,
      source: "unavailable",
      matchedMessageId: null,
      reasonCode: code,
      checkedAt: new Date(this.now()).toISOString(),
      fromCache: false,
      coverage: "partial",
    };
  }

  /** Local-first unknown (no mailbox round trip; coverage local_only). */
  private unknownLocal(
    code: ReplyDetectionUnknown["reasonCode"]
  ): ReplyDetectionUnknown {
    return {
      state: "unknown",
      replied: null,
      source: "local_state",
      matchedMessageId: null,
      reasonCode: code,
      checkedAt: null,
      fromCache: false,
      coverage: "local_only",
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

/**
 * Classify one Sent-folder candidate against the original message id and the
 * configured sending identity (§7.2 matching rules).
 *
 * - Direct reply: `In-Reply-To` contains the exact original token AND the
 *   parsed sender matches the configured sending identity.
 * - References-only (token appears in References but not In-Reply-To): the
 *   candidate is an `ambiguous_match` in V1 — it may be an ancestor, not a
 *   direct reply.
 * - Unrecognized sender/alias: `ambiguous_match`.
 * - The outgoing message's own missing Message-ID does not negate a verified
 *   parent match; report null matched ID (§7.2).
 */
function classifyCandidate(
  candidate: ReplyHeaderCandidate,
  originalMessageId: string,
  configuredSenderLower: string
): CandidateMatch {
  const inReplyToTokens = parseReferenceChain(candidate.inReplyTo);
  const referencesTokens = parseReferenceChain(candidate.references);
  const hasDirectParent = inReplyToTokens.some((t) =>
    normalizedIdsMatch(t, originalMessageId)
  );
  const hasAncestorReference = referencesTokens.some((t) =>
    normalizedIdsMatch(t, originalMessageId)
  );

  const senderMatches = candidateSenderMatches(
    candidate.from,
    configuredSenderLower
  );

  if (hasDirectParent && senderMatches) {
    // Verified direct reply. The candidate's own Message-ID may be missing
    // (§7.2) — that does not weaken the match.
    const matchedMessageId = normalizeMessageId(candidate.messageId);
    return { kind: "direct", matchedMessageId };
  }

  if (hasDirectParent || hasAncestorReference) {
    // Parent token present but sender unrecognized → ambiguous. OR
    // References-only (no In-Reply-To match) → ambiguous in V1.
    return { kind: "ambiguous" };
  }

  // No header token matches the original at all — the IMAP substring search
  // surfaced an unrelated candidate. Skip it (§7.2): a non-match must not
  // inflate the ambiguity signal, nor count toward the candidate fetch cap
  // beyond what was already fetched.
  return { kind: "no_match" };
}

/**
 * Parse a candidate From header and compare its address (case-insensitively)
 * to the configured sending identity. Returns false when the From header is
 * missing/malformed or the address differs (an alias the user did not
 * configure counts as ambiguous, not direct — §7.2).
 */
function candidateSenderMatches(
  rawFrom: string | null,
  configuredSenderLower: string
): boolean {
  if (!rawFrom) return false;
  const address = extractAddress(rawFrom);
  if (!address) return false;
  return address.toLowerCase() === configuredSenderLower;
}

/** Extract the first `<address@domain>` or bare `address@domain` from a From header. */
function extractAddress(value: string): string | null {
  const tokenMatch = value.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  if (tokenMatch) return tokenMatch[1];
  const bareMatch = value.match(/([^\s<>]+@[^\s<>]+)/);
  return bareMatch ? bareMatch[1] : null;
}

/** Upper bound for sanitized error text persisted to audit/metadata (FR-039). */
const MAX_DETECTION_ERROR_CHARS = 240;

/** Reduce an unknown error to a short, safe string (no stack traces leaked). */
export function sanitizeDetectionError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message || error.name;
    return msg.length > MAX_DETECTION_ERROR_CHARS
      ? msg.slice(0, MAX_DETECTION_ERROR_CHARS) + "…"
      : msg;
  }
  return String(error).slice(0, MAX_DETECTION_ERROR_CHARS);
}

/** sha256 hex digest (passwords/secrets never enter this hash — §7.3). */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Default production ports. Constructed lazily at service-construction time
// (runtime), never at module-eval time — avoids the BaseModule TDZ landmine
// under vi.mock. Each wraps the real Module/Client, which structurally
// satisfies its port interface.
// ---------------------------------------------------------------------------

class DefaultMessagePort implements ReplyDetectionMessagePort {
  private readonly module = new EmailReceivedMessageModule();
  read(id: number): Promise<EmailReceivedMessageEntity | null> {
    return this.module.read(id);
  }
  findCanonicalEquivalents(
    seed: EmailReceivedMessageEntity
  ): Promise<EmailReceivedMessageEntity[]> {
    return this.module.findCanonicalEquivalents(seed);
  }
  updateReplyEvidence(input: {
    id: number;
    replyDetectedAt?: Date | null;
    replyDetectionSource?: string | null;
    replyMatchedMessageId?: string | null;
    replyNegativeCheckAt?: Date | null;
    replyNegativeContextHash?: string | null;
    isAnswered?: number;
    answeredFlagCheckedAt?: Date | null;
  }): Promise<boolean> {
    return this.module.updateReplyEvidence(input);
  }
  voidExpiredNegativeWrite(input: {
    id: number;
    observedAt: Date;
  }): Promise<boolean> {
    return this.module.voidExpiredNegativeWrite(input);
  }
}

class DefaultDraftPort implements ReplyDetectionDraftPort {
  private readonly module = new EmailReplyDraftModule();
  listByMessages(messageIds: number[]): Promise<EmailReplyDraftEntity[]> {
    return this.module.listByMessageIds(messageIds);
  }
}

class DefaultAttemptPort implements ReplyDetectionAttemptPort {
  private readonly module = new EmailReplySendAttemptModule();
  listByMessages(messageIds: number[]): Promise<EmailReplySendAttemptEntity[]> {
    return this.module.listByMessageIds(messageIds);
  }
}

class DefaultEmailServicePort implements ReplyDetectionEmailServicePort {
  private readonly module = new EmailServiceModule();
  getEmailServiceReceiveConfig(
    id: number
  ): Promise<EmailReceiveConnectionConfig | null> {
    return this.module.getEmailServiceReceiveConfig(id);
  }
  readIdentity(id: number): Promise<{
    smtpUsername: string;
    fromAddress: string;
    replyToAddress: string | null;
    receiveUsername: string;
  } | null> {
    return this.module.readIdentity(id);
  }
}

class DefaultImapPort implements ReplyDetectionImapPort {
  private readonly client = new ImapEmailReceiveClient();
  refreshMessageFlags(input: {
    config: EmailReceiveConnectionConfig;
    folder: string;
    uidValidity: string;
    uid: string;
    signal?: AbortSignal;
  }): Promise<RefreshedFlags | null> {
    return this.client.refreshMessageFlags(input);
  }
  discoverSentFolders(
    config: EmailReceiveConnectionConfig,
    signal?: AbortSignal
  ): Promise<SentFolder[]> {
    return this.client.discoverSentFolders(config, signal);
  }
  searchReplyHeaders(input: {
    config: EmailReceiveConnectionConfig;
    folder: string;
    originalMessageId: string;
    cap: number;
    signal?: AbortSignal;
  }): Promise<ReplyHeaderSearchResult | false> {
    return this.client.searchReplyHeaders(input);
  }
}

// ---------------------------------------------------------------------------
// Process-wide shared singleton (D6). The in-memory cache, single-flight,
// and per-mailbox probe lock are INSTANCE state. The three production call
// sites (generation §8.1, delivery §9.2, detection module) previously each
// constructed a fresh service per outer-service instance, and the outer
// services are constructed per request — so the cache layer could never hit
// across requests. ONE memoized instance shares that state process-wide.
//
// Construction stays lazy (this getter is called at runtime, never at module
// eval time) to avoid the BaseModule TDZ landmine under `vi.mock` of
// `BaseDb`/`Token`: the Default*Port classes construct their Modules inside
// the constructor body, which runs the first time this getter is invoked —
// not when the module is imported. Injected test seams (`detectionServiceFactory`
// in delivery/generation, `{service}` in the Module constructor) keep
// precedence so existing detection-exercising tests are not polluted by this
// singleton. `resetSharedEmailReplyDetectionService` exists ONLY as a test
// hook to drop the memo between isolated suites; production never calls it.
// ---------------------------------------------------------------------------

let sharedEmailReplyDetectionService: EmailReplyDetectionService | null = null;

/**
 * Resolve the process-wide shared {@link EmailReplyDetectionService} (D6).
 * Memoized on first call. Production fallbacks in delivery, generation, and
 * the detection Module route through this getter instead of `new`-ing a
 * per-request service, so the in-memory cache/single-flight/mailbox-lock
 * state survives across requests.
 */
export function getSharedEmailReplyDetectionService(): EmailReplyDetectionService {
  if (!sharedEmailReplyDetectionService) {
    sharedEmailReplyDetectionService = new EmailReplyDetectionService();
  }
  return sharedEmailReplyDetectionService;
}

/**
 * Test-only hook (D6): drop the memoized shared instance, optionally seeding a
 * replacement (e.g. a fake-ports service). Production code MUST NOT call this
 * — the shared singleton is meant to live for the process lifetime. Tests use
 * it to keep the singleton's instance state from leaking across suites.
 */
export function resetSharedEmailReplyDetectionService(
  next?: EmailReplyDetectionService | null
): void {
  sharedEmailReplyDetectionService = next ?? null;
}
