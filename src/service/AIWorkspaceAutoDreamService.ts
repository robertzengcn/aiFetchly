import { AIWorkspaceMemoryModule } from "@/modules/AIWorkspaceMemoryModule";
import { log } from "@/modules/Logger";
import type { WorkspaceMemoryScope } from "@/modules/AIWorkspaceMemoryModule";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import { PortableWorkspaceMemoryModule } from "@/modules/PortableWorkspaceMemoryModule";
import type { WorkspaceMemoryScopeContext } from "@/entityTypes/portableWorkspaceMemoryTypes";
import { PortableWorkspaceMemoryService } from "@/service/PortableWorkspaceMemoryService";
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
import { attemptAutoDreamJsonRepair } from "@/service/AIAutoDreamJsonRepair";
import type {
  AIWorkspaceMemoryConsolidationRunView,
  AIWorkspaceAutoDreamStatusView,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import type {
  AIChatLightweightCompletionInput,
  AIChatLightweightCompletionResult,
} from "@/service/AIChatLightweightTypes";
import type {
  OpenAIChatMessage,
  OpenAISmallModelCapability,
} from "@/api/aiChatApi";
import { openAIContentToString } from "@/api/aiChatApi";
import { runBatchedAutoDreamConsolidation } from "@/service/AIAutoDreamBatchRunner";
import type { AIWorkspaceMemoryView } from "@/entityTypes/aiWorkspaceMemoryTypes";
import type { WorkspaceAutoDreamParseResult } from "@/service/AIWorkspaceAutoDreamPromptBuilder";
import { getLightweightProfile } from "@/service/AIChatLightweightProfiles";

/** Frozen profile for the workspace_auto_dream workload. */
const WORKSPACE_AUTO_DREAM_PROFILE = getLightweightProfile(
  "workspace_auto_dream"
);

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
  /**
   * Resolves the hosted small-model capability metadata. Workspace auto-dream
   * uses a conservative 32k context when metadata is absent (tech-design
   * §8.4). Optional so tests can omit it.
   */
  getSmallModelCapability?(): Promise<OpenAISmallModelCapability | null>;
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
  private readonly scopeModule = new WorkspaceMemoryScopeModule();
  private readonly portableModule = new PortableWorkspaceMemoryModule();
  private readonly portableMemory = new PortableWorkspaceMemoryService();
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
    /** Manual panel run: focus this conversation so it is never sliced off by
     * the oldest-first batch cap (dev's portable-memory Phase F). */
    conversationId?: string;
    /** Caller cancellation signal, propagated to every lightweight request
     * and checked before retry/repair/transactional apply (SMBW-011). */
    signal?: AbortSignal;
  }): Promise<AIWorkspaceMemoryConsolidationRunView[]> {
    const force = input?.force === true;
    const result = await this.maybeRun({
      force,
      reason: input?.reason ?? "manual",
      conversationId: input?.conversationId,
      signal: input?.signal,
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
    conversationId?: string;
    signal?: AbortSignal;
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
    conversationId?: string;
    signal?: AbortSignal;
  }): Promise<AIWorkspaceMemoryConsolidationRunView[] | null> {
    if (input.signal?.aborted) return null;
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

    const collected = await this.sourceCollector.collect({
      reviewedSince,
      focusConversationId: input.conversationId,
    });
    const groups = this.buildGroups(collected.packets);
    if (groups.length === 0) {
      log.info(
        `[workspace-auto-dream] skipped: no workspace-bound sources (packets=${
          collected.packets.length
        } focus=${input.conversationId ?? "-"})`
      );
      return null;
    }

    const results: AIWorkspaceMemoryConsolidationRunView[] = [];
    for (const group of groups) {
      // SMBW-011: stop processing further workspace groups once cancelled.
      if (input.signal?.aborted) break;
      const view = await this.runForGroup(
        group,
        reviewedSince,
        input.force === true,
        input.signal
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
    force: boolean,
    signal?: AbortSignal
  ): Promise<AIWorkspaceMemoryConsolidationRunView | null> {
    let scope: WorkspaceMemoryScope = {
      workspaceKey: group.workspaceKey,
      workspaceRoot: group.workspaceRoot,
    };
    let scopeContext: WorkspaceMemoryScopeContext | null = null;
    // Portable-memory Phase A/F (design §19.5): resolve the internal scope so
    // writes land in the scope-keyed rows and legacy rows converge. Best
    // effort — a scope-table failure falls back to the legacy key path.
    try {
      const resolved: WorkspaceMemoryScopeContext =
        await this.scopeModule.resolveLegacyScope({
          workspaceKey: group.workspaceKey,
          workspaceRoot: group.workspaceRoot,
          displayName: group.displayName,
        });
      scopeContext = resolved;
      scope = {
        workspaceKey: resolved.workspaceKey,
        workspaceRoot: resolved.workspaceRoot,
        scopeId: resolved.scopeId,
      };
    } catch {
      // Legacy path unchanged.
    }

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

    // SMBW-008: do not pass the candidate reviewedThrough to startRun — the
    // watermark commits only with the successful applyPlanAndCompleteRun.
    const runView = await this.runModule.startRun({
      workspaceKey: group.workspaceKey,
      reviewedSince: reviewedSince ?? null,
      reviewedThrough: null,
    });

    try {
      const validWorkspaceKeys = new Set([group.workspaceKey]);
      const isManual = force;

      // Total-budgeted batching (SMBW-007): shared runner packs workspace
      // packets into bounded batches, processes each through the lightweight
      // route with one same-route JSON repair, merges the plans, and applies
      // the merged plan + run completion in one transaction scoped to this
      // workspace.
      const outcome =
        await runBatchedAutoDreamConsolidation<WorkspaceAutoDreamParseResult>({
          runId: runView.runId,
          packets: group.packets,
          reviewedThrough: groupReviewedThrough,
          isManual,
          signal,
          completeLightweight: (lwInput) =>
            this.deps.completeLightweight({
              ...lwInput,
              ...(signal ? { signal } : {}),
            }),
          getSmallModelCapability: this.deps.getSmallModelCapability,
          profile: WORKSPACE_AUTO_DREAM_PROFILE,
          memory: {
            listActiveMemories: async () =>
              this.memoryModule.listActiveForRetrieval(scope, 200),
            applyPlanAndCompleteRun: async (applyInput) => {
              signal?.throwIfAborted();
              const parsed = applyInput.plan;
              // Dev's portable-memory handling (Phase A/F, design D-09 / §19.5):
              // portable records are file-first; a SQLite-only archive/update
              // would be reverted. Apply file mutations, then filter portable
              // records out of the SQLite plan. Integrated into the SMBW-007
              // batch runner's apply boundary so the merged plan is handled
              // the same way dev's single-shot path handled parsed.
              let planToApply = parsed;
              let extraMemoriesCreated = 0;
              let extraMemoriesUpdated = 0;
              let extraMemoriesArchived = 0;
              let fileMutationsApplied = false;

              if (scopeContext?.portableEnabled) {
                try {
                  const fileResult =
                    await this.portableMemory.applyAutoDreamFileMutations(
                      scopeContext,
                      parsed
                    );
                  planToApply = fileResult.sqlitePlan;
                  extraMemoriesCreated = fileResult.fileCreated;
                  extraMemoriesUpdated = fileResult.fileUpdated;
                  extraMemoriesArchived = fileResult.fileArchived;
                  fileMutationsApplied = true;
                } catch (err) {
                  log.warn(
                    "[workspace-auto-dream] portable file write failed; sqlite fallback:",
                    err
                  );
                }
              }

              if (!fileMutationsApplied) {
                let skippedPortable = 0;
                const isPortable = async (
                  memoryId: string
                ): Promise<boolean> => {
                  if (!scope.scopeId) return false;
                  try {
                    const state = await this.portableModule.getPortableState(
                      {
                        scopeId: scope.scopeId,
                        workspaceKey: scope.workspaceKey,
                        workspaceRoot: scope.workspaceRoot,
                        displayName: group.displayName,
                        portableEnabled: false,
                        defaultStorageMode: "private-only",
                        importPolicy: "review-new",
                      },
                      memoryId
                    );
                    return state !== null;
                  } catch {
                    return false;
                  }
                };
                const filteredArchive: typeof parsed.archive = [];
                for (const a of parsed.archive) {
                  if (await isPortable(a.memoryId)) {
                    skippedPortable += 1;
                    continue;
                  }
                  filteredArchive.push(a);
                }
                const filteredUpdate: typeof parsed.update = [];
                for (const u of parsed.update) {
                  if (await isPortable(u.memoryId)) {
                    skippedPortable += 1;
                    continue;
                  }
                  filteredUpdate.push(u);
                }
                if (skippedPortable > 0) {
                  log.info(
                    `[workspace-auto-dream] skipped ${skippedPortable} portable record edits (files are authoritative)`
                  );
                }
                planToApply = {
                  ...parsed,
                  archive: filteredArchive,
                  update: filteredUpdate,
                };
              }

              if (
                parsed.create.length === 0 &&
                parsed.update.length === 0 &&
                parsed.archive.length === 0
              ) {
                log.info(
                  `[workspace-auto-dream] empty plan workspace=${group.workspaceKey}`
                );
              }

              return this.memoryModule.applyPlanAndCompleteRun({
                scope,
                runId: applyInput.runId,
                plan: planToApply,
                chatConversationsReviewed: applyInput.chatConversationsReviewed,
                agentTasksReviewed: applyInput.agentTasksReviewed,
                model: applyInput.model,
                reviewedThrough: applyInput.reviewedThrough,
                extraMemoriesCreated,
                extraMemoriesUpdated,
                extraMemoriesArchived,
              });
            },
          },
          prompt: {
            buildSystemPrompt: () => buildWorkspaceAutoDreamSystemPrompt(),
            buildUserPrompt: ({
              activeMemories,
              packets,
            }: {
              activeMemories: ReadonlyArray<AIWorkspaceMemoryView>;
              packets: readonly WorkspaceAwareAutoDreamSourcePacket[];
            }) =>
              buildWorkspaceAutoDreamUserPrompt({
                workspaceKey: group.workspaceKey,
                workspaceRoot: group.workspaceRoot,
                activeMemories,
                packets,
              }),
            parse: (
              raw: string,
              _packets: readonly WorkspaceAwareAutoDreamSourcePacket[],
              activeMemories: ReadonlyArray<AIWorkspaceMemoryView>
            ) =>
              parseWorkspaceAutoDreamModelOutput(
                raw,
                validWorkspaceKeys,
                activeMemories
              ),
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
        log.warn(
          `[workspace-auto-dream] parse_error workspace=${
            group.workspaceKey
          } error=${outcome.error ?? "unknown"}`
        );
        await this.runModule.failRun(
          runView.runId,
          `parse_error: ${outcome.error}`
        );
        return await this.runModule.getByRunId(runView.runId);
      }
      if (outcome.outcome === "cancelled") {
        // SMBW-011: cancellation is not a failure — no cursor advance, no
        // failure recorded. The run record is left for stale-run recovery.
        log.info(
          `[workspace-auto-dream] run cancelled ws=${group.workspaceKey} — no cursor advance, no failure recorded`
        );
        return await this.runModule.getByRunId(runView.runId);
      }
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
