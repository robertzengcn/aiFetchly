import type { OpenAIChatCompletionRequest, OpenAIChatCompletionResponse } from "@/api/aiChatApi";
import type { LocalAIProviderConfig } from "@/entityTypes/aiProviderTypes";
import type {
  ChatTitleFailureCode,
  ChatTitleUpdatedEvent,
  PreparedTitleCandidate,
} from "@/service/aiChatTitle/AIChatTitleTypes";
import {
  TITLE_MAX_OUTPUT_TOKENS,
  TITLE_REQUEST_BUDGET_MS,
} from "@/service/aiChatTitle/AIChatTitleText";
import {
  buildTitleMessages,
  CHAT_TITLE_PROMPT_VERSION,
} from "@/service/aiChatTitle/AIChatTitlePrompt";
import { validateGeneratedTitle } from "@/service/aiChatTitle/AIChatTitleValidator";
import { SMALL_MODEL_ALIAS } from "@/service/aiProvider/SmallModelAlias";
import { isAutoChatTitlesEnabled } from "@/config/aiChatTitlesSettings";
import { currentTitlePolicyEpoch } from "@/service/aiChatTitle/AIChatTitlePolicyGate";

/** Provider snapshot pinned for one dispatch (titles design §8.3). */
export type ResolvedTitleProvider =
  | { kind: "hosted" }
  | { kind: "local"; config: LocalAIProviderConfig; apiKey: string };

/** Narrow module surface the service depends on (test-injectable). */
export interface AIChatTitleModuleSurface {
  prepareTitleCandidate(
    conversationId: string,
    trustedAssistantMessageId: string | null
  ): Promise<PreparedTitleCandidate>;
  claimTitleAttempt(input: {
    conversationId: string;
    epoch: number;
    revision: number;
    requestId: string;
  }): Promise<boolean>;
  applyGeneratedTitle(input: {
    conversationId: string;
    epoch: number;
    revision: number;
    requestId: string;
    title: string;
    policyCheck?: () => boolean;
  }): Promise<
    | { outcome: "applied"; title: string; revision: number }
    | { outcome: "stale" }
    | { outcome: "missing" }
  >;
  markTitleAttemptFailed(input: {
    conversationId: string;
    requestId: string;
    failureCode: ChatTitleFailureCode;
  }): Promise<void>;
}

export interface AIChatTitleServiceDeps {
  /** Create the per-job module surface (fresh module per job). */
  createModule(): AIChatTitleModuleSurface;
  /**
   * Resolve the provider snapshot for dispatch. Hosted entitlement
   * (Token/USER_AI_ENABLED) is checked here — null means no dispatch.
   */
  resolveTitleProvider(): ResolvedTitleProvider | null;
  /** Pinned-provider nonstreaming completion. Never routes elsewhere. */
  completeTitle(
    provider: ResolvedTitleProvider,
    request: OpenAIChatCompletionRequest,
    signal: AbortSignal
  ): Promise<OpenAIChatCompletionResponse>;
  broadcastTitle(event: ChatTitleUpdatedEvent): void;
  providerConfigVersion(): number;
  isAutoTitlesEnabled?(): boolean;
  /** True while foreground chat work should take priority. */
  isForegroundBusy(): boolean;
  requestIdFactory(): string;
}

/** In-memory queue capacity; overflow drops the newest unclaimed entry. */
const QUEUE_CAPACITY = 20;

/** Unclaimed entries expire without consuming an attempt (design §6). */
const QUEUE_ENTRY_TTL_MS = 60_000;

/** Foreground-busy recheck cadence while waiting/dispatching. */
const FOREGROUND_POLL_MS = 250;

/** Content-free diagnostic counters (titles design §12; no telemetry). */
export interface AIChatTitleDiagnostics {
  candidates: number;
  eligible: number;
  claimed: number;
  dispatched: number;
  succeeded: number;
  stale: number;
  queueFull: number;
  expired: number;
  droppedFeatureDisabled: number;
  droppedProviderUnavailable: number;
  droppedMissingModel: number;
  failedByCode: Record<string, number>;
  /**
   * §12: actual provider usage from the last successful response when the
   * provider reported it (never fabricated; absent -> unknown).
   */
  lastProviderUsage: { promptTokens: number; completionTokens: number } | null;
  /** B24: bounded dispatch-duration samples (ms), newest last. */
  dispatchDurationsMs: number[];
  /** B24: estimated serialized input bytes of the last dispatch. */
  lastBudgetEstimateBytes: number | null;
  /** B24: claim races lost (conditional update matched zero rows). */
  claimsLost: number;
  /**
   * F16: bounded per-attempt outcome metadata (last 50). Usage is
   * "provider"-measured when reported and "unknown" otherwise — a prior
   * request's numbers never stand in for a later one, including
   * provider-charged invalid output.
   */
  attemptRecords: Array<{
    requestId: string;
    outcome: string;
    providerKind: string;
    promptVersion: string;
    durationMs: number;
    budgetEstimateBytes: number | null;
    usage: { promptTokens: number; completionTokens: number } | null;
    usageSource: "provider" | "unknown";
  }>;
}

interface QueueEntry {
  readonly conversationId: string;
  readonly enqueuedAt: number;
  /** B03: provider config version captured at the source exchange. */
  readonly sourceVersion: number;
  /** B02: the completed assistant message this notification is bound to. */
  readonly assistantMessageId: string | null;
}

function emptyDiagnostics(): AIChatTitleDiagnostics {
  return {
    candidates: 0,
    eligible: 0,
    claimed: 0,
    dispatched: 0,
    succeeded: 0,
    stale: 0,
    queueFull: 0,
    expired: 0,
    droppedFeatureDisabled: 0,
    droppedProviderUnavailable: 0,
    droppedMissingModel: 0,
    failedByCode: {},
    lastProviderUsage: null,
    dispatchDurationsMs: [],
    lastBudgetEstimateBytes: null,
    claimsLost: 0,
    attemptRecords: [],
  };
}

/** B13: an EXPLICIT non-stop finish reason is not eligible output. */
function raw_envelopeInvalid(
  finishReason: string | null | undefined,
  hasToolCalls: boolean,
  refusal: string | null
): boolean {
  // Review #15: a missing finish_reason is accepted — OpenAI-compatible
  // local servers legitimately omit it; actual truncation carries an
  // explicit "length"/"content_filter" marker which IS rejected below.
  if (
    finishReason !== undefined &&
    finishReason !== null &&
    finishReason !== "stop"
  ) {
    return true;
  }
  return hasToolCalls || (refusal !== null && refusal.length > 0);
}

function extractAssistantText(
  response: OpenAIChatCompletionResponse
): string | null {
  const content = response.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : null;
}

/**
 * Main-process background title generation (titles design §6).
 *
 * Consumes nonblocking notifications fired after durable interactive
 * completion (coordinator dispatch + queue drain). One attempt per
 * conversation lifecycle, claimed through a conditional DB write; no
 * automatic retry after dispatch. Title failures never propagate into the
 * chat run pipeline.
 */
export class AIChatTitleService {
  private readonly queue = new Map<string, QueueEntry>();
  private disposed = false;
  private running = false;
  private pumpScheduled = false;
  private activeAbort: AbortController | null = null;
  private activeConversationId: string | null = null;
  private readonly diagnostics: AIChatTitleDiagnostics = emptyDiagnostics();

  constructor(private readonly deps: AIChatTitleServiceDeps) {}

  /**
   * Nonblocking enqueue after a durably completed interactive exchange.
   * Duplicate notifications (both owners) dedupe on conversation id.
   */
  notifyInteractiveTurnCompleted(input: {
    conversationId: string;
    assistantMessageId: string | null;
    /**
     * F01: provider config version captured at SOURCE TURN EXECUTION. When
     * absent (legacy callers/tests), the notification-time version is used.
     */
    sourceProviderVersion?: number;
  }): void {
    const conversationId = input.conversationId;
    if (conversationId.length === 0 || this.disposed) return;
    this.diagnostics.candidates += 1;
    if (this.queue.has(conversationId)) return; // AC-03 dedupe
    if (this.queue.size >= QUEUE_CAPACITY) {
      this.diagnostics.queueFull += 1; // drop the newest candidate; row stays pending
      return;
    }
    this.queue.set(conversationId, {
      conversationId,
      enqueuedAt: Date.now(),
      // F01/B03: bind the candidate to the provider that EXECUTED the source
      // exchange — a settings change after the turn started discards the
      // job even before the pump.
      sourceVersion:
        input.sourceProviderVersion ?? this.deps.providerConfigVersion(),
      assistantMessageId: input.assistantMessageId,
    });
    this.schedulePump();
  }

  /** Why the active dispatch's controller was aborted (B24 classification). */
  private activeAbortReason: "deadline" | "foreground" | "cancelled" | null = null;

  /** Best-effort cancel: drop queued work and abort an in-flight dispatch. */
  cancelConversation(conversationId: string): void {
    this.queue.delete(conversationId);
    if (this.activeConversationId === conversationId) {
      this.activeAbortReason = "cancelled";
      this.activeAbort?.abort();
    }
  }

  /**
   * B09: shutdown seal — drops queued work, aborts in-flight dispatch, and
   * rejects future notifications (scope change / app shutdown).
   */
  dispose(): void {
    this.disposed = true;
    this.cancelAll();
  }

  /** Drop all queued work (feature disable / provider change best effort). */
  cancelAll(): void {
    this.queue.clear();
    this.activeAbortReason = "cancelled";
    this.activeAbort?.abort();
  }

  getDiagnostics(): AIChatTitleDiagnostics {
    return {
      ...this.diagnostics,
      failedByCode: { ...this.diagnostics.failedByCode },
      lastProviderUsage: this.diagnostics.lastProviderUsage
        ? { ...this.diagnostics.lastProviderUsage }
        : null,
      dispatchDurationsMs: [...this.diagnostics.dispatchDurationsMs],
      attemptRecords: this.diagnostics.attemptRecords.map((record) => ({
        ...record,
      })),
    };
  }

  resetForTesting(): void {
    this.cancelAll();
    this.queue.clear();
    this.running = false;
    this.pumpScheduled = false;
    Object.assign(this.diagnostics, emptyDiagnostics());
  }

  private isEnabled(): boolean {
    return this.deps.isAutoTitlesEnabled
      ? this.deps.isAutoTitlesEnabled()
      : isAutoChatTitlesEnabled();
  }

  private schedulePump(): void {
    if (this.pumpScheduled || this.running) return;
    this.pumpScheduled = true;
    setTimeout(() => {
      this.pumpScheduled = false;
      void this.pump();
    }, 0);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    // Feature disabled: unclaimed jobs leave memory; rows stay pending.
    if (!this.isEnabled()) {
      this.diagnostics.droppedFeatureDisabled += this.queue.size;
      this.queue.clear();
      return;
    }
    const entry = this.nextNonExpiredEntry();
    if (!entry) {
      // nextNonExpiredEntry deletes every inspected entry, so a null return
      // implies an empty queue (review #3: no delayed re-pump needed).
      return;
    }
    this.running = true;
    this.activeConversationId = entry.conversationId; // B09: track from pop
    const preparationAbort = new AbortController();
    this.activeAbort = preparationAbort; // cancellable during preparation too
    try {
      await this.process(entry, preparationAbort);
    } catch (err) {
      // B11: a background metadata failure never escapes its feature
      // boundary — record bounded metadata and keep draining the queue.
      this.recordFailure("error");
      void err; // no content logging (PRD §8)
    } finally {
      this.running = false;
      this.activeAbort = null;
      this.activeConversationId = null;
      if (this.queue.size > 0) this.schedulePump();
    }
  }

  private nextNonExpiredEntry(): QueueEntry | null {
    const now = Date.now();
    for (const [conversationId, entry] of this.queue) {
      this.queue.delete(conversationId);
      if (now - entry.enqueuedAt > QUEUE_ENTRY_TTL_MS) {
        this.diagnostics.expired += 1; // no attempt consumed
        continue;
      }
      return entry;
    }
    return null;
  }

  private scheduleDelayedPump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    setTimeout(() => {
      this.pumpScheduled = false;
      void this.pump();
    }, FOREGROUND_POLL_MS);
  }

  private async process(entry: QueueEntry, preparationAbort: AbortController): Promise<void> {
    const conversationId = entry.conversationId;
    const module = this.deps.createModule();
    // B03: the provider identity of the SOURCE exchange; any later change
    // (before claim or dispatch) invalidates the job. versionAtPrepare is
    // captured from the entry, not from "now".
    const versionAtPrepare = entry.sourceVersion;
    if (this.deps.providerConfigVersion() !== versionAtPrepare) {
      // Settings changed between the source exchange and the pump: the
      // excerpt must not travel to the newly selected provider.
      this.recordFailure("provider_changed");
      return;
    }

    // F18 (design §8.4): hosted entitlement / custom-provider availability
    // is resolved BEFORE any context preparation — with AI unavailable the
    // service performs zero candidate reads, excerpt writes, or
    // suppressions. Custom-provider-without-hosted-subscription still works
    // (the resolver's local path carries its own availability).
    const earlyProvider = this.deps.resolveTitleProvider();
    if (!earlyProvider) {
      this.diagnostics.droppedProviderUnavailable += 1;
      return;
    }

    // Foreground chat takes priority: wait for idle capacity, bounded by the
    // entry TTL (expiry drops it without consuming an attempt).
    while (this.deps.isForegroundBusy()) {
      if (Date.now() - entry.enqueuedAt > QUEUE_ENTRY_TTL_MS) {
        this.diagnostics.expired += 1;
        return;
      }
      if (preparationAbort.signal.aborted) return; // B09: cancelled while waiting
      await sleep(FOREGROUND_POLL_MS);
      if (!this.isEnabled()) {
        this.diagnostics.droppedFeatureDisabled += 1;
        return;
      }
    }

    const candidate = await module.prepareTitleCandidate(
      conversationId,
      entry.assistantMessageId
    );
    if (preparationAbort.signal.aborted) return; // B09: cancelled during preparation
    if (candidate.kind !== "eligible") return; // pending_window/not_ready/suppressed
    this.diagnostics.eligible += 1; // B24
    // B15: publish the committed excerpt replacement (revisioned) — windows
    // holding the greeting excerpt converge without waiting for bootstrap.
    if (candidate.excerptRefreshed && candidate.visibleTitle !== null) {
      this.deps.broadcastTitle({
        conversationId,
        title: candidate.visibleTitle,
        titleRevision: candidate.revision,
        titleSource: "excerpt",
      });
    }

    const provider = this.deps.resolveTitleProvider();
    if (!provider) {
      this.diagnostics.droppedProviderUnavailable += 1;
      return;
    }
    let model: string;
    if (provider.kind === "local") {
      const titleModel = provider.config.titleModel?.trim();
      if (!titleModel) {
        this.diagnostics.droppedMissingModel += 1; // AC-05: zero calls
        return;
      }
      model = titleModel;
    } else {
      model = SMALL_MODEL_ALIAS;
    }

    // F05: a cancel/dispose during the awaited claim must still seal this
    // attempt — check immediately after the claim returns.
    if (preparationAbort.signal.aborted || this.disposed) {
      // The claim (if won) is invalidated without any dispatch.
      this.diagnostics.claimsLost += 1;
      return;
    }
    const requestId = this.deps.requestIdFactory();
    const claimed = await module.claimTitleAttempt({
      conversationId,
      epoch: candidate.epoch,
      revision: candidate.revision,
      requestId,
    });
    if (!claimed) {
      // B24: the conditional update matched zero rows — another writer moved
      // the state first.
      this.diagnostics.claimsLost += 1;
      return;
    }
    this.diagnostics.claimed += 1;

    // Recheck configuration immediately after claiming and before sending;
    // if invalidated then, mark the attempt failed WITHOUT sending.
    if (this.deps.providerConfigVersion() !== versionAtPrepare) {
      await module.markTitleAttemptFailed({
        conversationId,
        requestId,
        failureCode: "provider_changed",
      });
      this.recordFailure("provider_changed");
      return;
    }
    if (!this.isEnabled()) {
      await module.markTitleAttemptFailed({
        conversationId,
        requestId,
        failureCode: "feature_disabled",
      });
      this.recordFailure("feature_disabled");
      return;
    }

    const { messages, budget } = buildTitleMessages({
      userText: candidate.userText,
      assistantExcerpt: candidate.assistantExcerpt,
    });
    this.diagnostics.lastBudgetEstimateBytes = budget.bytes; // B24
    const request: OpenAIChatCompletionRequest = {
      messages: messages.map((message) => ({ ...message })),
      model,
      max_tokens: TITLE_MAX_OUTPUT_TOKENS,
      stream: false,
      smallModelFallbackPolicy: "forbid",
      requestPurpose: "chat_title",
      ...(provider.kind === "local" ? { literalModel: true } : {}),
      ...(provider.kind === "hosted"
        ? { callBudgetMs: TITLE_REQUEST_BUDGET_MS }
        : {}),
    };

    if (preparationAbort.signal.aborted || this.disposed) {
      // F05: cancel/dispose landed DURING the awaited claim — the attempt
      // is consumed (claimed above) but nothing is dispatched.
      await module.markTitleAttemptFailed({
        conversationId,
        requestId,
        failureCode: "interrupted",
      });
      this.recordFailure("interrupted");
      return;
    }
    // F05: ONE linked token spans preparation/claim/transport/application —
    // the preparation controller's abort tears down the transport too.
    const controller = new AbortController();
    const abortWithTransport = (): void => controller.abort();
    if (preparationAbort.signal.aborted) controller.abort();
    else preparationAbort.signal.addEventListener("abort", abortWithTransport, {
      once: true,
    });
    this.activeAbort = controller;
    this.activeConversationId = conversationId;
    const deadline = setTimeout(() => {
      this.activeAbortReason = "deadline";
      controller.abort();
    }, TITLE_REQUEST_BUDGET_MS);
    // Foreground preemption mid-flight: abort naming to favor chat; the
    // attempt stays consumed and the excerpt is retained (design §6).
    const foregroundWatch = setInterval(() => {
      if (this.deps.isForegroundBusy()) {
        this.activeAbortReason = "foreground";
        controller.abort();
      }
    }, FOREGROUND_POLL_MS);
    const dispatchedAt = Date.now(); // B24

    try {
      this.diagnostics.dispatched += 1;
      const response = await this.deps.completeTitle(
        provider,
        request,
        controller.signal
      );
      // B13: require an eligible final-text completion envelope. Truncated
      // (finish_reason=length), content-filtered, tool-call, refusal, or
      // malformed responses never reach persistence.
      const choice = response.choices?.[0];
      const finishReason = choice?.finish_reason;
      const hasToolCalls = (choice?.message?.tool_calls?.length ?? 0) > 0;
      const refusal =
        choice?.message?.refusal ?? null;
      const envelopeInvalid =
        raw_envelopeInvalid(finishReason, hasToolCalls, refusal);
      // F16: usage is captured for EVERY returned response — including
      // provider-charged invalid envelopes — and absent usage stays unknown.
      const reportedUsage = response.usage;
      const attemptUsage =
        reportedUsage &&
        typeof reportedUsage.prompt_tokens === "number" &&
        typeof reportedUsage.completion_tokens === "number"
          ? {
              promptTokens: reportedUsage.prompt_tokens,
              completionTokens: reportedUsage.completion_tokens,
            }
          : null;
      if (attemptUsage) {
        this.diagnostics.lastProviderUsage = attemptUsage;
      }
      const raw = envelopeInvalid ? null : extractAssistantText(response);
      const finishOutcome = (outcome: string): void => {
        this.recordAttempt(
          requestId,
          outcome,
          provider.kind,
          Date.now() - dispatchedAt,
          attemptUsage
        );
      };
      if (envelopeInvalid) {
        await module.markTitleAttemptFailed({
          conversationId,
          requestId,
          failureCode: "invalid_output",
        });
        this.recordFailure("invalid_output");
        finishOutcome("invalid_output");
        return;
      }
      if (raw === null) {
        await module.markTitleAttemptFailed({
          conversationId,
          requestId,
          failureCode: "invalid_output",
        });
        this.recordFailure("invalid_output");
        finishOutcome("invalid_output");
        return;
      }
      const validated = validateGeneratedTitle(raw);
      if (!validated.ok) {
        await module.markTitleAttemptFailed({
          conversationId,
          requestId,
          failureCode: "invalid_output",
        });
        this.recordFailure("invalid_output");
        finishOutcome("invalid_output");
        return;
      }
      if (validated.title.length === 0) {
        // Model declined: retain the excerpt, no retry (FR-05).
        await module.markTitleAttemptFailed({
          conversationId,
          requestId,
          failureCode: "invalid_output",
        });
        this.recordFailure("invalid_output");
        finishOutcome("declined");
        return;
      }
      // F05: a dispose during the network call seals the result.
      if (this.disposed || preparationAbort.signal.aborted) {
        await module.markTitleAttemptFailed({
          conversationId,
          requestId,
          failureCode: "interrupted",
        });
        this.recordFailure("interrupted");
        return;
      }
      // FR-10 / design §5.4: recheck the captured configuration version and
      // enabled state BEFORE applying — a settings change or feature disable
      // during the request discards the late result (excerpt retained).
      if (this.deps.providerConfigVersion() !== versionAtPrepare) {
        await module.markTitleAttemptFailed({
          conversationId,
          requestId,
          failureCode: "provider_changed",
        });
        this.recordFailure("provider_changed");
        return;
      }
      if (!this.isEnabled()) {
        await module.markTitleAttemptFailed({
          conversationId,
          requestId,
          failureCode: "feature_disabled",
        });
        this.recordFailure("feature_disabled");
        return;
      }
      // B08: capture the policy gate synchronously; the model re-checks it
      // in the same synchronous block as the conditional UPDATE.
      const epochAtCheck = currentTitlePolicyEpoch();
      const applied = await module.applyGeneratedTitle({
        conversationId,
        epoch: candidate.epoch,
        revision: candidate.revision,
        requestId,
        policyCheck: () => currentTitlePolicyEpoch() === epochAtCheck,
        title: validated.title,
      });
      if (applied.outcome === "applied") {
        this.diagnostics.succeeded += 1;
        this.recordAttempt(
          requestId,
          "succeeded",
          provider.kind,
          Date.now() - dispatchedAt,
          attemptUsage
        );
        // Publish only AFTER the committed write (invariant 4).
        this.deps.broadcastTitle({
          conversationId,
          title: applied.title,
          titleRevision: applied.revision,
          titleSource: "ai",
        });
      } else {
        this.diagnostics.stale += 1; // manual rename/clear won the race
        this.recordAttempt(
          requestId,
          "stale",
          provider.kind,
          Date.now() - dispatchedAt,
          attemptUsage
        );
      }
    } catch (err) {
      const code = this.classifyError(err);
      await module
        .markTitleAttemptFailed({ conversationId, requestId, failureCode: code })
        .catch(() => undefined);
      // Review #5: a specific code recorded above in this block is the
      // attempt's outcome — the catch must not silently relabel it "error".
      if (this.diagnostics.failedByCode[code] === undefined) {
        this.recordFailure(code);
      }
    } finally {
      // B24: bounded duration sample (last 50 dispatches).
      this.diagnostics.dispatchDurationsMs.push(Date.now() - dispatchedAt);
      if (this.diagnostics.dispatchDurationsMs.length > 50) {
        this.diagnostics.dispatchDurationsMs.shift();
      }
      clearTimeout(deadline);
      clearInterval(foregroundWatch);
      preparationAbort.signal.removeEventListener("abort", abortWithTransport);
      this.activeAbortReason = null;
    }
  }

  private classifyError(err: unknown): ChatTitleFailureCode {
    if (err instanceof Error && err.name === "AbortError") {
      // B24: distinguish deadline expiry, foreground preemption, and manual
      // invalidation instead of guessing from the busy snapshot.
      if (this.activeAbortReason === "deadline") return "timeout";
      if (this.activeAbortReason === "foreground") return "interrupted";
      if (this.activeAbortReason === "cancelled") return "interrupted";
      return this.deps.isForegroundBusy() ? "interrupted" : "timeout";
    }
    return "error";
  }

  /** F16: append a bounded per-attempt outcome record. */
  private recordAttempt(
    requestId: string,
    outcome: string,
    providerKind: string,
    durationMs: number,
    usage: { promptTokens: number; completionTokens: number } | null
  ): void {
    this.diagnostics.attemptRecords.push({
      requestId,
      outcome,
      providerKind,
      promptVersion: CHAT_TITLE_PROMPT_VERSION,
      durationMs,
      budgetEstimateBytes: this.diagnostics.lastBudgetEstimateBytes,
      usage,
      usageSource: usage ? "provider" : "unknown",
    });
    if (this.diagnostics.attemptRecords.length > 50) {
      this.diagnostics.attemptRecords.shift();
    }
  }

  private recordFailure(code: ChatTitleFailureCode): void {
    this.diagnostics.failedByCode[code] =
      (this.diagnostics.failedByCode[code] ?? 0) + 1;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
