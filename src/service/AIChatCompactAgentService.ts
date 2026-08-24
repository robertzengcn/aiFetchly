import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import {
  buildSessionMemorySystemPrompt,
  buildSessionMemoryUserPrompt,
  buildFullCompactSystemPrompt,
  buildFullCompactUserPrompt,
  normalizeSessionMemorySummary,
  normalizeFullCompactSummary,
} from "@/service/AIChatCompactPromptBuilder";
import type { Token } from "@/modules/token";
import type { USER_AI_ENABLED } from "@/config/usersetting";
import { openAIContentToString } from "@/api/aiChatApi";
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import type {
  AIChatLightweightCompletionInput,
  AIChatLightweightCompletionResult,
} from "@/service/AIChatLightweightTypes";
import { AIChatLightweightFailure } from "@/service/AIChatLightweightTypes";
import { allowsNormalFallback } from "@/service/AIChatLightweightFailureClassifier";
import { getLightweightProfile } from "@/service/AIChatLightweightProfiles";
import {
  computeLightweightBudget,
  groupMessagesAtomically,
  chunkGroupsByBudget,
  chunkSummariesByBudget,
} from "@/service/AIChatPromptBudget";
import type { OpenAISmallModelCapability } from "@/api/aiChatApi";
import { MessageType } from "@/entityTypes/commonType";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { log } from "@/modules/Logger";

const V2_PREFIX = "v2-";
const MIN_DELTA_MESSAGES = 2;
const FAILURE_CIRCUIT_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
/** Trigger session-memory compaction when prompt tokens reach this fraction
 * of the configured context window. Mirrors Claude Code's autocompact layer.
 * Kept at 70% to leave headroom for intra-turn tool growth. */
const SESSION_MEMORY_TOKEN_THRESHOLD_FRACTION = 0.7;
/** Trigger an automatic FULL compact (which actually shrinks the assembled
 * context) when prompt tokens reach this fraction of the model's real context
 * window. Kept at 70% to leave headroom for intra-turn tool-call/result growth
 * (a single turn with multiple tool rounds can easily add 100k+ tokens of tool
 * results). The renderer badge threshold stays at 80% so the user sees the
 * badge slightly before the backend triggers. */
const AUTO_COMPACT_THRESHOLD_FRACTION = 0.7;
/** Fallback context-window size when the model limit is unknown. */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
/** Trigger session-memory compaction when more than this long has passed
 * since the last successful update. Mirrors Claude Code's time-based layer. */
const SESSION_MEMORY_MAX_AGE_MS = 60 * 60 * 1000;

function isMessageRow(row: { messageType?: MessageType }): boolean {
  return row.messageType === MessageType.MESSAGE;
}

export interface AIChatCompactAgentDeps {
  /**
   * Lightweight completion route. Session-memory summaries use the
   * `session_memory_summary` profile (hosted + kill-switch-on sends
   * `model: "small"`); full compact uses `conversation_compact` with its
   * controlled fallback. Optional background workloads never fall back to
   * the normal model (tech-design §8.1, §9.2).
   */
  completeLightweight(
    input: AIChatLightweightCompletionInput
  ): Promise<AIChatLightweightCompletionResult>;
  /** Returns true when the user has AI enabled (USER_AI_ENABLED === 'true'). */
  isEnabled(): boolean;
  /** Resolves the real context window (tokens) for a model. Optional; the
   * 128k fallback is used when omitted. Wired to AIChatModelCatalogService in
   * production so thresholds match the renderer's per-model badge denominator. */
  getContextWindow?(model?: string): Promise<number>;
  /** Resolves the hosted small-model capability metadata. Full compact uses
   * this to gate the small route: absent/invalid metadata means the small
   * route is not eligible and compact goes directly to the normal model
   * (tech-design §8.4, §16.1). */
  getSmallModelCapability?(): Promise<OpenAISmallModelCapability | null>;
  /** Notified after a successful automatic full compact so the renderer can
   * drop the context badge immediately (mirrors the manual compact flow). */
  onAutoCompacted?(summary: AIChatCompactSummaryView): void;
}

export interface SessionMemoryUpdateInput {
  conversationId: string;
  reason: string;
  /** Real prompt-token count from the API usage event. When provided,
   * enables token-based threshold gating. */
  promptTokens?: number;
  /** Model used by the triggering chat turn; forwarded to the compact request. */
  model?: string;
}

export interface FullCompactInput {
  conversationId: string;
  model?: string;
}

export class AIChatCompactAgentService {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly memory = new AIChatSessionMemoryModule();
  private readonly compact = new AIChatCompactModule();
  private readonly v2 = new AIChatV2Module();
  private readonly estimator = new AIChatTokenEstimator();
  /** Per-conversation latest known prompt-token count from the API. */
  private readonly lastPromptTokens = new Map<string, number>();
  /** Per-conversation epoch-ms of the last successful session-memory update.
   * In-memory only; resets on process restart (acceptable: the first turn
   * after restart falls through to MIN_DELTA_MESSAGES inside the runner). */
  private readonly lastSessionMemoryAt = new Map<string, number>();

  constructor(
    private readonly tokenService: Token,
    private readonly deps: AIChatCompactAgentDeps
  ) {}

  /**
   * Enqueue a background session-memory update. Never throws.
   * Resolves once the update is skipped, completed, or failed.
   */
  async enqueueSessionMemoryUpdate(
    input: SessionMemoryUpdateInput
  ): Promise<void> {
    if (!input.conversationId || !input.conversationId.startsWith(V2_PREFIX)) {
      log.info(
        `[ai-chat-compact] session update skipped (invalid conversationId) reason=${input.reason}`
      );
      return;
    }
    if (!this.deps.isEnabled()) {
      log.info(
        `[ai-chat-compact] session update skipped (AI disabled) conv=${input.conversationId}`
      );
      return;
    }
    // Resolve the model's REAL context window before the in-flight check. The
    // remainder of this method must stay synchronous up to this.inFlight.set
    // so concurrent enqueues dedupe correctly. Falls back to 128k when the
    // resolver is not wired (tests) — matching the renderer's default.
    const contextWindow = await this.resolveContextWindow(input.model);
    // Per-conversation serialization.
    const existing = this.inFlight.get(input.conversationId);
    if (existing) {
      log.info(
        `[ai-chat-compact] session update skipped (already running) conv=${input.conversationId}`
      );
      return;
    }
    // Threshold gate: skip all DB and LLM work unless either (A) the latest
    // prompt-token count is near the context-window limit, or (B) more than
    // SESSION_MEMORY_MAX_AGE_MS has passed since the last successful update.
    const gate = this.shouldAttemptSessionMemoryUpdate(input, contextWindow);
    if (!gate.attempt) {
      log.info(
        `[ai-chat-compact] session update skipped (threshold gate) conv=${
          input.conversationId
        } reason=${gate.reason} promptTokens=${
          this.lastPromptTokens.get(input.conversationId) ?? "n/a"
        }`
      );
      return;
    }
    const p = this.runSessionMemoryUpdate(input).finally(() => {
      this.inFlight.delete(input.conversationId);
    });
    this.inFlight.set(input.conversationId, p);
    await p;
  }

  /**
   * Resolve the model's real context window, or the 128k fallback when no
   * resolver is wired. Never throws (resolver implementations don't throw).
   */
  private async resolveContextWindow(model?: string): Promise<number> {
    return this.deps.getContextWindow
      ? this.deps.getContextWindow(model)
      : DEFAULT_CONTEXT_WINDOW_TOKENS;
  }

  /**
   * Enqueue an automatic FULL compact when the turn's prompt tokens reach the
   * threshold fraction of the model's real context window. Unlike a session
   * memory update, a full compact creates a boundary that actually shrinks
   * the assembled context on the next turn. Returns true when a compact was
   * saved. Never throws.
   */
  async enqueueAutoCompact(input: SessionMemoryUpdateInput): Promise<boolean> {
    if (!input.conversationId || !input.conversationId.startsWith(V2_PREFIX)) {
      return false;
    }
    if (!this.deps.isEnabled()) {
      return false;
    }
    if (typeof input.promptTokens !== "number" || input.promptTokens <= 0) {
      return false;
    }
    // Track the latest prompt tokens (mirrors the session-memory gate) so the
    // session-memory path re-evaluates against the freshest count next turn.
    this.lastPromptTokens.set(input.conversationId, input.promptTokens);
    const existing = this.inFlight.get(input.conversationId);
    if (existing) {
      log.info(
        `[ai-chat-compact] auto compact skipped (already running) conv=${input.conversationId}`
      );
      return false;
    }
    const contextWindow = await this.resolveContextWindow(input.model);
    const threshold = Math.floor(
      AUTO_COMPACT_THRESHOLD_FRACTION * contextWindow
    );
    if (input.promptTokens < threshold) {
      log.info(
        `[ai-chat-compact] auto compact skipped (below threshold) conv=${input.conversationId} promptTokens=${input.promptTokens} threshold=${threshold}`
      );
      return false;
    }
    log.info(
      `[ai-chat-compact] auto compact triggered conv=${input.conversationId} promptTokens=${input.promptTokens} threshold=${threshold} window=${contextWindow}`
    );
    let compacted = false;
    const p = this.runAutoCompact(input)
      .then((ran) => {
        compacted = ran;
      })
      .finally(() => {
        this.inFlight.delete(input.conversationId);
      });
    this.inFlight.set(input.conversationId, p);
    await p;
    return compacted;
  }

  /**
   * Run the auto full compact: skip when the active compact boundary already
   * covers every message row (prevents compact loops when the summary itself
   * fills the window), otherwise reuse runFullCompact and notify listeners.
   * Returns true when a new compact was saved. Never throws.
   */
  private async runAutoCompact(
    input: SessionMemoryUpdateInput
  ): Promise<boolean> {
    try {
      const [active, rows] = await Promise.all([
        this.compact.getActiveSummary(input.conversationId),
        this.v2.getConversationMessages(input.conversationId),
      ]);
      if (active) {
        const boundaryTime = new Date(active.throughTimestamp).getTime();
        const hasNewMessages = rows.some(
          (r) => isMessageRow(r) && r.timestamp.getTime() > boundaryTime
        );
        if (!hasNewMessages) {
          log.info(
            `[ai-chat-compact] auto compact skipped (boundary covers all messages) conv=${input.conversationId}`
          );
          return false;
        }
      }
      const summary = await this.runFullCompact({
        conversationId: input.conversationId,
        model: input.model,
      });
      if (this.deps.onAutoCompacted) {
        try {
          this.deps.onAutoCompacted(summary);
        } catch (err) {
          log.error("[ai-chat-compact] auto-compact notification failed:", err);
        }
      }
      return true;
    } catch (err) {
      log.error(
        `[ai-chat-compact] auto compact failed conv=${input.conversationId}:`,
        err
      );
      return false;
    }
  }

  /**
   * Decide whether to actually run a session-memory update this turn.
   * Cheap, in-memory only — never touches the DB. Always tracks the latest
   * promptTokens even when skipping, so the gate re-evaluates next turn.
   */
  private shouldAttemptSessionMemoryUpdate(
    input: SessionMemoryUpdateInput,
    contextWindow: number
  ): { attempt: true; reason: string } | { attempt: false; reason: string } {
    if (typeof input.promptTokens === "number") {
      this.lastPromptTokens.set(input.conversationId, input.promptTokens);
    }
    const lastTokens = this.lastPromptTokens.get(input.conversationId) ?? 0;
    const tokenThreshold = Math.floor(
      SESSION_MEMORY_TOKEN_THRESHOLD_FRACTION * contextWindow
    );
    const nearLimit = lastTokens >= tokenThreshold;
    if (nearLimit) {
      return {
        attempt: true,
        reason: `prompt_tokens=${lastTokens}>=${tokenThreshold}`,
      };
    }
    // Lazy-initialize the per-conversation timestamp on first observation.
    // Using 0 (Unix epoch) as the default would make Date.now() - 0 always
    // exceed SESSION_MEMORY_MAX_AGE_MS, causing the time gate to fire on
    // every fresh conversation. Seeding to now ensures the time gate starts
    // closed and only opens after 60 min of actual inactivity.
    let lastAt = this.lastSessionMemoryAt.get(input.conversationId);
    if (lastAt === undefined) {
      lastAt = Date.now();
      this.lastSessionMemoryAt.set(input.conversationId, lastAt);
    }
    const staleByTime = Date.now() - lastAt > SESSION_MEMORY_MAX_AGE_MS;
    if (staleByTime) {
      return {
        attempt: true,
        reason: `stale_ms=${Date.now() - lastAt}>=${SESSION_MEMORY_MAX_AGE_MS}`,
      };
    }
    return {
      attempt: false,
      reason: `prompt_tokens=${lastTokens}<${tokenThreshold} and age_ms=${
        Date.now() - lastAt
      }<${SESSION_MEMORY_MAX_AGE_MS}`,
    };
  }

  private async runSessionMemoryUpdate(
    input: SessionMemoryUpdateInput
  ): Promise<void> {
    try {
      const existing = await this.memory.getByConversation(
        input.conversationId
      );
      if (existing && existing.failureCount >= FAILURE_CIRCUIT_THRESHOLD) {
        // Time-based reset: if the last failure was long ago, give it another try.
        const lastFailureAt = existing.updatedAt
          ? new Date(existing.updatedAt).getTime()
          : 0;
        if (Date.now() - lastFailureAt > CIRCUIT_BREAKER_COOLDOWN_MS) {
          log.info(
            `[ai-chat-compact] circuit breaker cooldown expired conv=${input.conversationId} — retrying`
          );
          await this.memory.resetFailures(input.conversationId);
        } else {
          log.info(
            `[ai-chat-compact] session update skipped (circuit broken) conv=${input.conversationId} failures=${existing.failureCount}`
          );
          return;
        }
      }

      const allRows = await this.v2.getConversationMessages(
        input.conversationId
      );
      const sorted = [...allRows].sort((a, b) => {
        const t = a.timestamp.getTime() - b.timestamp.getTime();
        return t !== 0 ? t : a.id - b.id;
      });
      const boundaryIdx = existing?.coveredThroughMessageId
        ? sorted.findIndex(
            (r) => r.messageId === existing.coveredThroughMessageId
          )
        : -1;
      const newRows = sorted.slice(boundaryIdx + 1).filter(isMessageRow);
      if (newRows.length < MIN_DELTA_MESSAGES) {
        log.info(
          `[ai-chat-compact] session update skipped (delta too small) conv=${input.conversationId} delta=${newRows.length}`
        );
        return;
      }

      await this.memory.markUpdating(input.conversationId);

      const newMessages: OpenAIChatMessage[] = newRows.map((r) => ({
        role: r.role as OpenAIChatMessage["role"],
        content: r.content,
      }));
      const messages: OpenAIChatMessage[] = [
        { role: "system", content: buildSessionMemorySystemPrompt() },
        {
          role: "user",
          content: buildSessionMemoryUserPrompt(
            existing?.summary ?? null,
            newMessages
          ),
        },
      ];
      const startedAt = Date.now();
      // Route through the lightweight service (session_memory_summary profile).
      // Hosted + kill-switch-on sends `model: "small"`; optional background
      // workloads never fall back to the normal model (tech-design §15.2).
      const result = await this.deps.completeLightweight({
        workload: "session_memory_summary",
        messages,
        normalModel: input.model,
        manual: false,
      });
      const resp = result.response;
      const raw = openAIContentToString(resp.choices?.[0]?.message?.content);
      const { summary, ok } = normalizeSessionMemorySummary(raw);
      if (!ok) {
        await this.memory.recordFailure(
          input.conversationId,
          "Compact model returned empty summary"
        );
        return;
      }
      const last = newRows[newRows.length - 1];
      const tokenEstimate = this.estimator.estimateText(summary);
      const priorCount = existing?.sourceMessageCount ?? 0;
      await this.memory.upsertMemory({
        conversationId: input.conversationId,
        summary,
        coveredThroughMessageId: last.messageId,
        coveredThroughTimestamp: last.timestamp,
        sourceMessageCount: priorCount + newRows.length,
        tokenEstimate,
        model: resp.model,
        status: "active",
      });
      await this.memory.resetFailures(input.conversationId);
      this.lastSessionMemoryAt.set(input.conversationId, Date.now());
      log.info(
        `[ai-chat-compact] session update completed conv=${
          input.conversationId
        } msgs=${newRows.length} tokens=${tokenEstimate} elapsed=${
          Date.now() - startedAt
        }ms`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        `[ai-chat-compact] compact failed conv=${input.conversationId}:`,
        err
      );
      try {
        await this.memory.recordFailure(input.conversationId, message);
      } catch {
        // swallow — never propagate failure out of the agent
      }
    }
  }

  /**
   * Run a full compact on demand. Returns the new active summary view.
   * Throws on failure — callers (IPC) are responsible for surfacing errors.
   *
   * Active-boundary reuse (SMBW-002): the active compact summary is loaded
   * BEFORE selecting source rows. When one exists, it is the representation
   * of covered history — only messages strictly after its boundary are sent
   * to the model, and the prior summary is fed in as context. The replacement
   * compact preserves the original `fromMessageId` and accumulates the source
   * count so the boundary never advances past a row excluded from the
   * successful final compact. Missing/stale boundaries fail safely (process
   * the full conversation) instead of silently dropping messages.
   *
   * Hierarchical compact (tech-design §16.2): delta messages are converted to
   * chronological atomic groups, split into budgeted chunks, and summarized
   * map/reduce-style. A conversation that fits one request is summarized
   * once; an oversized conversation is summarized chunk-by-chunk and the
   * chunk summaries are merged into a final validated compact. Intermediate
   * summaries are transient; only the final summary is activated atomically
   * via saveFullCompact. A failure leaves the previous active compact
   * untouched.
   */
  async runFullCompact(
    input: FullCompactInput
  ): Promise<AIChatCompactSummaryView> {
    if (!input.conversationId.startsWith(V2_PREFIX)) {
      throw new Error("Full compact requires a v2- conversation id");
    }
    if (!this.deps.isEnabled()) {
      throw new Error("AI is not enabled");
    }
    // Load the active compact BEFORE selecting source rows so covered history
    // is reused rather than re-sent (SMBW-002).
    const [active, allRows] = await Promise.all([
      this.compact.getActiveSummary(input.conversationId),
      this.v2.getConversationMessages(input.conversationId),
    ]);
    const sorted = [...allRows].filter(isMessageRow).sort((a, b) => {
      const t = a.timestamp.getTime() - b.timestamp.getTime();
      return t !== 0 ? t : a.id - b.id;
    });
    if (sorted.length === 0) {
      if (active) {
        // No message rows at all, but an active compact exists — return it
        // unchanged rather than throwing (nothing new to compact).
        return active;
      }
      throw new Error("No messages to compact");
    }

    // Select only the rows strictly after the active boundary. When the
    // boundary is valid, covered raw rows are not resent and the prior
    // summary stands in for them. A missing/stale boundary fails safely:
    // the full conversation is processed so no message is silently dropped.
    const { deltaRows, reusedBoundary } = this.selectDeltaRows(sorted, active);

    if (deltaRows.length === 0) {
      // The active compact already covers every message row — no new
      // material to compact. Return the existing view without a model call.
      return active ?? this.compactEmptyFallback(input.conversationId);
    }

    const priorSummary = reusedBoundary ? active?.summary ?? null : null;
    const deltaMessages: OpenAIChatMessage[] = deltaRows.map((r) => ({
      role: r.role as OpenAIChatMessage["role"],
      content: r.content,
    }));
    // The prior summary is the representation of covered history; prepend it
    // to the chunking input so (a) its tokens count toward the budget and
    // (b) the first chunk's summary carries the covered context forward.
    const chunkSourceMessages: OpenAIChatMessage[] = priorSummary
      ? [{ role: "assistant", content: priorSummary }, ...deltaMessages]
      : deltaMessages;
    const inputTokenEstimate =
      this.estimator.estimateMessages(chunkSourceMessages);
    const startedAt = Date.now();
    log.info(
      `[ai-chat-compact] full compact started conv=${input.conversationId} msgs=${deltaMessages.length} reused=${reusedBoundary} tokens=${inputTokenEstimate}`
    );

    const budget = await this.computeCompactBudget(input.model);

    // Map/reduce hierarchical summarization. The pipeline runs with the
    // router-level fallback SUPPRESSED on every sub-request — the compact
    // orchestration owns the single allowed normal-model fallback at this
    // boundary so a multi-chunk compact never makes more than one
    // normal-model request (SMBW-004, tech-design §16.3). On a definitive
    // small-route failure that warrants a fallback, the pipeline throws an
    // AIChatLightweightFailure and the wrapper below restarts the whole
    // compact once on the normal route (forceNormalRoute), discarding all
    // transient small intermediates. The restart never touches the small
    // route again, so the whole logical compact performs at most one
    // normal-model sequence.
    try {
      const pipeline = await this.runCompactPipeline(
        chunkSourceMessages,
        priorSummary,
        budget,
        input.model,
        /* forceNormalRoute */ false
      );
      return await this.activateCompact(
        input.conversationId,
        pipeline.summary,
        pipeline.resolvedModel,
        deltaRows,
        reusedBoundary,
        active,
        inputTokenEstimate,
        startedAt,
        pipeline.chunkCount
      );
    } catch (error) {
      if (this.isFallbackEligibleFailure(error)) {
        log.info(
          `[ai-chat-compact] small-route failed (${this.failureReason(
            error
          )}); restarting compact once on the normal route conv=${
            input.conversationId
          }`
        );
        const pipeline = await this.runCompactPipeline(
          chunkSourceMessages,
          priorSummary,
          budget,
          input.model,
          /* forceNormalRoute */ true
        );
        return await this.activateCompact(
          input.conversationId,
          pipeline.summary,
          pipeline.resolvedModel,
          deltaRows,
          reusedBoundary,
          active,
          inputTokenEstimate,
          startedAt,
          pipeline.chunkCount
        );
      }
      throw error;
    }
  }

  /**
   * Run the map+reduce pipeline. On the small route (`forceNormalRoute=false`)
   * every sub-request suppresses the router-level fallback so the
   * orchestration owns the single allowed fallback. On the restart
   * (`forceNormalRoute=true`) every sub-request is sent through the
   * provider-normal path with no small attempt and no fallback — the whole
   * logical compact performs at most one normal-model sequence (SMBW-004).
   */
  private async runCompactPipeline(
    chunkSourceMessages: readonly OpenAIChatMessage[],
    priorSummary: string | null,
    budget: ReturnType<typeof computeLightweightBudget>,
    model: string | undefined,
    forceNormalRoute: boolean
  ): Promise<{ summary: string; resolvedModel: string; chunkCount: number }> {
    const groups = groupMessagesAtomically(chunkSourceMessages);
    const chunks = chunkGroupsByBudget(groups, budget.usablePayloadTokens);
    const { chunkSummaries, singleChunkResponseModel } =
      await this.summarizeChunks(chunks, model, forceNormalRoute);

    const { summary, resolvedModel } =
      chunkSummaries.length === 1
        ? {
            summary: chunkSummaries[0]!,
            // Single-chunk: the chunk's own completion produced the summary, so
            // attribute the resolved model from that response (not the input model).
            resolvedModel: singleChunkResponseModel ?? model ?? "compact",
          }
        : await this.mergeChunkSummaries(
            chunkSummaries,
            priorSummary,
            model,
            forceNormalRoute
          );
    return {
      summary,
      resolvedModel,
      chunkCount: chunkSummaries.length,
    };
  }

  /**
   * Persist the final summary as the active compact. Boundaries represent the
   * actual input the replacement compact covers: when reusing, preserve the
   * original start id and accumulate the source count so the watermark never
   * advances past unprocessed material (SMBW-002).
   */
  private async activateCompact(
    conversationId: string,
    summary: string,
    resolvedModel: string,
    deltaRows: readonly AIChatMessageEntity[],
    reusedBoundary: boolean,
    active: AIChatCompactSummaryView | null,
    inputTokenEstimate: number,
    startedAt: number,
    chunkCount: number
  ): Promise<AIChatCompactSummaryView> {
    const last = deltaRows[deltaRows.length - 1]!;
    const fromMessageId =
      reusedBoundary && active?.fromMessageId
        ? active.fromMessageId
        : deltaRows[0]!.messageId;
    const sourceMessageCount =
      reusedBoundary && active
        ? (active.sourceMessageCount ?? 0) + deltaRows.length
        : deltaRows.length;
    const view = await this.compact.saveFullCompact({
      compactId: `compact-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      conversationId,
      summary,
      fromMessageId,
      throughMessageId: last.messageId,
      throughTimestamp: last.timestamp,
      sourceMessageCount,
      inputTokenEstimate,
      outputTokenEstimate: this.estimator.estimateText(summary),
      model: resolvedModel,
      status: "active",
    });
    log.info(
      `[ai-chat-compact] full compact completed conv=${conversationId} chunks=${chunkCount} elapsed=${
        Date.now() - startedAt
      }ms`
    );
    return view;
  }

  /**
   * True when a thrown failure from the small route is a definitive reason
   * that permits the one allowed normal-model fallback for the logical
   * compact (SMBW-004, tech-design §16.3). Ambiguous / auth / quota /
   * invalid-request failures are NOT eligible and propagate unchanged.
   */
  private isFallbackEligibleFailure(error: unknown): boolean {
    if (error instanceof AIChatLightweightFailure) {
      return allowsNormalFallback(error.reason);
    }
    return false;
  }

  private failureReason(error: unknown): string {
    if (error instanceof AIChatLightweightFailure) {
      return error.reason;
    }
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Select the rows strictly after the active compact's boundary. Returns the
   * delta rows and whether the boundary was successfully reused.
   *
   * Selection order: (1) exact `throughMessageId` row match → slice after it;
   * (2) valid `throughTimestamp` → rows strictly after that time; (3) both
   * missing/invalid → fail safe by processing the full conversation
   * (`reusedBoundary=false`), never silently dropping messages. All rows at
   * the boundary timestamp are treated as eligible (`>`) so timestamp-only
   * cursors cannot skip ties (tech-design §14.1).
   */
  private selectDeltaRows(
    sorted: readonly AIChatMessageEntity[],
    active: AIChatCompactSummaryView | null
  ): { deltaRows: AIChatMessageEntity[]; reusedBoundary: boolean } {
    if (!active) {
      return { deltaRows: [...sorted], reusedBoundary: false };
    }
    const throughId = active.throughMessageId;
    if (throughId) {
      const idx = sorted.findIndex((r) => r.messageId === throughId);
      if (idx >= 0) {
        return { deltaRows: sorted.slice(idx + 1), reusedBoundary: true };
      }
    }
    const throughTs = active.throughTimestamp;
    const boundaryMs = throughTs ? new Date(throughTs).getTime() : NaN;
    if (Number.isFinite(boundaryMs)) {
      return {
        deltaRows: sorted.filter((r) => r.timestamp.getTime() > boundaryMs),
        reusedBoundary: true,
      };
    }
    // Both boundary fields missing/stale: fail safe — process the full
    // conversation rather than drop messages. The prior summary is not fed
    // in because its exact coverage is unknown.
    return { deltaRows: [...sorted], reusedBoundary: false };
  }

  /**
   * Defensive fallback when there is no active compact and no delta rows —
   * should be unreachable because the empty-sorted case throws earlier, but
   * keeps the no-delta return type total.
   */
  private async compactEmptyFallback(
    conversationId: string
  ): Promise<AIChatCompactSummaryView> {
    throw new Error(`No messages to compact for ${conversationId}`);
  }

  /**
   * Capability-aware budget for full compact. Full compact requires a known
   * small-model context window before it will send large input to the small
   * route. When capability metadata is absent/invalid, the lightweight
   * service's kill-switch/provider-normal path handles it (compact goes
   * directly to the normal model; this is NOT counted as the one failure
   * fallback) (tech-design §8.4, §16.1).
   */
  private async computeCompactBudget(
    model: string | undefined
  ): Promise<ReturnType<typeof computeLightweightBudget>> {
    const capability = this.deps.getSmallModelCapability
      ? await this.deps.getSmallModelCapability()
      : null;
    const contextWindow =
      capability?.context_size ?? (await this.resolveContextWindow(model));
    const profileMaxOutput = getLightweightProfile(
      "conversation_compact"
    ).maxOutputTokens;
    const fixedPromptTokens = this.estimator.estimateText(
      buildFullCompactSystemPrompt()
    );
    return computeLightweightBudget({
      contextWindow,
      maxOutputTokens: profileMaxOutput,
      discoveredMaxOutputTokens: capability?.max_tokens,
      fixedPromptTokens,
    });
  }

  /**
   * Map phase: summarize each budgeted chunk through the conversation_compact
   * lightweight route. A failed intermediate chunk throws before any
   * saveFullCompact call, so the previous active compact is untouched.
   */
  private async summarizeChunks(
    chunks: ReadonlyArray<{
      readonly groups: ReadonlyArray<{
        readonly messages: readonly OpenAIChatMessage[];
      }>;
    }>,
    model: string | undefined,
    forceNormalRoute: boolean
  ): Promise<{
    chunkSummaries: string[];
    singleChunkResponseModel: string | undefined;
  }> {
    const chunkSummaries: string[] = [];
    let singleChunkResponseModel: string | undefined;
    for (const chunk of chunks) {
      const chunkMessages = chunk.groups.flatMap(
        (g) => g.messages as OpenAIChatMessage[]
      );
      const result = await this.deps.completeLightweight({
        workload: "conversation_compact",
        messages: [
          { role: "system", content: buildFullCompactSystemPrompt() },
          {
            role: "user",
            content: buildFullCompactUserPrompt(chunkMessages),
          },
        ],
        normalModel: model,
        manual: true,
        // Small route: suppress per-chunk router fallback (the orchestration
        // owns the one fallback). Normal restart: skip the small attempt.
        ...(forceNormalRoute
          ? { forceNormalRoute: true }
          : { allowNormalFallback: false }),
      });
      const raw = openAIContentToString(
        result.response.choices?.[0]?.message?.content
      );
      const { summary, ok } = normalizeFullCompactSummary(raw);
      if (!ok) {
        throw new Error("Compact model returned empty summary for a chunk");
      }
      chunkSummaries.push(summary);
      if (chunks.length === 1) {
        singleChunkResponseModel = result.response.model;
      }
    }
    return { chunkSummaries, singleChunkResponseModel };
  }

  /**
   * Reduce phase: recursively merge chunk summaries into one final validated
   * summary. Each merge request is budgeted: when the summaries (plus the
   * prior active summary) fit one batch, a single merge request produces the
   * final summary; when they do not, the summaries are split into bounded
   * batches, each batch is merged into an intermediate summary, and the
   * intermediates are recursively merged until exactly one final summary
   * remains (SMBW-003). A single summary that cannot fit by itself is
   * deterministically reduced (clamped to the usable budget) before the
   * merge request rather than submitting a knowingly oversized request.
   * Throws on an empty merge result.
   */
  private async mergeChunkSummaries(
    chunkSummaries: readonly string[],
    priorSummary: string | null,
    model: string | undefined,
    forceNormalRoute: boolean
  ): Promise<{ summary: string; resolvedModel: string }> {
    const budget = await this.computeCompactBudget(model);
    const fixedPromptTokens = this.estimator.estimateText(
      buildFullCompactSystemPrompt()
    );
    // The merge budget excludes the fixed system prompt already counted by the
    // chunk-completion budget; the user-prompt scaffolding overhead is
    // bounded by the estimator so the usable merge payload is conservative.
    const mergeUsablePayload = Math.max(
      0,
      budget.usablePayloadTokens - fixedPromptTokens
    );
    // Seed the merge inputs with the prior active summary (covered history)
    // when present so the final compact carries it forward (SMBW-002).
    const inputs: string[] = [];
    if (priorSummary && priorSummary.trim().length > 0) {
      inputs.push(priorSummary);
    }
    for (const s of chunkSummaries) {
      inputs.push(s);
    }
    return this.recursiveMerge(
      inputs,
      mergeUsablePayload,
      model,
      forceNormalRoute
    );
  }

  /**
   * Recursive merge: reduce a list of summary strings to one final summary,
   * budgeting each completion request. Bounded groups of summaries are merged
   * into intermediates; intermediates are recursively merged until one
   * remains. Determinism: identical inputs and budget produce identical batch
   * boundaries (SMBW-003).
   *
   * Termination guarantee: each recursion level strictly reduces the summary
   * count. When the budget is large enough to batch multiple summaries, the
   * batch merge reduces N→ceil(N/batchSize). When the budget is too small for
   * any two summaries to share a batch, the function falls back to a pairwise
   * reduce (merge adjacent pairs) so the count still halves every level — it
   * never re-merges a single summary into a new single summary, which would
   * loop forever (SMBW-003).
   */
  private async recursiveMerge(
    summaries: readonly string[],
    usablePayloadTokens: number,
    model: string | undefined,
    forceNormalRoute: boolean
  ): Promise<{ summary: string; resolvedModel: string }> {
    // Single summary left — it is the final result (clamped if oversized).
    if (summaries.length === 1) {
      return {
        summary: this.clampForMerge(summaries[0]!, usablePayloadTokens),
        resolvedModel: model ?? "compact",
      };
    }
    const batches = chunkSummariesByBudget(summaries, usablePayloadTokens);
    // Progress check: if every summary is alone in its own batch, batching
    // would not reduce the count (N batches → N intermediates → same N).
    // Fall back to a pairwise reduce so the count strictly decreases.
    const batchingMakesProgress =
      batches.length > 0 && batches.length < summaries.length;
    if (batches.length <= 1) {
      // All summaries fit a single merge request.
      const merged = await this.requestMerge(
        batches[0]?.summaries ?? summaries,
        model,
        forceNormalRoute
      );
      return {
        summary: merged.summary,
        resolvedModel: merged.resolvedModel,
      };
    }
    if (!batchingMakesProgress) {
      return this.pairwiseReduce(
        summaries,
        usablePayloadTokens,
        model,
        forceNormalRoute
      );
    }
    // Multiple batches that reduce the count: merge each into an intermediate,
    // then recurse.
    const intermediates: string[] = [];
    let resolvedModel: string | undefined;
    for (const batch of batches) {
      const merged = await this.requestMerge(
        batch.summaries,
        model,
        forceNormalRoute
      );
      intermediates.push(merged.summary);
      if (!resolvedModel) {
        resolvedModel = merged.resolvedModel;
      }
    }
    return this.recursiveMerge(
      intermediates,
      usablePayloadTokens,
      model,
      forceNormalRoute
    );
  }

  /**
   * Pairwise reduce: merge adjacent pairs of summaries. Halves the count each
   * level so recursion always terminates even when the budget is too small to
   * batch. The final odd summary carries forward unchanged into the next
   * level. Used as the termination fallback when batching cannot reduce the
   * count (SMBW-003).
   */
  private async pairwiseReduce(
    summaries: readonly string[],
    usablePayloadTokens: number,
    model: string | undefined,
    forceNormalRoute: boolean
  ): Promise<{ summary: string; resolvedModel: string }> {
    const intermediates: string[] = [];
    let resolvedModel: string | undefined;
    for (let i = 0; i < summaries.length; i += 2) {
      const a = summaries[i]!;
      const b = summaries[i + 1];
      if (b === undefined) {
        // Odd one out — carry forward (clamped to budget).
        intermediates.push(this.clampForMerge(a, usablePayloadTokens));
        continue;
      }
      const merged = await this.requestMerge([a, b], model, forceNormalRoute);
      intermediates.push(merged.summary);
      if (!resolvedModel) {
        resolvedModel = merged.resolvedModel;
      }
    }
    if (intermediates.length === 1) {
      return {
        summary: intermediates[0]!,
        resolvedModel: resolvedModel ?? model ?? "compact",
      };
    }
    return this.recursiveMerge(
      intermediates,
      usablePayloadTokens,
      model,
      forceNormalRoute
    );
  }

  /** One merge completion request over a bounded list of summaries. */
  private async requestMerge(
    summaries: readonly string[],
    model: string | undefined,
    forceNormalRoute: boolean
  ): Promise<{ summary: string; resolvedModel: string }> {
    const inputs: { role: "assistant"; content: string }[] = summaries.map(
      (s) => ({ role: "assistant" as const, content: s })
    );
    const mergeMessages: OpenAIChatMessage[] = [
      { role: "system", content: buildFullCompactSystemPrompt() },
      {
        role: "user",
        content: buildFullCompactUserPrompt(inputs),
      },
    ];
    const mergeResult = await this.deps.completeLightweight({
      workload: "conversation_compact",
      messages: mergeMessages,
      normalModel: model,
      manual: true,
      ...(forceNormalRoute
        ? { forceNormalRoute: true }
        : { allowNormalFallback: false }),
    });
    const mergeRaw = openAIContentToString(
      mergeResult.response.choices?.[0]?.message?.content
    );
    const merged = normalizeFullCompactSummary(mergeRaw);
    if (!merged.ok) {
      throw new Error("Compact model returned empty merged summary");
    }
    return {
      summary: merged.summary,
      resolvedModel: mergeResult.response.model ?? model ?? "compact",
    };
  }

  /**
   * Deterministically reduce a single summary that cannot fit the merge
   * budget by itself. Reduction keeps the headings (structure) and the most
   * recent content, dropping trailing text past the token limit — never
   * silently submitting an oversized request (SMBW-003). A summary that
   * already fits is returned unchanged.
   */
  private clampForMerge(summary: string, usablePayloadTokens: number): string {
    const tokens = this.estimator.estimateText(summary);
    if (tokens <= usablePayloadTokens || usablePayloadTokens <= 0) {
      return summary;
    }
    // Character-based clamp approximating the token budget (the estimator uses
    // length/4 + overhead, so 4 chars per token is a conservative inverse).
    const charBudget = Math.max(0, usablePayloadTokens) * 4;
    if (summary.length <= charBudget) {
      return summary;
    }
    return `${summary.slice(0, charBudget)}…`;
  }
}

/**
 * Production helper: read USER_AI_ENABLED via the Token service.
 * Exported so IPC can pass the same resolver into the agent.
 */
export function makeTokenAiEnabledResolver(
  tokenService: Token,
  settingKey: typeof USER_AI_ENABLED
): () => boolean {
  return () => tokenService.getValue(settingKey) === "true";
}
