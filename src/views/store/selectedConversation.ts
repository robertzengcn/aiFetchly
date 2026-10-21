import { computed, markRaw, ref } from "vue";
import { defineStore } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { AIChatPendingMessageEvent } from "@/entityTypes/aiChatV2Types";
import type {
  ChatRunDetailEvent,
  ChatRunOwner,
  ChatRunTerminalRecord,
  ConversationRuntimeStatus,
  ConversationSummaryEvent,
  PlanContinuationIdentityMeta,
} from "@/entityTypes/aiChatWorkspaceTypes";
import {
  createWorkspaceStreamPresenter,
  type StreamPresenterOptions,
  type WorkspaceStreamStatus,
  type GoalRunInfo,
  type RecoveryInfo,
  type RetryInfo,
} from "@/views/utils/workspaceStreamPresenter";
import {
  cancelChatRun,
  createClientRequestId,
  loadHistoryPage,
  markConversationRead,
  selectConversation,
  startChatRun,
  subscribeDetailEvents,
  subscribeSummaryEvents,
  unsubscribeDetail,
} from "@/views/api/aiChatWorkspace";
import {
  denyChatV2ToolPermission,
  subscribeChatV2PendingEvents,
} from "@/views/api/aiChatV2";
import { windowInvoke } from "@/views/utils/apirequest";
// G01 (design §18.2): renderer event-receipt → projected-UI timing.
import {
  beginRendererProjectionWindow,
  cancelRendererProjectionWindow,
  endRendererProjectionWindow,
  observeRendererProjectionTiming,
} from "@/views/store/aiChatRendererMetrics";
import {
  flushRendererMetricsOnce,
  startRendererMetricsBridge,
} from "@/views/api/aiChatRendererMetricsBridge";
import { AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION } from "@/config/channellist";
import {
  markPermissionPromptExecuting,
  restorePermissionPromptAfterFailure,
} from "@/views/components/aiChatV2/toolExecutionStateUtil";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import {
  emitShellDiagnostic,
  hashConversationId,
} from "@/views/utils/shellDiagnostics";

/** Default mounted ordinary message rows (design §12.2: bounded window). */
export const MAX_MOUNTED_MESSAGES = 200;

export interface SendOptions {
  readonly model?: string;
  readonly mode?: "chat" | "plan";
  readonly toolApprovalMode?:
    | "ask_for_approval"
    | "approve_for_me"
    | "full_access";
  readonly showReasoning?: boolean;
  /** Encoded attachments forwarded through the workspace start-run IPC. */
  readonly attachments?: readonly {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    contentBase64: string;
    kind: "document" | "image";
  }[];
  /**
   * Generated images attached as edit references (message + tile index).
   * The engine resolves them against persisted history and forwards the
   * image bytes to the model as `image_url` parts.
   */
  readonly generatedImageReferences?: readonly {
    messageId: string;
    imageIndex: number;
  }[];
  /**
   * FR-SUB-004 (capability parity): send-time paste bodies keyed by the
   * composer's numeric paste ids — forwarded through the workspace IPC to
   * the engine exactly as the Chat V2 stream edge does.
   */
  readonly pastedContents?: Record<string, string>;
  /**
   * FR-IMG-004 trusted channel: the user-confirmed generated-image batch
   * reference set (above the 3-reference direct cap). Rides outside
   * `generatedImageReferences` as `confirmedGeneratedImageBatch`.
   */
  readonly confirmedBatchReferences?: readonly {
    messageId: string;
    imageIndex: number;
  }[];
  /**
   * FR-HIS-002 transport: opaque archive references + retry-stable
   * submission identity (resolved by the engine start acknowledgement).
   */
  readonly historySelectionIds?: readonly string[];
  readonly submissionId?: string;
  /**
   * T8/T2 (audit): request identity. Defaults to a fresh random id; plan
   * continuations pass the AD-007 deterministic hash so a reload or replay
   * resubmits the SAME job identity instead of minting a duplicate.
   */
  readonly clientRequestId?: string;
  /**
   * Audit R2 G01: plan-continuation association so main observes the real
   * decision → durable-acceptance interval at the queue boundary.
   * Identity only — forwarded verbatim on the start-run request.
   */
  readonly planContinuation?: PlanContinuationIdentityMeta;
  /**
   * B15: renderer error localizer (the surface's `t()` bound to the central
   * workspace error map). Applied to send rejections so typed queue errors
   * surface localized actionable copy; absent = raw backend message.
   */
  readonly localizeError?: (message: string) => string;
  /**
   * Audit r3 D02: the submit-click boundary (composer click epoch ms) —
   * stamped by the surface BEFORE command routing/file encoding so the G01
   * click→acceptance journey includes those stages by construction.
   * Absent (programmatic sends) falls back to the sendMessage entry stamp.
   */
  readonly journeyStartClickAtEpochMs?: number;
}

/**
 * Localized permission-card strings passed in by the surface that owns
 * `useI18n` — the store stays i18n-free (technical-design §14.2).
 */
export interface PermissionActionTexts {
  readonly deniedText: string;
  readonly resumeFailedText: string;
  readonly noToolIdText: string;
}

/**
 * Replaceable selected-chat state (technical-design §14.2): bounded message
 * window, runtime snapshot, detail-event application with 50 ms batching,
 * and the selection handshake. Switching conversations never cancels the
 * previous run — only presentation buffers are cleared.
 */
export const useSelectedConversationStore = defineStore(
  "selectedConversation",
  () => {
    const workspaceStore = useChatWorkspaceStore();

    // Flush-time sync (design §13): onMutate fires on real state mutations
    // — never per buffered token — so one reactive update lands per flush
    // window, terminal, or seed instead of per stream chunk.
    // onStartAck fans engine `start` acknowledgements out to registered
    // surfaces (FR-HIS-003: history-selection accepted/changed/rejected ids).
    const startAckListeners = new Set<(chunk: Record<string, unknown>) => void>();
    const liveToolResultListeners = new Set<
      (chunk: Record<string, unknown>) => void
    >();
    const presenter = markRaw(
      createWorkspaceStreamPresenter({
        onMutate: () => syncFromPresenter(),
        onStartAck: (chunk) => {
          for (const listener of startAckListeners) {
            listener(chunk);
          }
        },
        onLiveToolResult: (chunk) => {
          for (const listener of liveToolResultListeners) {
            listener(chunk);
          }
        },
        // Audit R2 G01: the buffered-delta projection window closes when the
        // batched flush actually lands (receipt → projected UI state through
        // the flush boundary), or is cancelled when the pending flush is
        // discarded (presenter dispose on selection switch).
        scheduleFlush: (fn, ms) => {
          const timer = setTimeout(() => {
            try {
              fn();
            } finally {
              endRendererProjectionWindow();
            }
          }, ms);
          return () => {
            cancelRendererProjectionWindow();
            clearTimeout(timer);
          };
        },
      })
    );
    // Re-create presenter with options indirection for tests.
    function resetPresenter(options?: StreamPresenterOptions): void {
      const next = createWorkspaceStreamPresenter(options);
      Object.assign(presenter, next);
    }

    const messages = ref<readonly ChatV2MessageView[]>([]);
    const recovery = ref<RecoveryInfo | null>(null);
    const retry = ref<RetryInfo | null>(null);
    const goal = ref<GoalRunInfo | null>(null);
    const activeAssistantMessageId = ref<string | null>(null);
    const streamStatus = ref<WorkspaceStreamStatus>("idle");
    const errorMessage = ref<string | null>(null);
    const runtimeStatus = ref<ConversationRuntimeStatus>("idle");
    const activeRunId = ref<string | null>(null);
    /**
     * Audit R05: the last terminal detail event consumed for the selected
     * conversation (`complete`/`error`/`cancelled` as the presenter reports
     * them) with a per-conversation accepted-run ordinal. Surfaces key
     * accepted-submission bookkeeping (e.g. image-reference draft clears)
     * on this record — never on a view-state shape, which a selection
     * switch or a mid-run re-attach can impersonate.
     */
    const lastTerminalRun = ref<ChatRunTerminalRecord | null>(null);
    const loading = ref(false);
    const loadError = ref<string | null>(null);
    const hasOlder = ref(false);
    const loadingOlder = ref(false);
    const selectedTitle = ref<string | null>(null);

    let detailUnsubscribe: (() => void) | null = null;
    let appliedGeneration = -1;
    let nextBeforeCursor: { timestamp: string; messageId: string } | null =
      null;
    /**
     * Audit R6-01: between `presenter.dispose()` and the selection
     * snapshot's resolution, the redacted snapshot can be OLDER than facts
     * the live detail stream delivers (a run may complete, error or start
     * streaming during the await). Applying those events against an empty
     * presenter would (a) lose their content when `seedHistory` replaces
     * the rows and (b) let the snapshot's possibly stale runtime facts
     * overwrite a newer terminal seen during the load. Events received in
     * that window are therefore BUFFERED and replayed after the snapshot
     * seeds and hydrates — newer streamed/terminal facts always apply
     * AFTER the authoritative snapshot, so an older snapshot can never
     * overwrite them.
     */
    let deferDetailEventsDuringSelection = false;
    let deferredDetailEvents: ChatRunDetailEvent[] = [];

    function clearDeferredDetailEvents(): void {
      deferDetailEventsDuringSelection = false;
      deferredDetailEvents = [];
    }
    /**
     * Audit R4-01: monotonic id of the in-flight `loadOlder` operation.
     * The selection handshake advances it, so a page resolved after a
     * selection change belongs to a superseded attempt and is discarded
     * wholesale — messages, cursor, availability and the loading flag are
     * all owned by the newest attempt of the CURRENT generation.
     */
    let olderLoadSeq = 0;

    /**
     * B14: durable submission identity per logical draft + conversation.
     * The main process dedupes by clientRequestId (pending unique index /
     * coordinator request cache), so reusing the previous id for the SAME
     * unacknowledged payload collapses a committed-main/lost-response retry
     * into the one accepted row instead of executing twice. Entries rotate
     * on confirmed acceptance — an intentional repeat (or any changed
     * payload, whose hash differs) mints a fresh identity and is never
     * collapsed. Conversation-keyed: survives A→B→A switches and remounts.
     */
    const lastSubmitByConversation = new Map<
      string,
      { payloadHash: string; clientRequestId: string }
    >();

    /**
     * Stable payload hash. Any intentional content/attachment/reference/mode
     * change yields a new hash and therefore a new request identity. Audit
     * R05: attachment BYTES participate — under transport ambiguity, an
     * edited file with different bytes is a DIFFERENT submission and must
     * mint a fresh identity for the model instead of collapsing into the
     * accepted row (metadata-only hashes collapsed content edits).
     */
    function hashSendPayload(text: string, options?: SendOptions): string {
      const stable = {
        text,
        model: options?.model ?? null,
        mode: options?.mode ?? null,
        toolApprovalMode: options?.toolApprovalMode ?? null,
        showReasoning: options?.showReasoning ?? null,
        attachments: (options?.attachments ?? []).map((a) => ({
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          kind: a.kind,
          contentBase64: a.contentBase64 ?? null,
        })),
        generatedImageReferences: options?.generatedImageReferences ?? null,
        pastedContents: options?.pastedContents ?? null,
        confirmedBatchReferences: options?.confirmedBatchReferences ?? null,
        historySelectionIds: options?.historySelectionIds ?? null,
        submissionId: options?.submissionId ?? null,
      };
      return JSON.stringify(stable);
    }

    function resolveClientRequestId(
      conversationId: string,
      text: string,
      options?: SendOptions
    ): string {
      if (options?.clientRequestId) {
        // Explicit identities (plan continuations, history flows) are
        // recorded as the logical draft so a later plain retry of the same
        // payload reconciles against them instead of minting a duplicate.
        const entry = {
          payloadHash: hashSendPayload(text, options),
          clientRequestId: options.clientRequestId,
        };
        lastSubmitByConversation.set(conversationId, entry);
        return options.clientRequestId;
      }
      const payloadHash = hashSendPayload(text, options);
      const last = lastSubmitByConversation.get(conversationId);
      if (last && last.payloadHash === payloadHash) {
        // Same logical draft, acceptance still ambiguous (a confirmed
        // acceptance rotates the entry below) — reconcile by reusing.
        return last.clientRequestId;
      }
      const fresh = createClientRequestId();
      lastSubmitByConversation.set(conversationId, {
        payloadHash,
        clientRequestId: fresh,
      });
      return fresh;
    }

    function syncFromPresenter(): void {
      const state = presenter.getState();
      // Audit R5-02: this is the single choke point for the mount bound.
      // Live growth (start/tool/plan cards, optimistic sends) previously
      // bypassed the 200-row bound — only the explicit loadOlder eviction
      // enforced it. When the projection overflows here, the OLDEST rows
      // are evicted (the live tail stays), and the store re-arms the
      // paging state: the cursor moves to the boundary of the retained
      // top row and availability re-opens, because the evicted rows are
      // older than that top row and stay loadable through "Load older".
      if (state.messages.length > MAX_MOUNTED_MESSAGES) {
        presenter.trimToWindow(MAX_MOUNTED_MESSAGES, { retain: "newest" });
        const top = state.messages[0];
        if (top) {
          nextBeforeCursor = { timestamp: top.timestamp, messageId: top.id };
          hasOlder.value = true;
        }
      }
      messages.value = [...state.messages];
      activeAssistantMessageId.value = state.activeAssistantMessageId;
      streamStatus.value = state.streamStatus;
      errorMessage.value = state.errorMessage;
      runtimeStatus.value = state.runtimeStatus;
      activeRunId.value = state.activeRunId;
      recovery.value = state.recovery;
      retry.value = state.retry;
      goal.value = state.goal;
      const sig = `${streamStatus.value}/${runtimeStatus.value}`;
    }

    /**
     * Per-conversation runtime order registries (audit R05): every accepted
     * send takes the next ordinal; every consumed terminal takes the next
     * one. Runs serialize per conversation (durable pending queue drains
     * FIFO at the turn terminal), so the k-th ordinal identifies exactly
     * one accepted run and pairs with the k-th consumed terminal. A plain
     * Map: these change alongside store transitions only, never through UI
     * reactivity. Both lag reselection equally — a run that completes while
     * deselected leaves its terminal uncounted (documented R05 gap), never
     * a mismatched pop.
     */
    const acceptedRunOrdinalByConversation = new Map<string, number>();
    const consumedTerminalOrdinalByConversation = new Map<string, number>();

    /**
     * Accept-ordered run ledger per conversation for durable identity
     * resolution (audit R2 N04 / FR-IMG-002/015, FR-LIF-001/004, AD-005).
     * Every accepted send registers the durable run identity returned by the
     * queue: the real bridge run id when accepted into an idle conversation,
     * `pending-<pendingMessageId>` when queued. Terminal facts resolve an
     * entry by DURABLE IDENTITY, replacing the paired-counters scheme whose
     * ordinals drifted when a run completed while its conversation was
     * deselected (the selected-only detail stream cannot see that terminal):
     *
     *   exact   — `entry.boundRunId ?? entry.runIdAtAccept === fact.runId`
     *             (immediate runs match directly, no binding needed);
     *   rebind  — a `run_started` fact carrying the real bridge run id binds
     *             the next unresolved, unbound accepted send in order. Accept
     *             order equals durable queue order (AD-001/003), so a drained
     *             queued send rebinds to its own run.
     *
     * The resolution is published through `lastResolvedReferenceRun` with the
     * entry's accept ordinal — the identity accepted-submission bookkeeping
     * (generated-image reference tray clears) verifies against. Background
     * completions arrive through the redacted summary channel
     * (run_completed/failed/cancelled/interrupted + runId, no content).
     * Bounded residual: a terminal summary without a run id cannot resolve
     * by identity and is ignored.
     */
    interface AcceptedRunLedgerEntry {
      readonly acceptOrdinal: number;
      readonly runIdAtAccept: string;
      boundRunId: string | null;
      resolved: boolean;
      /** Terminal kind that resolved the row (completion bookkeeping). */
      resolvedKind?: "complete" | "error" | "cancelled";
    }
    const ACCEPTED_RUN_LEDGER_CAP = 64;
    const acceptedRunLedgerByConversation = new Map<
      string,
      AcceptedRunLedgerEntry[]
    >();
    /** Latest resolution per resolved ("conv|ord") entry (audit D01). */
    const resolvedResolutionByConversation = new Map<
      string,
      { runId: string; kind: "complete" | "error" | "cancelled"; ordinal: number }
    >();
    const lastResolvedReferenceRun = ref<{
      conversationId: string;
      runId: string;
      kind: "complete" | "error" | "cancelled";
      ordinal: number;
    } | null>(null);
    /** App-scoped consumers notified for EVERY published resolution. */
    type ResolvedReferenceRunListener = (resolution: {
      conversationId: string;
      runId: string;
      kind: "complete" | "error" | "cancelled";
      ordinal: number;
    }) => void;
    const resolvedReferenceRunListeners = new Set<ResolvedReferenceRunListener>();

    /**
     * Resolution history bound (audit R4-03): records only serve the D01
     * acceptance-replay re-publish, so retaining the newest slice is enough.
     */
    const RESOLVED_RESOLUTION_CAP = 256;

    function bindResolvedResolutionHistory(
      key: string,
      record: {
        runId: string;
        kind: "complete" | "error" | "cancelled";
        ordinal: number;
      }
    ): void {
      resolvedResolutionByConversation.set(key, record);
      while (resolvedResolutionByConversation.size > RESOLVED_RESOLUTION_CAP) {
        const oldestKey = resolvedResolutionByConversation
          .keys()
          .next().value;
        if (oldestKey === undefined) break;
        resolvedResolutionByConversation.delete(oldestKey);
      }
    }

    /**
     * Audit R4-03: publishing a resolution REPLACES the shared ref — a
     * consumer reading that ref through a batched Vue watcher receives only
     * the last resolution of a synchronous burst and everything before it
     * is lost. The publish therefore ALSO dispatches synchronously to every
     * registered consumer, in publish order, so each resolution is consumed
     * exactly once no matter how tightly facts arrive. Listener failures
     * never interrupt the resolution bookkeeping.
     */
    function publishResolvedReferenceRun(resolution: {
      conversationId: string;
      runId: string;
      kind: "complete" | "error" | "cancelled";
      ordinal: number;
    }): void {
      lastResolvedReferenceRun.value = resolution;
      for (const listener of resolvedReferenceRunListeners) {
        try {
          listener(resolution);
        } catch {
          // Isolate consumer failures from ledger bookkeeping.
        }
      }
    }

    function ledgerFor(conversationId: string): AcceptedRunLedgerEntry[] {
      let ledger = acceptedRunLedgerByConversation.get(conversationId);
      if (!ledger) {
        ledger = [];
        acceptedRunLedgerByConversation.set(conversationId, ledger);
      }
      return ledger;
    }

    /** Register one accepted send in the durable ledger (accept order). */
    function registerAcceptedRun(
      conversationId: string,
      runId: string
    ): number {
      const ledger = ledgerFor(conversationId);
      const ordinal =
        (acceptedRunOrdinalByConversation.get(conversationId) ?? 0) + 1;
      acceptedRunOrdinalByConversation.set(conversationId, ordinal);
      ledger.push({
        acceptOrdinal: ordinal,
        runIdAtAccept: runId,
        boundRunId: null,
        resolved: false,
      });
      while (ledger.length > ACCEPTED_RUN_LEDGER_CAP) {
        ledger.shift();
      }
      // Audit R03: facts that arrived while this acceptance was in flight
      // now have their acceptance to resolve against — replay once, drop.
      replayEarlySummaryFacts(conversationId);
      return ordinal;
    }

    /**
     * Audit R03: exact-or-legacy binding of a run-start identity.
     *
     * exact    — the fact carries the accepted append identity
     *            (`sourceRunId` = `pending-<pendingMessageId>` or the
     *            accepted run id): only the entry registered for THAT
     *            send may bind, so a duplicate or reordered start fact can
     *            never consume the next pending acceptance.
     * leg fix (audit 2026-10-21-r3 D01): the exact match is evaluated BEFORE
     *            the duplicate-start guard so a legacy wrong FIFO bind can
     *            be corrected by the later source-bearing fact, and a
     *            source mismatch is never consumed as a duplicate.
     * legacy   — pre-parity facts carry the real run id only: fall back to
     *            accept-ordered FIFO, but ONLY while no entry is already
     *            bound to that run id (duplicate starts would otherwise
     *            walk the ledger and wrongly bind later pending sends).
     *
     * Returns true when the fact was fully consumed (bind happens or it is
     * a duplicate that must never re-apply); false when it should wait for
     * an acceptance to exist (caller may buffer it).
     */
    function reconcileRunStartedIdentity(
      conversationId: string,
      realRunId: string,
      sourceRunId?: string | null
    ): boolean {
      const ledger = acceptedRunLedgerByConversation.get(conversationId) ?? [];
      if (sourceRunId) {
        const exactIndex = ledger.findIndex(
          (candidate) =>
            !candidate.resolved && candidate.runIdAtAccept === sourceRunId
        );
        if (exactIndex >= 0) {
          const entry = ledger[exactIndex];
          if (entry.boundRunId !== realRunId) {
            for (const other of ledger) {
              if (
                other !== entry &&
                other.boundRunId === realRunId
              ) {
                // A source-bearing fact is authoritative — release the
                // stale legacy FIFO bind a preceding fact put somewhere.
                other.boundRunId = null;
              }
            }
            entry.boundRunId = realRunId;
          }
          return true;
        }
        // No exact candidate: a row already bound to this real run id with
        // a DIFFERENT accepted identity is a source mismatch — never
        // consume it as a duplicate start (audit D01).
        return false;
      }
      // Duplicate start guard (audit R03): an entry already bound to this
      // real run consumes the fact — never rebind onto the next acceptance.
      if (ledger.some((entry) => entry.boundRunId === realRunId)) {
        return true;
      }
      const entry = ledger.find(
        (candidate) => !candidate.resolved && candidate.boundRunId === null
      );
      if (!entry) return false;
      entry.boundRunId = realRunId;
      return true;
    }

    /**
     * Audit R03: summary facts that arrive while their acceptance is still
     * in flight (the durable queue starts the run before the renderer's
     * `startChatRun` reply resolves) are buffered per conversation and
     * replayed exactly once on the next acceptance. Bounded like the other
     * per-conversation registries.
     */
    interface EarlySummaryFact {
      runId: string;
      reason:
        | "run_started"
        | "run_completed"
        | "run_failed"
        | "run_cancelled"
        | "run_interrupted";
      sourceRunId?: string | null;
    }
    const EARLY_SUMMARY_FACT_CAP = 32;
    const earlySummaryFactsByConversation = new Map<
      string,
      EarlySummaryFact[]
    >();

    function recordEarlySummaryFact(
      conversationId: string,
      fact: EarlySummaryFact
    ): void {
      let buffer = earlySummaryFactsByConversation.get(conversationId);
      if (!buffer) {
        buffer = [];
        earlySummaryFactsByConversation.set(conversationId, buffer);
      }
      buffer.push(fact);
      while (buffer.length > EARLY_SUMMARY_FACT_CAP) {
        buffer.shift();
      }
    }

    function replayEarlySummaryFacts(conversationId: string): void {
      const buffered = earlySummaryFactsByConversation.get(conversationId);
      if (!buffered || buffered.length === 0) return;
      earlySummaryFactsByConversation.delete(conversationId);
      for (const fact of buffered.splice(0)) {
        tryBindSummaryFact(conversationId, fact);
      }
    }

    /**
     * Resolve one terminal fact by durable identity; publishes the accepted
     * entry's ordinal so component bookkeeping can consume its snapshot.
     * Audit R03: returns whether the terminal was consumed so unmatched
     * facts can be buffered until their acceptance registers. A fact that
     * carries the accepted append identity resolves against that entry
     * FIRST (exactly), then falls back to the bound/accepted real identity.
     */
    function resolveTerminalFact(
      conversationId: string,
      runId: string,
      kind: "complete" | "error" | "cancelled",
      sourceRunId?: string | null
    ): boolean {
      const ledger = acceptedRunLedgerByConversation.get(conversationId);
      if (!ledger) return false;
      const entry =
        (sourceRunId
          ? ledger.find(
              (candidate) =>
                !candidate.resolved && candidate.runIdAtAccept === sourceRunId
            )
          : undefined) ??
        ledger.find(
          (candidate) =>
            !candidate.resolved &&
            (candidate.boundRunId ?? candidate.runIdAtAccept) === runId
        );
      if (!entry) return false;
      entry.resolved = true;
      entry.resolvedKind = kind;
      while (ledger.length > 0 && ledger[0].resolved) {
        ledger.shift();
      }
      bindResolvedResolutionHistory(`${conversationId}|${entry.acceptOrdinal}`, {
        runId,
        kind,
        ordinal: entry.acceptOrdinal,
      });
      publishResolvedReferenceRun({
        conversationId,
        runId,
        kind,
        ordinal: entry.acceptOrdinal,
      });
      return true;
    }

    /**
     * Redacted summary facts (any conversation, no content bodies): keep the
     * accept ledger reconciled for background runs the selected-only detail
     * stream never sees. Audit R03:
     *   exact    — facts carrying the accepted append identity (`sourceRunId`)
     *              bind/resolve against THAT accepted send only;
     *   owner    — facts signed with a non-interactive `runOwner` are
     *              background-only (sidebar state) and never touch ledger;
     *   buffering— facts that arrive while their acceptance is still in
     *              flight are replayed once on the next acceptance;
     *   legacy   — facts without identity metadata keep the guarded accept-
     *              ordered fallback (R2 N04 behavior).
     */
    function handleSummaryFact(event: ConversationSummaryEvent): void {
      if (!event.runId) return;
      if (event.runOwner && event.runOwner !== "interactive") return;
      if (!isLedgerRelevantReason(event.reason)) return;
      tryBindSummaryFact(event.conversationId, {
        runId: event.runId,
        reason: event.reason,
        sourceRunId: event.sourceRunId,
      });
    }

    /** Only these summary reasons participate in run-identity binding. */
    function isLedgerRelevantReason(
      reason: ConversationSummaryEvent["reason"]
    ): reason is EarlySummaryFact["reason"] {
      return (
        reason === "run_started" ||
        reason === "run_completed" ||
        reason === "run_failed" ||
        reason === "run_cancelled" ||
        reason === "run_interrupted"
      );
    }

    /**
     * Audit R03: route one summary fact into the ledger; returns whether it
     * was consumed. Unconsumed ledger-relevant facts buffer for their
     * acceptance; non-ledger reasons are ignored (background state only).
     */
    function tryBindSummaryFact(
      conversationId: string,
      fact: EarlySummaryFact
    ): boolean {
      switch (fact.reason) {
        case "run_started":
          if (
            reconcileRunStartedIdentity(
              conversationId,
              fact.runId,
              fact.sourceRunId
            )
          ) {
            return true;
          }
          recordEarlySummaryFact(conversationId, fact);
          return false;
        case "run_completed":
        case "run_failed":
        case "run_cancelled":
        case "run_interrupted": {
          const kind =
            fact.reason === "run_completed"
              ? ("complete" as const)
              : fact.reason === "run_failed"
              ? ("error" as const)
              : ("cancelled" as const);
          if (
            resolveTerminalFact(
              conversationId,
              fact.runId,
              kind,
              fact.sourceRunId
            )
          ) {
            return true;
          }
          recordEarlySummaryFact(conversationId, fact);
          return false;
        }
        default:
          return true;
      }
    }

    /** Ordinal of the most recent accepted send for one conversation. */
    function acceptedRunOrdinalFor(conversationId: string): number | null {
      return acceptedRunOrdinalByConversation.get(conversationId) ?? null;
    }

    /**
     * Audit D01 (2026-10-21-r3): a queued acceptance that will NEVER own a
     * real run (steered into the running turn, or cancelled before its
     * scheduling claim) must leave the ledger immediately — otherwise the
     * next run's legacy FIFO start binds onto that orphaned row and the
     * orphan's ordinal is published as a complete resolution, clearing the
     * wrong reference snapshot from the tray.
     *
     * The retirement publishes a `cancelled` resolution: composerDrafts
     * dequeues the submitted snapshot (no double consumption later) but
     * deliberately keeps the references (kind !== "complete") — cancel
     * leaves the selected images in the tray; a steered row was either
     * rejected (module rule: trusted reference rows are unsteerable) or had
     * no reference set, so no reference lifetime is consumed here.
     */
    function retirePendingLedgerRow(
      conversationId: string,
      pendingMessageId: string
    ): void {
      const ledger = acceptedRunLedgerByConversation.get(conversationId);
      if (!ledger) return;
      const entry = ledger.find(
        (candidate) =>
          !candidate.resolved &&
          candidate.boundRunId === null &&
          candidate.runIdAtAccept === `pending-${pendingMessageId}`
      );
      if (!entry) return;
      entry.resolved = true;
      entry.resolvedKind = "cancelled";
      while (ledger.length > 0 && ledger[0].resolved) {
        ledger.shift();
      }
      bindResolvedResolutionHistory(`${conversationId}|${entry.acceptOrdinal}`, {
        runId: `pending-${pendingMessageId}`,
        kind: "cancelled",
        ordinal: entry.acceptOrdinal,
      });
      publishResolvedReferenceRun({
        conversationId,
        runId: `pending-${pendingMessageId}`,
        kind: "cancelled",
        ordinal: entry.acceptOrdinal,
      });
    }

    /**
     * Re-publish an already-resolved accepted entry's resolution (audit D01).
     * Buffered summary terminal facts replay synchronously inside
     * `registerAcceptedRun` — their resolution can be consumed by the
     * composerDrafts watcher BEFORE the surface's accepted-send branch has
     * registered the submission's reference-clear snapshot, so the removal
     * never happened. The surface re-publishes after storing its snapshot;
     * the watcher will then find the record and consume it. Resolved rows
     * are trimmed from the ledger by design, so the historical resolution
     * is read back instead of the ledger row. Idempotent: an unknown
     * ordinal (unresolved trim) is a no-op and the normal flow's later
     * terminal re-publishes on its own.
     */
    function republishResolvedRun(conversationId: string, ordinal: number): void {
      const record = resolvedResolutionByConversation.get(
        `${conversationId}|${ordinal}`
      );
      if (!record) return;
      publishResolvedReferenceRun({
        conversationId,
        runId: record.runId,
        kind: record.kind,
        ordinal: record.ordinal,
      });
    }

    /**
     * Register an app-scoped consumer for every published run resolution
     * (audit R4-03). Resolutions are dispatched synchronously, in publish
     * order — the composerDrafts cleaner attaches through this registry so
     * a synchronous burst of terminal facts cannot collapse into one
     * batched watcher invocation.
     */
    function subscribeResolvedReferenceRuns(
      listener: ResolvedReferenceRunListener
    ): () => void {
      resolvedReferenceRunListeners.add(listener);
      return () => {
        resolvedReferenceRunListeners.delete(listener);
      };
    }

    /**
     * App-scoped pending lifecycle handler (audit D01). Fires for every
     * conversation — the accept ledger is OUTSIDE the selection scope.
     */
    function handlePendingLedgerEvent(event: AIChatPendingMessageEvent): void {
      if (event.status !== "applied" && event.status !== "cancelled") return;
      retirePendingLedgerRow(event.conversationId, event.pendingMessageId);
    }

    /** Ensure exactly one pending-event subscription exists per renderer. */
    let pendingEventsUnsubscribe: (() => void) | null = null;
    function ensurePendingEventSubscription(): void {
      if (pendingEventsUnsubscribe) return;
      pendingEventsUnsubscribe = subscribeChatV2PendingEvents((event) => {
        handlePendingLedgerEvent(event);
      });
    }

    function recordTerminalRun(
      conversationId: string,
      runId: string,
      kind: ChatRunTerminalRecord["kind"],
      sourceRunId?: string | null
    ): void {
      const ordinal =
        (consumedTerminalOrdinalByConversation.get(conversationId) ?? 0) + 1;
      consumedTerminalOrdinalByConversation.set(conversationId, ordinal);
      lastTerminalRun.value = { conversationId, runId, kind, ordinal };
      // Audit R2 N04: resolve the durable accept-ledger entry by identity —
      // the paired-counters ordinals above are kept only for legacy
      // consumers; the ledger ordinal is what accepted-submission
      // bookkeeping now verifies against. Audit D01: the source identity
      // from the detail envelope decides which row — never `boundRunId`
      // when the source matches a row.
      resolveTerminalFact(conversationId, runId, kind, sourceRunId);
    }

    /** Ensure exactly one summary subscription exists for this renderer. */
    let summaryUnsubscribe: (() => void) | null = null;
    function ensureSummarySubscription(): void {
      if (summaryUnsubscribe) return;
      summaryUnsubscribe = subscribeSummaryEvents((event) => {
        handleSummaryFact(event);
      });
      // Audit R2 G01: the diagnostics export consumer — first workspace
      // session starts the bounded renderer→main metrics bridge (idempotent,
      // telemetry-only) so projection aggregates join the structured soak
      // telemetry instead of dying unread with the renderer process.
      startRendererMetricsBridge();
    }

    /** Ensure exactly one detail subscription exists for this renderer. */
    function ensureDetailSubscription(): void {
      if (detailUnsubscribe) return;
      summaryUnsubscribe ??= null;
      if (!summaryUnsubscribe) ensureSummarySubscription();
      detailUnsubscribe = subscribeDetailEvents((event) => {
        if (event.conversationId !== workspaceStore.selectedConversationId) {
          return; // stale or foreign conversation (design §18.4)
        }
        applyDetailEvent(event);
      });
    }

    function applyDetailEvent(event: ChatRunDetailEvent): void {
      // G01 (design §18.2): event receipt → projected UI state timing
      // (durations only — never event content). Buffered deltas complete
      // their projection at the DEFERRED flush window, not here — those
      // open a projection window that closes inside the store's
      // scheduleFlush wrapper (see the presenter options above); every
      // other event type projects synchronously through the presenter's
      // onMutate hook, so the observation below covers its application
      // loop through the reactive sync.
      // Audit R6-01: during a selection's snapshot await, events wait for
      // the replay (below) so they project only once with the final
      // ordering (snapshot seed → newer stream facts). No projection
      // timing window opens for deferred events — the projection happens
      // at replay, and the replayed application opens its own windows.
      if (deferDetailEventsDuringSelection) {
        deferredDetailEvents.push(event);
        return;
      }
      const receivedAt = performance.now();
      const isBufferedDelta =
        event.eventType === "token" || event.eventType === "reasoning_delta";
      if (isBufferedDelta) beginRendererProjectionWindow();
      const consumed = presenter.applyEvent(event);
      if (!isBufferedDelta) {
        observeRendererProjectionTiming(performance.now() - receivedAt);
      }
      if (!consumed) {
        if (isBufferedDelta) cancelRendererProjectionWindow();
        return;
      }
      // Reactive sync happens through the presenter's onMutate hook — one
      // update per flush window, not one per token chunk.
      // FR-026: an openImmediately artifact opens the inspector preview for
      // the SELECTED conversation only (events arrive selected-only).
      // Audit R2 N04 / R03: a drained queued send's bridge run starts here —
      // bind the accepted send it serves exactly (source identity) or, for
      // legacy envelopes, in accept order guarded against duplicates, so the
      // queued identity resolves against this run's terminal. Audit D01: an
      // unmatched start is buffered for its acceptance, not dropped.
      if (event.eventType === "start") {
        const consumed = reconcileRunStartedIdentity(
          event.conversationId,
          event.runId,
          event.sourceRunId
        );
        if (!consumed) {
          recordEarlySummaryFact(event.conversationId, {
            runId: event.runId,
            reason: "run_started",
            sourceRunId: event.sourceRunId,
          });
        }
      }
      if (event.eventType === "tool_result") {
        const pending = presenter.consumePendingArtifactOpen();
        if (pending) {
          workspaceStore.requestArtifactPreview(pending.artifactId);
        }
      }
      // A terminal event for the selected conversation means durable state
      // changed — the view is authoritative enough (the presenter applied
      // the full content) but clear unread locally. Audit R05: the store
      // reports the genuine terminal identity — a consumed event, never a
      // view-state shape a selection switch can impersonate.
      if (
        event.eventType === "complete" ||
        event.eventType === "error" ||
        event.eventType === "cancelled"
      ) {
        workspaceStore.markConversationReadLocally(event.conversationId);
        // Audit D01: the envelope's source identity selects the accepted
        // row exactly — a bound-by-legacy row must never publish another
        // send's terminal.
        recordTerminalRun(
          event.conversationId,
          event.runId,
          event.eventType,
          event.sourceRunId
        );
      }
    }

    /**
     * Selection handshake (design §11.6): bump generation, subscribe FIRST
     * (main registers before reading), then seed from the returned snapshot.
     */
    async function loadSelection(conversationId: string | null): Promise<void> {
      const generation = workspaceStore.nextGeneration();
      appliedGeneration = generation;
      // Audit R4-01: the handshake owns a fresh paging state — any in-flight
      // older-page attempt of the previous selection is superseded (its
      // eventual `finally` must not clear THIS generation's flag) and the
      // new selection can page immediately.
      olderLoadSeq += 1;
      loadingOlder.value = false;
      workspaceStore.setSelected(conversationId);
      loading.value = conversationId !== null;
      loadError.value = null;
      // Audit R5-03: the incoming selection owns fresh paging state from
      // the very start. The previous conversation's cursor must never be
      // usable (Load older cannot fire with it while the new snapshot is
      // pending) and stale availability must not leak across selections;
      // the snapshot re-establishes both on a successful load.
      nextBeforeCursor = null;
      hasOlder.value = false;

      // Clear only presentation buffers — the previous run keeps executing.
      presenter.dispose();
      syncFromPresenter();
      // Audit R6-01: hold the new selection's first detail events until
      // the authoritative snapshot lands, then replay them over the seed.
      clearDeferredDetailEvents();
      deferDetailEventsDuringSelection = true;

      if (conversationId === null) {
        nextBeforeCursor = null;
        hasOlder.value = false;
        selectedTitle.value = null;
        loading.value = false;
        clearDeferredDetailEvents();
        return;
      }

      const startedAt = Date.now();
      ensureDetailSubscription();
      // Audit D01: the pending lifecycle retirement rides the same app-
      // scoped lifetime as the ledger it protects.
      ensurePendingEventSubscription();
      try {
        const snapshot = await selectConversation(conversationId, generation);
        // Apply only if this handshake is still the latest selection.
        if (
          appliedGeneration !== generation ||
          snapshot.acceptedGeneration === -1
        ) {
          clearDeferredDetailEvents();
          emitShellDiagnostic({
            type: "chat.selection_loaded",
            conversationHash: hashConversationId(conversationId),
            generation,
            latencyMs: Date.now() - startedAt,
            outcome: "superseded",
          });
          return;
        }
        presenter.seedHistory([...snapshot.messages]);
        // Audit R6-01: hydrate the presenter from the SAME authoritative
        // snapshot — seeding resets the presenter to default idle, so the
        // previous manual assignment of `runtimeStatus`/`activeRunId` was
        // immediately overwritten by `syncFromPresenter()` afterwards
        // (selected run presented idle with no run strip/Stop affordance
        // until another engine event repaired it). Hydration registers
        // restored actionable rows too (audit R6-02), keeping a quiet
        // waiting/running conversation protective from the first moment.
        presenter.hydrateRuntime({
          runtimeStatus: snapshot.runtimeStatus,
          activeRunId: snapshot.activeRunId,
        });
        nextBeforeCursor = snapshot.nextBefore;
        hasOlder.value = snapshot.hasOlder;
        selectedTitle.value = snapshot.title;
        syncFromPresenter();
        // Audit R6-01: replay the events the live channel delivered during
        // the snapshot await AFTER the seed+hydration, so newer terminal/
        // streamed facts overwrite the (possibly older) snapshot facts —
        // deterministically the stream is the authoritative source for
        // what happened while the snapshot was being assembled.
        deferDetailEventsDuringSelection = false;
        const pendingEvents = deferredDetailEvents;
        deferredDetailEvents = [];
        for (const event of pendingEvents) {
          applyDetailEvent(event);
        }
        emitShellDiagnostic({
          type: "chat.selection_loaded",
          conversationHash: hashConversationId(conversationId),
          generation,
          latencyMs: Date.now() - startedAt,
          outcome: "ok",
        });
        await markReadAfterLoad(conversationId);
      } catch (err) {
        deferDetailEventsDuringSelection = false;
        deferredDetailEvents = [];
        if (appliedGeneration === generation) {
          loadError.value =
            err instanceof Error ? err.message : "Failed to load conversation";
          emitShellDiagnostic({
            type: "chat.selection_loaded",
            conversationHash: hashConversationId(conversationId),
            generation,
            latencyMs: Date.now() - startedAt,
            outcome: "error",
          });
        }
      } finally {
        if (appliedGeneration === generation) {
          loading.value = false;
        }
      }
    }

    /** Advance the durable read marker after the newest page is displayed. */
    async function markReadAfterLoad(conversationId: string): Promise<void> {
      const newest = messages.value[messages.value.length - 1];
      if (!newest) return;
      try {
        await markConversationRead({
          conversationId,
          observedThrough: newest.timestamp,
        });
        workspaceStore.markConversationReadLocally(conversationId);
      } catch {
        // Non-fatal: unread stays until the next successful mark.
      }
    }

    /**
     * Load the next older page and prepend it (design §12.2).
     * Audit R4-01: the request carries an immutable snapshot of the selection
     * generation and the attempt id. After the transport await, every shared
     * mutation — messages, cursor, availability, eviction — only applies
     * while this attempt is still the newest one of the CURRENT generation.
     * A stale page (selection changed, deselected, or superseded by a newer
     * attempt) is discarded without touching the newer owner's state, and
     * its `finally` only clears the loading flag when it still owns it.
     */
    async function loadOlder(): Promise<void> {
      const conversationId = workspaceStore.selectedConversationId;
      // Audit R5-03: refuse while the selection's snapshot is still in
      // flight — until it lands there is no owned cursor for this
      // selection, and paging with the previous selection's cursor would
      // request the wrong range (or corrupt a selection boundary).
      if (
        !conversationId ||
        loading.value ||
        !nextBeforeCursor ||
        loadingOlder.value
      ) {
        return;
      }
      const selectionToken = appliedGeneration;
      const loadToken = ++olderLoadSeq;
      loadingOlder.value = true;
      try {
        const page = await loadHistoryPage(
          conversationId,
          50,
          nextBeforeCursor
        );
        if (
          appliedGeneration !== selectionToken ||
          loadToken !== olderLoadSeq
        ) {
          return;
        }
        // Bounded-history availability always reflects what the server
        // returned — an exhausted cursor is authoritative (audit R4-04).
        nextBeforeCursor = page.nextBefore;
        hasOlder.value = page.hasOlder;
        presenter.prependHistory([...page.messages]);
        // Evict distant rows beyond the bounded window (design §12.2).
        evictBeyondWindow();
        syncFromPresenter();
      } catch {
        // Keep the current window; user can retry via the affordance.
      } finally {
        if (loadToken === olderLoadSeq) {
          loadingOlder.value = false;
        }
      }
    }

    function evictBeyondWindow(): void {
      // Design §12.2 / audit R4-04: the loadOlder path just PREPENDED the
      // requested older range — trimming must therefore retain the OLDEST
      // rows and evict from the newest end, so a full window can no longer
      // discard the page the user just fetched. The newest rows remain
      // reachable (live stream catch-up and the selection snapshot's
      // reseed are the way back to the live tail). The 200-row bound is
      // preserved and `hasOlder` keeps the server's own verdict (set above
      // from `page.hasOlder` — never forced true by this eviction).
      presenter.trimToWindow(MAX_MOUNTED_MESSAGES, { retain: "oldest" });
    }

    /**
     * Send a message through the coordinator with send-button retry safety.
     * Returns whether THIS send was accepted (a run started or the durable
     * queue took the row) — the composer keys its draft clear on the result,
     * never on shared run state (a stale activeRunId from the previous run
     * must not clear a rejected send's draft).
     */
    async function sendMessage(
      text: string,
      options?: SendOptions
    ): Promise<boolean> {
      const conversationId = workspaceStore.selectedConversationId;
      if (!conversationId || text.trim().length === 0) return false;
      // B07: the originating conversation is fixed BEFORE the first await.
      // Every post-await presenter/status mutation below rechecks it — a
      // delayed IPC success/rejection for A must never touch B's messages,
      // error banner or draft (including A→B→A generation changes: the id
      // check passes on return and durable reload reconciles the view).
      const originConversationId = conversationId;
      // G01: the submit click boundary — the earliest point of this send;
      // main closes the click→acceptance sample at the queue receipt.
      const clickAtEpochMs = Date.now();

      // Optimistic user message; history reload replaces it durably.
      const optimisticId = `local-user-${Date.now()}`;
      presenter.appendLocalUserMessage({
        id: optimisticId,
        conversationId,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
        messageType: MessageType.MESSAGE,
        metadata: { source: "chat-v2" },
      });
      syncFromPresenter();

      // T8/D5 (audit): the optimistic row is the request's identity holder —
      // a REJECTION removes it so the draft (still in the composer) is not
      // duplicated in the transcript; the error bubble alone remains.
      // B14: retry-stable identity — an ambiguous (possibly committed, lost
      // response) retry of the same logical draft reuses the previous id so
      // main dedupes it into the one accepted row/provider turn.
      const clientRequestId = resolveClientRequestId(
        conversationId,
        text,
        options
      );
      try {
        const response = await startChatRun({
          conversationId,
          clientRequestId,
          message: text,
          model: options?.model,
          mode: options?.mode,
          toolApprovalMode: options?.toolApprovalMode,
          showReasoning: options?.showReasoning,
          uploadedFiles: options?.attachments,
          generatedImageReferences: options?.generatedImageReferences,
          pastedContents: options?.pastedContents,
          confirmedGeneratedImageBatch: options?.confirmedBatchReferences
            ? { references: [...options.confirmedBatchReferences] }
            : undefined,
          historySelectionIds: options?.historySelectionIds
            ? [...options.historySelectionIds]
            : undefined,
          submissionId: options?.submissionId,
          planContinuation: options?.planContinuation,
          journeyStart: {
            clickAtEpochMs:
              options?.journeyStartClickAtEpochMs ?? clickAtEpochMs,
          },
        });
        // B14: confirmed acceptance rotates the logical-draft identity — an
        // intentional repeat of the same text afterwards mints a FRESH id
        // and is never collapsed into this row. (Rejections keep the entry
        // so an ambiguous retry reconciles by reuse.)
        lastSubmitByConversation.delete(originConversationId);
        // Audit R2 N04: this send is the origin conversation's next accepted
        // run in the durable accept ledger — its entry carries the identity
        // the queue returned (real run id, or `pending-…` when queued) and
        // its accept index is the ordinal accepted-submission bookkeeping
        // resolves against (replacing the paired-counters scheme).
        registerAcceptedRun(originConversationId, response.runId);
        // B07: only when the selection still owns this send — after a
        // switch, A's durable row renders via subscription/summary when the
        // user returns; touching B's presenter/status here would corrupt it.
        if (workspaceStore.selectedConversationId !== originConversationId) {
          return true;
        }
        activeRunId.value = response.runId;
        runtimeStatus.value = response.status;
        streamStatus.value =
          response.status === "running" ? "streaming" : "idle";
        // A busy-conversation send was accepted into the durable pending
        // queue (main-process delegation): the pending bubble replaces the
        // optimistic row, and the queue drains FIFO at the turn terminal.
        if (
          response.status === "queued" &&
          response.runId.startsWith("pending-")
        ) {
          presenter.removeMessage(optimisticId);
          syncFromPresenter();
        }
        return true;
      } catch (err) {
        // B07: a delayed rejection for A must not mutate B. The draft stays
        // (composer clears only on acceptance) so A's text remains available
        // for retry; B's messages/error/draft are untouched.
        if (workspaceStore.selectedConversationId !== originConversationId) {
          return false;
        }
        // T8/D5: rejected — drop the optimistic row (the draft stays in the
        // composer for retry; keeping both showed the text twice).
        presenter.removeMessage(optimisticId);
        syncFromPresenter();
        const rawText: string =
          err instanceof Error ? err.message : "Failed to start the run";
        // B15: typed queue errors map to localized actionable copy
        // (reason + unblock action preserved in all six languages).
        const messageText: string =
          options?.localizeError?.(rawText) ?? rawText;
        // Pre-V2 parity (AiChatBox + AiChatV2.showAssistantError): surface the
        // denial as a visible assistant bubble so an AI-disabled
        // (subscription-required) rejection is not silent. The optimistic user
        // row is kept for retry; the error bubble carries the backend's
        // user-safe message (e.g. hosted-subscription notice).
        presenter.appendLocalUserMessage({
          id: `local-error-${Date.now()}`,
          conversationId,
          role: "assistant",
          content: messageText,
          timestamp: new Date().toISOString(),
          messageType: MessageType.MESSAGE,
          metadata: { source: "chat-v2", error: messageText },
        });
        syncFromPresenter();
        // syncFromPresenter copies the presenter's (null) errorMessage, so
        // re-apply the rejection AFTER the sync or the banner stays silent.
        errorMessage.value = messageText;
        streamStatus.value = "error";
        return false;
      }
    }

    /** Stop the selected active run (composer Send/Stop control). */
    async function stopActiveRun(): Promise<void> {
      const conversationId = workspaceStore.selectedConversationId;
      if (!conversationId) return;
      try {
        await cancelChatRun({ conversationId });
      } catch {
        // Terminal events still arrive via the detail subscription.
      }
    }

    // -------------------------------------------------------------------------
    // Tool permission actions (design §15.5)
    // -------------------------------------------------------------------------

    /**
     * Render a local (non-persisted) user/assistant command exchange
     * (capability-parity FR-CMD-004): slash-command results and command
     * errors surface as transcript rows with the same lifetime contract as
     * Chat V2's `appendLocalCommandExchange` — visible until the next
     * history reload, never persisted, never sent to the model.
     */
    function appendLocalCommandExchange(
      userText: string,
      assistantText: string
    ): void {
      const current = workspaceStore.selectedConversationId;
      if (!current) return;
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timestamp = new Date().toISOString();
      presenter.appendLocalUserMessage({
        id: `local-command-user-${suffix}`,
        conversationId: current,
        role: "user",
        content: userText,
        timestamp,
        messageType: MessageType.MESSAGE,
      });
      presenter.appendLocalUserMessage({
        id: `local-command-assistant-${suffix}`,
        conversationId: current,
        role: "assistant",
        content: assistantText,
        timestamp,
        messageType: MessageType.MESSAGE,
        metadata: { source: "slash-command" },
      });
      syncFromPresenter();
    }

    /**
     * Append the durable user row a queue-drained turn just delivered
     * (message-queue §7): the delegated send's optimistic row was swapped for
     * the pending bubble, and the bubble is removed at delivery — without
     * this append the live transcript would lose the user's message until a
     * re-selection reloads history. The persisted id makes the later history
     * reload dedupe seamlessly.
     */
    function appendDeliveredUserRow(input: {
      readonly id: string;
      readonly content: string;
      readonly timestamp: string;
    }): void {
      const current = workspaceStore.selectedConversationId;
      if (!current) return;
      if (messages.value.some((m) => m.id === input.id)) return; // idempotent
      presenter.appendLocalUserMessage({
        id: input.id,
        conversationId: current,
        role: "user",
        content: input.content,
        timestamp: input.timestamp,
        messageType: MessageType.MESSAGE,
        metadata: { source: "chat-v2" },
      });
      syncFromPresenter();
    }

    /** One in-flight resume per tool id — double clicks are no-ops. */
    const permissionResumeInFlightToolIds = new Set<string>();

    /** Resolve the tool id for a permission message: direct metadata first,
     * then the nearest preceding TOOL_CALL with the same tool name (mirrors
     * the legacy dock's resolution for histories without toolCallId rows). */
    function resolveToolIdForPermission(
      message: ChatV2MessageView
    ): string | undefined {
      const direct = message.metadata?.toolCallId;
      if (typeof direct === "string" && direct.length > 0) {
        return direct;
      }
      const toolName = message.metadata?.toolName;
      if (!toolName) {
        return undefined;
      }
      const idx = messages.value.findIndex((m) => m.id === message.id);
      for (let i = idx - 1; i >= 0; i -= 1) {
        const candidate = messages.value[i];
        if (
          candidate.messageType === MessageType.TOOL_CALL &&
          candidate.metadata?.toolName === toolName &&
          candidate.metadata?.toolCallId
        ) {
          return candidate.metadata.toolCallId;
        }
      }
      return undefined;
    }

    /**
     * Grant a parked tool permission: mark the prompt executing locally,
     * resume the main-process turn, and surface failures on the row (the
     * resumed tool_result event replaces the row on success).
     */
    async function grantToolPermission(
      message: ChatV2MessageView,
      texts: PermissionActionTexts
    ): Promise<void> {
      const toolId = resolveToolIdForPermission(message);
      if (!toolId) {
        errorMessage.value = texts.noToolIdText;
        return;
      }
      if (permissionResumeInFlightToolIds.has(toolId)) return;
      permissionResumeInFlightToolIds.add(toolId);
      // Executing rewrite goes through the presenter so the next presenter
      // mutation cannot clobber it (single source of truth for the window).
      presenter.rewriteMessage(message.id, (m) => {
        const [next] = markPermissionPromptExecuting([m], message.id);
        return next;
      });
      try {
        const raw = await windowInvoke(
          AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
          {
            toolId,
            conversationId:
              message.conversationId || workspaceStore.selectedConversationId,
          }
        );
        const res = raw as { ok: boolean; error?: string } | null;
        if (!res?.ok) {
          const errMsg = res?.error || texts.resumeFailedText;
          // T4/D1 (audit): a failed resume RESTORES the prompt — Grant/Deny
          // stay mounted and actionable (FR-PER-007); the safe error rides
          // the row content so it is announced without stealing focus.
          presenter.rewriteMessage(message.id, (m) =>
            restorePermissionPromptAfterFailure([m], message.id, errMsg)[0]
          );
          syncFromPresenter();
          errorMessage.value = errMsg;
        }
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : String(error);
        presenter.rewriteMessage(message.id, (m) =>
          restorePermissionPromptAfterFailure([m], message.id, errMsg)[0]
        );
        syncFromPresenter();
        errorMessage.value = errMsg;
      } finally {
        permissionResumeInFlightToolIds.delete(toolId);
      }
    }

    /**
     * Deny a parked tool permission (V2 parity, FR-PER-004/006/007).
     * Routes Deny by the exact tool/conversation through the existing
     * continuation API first: when a scheduled-loop engine owns the paused
     * turn it synthesizes the denial result and the run continues (honor
     * `handled` — never stop an unrelated task). Otherwise falls back to
     * the interactive stop, which settles the parked run to cancelled
     * through the normal terminal path. Ordinary interactive denial keeps
     * its stop fallback; only the scheduled-owner gap is closed here.
     */
    async function denyToolPermission(
      message: ChatV2MessageView,
      texts: PermissionActionTexts
    ): Promise<void> {
      const toolId = resolveToolIdForPermission(message);
      const targetConversationId =
        message.conversationId || workspaceStore.selectedConversationId || undefined;
      if (toolId) {
        try {
          const result = await denyChatV2ToolPermission(
            toolId,
            targetConversationId
          );
          if (result.handled) {
            // Scheduled engine owned the paused turn — it synthesized a
            // denied tool_result and the run continues. Rewrite the row to
            // the denied receipt (the engine's tool_result replaces it on
            // success) and do NOT stop any stream.
            presenter.rewriteMessage(message.id, (m) => ({
              ...m,
              content: texts.deniedText,
              metadata: {
                ...m.metadata,
                source: "chat-v2",
                toolResult: undefined,
                success: false,
              },
            }));
            syncFromPresenter();
            return;
          }
        } catch {
          // IPC denied (e.g. AI gate) or stale tool id — fall through to
          // the interactive stop below, which keeps an actionable card on
          // failure via the grant-style restore path.
        }
      }
      presenter.rewriteMessage(message.id, (m) => ({
        ...m,
        content: texts.deniedText,
        metadata: {
          ...m.metadata,
          source: "chat-v2",
          toolResult: undefined,
          success: false,
        },
      }));
      syncFromPresenter();
      await stopActiveRun();
    }

    function teardown(): void {
      if (detailUnsubscribe) {
        detailUnsubscribe();
        detailUnsubscribe = null;
      }
      unsubscribeDetail();
      if (summaryUnsubscribe) {
        summaryUnsubscribe();
        summaryUnsubscribe = null;
      }
      presenter.dispose();
      syncFromPresenter();
      // Audit R6-01: the store's scoping ends with the session — a pending
      // selection's deferred events must never replay after teardown.
      clearDeferredDetailEvents();
      // Audit R2 G01: flush the session's projection aggregates into main's
      // telemetry before the renderer tears the store down (best-effort).
      void flushRendererMetricsOnce();
    }

    /**
     * Seed authoritative goal state from the backend (FR-CMD-006): the
     * run-strip's /loop precondition must survive selection reloads.
     */
    function seedGoal(goal: GoalRunInfo | null): void {
      presenter.setGoal(goal);
      syncFromPresenter();
    }

    /**
     * Subscribe to engine start acknowledgements (FR-HIS-003). Returns an
     * unsubscribe function; the surface cleans up on unmount.
     */
    function onStartAck(
      listener: (chunk: Record<string, unknown>) => void
    ): () => void {
      startAckListeners.add(listener);
      return () => {
        startAckListeners.delete(listener);
      };
    }

    /**
     * Subscribe to LIVE tool results (FR-INT-003) — selected conversation
     * only, never history seeding. Returns an unsubscribe function.
     */
    function onLiveToolResult(
      listener: (chunk: Record<string, unknown>) => void
    ): () => void {
      liveToolResultListeners.add(listener);
      return () => {
        liveToolResultListeners.delete(listener);
      };
    }

    const isBusy = computed(
      () =>
        runtimeStatus.value === "running" ||
        runtimeStatus.value === "queued" ||
        streamStatus.value === "streaming"
    );

    /** Latest scheduled-loop row state derived from message metadata. */
    const scheduledLoop = computed(() => {
      for (let i = messages.value.length - 1; i >= 0; i -= 1) {
        const loop = messages.value[i].metadata?.scheduledLoop;
        if (loop) return loop;
      }
      return null;
    });

    return {
      messages,
      recovery,
      retry,
      goal,
      scheduledLoop,
      activeAssistantMessageId,
      streamStatus,
      errorMessage,
      runtimeStatus,
      activeRunId,
      lastTerminalRun,
      lastResolvedReferenceRun,
      acceptedRunOrdinalFor,
      republishResolvedRun,
      subscribeResolvedReferenceRuns,
      loading,
      loadError,
      hasOlder,
      loadingOlder,
      selectedTitle,
      loadSelection,
      loadOlder,
      sendMessage,
      appendDeliveredUserRow,
      appendLocalCommandExchange,
      stopActiveRun,
      grantToolPermission,
      denyToolPermission,
      applyDetailEvent,
      onStartAck,
      onLiveToolResult,
      seedGoal,
      markReadAfterLoad,
      teardown,
      isBusy,
      resetPresenter,
    };
  }
);
