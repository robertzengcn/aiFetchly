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
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatMessage,
} from "@/api/aiChatApi";
import { MessageType } from "@/entityTypes/commonType";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";

const V2_PREFIX = "v2-";
const MIN_DELTA_MESSAGES = 2;
const FAILURE_CIRCUIT_THRESHOLD = 3;

function isMessageRow(row: {
  messageType?: MessageType;
}): boolean {
  return row.messageType === MessageType.MESSAGE;
}

export interface AIChatCompactAgentDeps {
  completeChat(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse>;
  /** Returns true when the user has AI enabled (USER_AI_ENABLED === 'true'). */
  isEnabled(): boolean;
}

export interface SessionMemoryUpdateInput {
  conversationId: string;
  reason: string;
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
    if (
      !input.conversationId ||
      !input.conversationId.startsWith(V2_PREFIX)
    ) {
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
    // Per-conversation serialization.
    const existing = this.inFlight.get(input.conversationId);
    if (existing) {
      console.log(
        `[ai-chat-compact] session update skipped (already running) conv=${input.conversationId}`
      );
      return;
    }
    const p = this.runSessionMemoryUpdate(input).finally(() => {
      this.inFlight.delete(input.conversationId);
    });
    this.inFlight.set(input.conversationId, p);
    await p;
  }

  private async runSessionMemoryUpdate(
    input: SessionMemoryUpdateInput
  ): Promise<void> {
    try {
      const existing = await this.memory.getByConversation(
        input.conversationId
      );
      if (
        existing &&
        existing.failureCount >= FAILURE_CIRCUIT_THRESHOLD
      ) {
        console.log(
          `[ai-chat-compact] session update skipped (circuit broken) conv=${input.conversationId} failures=${existing.failureCount}`
        );
        return;
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
        console.log(
          `[ai-chat-compact] session update skipped (delta too small) conv=${input.conversationId} delta=${newRows.length}`
        );
        return;
      }

      await this.memory.markUpdating(input.conversationId);

      const newMessages: OpenAIChatMessage[] = newRows.map((r) => ({
        role: r.role as OpenAIChatMessage["role"],
        content: r.content,
      }));
      const req: OpenAIChatCompletionRequest = {
        messages: [
          { role: "system", content: buildSessionMemorySystemPrompt() },
          {
            role: "user",
            content: buildSessionMemoryUserPrompt(
              existing?.summary ?? null,
              newMessages
            ),
          },
        ],
      };
      const startedAt = Date.now();
      const resp = await this.deps.completeChat(req);
      const raw = resp.choices?.[0]?.message?.content ?? "";
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
      console.log(
        `[ai-chat-compact] session update completed conv=${input.conversationId} msgs=${newRows.length} tokens=${tokenEstimate} elapsed=${Date.now() - startedAt}ms`
      );
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
    const rows = await this.v2.getConversationMessages(input.conversationId);
    const sorted = [...rows]
      .filter(isMessageRow)
      .sort((a, b) => {
        const t = a.timestamp.getTime() - b.timestamp.getTime();
        return t !== 0 ? t : a.id - b.id;
      });
    if (sorted.length === 0) {
      throw new Error("No messages to compact");
    }
    const messages: OpenAIChatMessage[] = sorted.map((r) => ({
      role: r.role as OpenAIChatMessage["role"],
      content: r.content,
    }));
    const inputTokenEstimate = this.estimator.estimateMessages(messages);
    const startedAt = Date.now();
    console.log(
      `[ai-chat-compact] full compact started conv=${input.conversationId} msgs=${messages.length} tokens=${inputTokenEstimate}`
    );
    const resp = await this.deps.completeChat({
      messages: [
        { role: "system", content: buildFullCompactSystemPrompt() },
        {
          role: "user",
          content: buildFullCompactUserPrompt(messages),
        },
      ],
      ...(input.model ? { model: input.model } : {}),
    });
    const raw = resp.choices?.[0]?.message?.content ?? "";
    const { summary, ok } = normalizeFullCompactSummary(raw);
    if (!ok) {
      throw new Error("Compact model returned empty summary");
    }
    const last = sorted[sorted.length - 1];
    const first = sorted[0];
    const view = await this.compact.saveFullCompact({
      compactId: `compact-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      conversationId: input.conversationId,
      summary,
      fromMessageId: first.messageId,
      throughMessageId: last.messageId,
      throughTimestamp: last.timestamp,
      sourceMessageCount: sorted.length,
      inputTokenEstimate,
      outputTokenEstimate: this.estimator.estimateText(summary),
      model: resp.model,
      status: "active",
    });
    console.log(
      `[ai-chat-compact] full compact completed conv=${input.conversationId} elapsed=${Date.now() - startedAt}ms`
    );
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
