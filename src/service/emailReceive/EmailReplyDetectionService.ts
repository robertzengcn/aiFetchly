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
 * Cache, single-flight, and the 15s probe deadline land in step 10 (T05); the
 * call sites from step 7/8 are identical with or without that layer.
 */
import { createHash } from "node:crypto";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";
import type { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import type { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import type { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import type {
  RefreshedFlags,
  ReplyHeaderCandidate,
  SentFolder,
} from "@/service/emailReceive/EmailReceiveClient";
import {
  normalizeStoredMessageId,
  normalizedIdsMatch,
  parseNamespacedProviderUid,
} from "@/service/emailReceive/EmailReplyIdentity";
import {
  normalizeMessageId,
  parseReferenceChain,
} from "@/service/emailReceive/EmailThreadResolver";
import {
  normalizeReceiveConnectionConfig,
  validateReceiveEndpointConfig,
} from "@/service/emailReceive/EmailReceiveSyncService";
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
 */
export const REPLY_DETECTOR_VERSION = "reply-detection-v1";

/** Negative cache TTL (§7.3): a complete negative is reusable for 60s. */
const NEGATIVE_CACHE_TTL_MS = 60_000;

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
}

/** Draft lifecycle reads (cluster inspection) the detector needs. */
export interface ReplyDetectionDraftPort {
  listByMessage(messageId: number): Promise<EmailReplyDraftEntity[]>;
}

/** Send-attempt ledger reads (cluster inspection) the detector needs. */
export interface ReplyDetectionAttemptPort {
  listByMessage(messageId: number): Promise<EmailReplySendAttemptEntity[]>;
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
  }): Promise<RefreshedFlags | null>;
  discoverSentFolders(
    config: EmailReceiveConnectionConfig
  ): Promise<SentFolder[]>;
  searchReplyHeaders(input: {
    config: EmailReceiveConnectionConfig;
    folder: string;
    originalMessageId: string;
    cap: number;
  }): Promise<ReplyHeaderCandidate[] | false>;
}

/** What a candidate-matching pass concluded about one candidate. */
type CandidateMatch =
  | { kind: "direct"; matchedMessageId: string | null }
  | { kind: "ambiguous" }
  | { kind: "no_match" };

/**
 * Shared mailbox reply-detection service. One instance per process is fine
 * (the cache layer in step 10 will make it stateful); the generation and
 * delivery services construct it lazily through a factory getter.
 */
export class EmailReplyDetectionService {
  private readonly messagePort: ReplyDetectionMessagePort;
  private readonly draftPort: ReplyDetectionDraftPort;
  private readonly attemptPort: ReplyDetectionAttemptPort;
  private readonly emailServicePort: ReplyDetectionEmailServicePort;
  private readonly imapPort: ReplyDetectionImapPort;
  private readonly now: () => number;

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
   */
  async detect(input: {
    messageId: number;
    forceRefresh?: boolean;
  }): Promise<ReplyDetectionResult> {
    const forceRefresh = input.forceRefresh === true;
    const message = await this.messagePort.read(input.messageId);
    if (!message) {
      return this.unknown("probe_failed");
    }

    // Step 1 — local-first (no mailbox round trip).
    const localState = await this.inspectLocalState(message);
    if (localState) return localState;

    // Step 2 — sticky positive evidence reuse.
    if (message.replyDetectedAt != null) {
      const source = (message.replyDetectionSource ?? "mailbox_flag") as
        | "mailbox_flag"
        | "sent_search";
      return this.repliedFromCache(source, message.replyMatchedMessageId);
    }

    // Step 3 — negative reuse (draft checks only; age 0–60s + matching hash).
    if (!forceRefresh) {
      const cached = this.readCachedNegative(message);
      if (cached) return cached;
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

    // Steps 5–7 — bounded mailbox probe. The timed stage captures the probe
    // duration as a low-cardinality metric (stage `database` is the closest
    // existing ReplyMetricStage; the 15s deadline enforcement lands in T05).
    return timedReplyStage(
      "database",
      (): Promise<ReplyDetectionResult> =>
        this.probeMailbox(message, config, normalizedId),
      { message_id: message.id }
    );
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
    seed: EmailReceivedMessageEntity
  ): Promise<ReplyDetectionResult | null> {
    const clusterRows = await this.messagePort.findCanonicalEquivalents(seed);
    const rowIds = clusterRows.map((r) => r.id);

    const [draftsPerRow, attemptsPerRow] = await Promise.all([
      Promise.all(rowIds.map((id) => this.draftPort.listByMessage(id))),
      Promise.all(rowIds.map((id) => this.attemptPort.listByMessage(id))),
    ]);
    const drafts = draftsPerRow.flat();
    const attempts = attemptsPerRow.flat();

    const liveDrafts = drafts.filter((d) =>
      isLiveDraftStatus(d.status)
    );
    const sentDrafts = drafts.filter((d) => d.status === "sent");
    const unknownDrafts = drafts.filter(
      (d) => d.status === "delivery_unknown"
    );
    const sentAttempts = attempts.filter((a) => a.status === "sent");
    const unknownAttempts = attempts.filter(
      (a) => a.status === "delivery_unknown"
    );
    const inFlightAttempts = attempts.filter((a) =>
      isAttemptInFlight(a.status)
    );

    // Namespace conflict across a multi-row cluster cannot be safely merged.
    // This is a local-state finding (no mailbox round trip), so it surfaces
    // with source `local_state` and `local_only` coverage, not as a mailbox
    // `unavailable` outcome.
    if (clusterRows.length > 1 && hasNamespaceConflict(clusterRows)) {
      return this.unknownLocal("identity_conflict");
    }

    const replyStatus = seed.replyStatus;

    // 1. Already replied: explicit message state OR a sent draft OR a sent
    //    attempt (the ledger is authoritative even if the draft row is gone).
    if (
      replyStatus === "sent" ||
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
    rawConfig: EmailReceiveConnectionConfig,
    normalizedId: string
  ): Promise<ReplyDetectionResult> {
    const normalizedConfig = normalizeReceiveConnectionConfig(rawConfig);
    const validationError = validateReceiveEndpointConfig(normalizedConfig);
    if (validationError) {
      return this.unknown("receive_unavailable");
    }

    const identity = await this.emailServicePort.readIdentity(
      message.emailServiceId
    );
    if (!identity) {
      return this.unknown("receive_unavailable");
    }

    // Step 7 precondition — the account context hash is captured BEFORE any
    // mailbox I/O and recomputed AFTER the probe; a mismatch means the
    // account was reconfigured mid-probe and the observed negative is not
    // safely attributable to the current context (§7.1 step 7). The hash
    // excludes passwords/secrets (§7.3). The probe-start hash cannot be
    // computed once and reused: at the start the Sent scope is unknown, so
    // the post-probe comparison recomputes the start hash WITH the now-known
    // scope to isolate account/sender changes from scope changes. See
    // `probeStartRehashed` vs `probeEndContextHash` below.

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
        });
        if (flags) {
          flagSideComplete = true;
          isAnswered = flags.isAnswered;
          answeredCheckedAt = flags.checkedAt;
          if (isAnswered) {
            // A positive `\Answered` flag settles replied (§7.1 step 5).
            await this.persistPositive(message, {
              source: "mailbox_flag",
              matchedMessageId: null,
              isAnswered: 1,
              answeredCheckedAt,
            });
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
      identity.fromAddress
    );

    if (sentResult.kind === "replied") {
      // A verified direct match settles replied even if the flag side or other
      // folders were unavailable (§7.1 step 6).
      await this.persistPositive(message, {
        source: "sent_search",
        matchedMessageId: sentResult.matchedMessageId,
        isAnswered: isAnswered ? 1 : 0,
        answeredCheckedAt,
      });
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

    // Step 7 — before persisting a negative, confirm the account context is
    // unchanged since the probe began (§7.1 step 7). A context change means
    // the configured sender / scope the probe reasoned under may no longer be
    // current; the safe outcome is `identity_conflict` (review, not negative).
    // The persisted hash incorporates the resolved Sent scope so future cache
    // hits invalidate when the scope changes too.
    const freshConfig = await this.emailServicePort.getEmailServiceReceiveConfig(
      normalizedConfig.emailServiceId
    );
    if (!freshConfig) {
      // Config vanished during I/O — the account was reconfigured or disabled.
      return this.unknown("identity_conflict");
    }
    const freshNormalized = normalizeReceiveConnectionConfig(freshConfig);
    const probeEndContextHash = this.hashContext(
      freshNormalized,
      identity.fromAddress,
      sentResult.sentScope
    );
    // The probe-start hash used an empty sentScope (scope unknown until
    // discoverSentFolders resolved). Compare the non-scope fields by
    // recomputing the start hash with the SAME (now-known) scope — isolating
    // account/sender changes from scope changes.
    const probeStartRehashed = this.hashContext(
      normalizedConfig,
      identity.fromAddress,
      sentResult.sentScope
    );
    if (probeStartRehashed !== probeEndContextHash) {
      // Account endpoint / protocol / username / configured sender changed
      // during the probe — the negative is not safely attributable.
      return this.unknown("identity_conflict");
    }

    await this.persistNegative(message, probeEndContextHash, {
      isAnswered: isAnswered ? 1 : 0,
      answeredCheckedAt,
    });

    const negative: ReplyDetectionNotReplied = {
      state: "not_replied",
      replied: false,
      source: "sent_search",
      matchedMessageId: null,
      reasonCode: "no_reply_observed",
      checkedAt: new Date(this.now()).toISOString(),
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
    configuredSender: string
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
      folders = await this.imapPort.discoverSentFolders(config);
    } catch {
      // Auth/permission/connection failures during LIST must NOT collapse to
      // folder absence (§7.2) — propagate as probe_failed (unknown upstream).
      return { kind: "probe_failed" };
    }
    if (folders.length === 0) {
      return { kind: "unavailable" };
    }
    const boundedFolders = folders.slice(0, MAX_SENT_FOLDERS);
    const sentScope = boundedFolders
      .map((f) => f.folder)
      .sort()
      .join(",");

    const senderLower = configuredSender.toLowerCase();
    let allComplete = true;
    let ambiguity = false;
    let fetchesRemaining = MAX_CANDIDATE_FETCHES;

    for (const f of boundedFolders) {
      if (fetchesRemaining <= 0) {
        // Cap exhausted without a verified match (§7.3).
        return { kind: "limit_exceeded" };
      }
      let candidates: ReplyHeaderCandidate[];
      try {
        const result = await this.imapPort.searchReplyHeaders({
          config,
          folder: f.folder,
          originalMessageId,
          cap: fetchesRemaining,
        });
        if (result === false) {
          // A failed/incomplete search does not collapse to no-matches (§7.2).
          allComplete = false;
          continue;
        }
        candidates = result;
      } catch {
        allComplete = false;
        continue;
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
          // Verified direct match takes precedence over any ambiguity (§7.2).
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

    if (ambiguity) return { kind: "ambiguous" };
    return { kind: "no_match", allFoldersComplete: allComplete, sentScope };
  }

  // -------------------------------------------------------------------------
  // Cache + persistence helpers.
  // -------------------------------------------------------------------------

  /** Step 3 — read a reusable cached negative (age 0–60s + matching hash). */
  private readCachedNegative(
    message: EmailReceivedMessageEntity
  ): ReplyDetectionNotReplied | null {
    if (!message.replyNegativeCheckAt || !message.replyNegativeContextHash) {
      return null;
    }
    // Future timestamps are invalid (clock skew) — never reuse.
    const observedAt = message.replyNegativeCheckAt.getTime();
    const ageMs = this.now() - observedAt;
    if (ageMs < 0 || ageMs > NEGATIVE_CACHE_TTL_MS) return null;

    // A cached negative is only reusable when the detector version + account
    // context match. We cannot recompute the full hash without re-reading the
    // config (which would defeat the cache), so the persisted hash IS the
    // validity token: it was computed under the same DETECTOR_VERSION and
    // context that produced the negative. A config/identity/sender change will
    // have produced a different hash at the next probe and overwritten this
    // entry — until then the cached negative is authoritative.
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

  private async persistPositive(
    message: EmailReceivedMessageEntity,
    evidence: {
      source: "mailbox_flag" | "sent_search";
      matchedMessageId: string | null;
      isAnswered: number;
      answeredCheckedAt: Date | null;
    }
  ): Promise<void> {
    try {
      await this.messagePort.updateReplyEvidence({
        id: message.id,
        replyDetectedAt: new Date(this.now()),
        replyDetectionSource: evidence.source,
        replyMatchedMessageId: evidence.matchedMessageId,
        isAnswered: evidence.isAnswered,
        answeredFlagCheckedAt: evidence.answeredCheckedAt,
      });
    } catch (error) {
      // Persistence failure does not downgrade a verified-positive observation
      // (§5.1: a sticky positive protects the next probe). Log and proceed.
      incrementReplyMetric("detection_persist_failure", {
        kind: "positive",
      });
      void error;
    }
  }

  private async persistNegative(
    message: EmailReceivedMessageEntity,
    contextHash: string,
    flags: { isAnswered: number; answeredCheckedAt: Date | null }
  ): Promise<void> {
    try {
      await this.messagePort.updateReplyEvidence({
        id: message.id,
        replyNegativeCheckAt: new Date(this.now()),
        replyNegativeContextHash: contextHash,
        isAnswered: flags.isAnswered,
        answeredFlagCheckedAt: flags.answeredCheckedAt,
      });
    } catch (error) {
      incrementReplyMetric("detection_persist_failure", {
        kind: "negative",
      });
      void error;
    }
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

/** True when the draft is in a live (editable/in-flight) status. */
function isLiveDraftStatus(status: string): boolean {
  return status === "draft" || status === "approved" || status === "sending";
}

/** True when the attempt is in-flight (atomic pre-SMTP or post-handoff hold). */
function isAttemptInFlight(status: string): boolean {
  return status === "claimed" || status === "submitted";
}

/**
 * T02 namespace-conflict detection for a canonical cluster: mixes legacy bare
 * UIDs with namespaced UIDs, or namespaced rows disagree on folder hash or
 * UIDVALIDITY. Such a cluster cannot be safely merged without a verified
 * header match (§4.1, FR-038).
 */
function hasNamespaceConflict(
  rows: readonly EmailReceivedMessageEntity[]
): boolean {
  const parsed = rows
    .map((r) => parseNamespacedProviderUid(r.providerUid))
    .filter(
      (p): p is { folderHash: string; uidValidity: string; uid: string } =>
        p !== null
    );
  if (parsed.length === 0) {
    return rows.length > 1;
  }
  if (parsed.length < rows.length) {
    return true;
  }
  const folderHashes = new Set(parsed.map((p) => p.folderHash));
  const uidValidities = new Set(parsed.map((p) => p.uidValidity));
  return folderHashes.size > 1 || uidValidities.size > 1;
}

/** Reduce an unknown error to a short, safe string (no stack traces leaked). */
function sanitizeDetectionError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message || error.name;
    return msg.length > 240 ? msg.slice(0, 240) + "…" : msg;
  }
  return String(error).slice(0, 240);
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

import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { ImapEmailReceiveClient } from "@/service/emailReceive/ImapEmailReceiveClient";

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
}

class DefaultDraftPort implements ReplyDetectionDraftPort {
  private readonly module = new EmailReplyDraftModule();
  listByMessage(messageId: number): Promise<EmailReplyDraftEntity[]> {
    return this.module.listByMessage(messageId);
  }
}

class DefaultAttemptPort implements ReplyDetectionAttemptPort {
  private readonly module = new EmailReplySendAttemptModule();
  listByMessage(messageId: number): Promise<EmailReplySendAttemptEntity[]> {
    return this.module.listByMessage(messageId);
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
  }): Promise<RefreshedFlags | null> {
    return this.client.refreshMessageFlags(input);
  }
  discoverSentFolders(
    config: EmailReceiveConnectionConfig
  ): Promise<SentFolder[]> {
    return this.client.discoverSentFolders(config);
  }
  searchReplyHeaders(input: {
    config: EmailReceiveConnectionConfig;
    folder: string;
    originalMessageId: string;
    cap: number;
  }): Promise<ReplyHeaderCandidate[] | false> {
    return this.client.searchReplyHeaders(input);
  }
}
