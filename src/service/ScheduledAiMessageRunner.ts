// src/service/ScheduledAiMessageRunner.ts

import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";
import { AIProviderResolver } from "@/service/aiProvider/AIProviderResolver";
import { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";
import { AiMessageTaskRunModule } from "@/modules/AiMessageTaskRunModule";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
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
import { AIChatV2Module } from "@/modules/AIChatV2Module";

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
  private readonly taskModule: AiMessageTaskModule;
  private readonly runModule: AiMessageTaskRunModule;
  // Lazy-initialized deps for the chat-bound path (kept out of the legacy
  // constructor so standalone runs pay nothing for them).
  private scheduleModelLazy: ScheduleTaskModel | null = null;
  private readonly runRegistry = ScheduledLoopRunRegistry.getInstance();
  private readonly broadcaster =
    AIChatConversationUpdateBroadcaster.getInstance();

  constructor() {
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
    // 1. Chat availability — hosted subscription OR a configured local provider.
    //    USER_AI_ENABLED alone would block local-provider schedules.
    const chatAccess = new AIProviderResolver().resolveForChat();
    if (!chatAccess.canUse) {
      return this.failFast(taskId, scheduleId, chatAccess.message);
    }

    // 2. Load task configuration
    const task = await this.taskModule.getTask(taskId);
    if (!task) {
      return this.failFast(
        taskId,
        scheduleId,
        `AI message task ${taskId} not found.`
      );
    }

    if (task.status !== "active") {
      return this.failFast(
        taskId,
        scheduleId,
        `AI message task ${taskId} is not active (status: ${task.status}).`
      );
    }

    const conversationId = await this.ensureV2Conversation(task);

    // 3. Parse policy and limits
    const policy = this.parseTaskPolicy(task);
    const limits = this.parseRunLimits(task);

    // 4. Create run log
    const runId = await this.runModule.createRun({
      taskId,
      scheduleId,
      conversationId,
    });

    await this.runModule.updateRunStatus(runId, "running");

    // 5. Run the AI conversation loop through Chat V2 so the transcript
    //    appears in AiChatV2 history (v2-* conversation id).
    try {
      const result = await this.executeRunLoop(
        runId,
        task,
        policy,
        limits,
        conversationId,
        scheduleId
      );
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

    // 1. Chat availability at execution time (hosted OR local provider).
    const chatAccess = new AIProviderResolver().resolveForChat();
    if (!chatAccess.canUse) {
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
      const assistantMessageId = `scheduled-assistant-${scheduleId}-${occurrence}`;
      const sink = new ScheduledLoopEventSink((event) => {
        // Forward token/done/error chunks for live streaming to a renderer
        // viewing this conversation (technical-design §13.2). Strict routing
        // is enforced renderer-side; forwarding failures are non-fatal.
        if (event.type === "token") {
          this.broadcaster.emitScheduledStream({
            conversationId,
            runId,
            messageId: assistantMessageId,
            kind: "token",
            contentDelta: event.contentDelta,
          });
        } else if (event.type === "complete" || event.type === "error") {
          this.broadcaster.emitScheduledStream({
            conversationId,
            runId,
            messageId: assistantMessageId,
            kind: event.type === "error" ? "error" : "done",
            errorMessage:
              event.type === "error" ? event.errorMessage : undefined,
          });
        }
      });
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
      // Persist the precise terminal status + link the chat message row +
      // delivery state. This honors the §17.3 status mapping (failed vs
      // blocked_by_policy vs cancelled) and runs regardless of whether an
      // assistant row was produced.
      await this.runModule.updateRunStatus(runId, status, {
        assistant_message_id: assistantMessageId ?? null,
        error_code: resultErrorCode ?? null,
        delivery_state: "persisted",
        finished_at: finishedAt,
        duration_ms: durationMs,
      } as never);
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
   * Guarantee the task is bound to a Chat V2 (`v2-*`) conversation. Legacy
   * schedule-page tasks used `ai-msg-*` ids, which AiChatV2 history filters
   * out. Mint and persist a v2 id when the stored one is missing or stale.
   */
  private async ensureV2Conversation(
    task: AiMessageTaskEntity
  ): Promise<string> {
    const existing = task.conversation_id;
    if (existing && existing.startsWith("v2-")) {
      return existing;
    }
    const conversationId = new AIChatV2Module().createConversationIfNeeded(
      existing ?? undefined
    );
    await this.taskModule.updateTask({
      id: task.id,
      conversationId,
    });
    task.conversation_id = conversationId;
    return conversationId;
  }

  /**
   * Cron / schedule-page run: persist the turn through AIChatQueryEngine so
   * user + assistant rows land in the originating v2 conversation (and therefore
   * in AiChatV2 history). Interval counters are owned by the chat-loop path.
   */
  private async executeRunLoop(
    runId: number,
    task: AiMessageTaskEntity,
    policy: AiMessageTaskToolPolicy,
    limits: RunLimits,
    conversationId: string,
    scheduleId?: number
  ): Promise<ScheduledAiMessageRunResult> {
    const startedAt = new Date();
    const scheduleKey = scheduleId ?? 0;
    const coordinator = AIChatConversationTurnCoordinator.getInstance();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, limits.maxRuntimeMs);
    this.runRegistry.register(runId, abortController);
    let lease: ConversationTurnLease | null = null;
    let outcome: ScheduledTurnOutcome = {
      kind: "failed",
      errorMessage: "NO_TERMINAL_EVENT",
    };

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
        const errorMessage = "CONVERSATION_BUSY";
        await this.runModule.failRun(runId, errorMessage);
        await this.taskModule.updateLastRunResult(task.id, null, errorMessage);
        return {
          runId,
          status: "blocked_by_policy",
          assistantFinalMessage: "",
          toolCallsCount: 0,
          blockedToolCalls: [],
          errorMessage,
        };
      }

      const engine = new AIChatQueryEngineFactory().createScheduled(policy);
      const assistantMessageId = `scheduled-assistant-${scheduleKey}-${runId}`;
      const sink = new ScheduledLoopEventSink((event) => {
        if (event.type === "token") {
          this.broadcaster.emitScheduledStream({
            conversationId,
            runId,
            messageId: assistantMessageId,
            kind: "token",
            contentDelta: event.contentDelta,
          });
        } else if (event.type === "complete" || event.type === "error") {
          this.broadcaster.emitScheduledStream({
            conversationId,
            runId,
            messageId: assistantMessageId,
            kind: event.type === "error" ? "error" : "done",
            errorMessage:
              event.type === "error" ? event.errorMessage : undefined,
          });
        }
      });
      await engine.submitMessage({
        eventSink: sink,
        request: {
          conversationId,
          message: task.message,
          model: task.model && task.model !== "auto" ? task.model : undefined,
          systemPrompt: task.system_prompt ?? undefined,
        },
        scheduledContext: {
          source: "scheduled_loop",
          taskId: task.id,
          scheduleId: scheduleKey,
          runId,
          occurrence: runId,
          scheduledFor: startedAt.toISOString(),
          catchUp: false,
          userMessageId: `scheduled-user-${scheduleKey}-${runId}`,
          assistantMessageId,
        },
      });
      outcome = sink.getOutcome() ?? {
        kind: "failed",
        errorMessage: "NO_TERMINAL_EVENT",
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        const errorMessage = `Run exceeded maximum runtime of ${limits.maxRuntimeMs}ms.`;
        await this.runModule.failRun(runId, errorMessage, {
          metadata: { elapsedMs: Date.now() - startedAt.getTime() },
        });
        await this.taskModule.updateLastRunResult(task.id, null, errorMessage);
        this.broadcastStandaloneUpdate(
          conversationId,
          scheduleKey,
          runId,
          "scheduled_turn_failed"
        );
        return {
          runId,
          status: "timeout",
          assistantFinalMessage: "",
          toolCallsCount: 0,
          blockedToolCalls: [],
          errorMessage,
        };
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      this.runRegistry.unregister(runId);
      if (lease) lease.release();
    }

    return this.finalizeStandaloneRun({
      runId,
      taskId: task.id,
      scheduleId: scheduleKey,
      conversationId,
      startedAt,
      outcome,
    });
  }

  /**
   * Persist a schedule-page (cron) run without touching interval counters.
   */
  private async finalizeStandaloneRun(input: {
    runId: number;
    taskId: number;
    scheduleId: number;
    conversationId: string;
    startedAt: Date;
    outcome: ScheduledTurnOutcome;
  }): Promise<ScheduledAiMessageRunResult> {
    const { runId, taskId, scheduleId, conversationId, startedAt, outcome } =
      input;
    const durationMs = Date.now() - startedAt.getTime();
    const blockedToolCalls: BlockedToolCallRecord[] = [];

    let status: ScheduledAiMessageRunResult["status"] = "failed";
    let contentSummary = "";
    let errorMessage: string | undefined;
    let assistantMessageId: string | undefined;

    switch (outcome.kind) {
      case "completed":
        status = "completed";
        contentSummary = outcome.content;
        assistantMessageId = outcome.assistantMessageId;
        break;
      case "cancelled":
        status = "failed";
        contentSummary = outcome.content;
        assistantMessageId = outcome.assistantMessageId;
        errorMessage = "RUN_INTERRUPTED";
        break;
      case "failed":
        status = "failed";
        assistantMessageId = outcome.assistantMessageId;
        errorMessage = outcome.errorMessage || "REMOTE_AI_ERROR";
        break;
      case "blocked":
        status = "blocked_by_policy";
        assistantMessageId = outcome.assistantMessageId;
        errorMessage = outcome.reason || "BLOCKED_BY_POLICY";
        break;
    }

    if (status === "completed") {
      await this.runModule.completeRun(runId, {
        assistantFinalMessage: contentSummary,
        toolCallsCount: 0,
        blockedToolCalls,
        metadata: { elapsedMs: durationMs, assistantMessageId },
      });
      const resultSummary =
        contentSummary.length > 200
          ? contentSummary.substring(0, 200) + "..."
          : contentSummary;
      await this.taskModule.updateLastRunResult(taskId, resultSummary, null);
    } else {
      await this.runModule.failRun(runId, errorMessage ?? "failed", {
        toolCallsCount: 0,
        blockedToolCalls,
        metadata: { elapsedMs: durationMs, assistantMessageId },
      });
      await this.taskModule.updateLastRunResult(
        taskId,
        null,
        errorMessage ?? "failed"
      );
    }

    this.broadcastStandaloneUpdate(
      conversationId,
      scheduleId,
      runId,
      status === "completed"
        ? "scheduled_turn_completed"
        : "scheduled_turn_failed",
      assistantMessageId
    );

    return {
      runId,
      status,
      assistantFinalMessage: contentSummary,
      toolCallsCount: 0,
      blockedToolCalls,
      errorMessage: status === "completed" ? undefined : errorMessage,
    };
  }

  private broadcastStandaloneUpdate(
    conversationId: string,
    scheduleId: number,
    runId: number,
    reason: ChatV2ConversationUpdatedEvent["reason"],
    assistantMessageId?: string
  ): void {
    const event: ChatV2ConversationUpdatedEvent = {
      conversationId,
      reason,
      scheduleId,
      runId,
      assistantMessageId,
      occurredAt: new Date().toISOString(),
    };
    try {
      this.broadcaster.emit(event);
    } catch {
      // Renderer delivery failure does not fail the run.
    }
  }

  /**
   * Parse the task's tool policy from entity fields.
   */
  private parseTaskPolicy(task: AiMessageTaskEntity): AiMessageTaskToolPolicy {
    const allowedTools = this.taskModule.parseAllowedTools(task);
    return {
      allowedTools,
      autoApproveTools: task.auto_approve_tools,
      allowSkills: task.allow_skills === true,
      allowMcp: task.allow_mcp === true,
      allowSubagents: task.allow_subagents === true,
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
   * Fast-fail: create a run log, mark as failed, update task, and return.
   */
  private async failFast(
    taskId: number,
    scheduleId: number | undefined,
    errorMessage: string
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
