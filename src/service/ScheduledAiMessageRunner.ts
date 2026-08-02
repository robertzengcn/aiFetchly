// src/service/ScheduledAiMessageRunner.ts

import {
  AiChatApi,
  type StreamEvent,
  StreamEventType,
  type ToolFunction,
  type ToolExecutionResult,
} from "@/api/aiChatApi";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED, USERSDBPATH } from "@/config/usersetting";
import { SkillRegistry } from "@/config/skillsRegistry";
import { SkillExecutor } from "@/service/SkillExecutor";
import { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";
import { AiMessageTaskRunModule } from "@/modules/AiMessageTaskRunModule";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import { canAutoApproveScheduledTool } from "@/service/ScheduledAiToolPolicy";
import { skillDefinitionToToolFunction } from "@/entityTypes/skillTypes";
import type {
  AiMessageTaskToolPolicy,
  BlockedToolCallRecord,
} from "@/entityTypes/aiMessageTaskTypes";
import { ScheduleTaskModel } from "@/model/ScheduleTask.model";
import { AIChatQueryEngineFactory } from "@/service/AIChatQueryEngineFactory";
import {
  ScheduledLoopEventSink,
  type ScheduledTurnOutcome,
} from "@/service/ScheduledLoopEventSink";
import {
  AIChatConversationTurnCoordinator,
  type ConversationTurnLease,
} from "@/service/AIChatConversationTurnCoordinator";
import { ScheduledLoopRunRegistry } from "@/service/ScheduledLoopRunRegistry";
import { AIChatConversationUpdateBroadcaster } from "@/service/AIChatConversationUpdateBroadcaster";
import {
  SCHEDULED_LOOP_CONVERSATION_LOCK_WAIT_MS,
  SCHEDULED_LOOP_MAX_CONSECUTIVE_FAILURES,
  SCHEDULED_LOOP_RUN_TIMEOUT_MS,
  nextFutureOccurrence,
} from "@/config/aiChatScheduledLoopConfig";
import type { ChatV2ConversationUpdatedEvent } from "@/entityTypes/aiChatScheduledLoopTypes";

/** Safety limits for a scheduled AI message run. */
interface RunLimits {
  readonly maxRuntimeMs: number;
  readonly maxToolCalls: number;
  readonly maxContinueCalls: number;
  readonly maxAssistantMessageLength: number;
  readonly maxConsecutiveToolFailures: number;
}

const DEFAULT_RUN_LIMITS: RunLimits = {
  maxRuntimeMs: 300_000,
  maxToolCalls: 10,
  maxContinueCalls: 10,
  maxAssistantMessageLength: 100_000,
  maxConsecutiveToolFailures: 5,
};

/** Result of a single scheduled AI message run. */
export interface ScheduledAiMessageRunResult {
  readonly runId: number;
  readonly status: "completed" | "failed" | "timeout" | "blocked_by_policy";
  readonly assistantFinalMessage: string;
  readonly toolCallsCount: number;
  readonly blockedToolCalls: readonly BlockedToolCallRecord[];
  readonly errorMessage?: string;
}

/**
 * Headless runner for scheduled AI message tasks.
 *
 * Does NOT depend on renderer IPC or UI permission prompts.
 * Consumes the AI stream, accumulates tokens, handles tool calls
 * through the task-scoped policy, and persists results.
 */
export class ScheduledAiMessageRunner {
  private readonly aiChatApi: AiChatApi;
  private readonly taskModule: AiMessageTaskModule;
  private readonly runModule: AiMessageTaskRunModule;
  // Lazy-initialized deps for the chat-bound path (kept out of the legacy
  // constructor so standalone runs pay nothing for them).
  private scheduleModelLazy: ScheduleTaskModel | null = null;
  private readonly runRegistry = ScheduledLoopRunRegistry.getInstance();
  private readonly broadcaster =
    AIChatConversationUpdateBroadcaster.getInstance();

  constructor() {
    this.aiChatApi = new AiChatApi();
    this.taskModule = new AiMessageTaskModule();
    this.runModule = new AiMessageTaskRunModule();
  }

  private get scheduleModel(): ScheduleTaskModel {
    if (!this.scheduleModelLazy) {
      const dbPath = new Token().getValue(USERSDBPATH);
      this.scheduleModelLazy = new ScheduleTaskModel(dbPath);
    }
    return this.scheduleModelLazy;
  }

  /**
   * Run a scheduled AI message task.
   *
   * @param taskId - The AI message task ID
   * @param scheduleId - Optional schedule ID that triggered this run
   * @returns The run result with run ID and status
   */
  async run(
    taskId: number,
    scheduleId?: number
  ): Promise<ScheduledAiMessageRunResult> {
    // 1. Check AI enabled
    const token = new Token();
    const aiEnabled = token.getValue(USER_AI_ENABLED);
    if (aiEnabled !== "true") {
      return this.failFast(
        taskId,
        scheduleId,
        "AI features are not enabled. Please upgrade your plan.",
        "AI_DISABLED"
      );
    }

    // 2. Load task configuration
    const task = await this.taskModule.getTask(taskId);
    if (!task) {
      return this.failFast(
        taskId,
        scheduleId,
        `AI message task ${taskId} not found.`,
        "TASK_NOT_FOUND"
      );
    }

    if (task.status !== "active") {
      return this.failFast(
        taskId,
        scheduleId,
        `AI message task ${taskId} is not active (status: ${task.status}).`,
        "TASK_NOT_FOUND"
      );
    }

    // 3. Parse policy and limits
    const policy = this.parseTaskPolicy(task);
    const limits = this.parseRunLimits(task);

    // 4. Create run log
    const runId = await this.runModule.createRun({
      taskId,
      scheduleId,
      conversationId: task.conversation_id ?? undefined,
    });

    await this.runModule.updateRunStatus(runId, "running");

    // 5. Run the AI conversation loop
    try {
      const result = await this.executeRunLoop(runId, task, policy, limits);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await this.runModule.failRun(runId, errorMsg);
      await this.taskModule.updateLastRunResult(taskId, null, errorMsg);
      return {
        runId,
        status: "failed",
        assistantFinalMessage: "",
        toolCallsCount: 0,
        blockedToolCalls: [],
        errorMessage: errorMsg,
      };
    }
  }

  /**
   * Run a chat-bound scheduled-loop occurrence through AIChatQueryEngine so the
   * scheduled user/assistant turns persist in the originating v2-* conversation
   * (FR-4/FR-5, technical-design §17). The run row was already created by the
   * scheduler's atomic claim, so this method executes and finalizes it.
   */
  async runChatScheduledLoop(input: {
    readonly taskId: number;
    readonly scheduleId: number;
    readonly runId: number;
    readonly occurrence: number;
    readonly catchUp: boolean;
    readonly scheduledFor: Date;
  }): Promise<ScheduledAiMessageRunResult> {
    const { taskId, scheduleId, runId, occurrence, catchUp, scheduledFor } =
      input;
    const startedAt = new Date();
    const token = new Token();

    // 1. AI gate at execution time.
    if (token.getValue(USER_AI_ENABLED) !== "true") {
      return this.finalizeChatRun({
        runId,
        taskId,
        scheduleId,
        startedAt,
        outcome: { kind: "failed", errorMessage: "AI_DISABLED" },
        errorCode: "AI_DISABLED",
      });
    }

    // 2. Load task + schedule.
    const task = await this.taskModule.getTask(taskId);
    if (!task || task.source_type !== "chat_scheduled_loop") {
      return this.finalizeChatRun({
        runId,
        taskId,
        scheduleId,
        startedAt,
        outcome: { kind: "failed", errorMessage: "TASK_NOT_FOUND" },
        errorCode: "TASK_NOT_FOUND",
      });
    }
    const schedule = await this.scheduleModel.getScheduleById(scheduleId);
    if (!schedule) {
      return this.finalizeChatRun({
        runId,
        taskId,
        scheduleId,
        startedAt,
        outcome: { kind: "failed", errorMessage: "SCHEDULE_NOT_FOUND" },
        errorCode: "SCHEDULE_EXPIRED",
      });
    }

    // 3. Same-conversation invariant (FR-4).
    const conversationId = schedule.source_conversation_id;
    if (!conversationId || task.conversation_id !== conversationId) {
      await this.scheduleModel.pauseWithReason(
        scheduleId,
        "CONVERSATION_MISMATCH"
      );
      return this.finalizeChatRun({
        runId,
        taskId,
        scheduleId,
        startedAt,
        outcome: { kind: "failed", errorMessage: "CONVERSATION_MISMATCH" },
        errorCode: "CONVERSATION_MISMATCH",
        pauseSchedule: true,
      });
    }

    // 4. Schedule must still be active.
    if (!schedule.is_active) {
      return this.finalizeChatRun({
        runId,
        taskId,
        scheduleId,
        startedAt,
        outcome: { kind: "cancelled", content: "" },
        errorCode: schedule.terminal_reason ?? "SCHEDULE_EXPIRED",
      });
    }

    await this.runModule.updateRunStatus(runId, "running", {
      started_at: startedAt,
    });

    // 5. Acquire the conversation turn lease (FR-7) + register the abort handle.
    const coordinator = AIChatConversationTurnCoordinator.getInstance();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      SCHEDULED_LOOP_RUN_TIMEOUT_MS
    );
    this.runRegistry.register(runId, abortController);
    let lease: ConversationTurnLease | null = null;

    let outcome: ScheduledTurnOutcome;
    try {
      try {
        lease = await coordinator.acquire({
          conversationId,
          owner: "scheduled",
          ownerId: `run-${runId}`,
          waitMs: SCHEDULED_LOOP_CONVERSATION_LOCK_WAIT_MS,
          signal: abortController.signal,
        });
      } catch {
        // Busy or aborted → defer to the next occurrence (coalesced).
        await this.runModule.updateRunStatus(
          runId,
          "waiting_for_conversation",
          {
            error_code: "CONVERSATION_BUSY",
          }
        );
        return {
          runId,
          status: "blocked_by_policy",
          assistantFinalMessage: "",
          toolCallsCount: 0,
          blockedToolCalls: [],
          errorMessage: "CONVERSATION_BUSY",
        };
      }

      // 6-9. Execute through the query engine; the engine persists user +
      // assistant messages in the originating conversation. Tool execution is
      // task-scoped (FR-16): only allowlisted policy-approved tools run. The
      // scheduled context supplies stable message IDs + trusted metadata that
      // the renderer cannot forge, and makes the user/assistant rows idempotent
      // across crash-retries (technical-design §14).
      const engine = new AIChatQueryEngineFactory().createScheduled(
        this.parseTaskPolicy(task)
      );
      const sink = new ScheduledLoopEventSink();
      await engine.submitMessage({
        eventSink: sink,
        request: {
          conversationId,
          message: task.message,
          model: task.model && task.model !== "auto" ? task.model : undefined,
        },
        scheduledContext: {
          source: "scheduled_loop",
          taskId,
          scheduleId,
          runId,
          occurrence,
          scheduledFor: scheduledFor.toISOString(),
          catchUp,
          userMessageId: `scheduled-user-${scheduleId}-${occurrence}`,
          assistantMessageId: `scheduled-assistant-${scheduleId}-${occurrence}`,
        },
      });
      outcome = sink.getOutcome() ?? {
        kind: "failed",
        errorMessage: "NO_TERMINAL_EVENT",
      };
    } finally {
      clearTimeout(timeoutHandle);
      this.runRegistry.unregister(runId);
      if (lease) lease.release();
    }

    return this.finalizeChatRun({
      runId,
      taskId,
      scheduleId,
      startedAt,
      outcome,
      conversationId,
    });
  }

  /**
   * Finalize a chat-bound occurrence: map the engine outcome to a run status,
   * persist the run + schedule counters, and broadcast a refresh hint (FR-11,
   * FR-12, FR-15). Status mapping per technical-design §17.3.
   */
  private async finalizeChatRun(input: {
    runId: number;
    taskId: number;
    scheduleId: number;
    startedAt: Date;
    outcome: ScheduledTurnOutcome;
    conversationId?: string;
    errorCode?: string;
    pauseSchedule?: boolean;
  }): Promise<ScheduledAiMessageRunResult> {
    const {
      runId,
      taskId,
      scheduleId,
      startedAt,
      outcome,
      conversationId,
      errorCode,
      pauseSchedule,
    } = input;
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    let status: ScheduledAiMessageRunResult["status"] = "failed";
    let assistantMessageId: string | undefined;
    let contentSummary = "";
    let scheduleTerminal: "failed" | undefined;
    let scheduleSuccess = false;
    let schedulePause = !!pauseSchedule;
    let resultErrorCode = errorCode;

    switch (outcome.kind) {
      case "completed":
        status = "completed";
        assistantMessageId = outcome.assistantMessageId;
        contentSummary = outcome.content;
        scheduleSuccess = true;
        break;
      case "cancelled":
        status = "failed";
        assistantMessageId = outcome.assistantMessageId;
        contentSummary = outcome.content;
        resultErrorCode = resultErrorCode ?? "RUN_INTERRUPTED";
        break;
      case "failed":
        status = "failed";
        assistantMessageId = outcome.assistantMessageId;
        resultErrorCode = resultErrorCode ?? "REMOTE_AI_ERROR";
        break;
      case "blocked":
        status = "blocked_by_policy";
        schedulePause = true;
        resultErrorCode = resultErrorCode ?? "BLOCKED_BY_POLICY";
        break;
    }

    // Persist the run row (idempotent across retries via stable occurrence key).
    try {
      if (status === "completed") {
        await this.runModule.completeRun(runId, {
          assistantFinalMessage: contentSummary,
          toolCallsCount: 0,
          blockedToolCalls: [],
          metadata: {
            elapsedMs: durationMs,
            assistantMessageId,
            errorCode: resultErrorCode,
          },
        });
      } else {
        await this.runModule.failRun(
          runId,
          contentSummary || resultErrorCode || "failed",
          {
            toolCallsCount: 0,
            blockedToolCalls: [],
            metadata: { elapsedMs: durationMs, assistantMessageId },
          }
        );
      }
      if (assistantMessageId) {
        await this.runModule.updateRunStatus(
          runId,
          status === "completed" ? "completed" : "failed",
          {
            assistant_message_id: assistantMessageId,
            error_code: resultErrorCode ?? null,
            delivery_state: "persisted",
            finished_at: finishedAt,
            duration_ms: durationMs,
          } as never
        );
      }
    } catch {
      // Persistence failures are logged by the module; the run is best-effort.
    }

    // Update schedule counters + terminal state (FR-15).
    try {
      const schedule = await this.scheduleModel.getScheduleById(scheduleId);
      const nowMs = Date.now();
      const nextRunAt =
        schedule && schedule.interval_ms && schedule.interval_anchor_at
          ? new Date(
              nextFutureOccurrence(
                schedule.interval_anchor_at.getTime(),
                schedule.interval_ms,
                nowMs
              ).timeMs
            )
          : new Date(nowMs);

      if (schedulePause) {
        await this.scheduleModel.pauseWithReason(
          scheduleId,
          resultErrorCode ?? "BLOCKED_BY_POLICY"
        );
      } else {
        const consecutive =
          (schedule?.consecutive_failure_count ?? 0) +
          (scheduleSuccess ? 0 : 1);
        const terminal =
          !scheduleSuccess &&
          consecutive >= SCHEDULED_LOOP_MAX_CONSECUTIVE_FAILURES
            ? ("failed" as const)
            : undefined;
        await this.scheduleModel.updateIntervalAfterResult({
          scheduleId,
          success: scheduleSuccess,
          nextRunAt,
          terminalStatus: terminal,
          terminalReason: terminal ? "REPEATED_RUN_FAILURE" : undefined,
        });
      }
    } catch {
      // non-fatal
    }

    // Broadcast a narrow refresh hint to any open renderer (FR-11).
    if (conversationId) {
      const event: ChatV2ConversationUpdatedEvent = {
        conversationId,
        reason:
          status === "completed"
            ? "scheduled_turn_completed"
            : "scheduled_turn_failed",
        scheduleId,
        runId,
        assistantMessageId,
        occurredAt: new Date().toISOString(),
      };
      try {
        this.broadcaster.emit(event);
      } catch {
        // Renderer delivery failure does not fail the run (FR-12).
      }
    }

    void taskId;
    return {
      runId,
      status,
      assistantFinalMessage: contentSummary,
      toolCallsCount: 0,
      blockedToolCalls: [],
      errorMessage: status === "completed" ? undefined : resultErrorCode,
    };
  }

  /**
   * Main AI conversation loop: send message → handle events → continue if tool calls.
   */
  private async executeRunLoop(
    runId: number,
    task: AiMessageTaskEntity,
    policy: AiMessageTaskToolPolicy,
    limits: RunLimits
  ): Promise<ScheduledAiMessageRunResult> {
    const startTime = Date.now();
    let assistantMessage = "";
    let toolCallsCount = 0;
    const continueCalls = 0;
    const consecutiveToolFailures = 0;
    const blockedToolCalls: BlockedToolCallRecord[] = [];

    // Get filtered tool definitions for the AI server
    const clientTools = this.buildFilteredClientTools(policy);

    const abortController = new AbortController();

    // Safety timeout
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, limits.maxRuntimeMs);

    try {
      // Initial message
      await this.aiChatApi.streamMessage(
        {
          message: task.message,
          conversationId: task.conversation_id ?? undefined,
          model: task.model && task.model !== "auto" ? task.model : undefined,
          systemPrompt: task.system_prompt ?? undefined,
          functions: clientTools,
        },
        (event: StreamEvent) => {
          const elapsed = Date.now() - startTime;

          switch (event.event) {
            case StreamEventType.TOKEN: {
              const token =
                typeof event.data.content === "string"
                  ? event.data.content
                  : "";
              if (
                token &&
                assistantMessage.length + token.length <=
                  limits.maxAssistantMessageLength
              ) {
                assistantMessage += token;
              }
              break;
            }

            case StreamEventType.ERROR: {
              const errMsg =
                typeof event.data.content === "string"
                  ? event.data.content
                  : JSON.stringify(event.data.content);
              throw new Error(`REMOTE_AI_ERROR: ${errMsg}`);
            }

            case StreamEventType.TOOL_CALL: {
              // Phase 2: Block all tool calls, send failure result back
              const toolData = event.data.data;
              if (toolData) {
                const blocked: BlockedToolCallRecord = {
                  toolName: toolData.name,
                  toolCallId: toolData.id,
                  reason:
                    "Tool execution is not supported in Phase 2. Scheduled tool calls will be enabled in a future update.",
                  timestamp: new Date().toISOString(),
                  args: toolData.arguments,
                };
                blockedToolCalls.push(blocked);
                toolCallsCount++;
              }
              break;
            }

            case StreamEventType.DONE:
            case StreamEventType.COMPLETE:
              // Stream ended normally
              break;
          }

          // Check runtime limit
          if (elapsed >= limits.maxRuntimeMs) {
            abortController.abort();
          }
        },
        { signal: abortController.signal }
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        // Timed out
        const result: ScheduledAiMessageRunResult = {
          runId,
          status: "timeout",
          assistantFinalMessage: assistantMessage,
          toolCallsCount,
          blockedToolCalls,
          errorMessage: `Run exceeded maximum runtime of ${limits.maxRuntimeMs}ms.`,
        };
        await this.runModule.failRun(runId, result.errorMessage ?? "Timeout", {
          toolCallsCount,
          blockedToolCalls,
          metadata: { elapsedMs: Date.now() - startTime },
        });
        await this.taskModule.updateLastRunResult(
          task.id,
          null,
          result.errorMessage ?? "Timeout"
        );
        return result;
      }
      // Other errors — rethrow to outer catch
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }

    // Persist successful completion
    const finalMessage = assistantMessage || "[No response from AI server]";
    await this.runModule.completeRun(runId, {
      assistantFinalMessage: finalMessage,
      toolCallsCount,
      blockedToolCalls,
      metadata: { elapsedMs: Date.now() - startTime, model: task.model },
    });

    const resultSummary =
      finalMessage.length > 200
        ? finalMessage.substring(0, 200) + "..."
        : finalMessage;
    await this.taskModule.updateLastRunResult(task.id, resultSummary, null);

    return {
      runId,
      status: "completed",
      assistantFinalMessage: finalMessage,
      toolCallsCount,
      blockedToolCalls,
    };
  }

  /**
   * Parse the task's tool policy from entity fields.
   */
  private parseTaskPolicy(task: AiMessageTaskEntity): AiMessageTaskToolPolicy {
    const allowedTools = this.taskModule.parseAllowedTools(task);
    return {
      allowedTools,
      autoApproveTools: task.auto_approve_tools,
      maxToolCalls: task.max_tool_calls,
      maxRuntimeMs: task.max_runtime_ms,
      maxContinueCalls: task.max_continue_calls,
    };
  }

  /**
   * Parse run safety limits from the task entity.
   */
  private parseRunLimits(task: AiMessageTaskEntity): RunLimits {
    return {
      maxRuntimeMs: task.max_runtime_ms || DEFAULT_RUN_LIMITS.maxRuntimeMs,
      maxToolCalls: task.max_tool_calls || DEFAULT_RUN_LIMITS.maxToolCalls,
      maxContinueCalls:
        task.max_continue_calls || DEFAULT_RUN_LIMITS.maxContinueCalls,
      maxAssistantMessageLength: DEFAULT_RUN_LIMITS.maxAssistantMessageLength,
      maxConsecutiveToolFailures: DEFAULT_RUN_LIMITS.maxConsecutiveToolFailures,
    };
  }

  /**
   * Build filtered client_tools list to send to the AI server.
   * Only includes tools that are allowed by the task policy.
   */
  private buildFilteredClientTools(
    policy: AiMessageTaskToolPolicy
  ): ToolFunction[] {
    if (!policy.autoApproveTools || policy.allowedTools.length === 0) {
      return [];
    }

    const tools: ToolFunction[] = [];
    for (const toolName of policy.allowedTools) {
      const skill = SkillRegistry.getSkill(toolName);
      if (skill && skill.source === "built-in") {
        const decision = canAutoApproveScheduledTool({
          skill,
          taskPolicy: policy,
          toolName,
        });
        if (decision.allowed) {
          tools.push(skillDefinitionToToolFunction(skill));
        }
      }
    }
    return tools;
  }

  /**
   * Fast-fail: create a run log, mark as failed, update task, and return.
   */
  private async failFast(
    taskId: number,
    scheduleId: number | undefined,
    errorMessage: string,
    _errorCode: string
  ): Promise<ScheduledAiMessageRunResult> {
    try {
      const runId = await this.runModule.createRun({
        taskId,
        scheduleId: scheduleId ?? undefined,
      });
      await this.runModule.failRun(runId, errorMessage);
      await this.taskModule.updateLastRunResult(taskId, null, errorMessage);
      return {
        runId,
        status: "failed",
        assistantFinalMessage: "",
        toolCallsCount: 0,
        blockedToolCalls: [],
        errorMessage,
      };
    } catch (logError) {
      console.error("Failed to log AI message task failure:", logError);
      return {
        runId: 0,
        status: "failed",
        assistantFinalMessage: "",
        toolCallsCount: 0,
        blockedToolCalls: [],
        errorMessage,
      };
    }
  }
}
