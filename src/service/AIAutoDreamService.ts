import { AIUserMemoryModule } from "@/modules/AIUserMemoryModule";
import { log } from "@/modules/Logger";
import { AIMemoryConsolidationRunModule } from "@/modules/AIMemoryConsolidationRunModule";
import { AIAutoDreamSourceCollector } from "@/service/AIAutoDreamSourceCollector";
import {
  buildAutoDreamSystemPrompt,
  buildAutoDreamUserPrompt,
  parseAutoDreamModelOutput,
} from "@/service/AIAutoDreamPromptBuilder";
import { attemptAutoDreamJsonRepair } from "@/service/AIAutoDreamJsonRepair";
import type {
  AIChatLightweightCompletionInput,
  AIChatLightweightCompletionResult,
} from "@/service/AIChatLightweightTypes";
import type {
  AIMemoryConsolidationRunView,
  AIAutoDreamStatusView,
} from "@/entityTypes/aiUserMemoryTypes";
import { openAIContentToString } from "@/api/aiChatApi";
import type { OpenAIChatMessage } from "@/api/aiChatApi";

const MIN_HOURS_BETWEEN_RUNS = 24;
const MIN_CHANGED_SOURCES = 5;
const RUNNING_STALE_MS = 60 * 60 * 1000;

export interface AIAutoDreamServiceDeps {
  /**
   * Lightweight completion route for the `user_auto_dream` workload. When the
   * kill switch is on and the provider is hosted, the first attempt sends
   * `model: "small"`; otherwise the provider-normal path is used. Optional
   * background workloads never fall back to the normal model
   * (tech-design §8.1, §9.2).
   */
  completeLightweight(
    input: AIChatLightweightCompletionInput
  ): Promise<AIChatLightweightCompletionResult>;
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
      log.error("[ai-auto-dream] chat trigger failed:", err);
    }
  }

  async evaluateAfterAgentTask(input: {
    agentTaskId: string;
    reason: "agent_task_completed";
  }): Promise<void> {
    try {
      await this.maybeRun({ reason: input.reason });
    } catch (err) {
      log.error("[ai-auto-dream] agent trigger failed:", err);
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

      const messages: OpenAIChatMessage[] = [
        { role: "system", content: buildAutoDreamSystemPrompt() },
        {
          role: "user",
          content: buildAutoDreamUserPrompt({
            activeMemories,
            packets: collected.packets,
          }),
        },
      ];

      // Route through the lightweight service: hosted + kill-switch-on sends
      // `model: "small"` for the first attempt; the route result carries the
      // resolved real model. Optional background work never falls back to the
      // normal model (tech-design §8.1, §9.2).
      const isManual = input.reason === "manual" || input.force === true;
      const result = await this.deps.completeLightweight({
        workload: "user_auto_dream",
        messages,
        manual: isManual,
      });
      const resp = result.response;
      const raw = openAIContentToString(resp.choices?.[0]?.message?.content);
      let parsed = parseAutoDreamModelOutput(
        raw,
        collected.packets,
        activeMemories
      );

      // JSON repair: if the small model returned non-empty but invalid
      // consolidation JSON, send ONE repair request on the same route with
      // the invalid output and the required schema. Never resend the full
      // source prompt unless needed. Never fall back to the normal model
      // (tech-design §9.4). Secret/semantic validation failure is NOT
      // repairable.
      if (!parsed.ok && raw.trim().length > 0) {
        parsed = await attemptAutoDreamJsonRepair({
          workload: "user_auto_dream",
          invalidRaw: raw,
          parsed,
          manual: isManual,
          completeLightweight: (input) => this.deps.completeLightweight(input),
          parse: (r) =>
            parseAutoDreamModelOutput(r, collected.packets, activeMemories),
        });
      }

      if (!parsed.ok) {
        await this.runModule.failRun(
          runView.runId,
          `parse_error: ${parsed.error ?? "unknown"}`
        );
        return await this.runModule.getByRunId(runView.runId);
      }

      // Atomic apply: archive/update/create the memory plan AND mark the run
      // completed with counts, resolved model, and source-derived cursor in
      // ONE transaction. A failure rolls back all mutations; the previous
      // successful cursor remains authoritative. No model call is repeated
      // after a persistence failure (tech-design §14.4, §9.5).
      await this.memoryModule.applyPlanAndCompleteRun({
        runId: runView.runId,
        plan: parsed,
        chatConversationsReviewed: collected.chatConversationCount,
        agentTasksReviewed: collected.agentTaskCount,
        model: resp.model,
        reviewedThrough: collected.reviewedThrough,
      });

      return await this.runModule.getByRunId(runView.runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("[ai-auto-dream] consolidation failed:", err);
      try {
        await this.runModule.failRun(runView.runId, message);
      } catch {
        /* swallow */
      }
      return await this.runModule.getByRunId(runView.runId);
    }
  }
}
