import { AIWorkspaceMemoryModule } from "@/modules/AIWorkspaceMemoryModule";
import { log } from "@/modules/Logger";
import type { WorkspaceMemoryScope } from "@/modules/AIWorkspaceMemoryModule";
import { AIWorkspaceMemoryConsolidationRunModule } from "@/modules/AIWorkspaceMemoryConsolidationRunModule";
import {
  AIAutoDreamSourceCollector,
  groupByWorkspace,
} from "@/service/AIAutoDreamSourceCollector";
import type { WorkspaceAwareAutoDreamSourcePacket } from "@/service/AIAutoDreamSourceCollector";
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
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";
import { openAIContentToString } from "@/api/aiChatApi";

const MIN_HOURS_BETWEEN_RUNS = 24;
const MIN_CHANGED_SOURCES_PER_WORKSPACE = 3;
const RUNNING_STALE_MS = 60 * 60 * 1000;

export interface AIWorkspaceAutoDreamServiceDeps {
  completeChat(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse>;
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

      if (group.packets.length < MIN_CHANGED_SOURCES_PER_WORKSPACE) {
        return null;
      }
    }

    const runView = await this.runModule.startRun({
      workspaceKey: group.workspaceKey,
      reviewedSince: reviewedSince ?? null,
      reviewedThrough: new Date(),
    });

    try {
      const activeMemories = await this.memoryModule.listActiveForRetrieval(
        scope,
        200
      );

      const validWorkspaceKeys = new Set([group.workspaceKey]);
      const req: OpenAIChatCompletionRequest = {
        messages: [
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
        ],
      };
      const resp = await this.deps.completeChat(req);
      const raw = openAIContentToString(resp.choices?.[0]?.message?.content);
      const parsed = parseWorkspaceAutoDreamModelOutput(
        raw,
        validWorkspaceKeys,
        activeMemories
      );
      if (!parsed.ok) {
        await this.runModule.failRun(
          runView.runId,
          `parse_error: ${parsed.error ?? "unknown"}`
        );
        return await this.runModule.getByRunId(runView.runId);
      }

      // Apply archives first to clear contradictions, then updates, then creates.
      for (const a of parsed.archive) {
        await this.memoryModule.archiveMemory(scope, a.memoryId);
      }
      for (const u of parsed.update) {
        await this.memoryModule.updateMemory(scope, {
          memoryId: u.memoryId,
          ...(u.title !== undefined ? { title: u.title } : {}),
          ...(u.content !== undefined ? { content: u.content } : {}),
          ...(u.confidence !== undefined ? { confidence: u.confidence } : {}),
        });
      }
      for (const c of parsed.create) {
        await this.memoryModule.createMemory(scope, {
          type: c.type,
          title: c.title,
          content: c.content,
          confidence: c.confidence,
          sourceKind: "auto_dream",
          sourceConversationId:
            c.sourceKind === "chat_v2" ? c.sourceId : undefined,
          sourceAgentTaskId:
            c.sourceKind === "agent_task" ? c.sourceId : undefined,
          sourceMessageIds: c.sourceMessageIds,
        });
      }

      await this.runModule.completeRun({
        runId: runView.runId,
        chatConversationsReviewed: group.packets.filter(
          (p) => p.sourceKind === "chat_v2"
        ).length,
        agentTasksReviewed: group.packets.filter(
          (p) => p.sourceKind === "agent_task"
        ).length,
        memoriesCreated: parsed.create.length,
        memoriesUpdated: parsed.update.length,
        memoriesArchived: parsed.archive.length,
        model: resp.model,
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
