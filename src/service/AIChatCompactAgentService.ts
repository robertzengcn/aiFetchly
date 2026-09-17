import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import type { Token } from "@/modules/token";
import type { USER_AI_ENABLED } from "@/config/usersetting";
import { openAIContentToString } from "@/api/aiChatApi";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";
import { MessageType } from "@/entityTypes/commonType";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";
import type { AIChatCompactionCoordinator } from "@/service/AIChatCompactionCoordinator";
import { UNKNOWN_MODEL_FALLBACK_LIMITS } from "@/service/AIChatRequestBudgetService";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";

const V2_PREFIX = "v2-";
const MIN_DELTA_MESSAGES = 2;
const FAILURE_CIRCUIT_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
/** Trigger session-memory compaction when prompt tokens reach this fraction
 * of the configured context window. Mirrors Claude Code's autocompact layer. */
const SESSION_MEMORY_TOKEN_THRESHOLD_FRACTION = 0.8;
/** Trigger an automatic FULL compact (which actually shrinks the assembled
 * context) when prompt tokens reach this fraction of the model's real context
 * window. Kept in sync with the renderer badge threshold (compact button at
 * 80%) so the badge and the backend agree on when compaction should happen. */
const AUTO_COMPACT_THRESHOLD_FRACTION = 0.8;
/**
 * Fallback context-window size when the model limit is unknown (design §8.1:
 * provisional 8,192-token context, labeled fallback). Never assume 128k — an
 * oversized denominator would delay auto-compact past the real window on
 * small/unknown models (AC-16, AC-23). Matches the dispatch budget profile in
 * AIChatRequestBudgetService.
 */
const DEFAULT_CONTEXT_WINDOW_TOKENS =
  UNKNOWN_MODEL_FALLBACK_LIMITS.contextLimit;
/** Trigger session-memory compaction when more than this long has passed
 * since the last successful update. Mirrors Claude Code's time-based layer. */
const SESSION_MEMORY_MAX_AGE_MS = 60 * 60 * 1000;

function isMessageRow(row: { messageType?: MessageType }): boolean {
  return row.messageType === MessageType.MESSAGE;
}

export interface AIChatCompactAgentDeps {
  completeChat(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse>;
  /** Returns true when the user has AI enabled (USER_AI_ENABLED === 'true'). */
  isEnabled(): boolean;
  /** Resolves the real context window (tokens) for a model. Optional; the
   * §8.1 unknown-model fallback (8,192) is used when omitted. Wired to
   * AIChatModelCatalogService in production so thresholds match the
   * renderer's per-model badge denominator. */
  getContextWindow?(model?: string): Promise<number>;
  /** Notified after a successful automatic full compact so the renderer can
   * drop the context badge immediately (mirrors the manual compact flow). */
  onAutoCompacted?(summary: AIChatCompactSummaryView): void;
  /** Optional: the durable incremental-compaction coordinator (design §11).
   * When present, runFullCompact delegates to coordinator.requestCompaction.
   * When absent, runFullCompact FAILS CLOSED with a budget-checked limitation
   * (the legacy all-history model call was removed and must never return —
   * design §18 rollback). Flag-off therefore means compaction is inoperable,
   * not unbounded. */
  compactionCoordinator?: AIChatCompactionCoordinator;
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
      console.log(
        `[ai-chat-compact] session update skipped (invalid conversationId) reason=${input.reason}`
      );
      return;
    }
    if (!this.deps.isEnabled()) {
      console.log(
        `[ai-chat-compact] session update skipped (AI disabled) conv=${input.conversationId}`
      );
      return;
    }
    // Resolve the model's REAL context window before the in-flight check. The
    // remainder of this method must stay synchronous up to this.inFlight.set
    // so concurrent enqueues dedupe correctly. Falls back to the §8.1
    // unknown-model profile (8,192) when the resolver is not wired.
    const contextWindow = await this.resolveContextWindow(input.model);
    // Per-conversation serialization.
    const existing = this.inFlight.get(input.conversationId);
    if (existing) {
      console.log(
        `[ai-chat-compact] session update skipped (already running) conv=${input.conversationId}`
      );
      return;
    }
    // Threshold gate: skip all DB and LLM work unless either (A) the latest
    // prompt-token count is near the context-window limit, or (B) more than
    // SESSION_MEMORY_MAX_AGE_MS has passed since the last successful update.
    const gate = this.shouldAttemptSessionMemoryUpdate(input, contextWindow);
    if (!gate.attempt) {
      console.log(
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
   * Resolve the model's real context window, or the §8.1 unknown-model
   * fallback (8,192) when no resolver is wired. Never throws (resolver
   * implementations don't throw).
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
      console.log(
        `[ai-chat-compact] auto compact skipped (already running) conv=${input.conversationId}`
      );
      return false;
    }
    const contextWindow = await this.resolveContextWindow(input.model);
    const threshold = Math.floor(
      AUTO_COMPACT_THRESHOLD_FRACTION * contextWindow
    );
    if (input.promptTokens < threshold) {
      console.log(
        `[ai-chat-compact] auto compact skipped (below threshold) conv=${input.conversationId} promptTokens=${input.promptTokens} threshold=${threshold}`
      );
      return false;
    }
    console.log(
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
   *
   * Bounded: the coverage check is a single COUNT query (hasMessagesAfter),
   * never a full conversation load (FR-01/FR-07).
   */
  private async runAutoCompact(
    input: SessionMemoryUpdateInput
  ): Promise<boolean> {
    try {
      const active = await this.compact.getActiveSummary(input.conversationId);
      if (active) {
        const boundaryTime = new Date(active.throughTimestamp);
        // afterRowId=0 is conservative: equal-timestamp rows count as new so
        // timestamp collisions can trigger (safe) extra work, never a skip.
        const hasNew = await this.v2.hasMessagesAfter(
          input.conversationId,
          boundaryTime,
          0
        );
        if (!hasNew) {
          console.log(
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
          console.error(
            "[ai-chat-compact] auto-compact notification failed:",
            err
          );
        }
      }
      return true;
    } catch (err) {
      console.error(
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

  /**
   * Delegate a session-memory update to the shared bounded coordinator
   * (FR-07, AC-23, design §§8/11/16). There is exactly ONE summarization
   * algorithm in this codebase — the coordinator's pack → summarize →
   * validate → checkpoint → publish pipeline. Session memory owns NO second
   * `completeChat` summarizer: every trigger (tiny or oversized delta) goes
   * through section packing with checkpoints, output caps, and the shared
   * retry ceiling. The session-memory store stays readable as advisory
   * fallback for conversations without a published generation. When no
   * coordinator is wired, record a failure with a budget-checked limitation
   * instead of summarizing directly (fail closed, never unbounded).
   */
  private async delegateSessionMemoryToCoordinator(
    input: SessionMemoryUpdateInput
  ): Promise<void> {
    console.log(
      `[ai-chat-compact] session update delegating to bounded coordinator conv=${input.conversationId}`
    );
    if (!this.deps.compactionCoordinator) {
      await this.memory.recordFailure(
        input.conversationId,
        "Session-memory update needs the bounded incremental coordinator; direct summarization is disabled"
      );
      return;
    }
    try {
      await this.memory.markUpdating(input.conversationId);
      const startedAt = Date.now();
      const result = await this.deps.compactionCoordinator.requestCompaction(
        input.conversationId,
        {
          trigger: "session-memory",
          model: input.model,
          summarize: async (systemPrompt: string, userPrompt: string) => {
            const resp = await this.deps.completeChat({
              // Explicit provider output cap (§8.3); oversized output is
              // rejected locally, never blindly cut.
              max_tokens:
                AI_CHAT_RECOVERABLE_DEFAULTS.sectionOutputCapTokens,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              ...(input.model ? { model: input.model } : {}),
            });
            return openAIContentToString(resp.choices?.[0]?.message?.content);
          },
        }
      );
      if (result.state === "cancelled" || result.state === "failed") {
        await this.memory.recordFailure(
          input.conversationId,
          `coordinator session-memory run ${result.state}`
        );
        return;
      }
      await this.memory.resetFailures(input.conversationId);
      this.lastSessionMemoryAt.set(input.conversationId, Date.now());
      console.log(
        `[ai-chat-compact] session update delegated conv=${
          input.conversationId
        } state=${result.state} sections=${result.sectionsPacked} elapsed=${
          Date.now() - startedAt
        }ms`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.memory.recordFailure(input.conversationId, message);
    }
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
          console.log(
            `[ai-chat-compact] circuit breaker cooldown expired conv=${input.conversationId} — retrying`
          );
          await this.memory.resetFailures(input.conversationId);
        } else {
          console.log(
            `[ai-chat-compact] session update skipped (circuit broken) conv=${input.conversationId} failures=${existing.failureCount}`
          );
          return;
        }
      }

      // New-work probe (bounded, never a full load): resolve the
      // covered-through boundary within this conversation, then count message
      // rows after it. Any real delta delegates to the shared bounded
      // coordinator — session memory never summarizes directly (FR-07,
      // AC-23). Deltas below MIN_DELTA_MESSAGES are skipped without waking
      // the model; a capped probe that fills up also delegates (the
      // coordinator pages the rest itself).
      const SESSION_MEMORY_DELTA_PROBE_ROWS = 64;
      if (existing?.coveredThroughMessageId) {
        const boundary = await this.v2.findBoundaryInConversation(
          input.conversationId,
          existing.coveredThroughMessageId
        );
        if (!boundary) {
          // Boundary row is gone (deleted/ambiguous): the coordinator rebuild
          // owns legacy migration via bounded sections.
          console.log(
            `[ai-chat-compact] session update delegating (boundary unresolvable) conv=${input.conversationId}`
          );
          await this.delegateSessionMemoryToCoordinator(input);
          return;
        }
        const after = await this.v2.getMessagesAfter(
          input.conversationId,
          boundary.timestamp,
          boundary.id,
          SESSION_MEMORY_DELTA_PROBE_ROWS + 1
        );
        if (
          after.length <= SESSION_MEMORY_DELTA_PROBE_ROWS &&
          after.filter(isMessageRow).length < MIN_DELTA_MESSAGES
        ) {
          console.log(
            `[ai-chat-compact] session update skipped (delta too small) conv=${input.conversationId}`
          );
          return;
        }
      } else {
        // No prior coverage: probe the head of the archive. Any real backlog
        // delegates — the coordinator pages it in bounded sections.
        const first = await this.v2.getMessagesAfter(
          input.conversationId,
          new Date(0),
          0,
          SESSION_MEMORY_DELTA_PROBE_ROWS + 1
        );
        if (
          first.length <= SESSION_MEMORY_DELTA_PROBE_ROWS &&
          first.filter(isMessageRow).length < MIN_DELTA_MESSAGES
        ) {
          console.log(
            `[ai-chat-compact] session update skipped (delta too small) conv=${input.conversationId}`
          );
          return;
        }
      }
      await this.delegateSessionMemoryToCoordinator(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
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
   * All triggers route through the durable bounded coordinator (design §11,
   * PRD FR-07/FR-08). The legacy all-history summarization path was removed:
   * disabling new publication must never restore unbounded input construction
   * (design §18 rollback). When no coordinator is wired, fail with a
   * budget-checked limitation instead of sending the entire archive.
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
    // Delegate to the durable incremental-compaction coordinator when wired
    // (design §11.1). The coordinator owns packing, summarization, validation,
    // and CAS publication; this service never constructs an all-history
    // input for the new engine.
    if (!this.deps.compactionCoordinator) {
      throw new Error(
        "Compaction unavailable: bounded incremental coordinator is not wired. " +
          "Enable new compaction publication; unbounded all-history summarization is disabled."
      );
    }
    const result = await this.deps.compactionCoordinator.requestCompaction(
        input.conversationId,
        {
          trigger: "manual",
          model: input.model,
          summarize: async (systemPrompt: string, userPrompt: string) => {
            const resp = await this.deps.completeChat({
              // Explicit provider output cap (§8.3); oversized output is
              // rejected locally, never blindly cut.
              max_tokens:
                AI_CHAT_RECOVERABLE_DEFAULTS.sectionOutputCapTokens,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              ...(input.model ? { model: input.model } : {}),
            });
            return openAIContentToString(resp.choices?.[0]?.message?.content);
          },
        }
      );
      // Return a legacy-compatible view. The new engine stores structured
      // summaries in context_generations; this view is a thin adapter so the
      // renderer badge drop + onAutoCompacted hook still fire on completion.
      // Non-terminal run states are preserved, never collapsed to "failed":
      // a history needing more than one batch reports paused (resumable),
      // never a failure (FR-07/FR-09, AC-04/AC-07).
      const status: AIChatCompactSummaryView["status"] =
        result.state === "completed"
          ? "active"
          : result.state === "paused"
            ? "paused"
            : result.state === "joined"
              ? "joined"
              : result.state === "cancelled"
                ? "cancelled"
                : "failed";
      const summary =
        result.state === "completed" && result.generationId
          ? `compaction generation ${result.generationId}`
          : result.state === "paused"
            ? `compaction paused after ${result.sectionsPacked} sections; retry to resume`
            : result.state === "joined"
              ? `joined active compaction run ${result.runId}`
              : result.state === "cancelled"
                ? "compaction cancelled"
                : "compaction failed";
      const view: AIChatCompactSummaryView = {
        compactId: result.runId,
        conversationId: input.conversationId,
        summary,
        fromMessageId: "",
        throughMessageId: "",
        throughTimestamp: new Date().toISOString(),
        sourceMessageCount: result.sectionsPacked,
        inputTokenEstimate: 0,
        outputTokenEstimate: 0,
        model: input.model ?? "",
        status,
      };
      // No onAutoCompacted here: the automatic trigger (runAutoCompact)
      // notifies exactly once after a successful run. The manual IPC flow has
      // its own badge handling and must not fire the auto hook.
      return view;
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
