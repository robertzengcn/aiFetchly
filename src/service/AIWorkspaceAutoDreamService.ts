import { AIWorkspaceMemoryModule } from "@/modules/AIWorkspaceMemoryModule";
import { log } from "@/modules/Logger";
import type { WorkspaceMemoryScope } from "@/modules/AIWorkspaceMemoryModule";
import { AIWorkspaceMemoryConsolidationRunModule } from "@/modules/AIWorkspaceMemoryConsolidationRunModule";
import {
  AIAutoDreamSourceCollector,
  groupByWorkspace,
} from "@/service/AIAutoDreamSourceCollector";
import type { WorkspaceAwareAutoDreamSourcePacket } from "@/service/AIAutoDreamSourceCollector";
import { maxPacketUpdatedAt } from "@/service/AIChatPromptBudget";
import {
  buildWorkspaceAutoDreamSystemPrompt,
  buildWorkspaceAutoDreamUserPrompt,
  parseWorkspaceAutoDreamModelOutput,
} from "@/service/AIWorkspaceAutoDreamPromptBuilder";
import type {
  AIWorkspaceMemoryConsolidationRunView,
  AIWorkspaceAutoDreamStatusView,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import type {
  AIChatLightweightCompletionInput,
  AIChatLightweightCompletionResult,
} from "@/service/AIChatLightweightTypes";
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import { openAIContentToString } from "@/api/aiChatApi";

const MIN_HOURS_BETWEEN_RUNS = 24;
const MIN_CHANGED_SOURCES_PER_WORKSPACE = 3;
const MIN_CHANGED_MESSAGES_PER_WORKSPACE = 6;
const RUNNING_STALE_MS = 60 * 60 * 1000;

export interface AIWorkspaceAutoDreamServiceDeps {
  /**
   * Lightweight completion route for the `workspace_auto_dream` workload.
   * Hosted + kill-switch-on sends `model: "small"`; optional background
   * workloads never fall back to the normal model.
   */
  completeLightweight(
    input: AIChatLightweightCompletionInput
  ): Promise<AIChatLightweightCompletionResult>;
  isAIEnabled(): boolean;
  /** Reads the workspace auto-dream toggle; defaults to enabled when absent. */
  isAutoDreamEnabled(): Promise<boolean>;
}

interface WorkspacePacketGroup {
  workspaceKey: string;
  workspaceRoot: string;
  displayName: string;
  packets: WorkspaceAwareAutoDreamSourcePacket[];
}

/**
 * Workspace-scoped counterpart to {@link AIAutoDreamService}. Keeps its OWN
 * in-flight lock so it runs independently of user-memory consolidation.
 *
 * One scheduled evaluation may produce several run records — one per resolved
 * workspace group. Failures (parse error, thrown exception) mark only that
 * group's run failed and never propagate into chat completion.
 */
export class AIWorkspaceAutoDreamService {
  private readonly memoryModule = new AIWorkspaceMemoryModule();
  private readonly runModule = new AIWorkspaceMemoryConsolidationRunModule();
  private readonly sourceCollector = new AIAutoDreamSourceCollector();
  private readonly deps: AIWorkspaceAutoDreamServiceDeps;
  private inFlight: Promise<
    AIWorkspaceMemoryConsolidationRunView[] | null
  > | null = null;

  constructor(deps: AIWorkspaceAutoDreamServiceDeps) {
    this.deps = deps;
  }

  async evaluateAfterChatTurn(input: {
    conversationId: string;
    reason: "assistant_turn_completed";
  }): Promise<void> {
    try {
      await this.maybeRun({ reason: input.reason });
    } catch (err) {
      log.error("[workspace-auto-dream] chat trigger failed:", err);
    }
  }

  async evaluateAfterAgentTask(input: {
    agentTaskId: string;
    reason: "agent_task_completed";
  }): Promise<void> {
    try {
      await this.maybeRun({ reason: input.reason });
    } catch (err) {
      log.error("[workspace-auto-dream] agent trigger failed:", err);
    }
  }

  async runNow(input?: {
    force?: boolean;
    reason?: string;
  }): Promise<AIWorkspaceMemoryConsolidationRunView[]> {
    const force = input?.force === true;
    const result = await this.maybeRun({
      force,
      reason: input?.reason ?? "manual",
    });
    if (!result) {
      throw new Error("Workspace auto-dream run skipped");
    }
    return result;
  }

  async getStatus(): Promise<AIWorkspaceAutoDreamStatusView> {
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
  }): Promise<AIWorkspaceMemoryConsolidationRunView[] | null> {
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
  }): Promise<AIWorkspaceMemoryConsolidationRunView[] | null> {
    if (!this.deps.isAIEnabled()) return null;
    if (!(await this.deps.isAutoDreamEnabled()) && !input.force) return null;

    const staleBefore = new Date(Date.now() - RUNNING_STALE_MS);
    await this.runModule.recoverStaleRunningRuns(staleBefore);

    // Derive reviewedSince from the most recent successful run across all
    // workspaces (a single backstop watermark; per-workspace cooldown is also
    // enforced below).
    let reviewedSince: Date | null = null;
    if (!input.force) {
      const latest = await this.runModule.getLatestSuccessfulRun();
      if (latest?.reviewedThrough) {
        reviewedSince = new Date(latest.reviewedThrough);
      }
    }

    const collected = await this.sourceCollector.collect({ reviewedSince });
    const groups = this.buildGroups(collected.packets);
    if (groups.length === 0) return null;

    const results: AIWorkspaceMemoryConsolidationRunView[] = [];
    for (const group of groups) {
      const view = await this.runForGroup(
        group,
        reviewedSince,
        input.force === true
      );
      if (view) results.push(view);
    }
    return results;
  }

  private buildGroups(
    packets: readonly WorkspaceAwareAutoDreamSourcePacket[]
  ): WorkspacePacketGroup[] {
    const grouped = groupByWorkspace(packets);
    const out: WorkspacePacketGroup[] = [];
    for (const [workspaceKey, list] of grouped.entries()) {
      const first = list[0];
      const ws = first?.workspace;
      if (!ws) continue;
      out.push({
        workspaceKey,
        workspaceRoot: ws.workspaceRoot,
        displayName: ws.displayName,
        packets: list,
      });
    }
    return out;
  }

  private async runForGroup(
    group: WorkspacePacketGroup,
    reviewedSince: Date | null,
    force: boolean
  ): Promise<AIWorkspaceMemoryConsolidationRunView | null> {
    const scope: WorkspaceMemoryScope = {
      workspaceKey: group.workspaceKey,
      workspaceRoot: group.workspaceRoot,
    };

    if (!force) {
      // Per-workspace cooldown.
      const latestForWs = await this.runModule.getLatestSuccessfulRun(
        group.workspaceKey
      );
      if (latestForWs?.finishedAt) {
        const elapsedMs =
          Date.now() - new Date(latestForWs.finishedAt).getTime();
        if (elapsedMs < MIN_HOURS_BETWEEN_RUNS * 60 * 60 * 1000) {
          return null;
        }
      }
      // Skip a workspace that still has a run in flight.
      const runningForWs = await this.runModule.getRunningRun(
        group.workspaceKey
      );
      if (runningForWs) return null;

      if (!hasEnoughChangedContent(group)) {
        return null;
      }
    }

    // Source-derived cursor: the greatest updatedAt among this workspace
    // group's packets. Never use new Date() as a success cursor — advancing
    // the watermark past unprocessed material would skip eligible sources
    // (tech-design §14.1, §14.5).
    const groupReviewedThrough = maxPacketUpdatedAt(group.packets);

    const runView = await this.runModule.startRun({
      workspaceKey: group.workspaceKey,
      reviewedSince: reviewedSince ?? null,
      reviewedThrough: groupReviewedThrough,
    });

    try {
      const activeMemories = await this.memoryModule.listActiveForRetrieval(
        scope,
        200
      );

      const validWorkspaceKeys = new Set([group.workspaceKey]);
      const messages: OpenAIChatMessage[] = [
        { role: "system", content: buildWorkspaceAutoDreamSystemPrompt() },
        {
          role: "user",
          content: buildWorkspaceAutoDreamUserPrompt({
            workspaceKey: group.workspaceKey,
            workspaceRoot: group.workspaceRoot,
            activeMemories,
            packets: group.packets,
          }),
        },
      ];
      // Route through the lightweight service (workspace_auto_dream profile).
      // Hosted + kill-switch-on sends `model: "small"`; optional background
      // workloads never fall back to the normal model (tech-design §8.1, §9.2).
      const isManual = force;
      const result = await this.deps.completeLightweight({
        workload: "workspace_auto_dream",
        messages,
        manual: isManual,
      });
      const resp = result.response;
      const raw = openAIContentToString(resp.choices?.[0]?.message?.content);
      let parsed = parseWorkspaceAutoDreamModelOutput(
        raw,
        validWorkspaceKeys,
        activeMemories
      );

      // JSON repair: one same-route repair request on invalid non-empty
      // output. Never falls back to the normal model (tech-design §9.4).
      if (!parsed.ok && raw.trim().length > 0) {
        const repairMessages: OpenAIChatMessage[] = [
          {
            role: "system",
            content:
              "Return ONLY valid JSON matching the workspace consolidation " +
              "schema. Fix the syntax errors in the provided output.",
          },
          {
            role: "user",
            content: `Invalid output to repair:\n${raw.slice(0, 4000)}`,
          },
        ];
        const repairResult = await this.deps.completeLightweight({
          workload: "workspace_auto_dream",
          messages: repairMessages,
          manual: isManual,
        });
        const repairRaw = openAIContentToString(
          repairResult.response.choices?.[0]?.message?.content
        );
        const repaired = parseWorkspaceAutoDreamModelOutput(
          repairRaw,
          validWorkspaceKeys,
          activeMemories
        );
        if (repaired.ok) {
          parsed = repaired;
        }
      }

      if (!parsed.ok) {
        await this.runModule.failRun(
          runView.runId,
          `parse_error: ${parsed.error ?? "unknown"}`
        );
        return await this.runModule.getByRunId(runView.runId);
      }

      // Atomic apply: memory plan + run completion in one transaction
      // (tech-design §14.4).
      await this.memoryModule.applyPlanAndCompleteRun({
        scope,
        runId: runView.runId,
        plan: parsed,
        chatConversationsReviewed: group.packets.filter(
          (p) => p.sourceKind === "chat_v2"
        ).length,
        agentTasksReviewed: group.packets.filter(
          (p) => p.sourceKind === "agent_task"
        ).length,
        model: resp.model,
        reviewedThrough: groupReviewedThrough,
      });

      return await this.runModule.getByRunId(runView.runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("[workspace-auto-dream] consolidation failed:", err);
      try {
        await this.runModule.failRun(runView.runId, message);
      } catch {
        /* swallow */
      }
      return await this.runModule.getByRunId(runView.runId);
    }
  }
}

function hasEnoughChangedContent(group: WorkspacePacketGroup): boolean {
  if (group.packets.length >= MIN_CHANGED_SOURCES_PER_WORKSPACE) {
    return true;
  }
  const messageCount = group.packets.reduce(
    (sum, packet) => sum + packet.messages.length,
    0
  );
  return messageCount >= MIN_CHANGED_MESSAGES_PER_WORKSPACE;
}
