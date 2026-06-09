// src/service/ScheduledAiMessageRunner.ts

import {
  AiChatApi,
  type StreamEvent,
  StreamEventType,
  type ToolFunction,
  type ToolExecutionResult,
} from "@/api/aiChatApi";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
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

  constructor() {
    this.aiChatApi = new AiChatApi();
    this.taskModule = new AiMessageTaskModule();
    this.runModule = new AiMessageTaskRunModule();
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
          model: task.model ?? undefined,
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
