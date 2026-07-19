import { AIUserMemoryModule } from "@/modules/AIUserMemoryModule";
import { AIMemoryConsolidationRunModule } from "@/modules/AIMemoryConsolidationRunModule";
import { AIAutoDreamSourceCollector } from "@/service/AIAutoDreamSourceCollector";
import {
  buildAutoDreamSystemPrompt,
  buildAutoDreamUserPrompt,
  parseAutoDreamModelOutput,
} from "@/service/AIAutoDreamPromptBuilder";
import type {
  AIMemoryConsolidationRunView,
  AIAutoDreamStatusView,
} from "@/entityTypes/aiUserMemoryTypes";
import {
  openAIContentToString,
} from "@/api/aiChatApi";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";

const MIN_HOURS_BETWEEN_RUNS = 24;
const MIN_CHANGED_SOURCES = 5;
const RUNNING_STALE_MS = 60 * 60 * 1000;

export interface AIAutoDreamServiceDeps {
  completeChat(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse>;
  isAIEnabled(): boolean;
  /** Resolves to the user-controllable auto-dream toggle. Reads from the
   * system_setting table; defaults to enabled when the row is absent. */
  isAutoDreamEnabled(): Promise<boolean>;
}

export class AIAutoDreamService {
  private readonly memoryModule = new AIUserMemoryModule();
  private readonly runModule = new AIMemoryConsolidationRunModule();
  private readonly sourceCollector = new AIAutoDreamSourceCollector();
  private readonly deps: AIAutoDreamServiceDeps;
  private inFlight: Promise<AIMemoryConsolidationRunView | null> | null = null;

  constructor(deps: AIAutoDreamServiceDeps) {
    this.deps = deps;
  }

  async evaluateAfterChatTurn(input: {
    conversationId: string;
    reason: "assistant_turn_completed";
  }): Promise<void> {
    try {
      await this.maybeRun({ reason: input.reason });
    } catch (err) {
      console.error("[ai-auto-dream] chat trigger failed:", err);
    }
  }

  async evaluateAfterAgentTask(input: {
    agentTaskId: string;
    reason: "agent_task_completed";
  }): Promise<void> {
    try {
      await this.maybeRun({ reason: input.reason });
    } catch (err) {
      console.error("[ai-auto-dream] agent trigger failed:", err);
    }
  }

  async runNow(input?: {
    force?: boolean;
    reason?: string;
  }): Promise<AIMemoryConsolidationRunView> {
    const force = input?.force === true;
    const result = await this.maybeRun({
      force,
      reason: input?.reason ?? "manual",
    });
    if (!result) {
      throw new Error("Auto-dream run skipped");
    }
    return result;
  }

  async getStatus(): Promise<AIAutoDreamStatusView> {
    const [latest, running, autoDreamEnabled] = await Promise.all([
      this.runModule.getLatestSuccessfulRun(),
      this.runModule.getRunningRun(),
      this.deps.isAutoDreamEnabled(),
    ]);
    return {
      aiEnabled: this.deps.isAIEnabled(),
      autoDreamEnabled,
      latestRun: latest ?? undefined,
      runningRun: running ?? undefined,
    };
  }

  private async maybeRun(input: {
    force?: boolean;
    reason: string;
  }): Promise<AIMemoryConsolidationRunView | null> {
    if (this.inFlight) {
      return this.inFlight.then(() => null).catch(() => null);
    }
    const p = this.executeRun(input).finally(() => {
      if (this.inFlight === p) this.inFlight = null;
    });
    this.inFlight = p;
    return p;
  }

  private async executeRun(input: {
    force?: boolean;
    reason: string;
  }): Promise<AIMemoryConsolidationRunView | null> {
    if (!this.deps.isAIEnabled()) return null;
    if (!(await this.deps.isAutoDreamEnabled()) && !input.force) return null;

    const staleBefore = new Date(Date.now() - RUNNING_STALE_MS);
    await this.runModule.recoverStaleRunningRuns(staleBefore);

    const running = await this.runModule.getRunningRun();
    if (running) return null;

    let reviewedSince: Date | null = null;
    if (!input.force) {
      const latest = await this.runModule.getLatestSuccessfulRun();
      if (latest?.finishedAt) {
        const elapsedMs = Date.now() - new Date(latest.finishedAt).getTime();
        if (elapsedMs < MIN_HOURS_BETWEEN_RUNS * 60 * 60 * 1000) return null;
      }
      if (latest?.reviewedThrough) {
        reviewedSince = new Date(latest.reviewedThrough);
      }
    }

    const collected = await this.sourceCollector.collect({ reviewedSince });

    if (!input.force) {
      const totalChanged =
        collected.chatConversationCount + collected.agentTaskCount;
      if (totalChanged < MIN_CHANGED_SOURCES) return null;
    }

    const runView = await this.runModule.startRun({
      reviewedSince: reviewedSince ?? null,
      reviewedThrough: collected.reviewedThrough,
    });

    try {
      const activeMemories = await this.memoryModule.listMemories({
        status: "active",
        limit: 200,
      });

      const req: OpenAIChatCompletionRequest = {
        messages: [
          { role: "system", content: buildAutoDreamSystemPrompt() },
          {
            role: "user",
            content: buildAutoDreamUserPrompt({
              activeMemories,
              packets: collected.packets,
            }),
          },
        ],
      };
      const resp = await this.deps.completeChat(req);
      const raw = openAIContentToString(resp.choices?.[0]?.message?.content);
      const parsed = parseAutoDreamModelOutput(
        raw,
        collected.packets,
        activeMemories
      );
      if (!parsed.ok) {
        await this.runModule.failRun(
          runView.runId,
          `parse_error: ${parsed.error ?? "unknown"}`
        );
        return await this.runModule.getByRunId(runView.runId);
      }

      // Apply archives first to clear contradictions.
      for (const a of parsed.archive) {
        await this.memoryModule.archiveMemory(a.memoryId);
      }
      for (const u of parsed.update) {
        await this.memoryModule.updateMemory({
          memoryId: u.memoryId,
          ...(u.title !== undefined ? { title: u.title } : {}),
          ...(u.content !== undefined ? { content: u.content } : {}),
          ...(u.confidence !== undefined ? { confidence: u.confidence } : {}),
        });
      }
      for (const c of parsed.create) {
        await this.memoryModule.createMemory({
          type: c.type,
          title: c.title,
          content: c.content,
          confidence: c.confidence,
          sourceKind: c.sourceKind === "chat_v2" ? "chat_v2" : "agent_task",
          sourceConversationId:
            c.sourceKind === "chat_v2" ? c.sourceId : undefined,
          sourceAgentTaskId:
            c.sourceKind === "agent_task" ? c.sourceId : undefined,
          sourceMessageIds: c.sourceMessageIds,
        });
      }

      await this.runModule.completeRun({
        runId: runView.runId,
        chatConversationsReviewed: collected.chatConversationCount,
        agentTasksReviewed: collected.agentTaskCount,
        memoriesCreated: parsed.create.length,
        memoriesUpdated: parsed.update.length,
        memoriesArchived: parsed.archive.length,
        model: resp.model,
      });

      return await this.runModule.getByRunId(runView.runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ai-auto-dream] consolidation failed:", err);
      try {
        await this.runModule.failRun(runView.runId, message);
      } catch {
        /* swallow */
      }
      return await this.runModule.getByRunId(runView.runId);
    }
  }
}
