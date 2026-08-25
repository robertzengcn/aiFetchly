import { AIUserMemoryModule } from "@/modules/AIUserMemoryModule";
import { log } from "@/modules/Logger";
import { AIMemoryConsolidationRunModule } from "@/modules/AIMemoryConsolidationRunModule";
import { AIAutoDreamSourceCollector } from "@/service/AIAutoDreamSourceCollector";
import {
  buildAutoDreamSystemPrompt,
  buildAutoDreamUserPrompt,
  parseAutoDreamModelOutput,
} from "@/service/AIAutoDreamPromptBuilder";
import { runBatchedAutoDreamConsolidation } from "@/service/AIAutoDreamBatchRunner";
import type {
  AIChatLightweightCompletionInput,
  AIChatLightweightCompletionResult,
} from "@/service/AIChatLightweightTypes";
import type {
  AIMemoryConsolidationRunView,
  AIAutoDreamStatusView,
} from "@/entityTypes/aiUserMemoryTypes";
import type {
  OpenAIChatMessage,
  OpenAISmallModelCapability,
} from "@/api/aiChatApi";
import type { AIUserMemoryView } from "@/entityTypes/aiUserMemoryTypes";
import type { AutoDreamSourcePacket } from "@/service/AIAutoDreamSourceCollector";
import type { ParseResult } from "@/service/AIAutoDreamPromptBuilder";
import { getLightweightProfile } from "@/service/AIChatLightweightProfiles";

/** Frozen profile for the user_auto_dream workload. */
const AUTO_DREAM_PROFILE = getLightweightProfile("user_auto_dream");

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
  /**
   * Resolves the hosted small-model capability metadata. Auto-dream uses a
   * conservative 32k context when metadata is absent — it does NOT require a
   * discovered context window (tech-design §8.4). Optional so tests can omit
   * it; an omitted resolver uses the conservative fallback.
   */
  getSmallModelCapability?(): Promise<OpenAISmallModelCapability | null>;
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
      // Total-budgeted batching (SMBW-007): resolve the small-model context
      // (or the conservative 32k fallback), pack active memories + source
      // packets into bounded batches, process each through the lightweight
      // route with one same-route JSON repair, merge the plans, and apply the
      // merged plan in one transactional call. Overflow packets are processed
      // in later batches; an unprocessable packet fails the run locally
      // without advancing the cursor.
      const isManual = input.reason === "manual" || input.force === true;
      const outcome = await runBatchedAutoDreamConsolidation<ParseResult>({
        runId: runView.runId,
        packets: collected.packets,
        reviewedThrough: collected.reviewedThrough,
        isManual,
        completeLightweight: (lwInput) =>
          this.deps.completeLightweight(lwInput),
        getSmallModelCapability: this.deps.getSmallModelCapability,
        profile: AUTO_DREAM_PROFILE,
        memory: {
          listActiveMemories: async () =>
            this.memoryModule.listMemories({ status: "active", limit: 200 }),
          applyPlanAndCompleteRun: async (applyInput) =>
            this.memoryModule.applyPlanAndCompleteRun(applyInput),
        },
        prompt: {
          buildSystemPrompt: () => buildAutoDreamSystemPrompt(),
          buildUserPrompt: ({
            activeMemories,
            packets,
          }: {
            activeMemories: ReadonlyArray<AIUserMemoryView>;
            packets: readonly AutoDreamSourcePacket[];
          }) => buildAutoDreamUserPrompt({ activeMemories, packets }),
          parse: (
            raw: string,
            packets: readonly AutoDreamSourcePacket[],
            activeMemories: ReadonlyArray<AIUserMemoryView>
          ) => parseAutoDreamModelOutput(raw, packets, activeMemories),
        },
      });

      if (outcome.outcome === "unprocessable") {
        await this.runModule.failRun(
          runView.runId,
          `oversized_packet: ${outcome.sourceId}`
        );
        return await this.runModule.getByRunId(runView.runId);
      }
      if (outcome.outcome === "parse_error") {
        await this.runModule.failRun(
          runView.runId,
          `parse_error: ${outcome.error}`
        );
        return await this.runModule.getByRunId(runView.runId);
      }
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
