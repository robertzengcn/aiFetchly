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
import { OUTBOUND_EMAIL_SEND_TOOL } from "@/service/AIChatQueryLoop";
import {
  ScheduledLoopEventSink,
  type ScheduledLoopPolicyBinding,
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
  SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS,
  SCHEDULED_LOOP_RESUME_TIMEOUT_MS,
  SCHEDULED_LOOP_RUN_TIMEOUT_MS,
  nextFutureOccurrence,
} from "@/config/aiChatScheduledLoopConfig";
import type { ChatV2ConversationUpdatedEvent } from "@/entityTypes/aiChatScheduledLoopTypes";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { bindApprovedWorkspace } from "@/service/AiMessageTaskWorkspace";
import { ScheduledLoopEngineRegistry } from "@/service/ScheduledLoopEngineRegistry";
import { showNotification } from "@/modules/lib/function";
import { isAiTaskCompletionPolicyV1Enabled } from "@/config/featureFlags";
import { TaskExecutionCoordinator } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import type { FinalizeScheduledInput } from "@/model/AiTaskExecution.model";
import { buildScheduledBudgetLimits } from "@/service/aiTaskExecution/budgetDefaults";
import { enrollScheduledExecution } from "@/service/aiTaskExecution/ScheduledExecutionEnroller";
import type { LoopTaskExecutionBinding } from "@/service/aiTaskExecution/TaskLoopConsult";

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
    const workspaceError = await this.bindTaskWorkspace(task, conversationId);
    if (workspaceError) {
      return this.failFast(taskId, scheduleId, workspaceError);
    }

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
    /**
     * Occurrence idempotency key from the scheduler's atomic claim (Unit 6).
     * Forwarded into the completion-policy enrollment's `occurrenceKey` so the
     * execution row, run row, and claim share one identity — a crash-retry
     * with the same key CAS-collides on the existing execution instead of
     * enrolling a duplicate. Falls back to the schedule/occurrence composite.
     */
    readonly idempotencyKey?: string;
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
    //
    // T04 (NFR-02/04, AC-24): the run-scoped `abortController` is created
    // BEFORE enrollment so the enroller can capture `() => abortController.signal`
    // and thread it into the consult closure (Stop / run-cancel propagates to
    // the checker dispatch; §9 line 445: a hanging request cannot hold the
    // gate). Previously created at the lease step (after enrollment), the
    // controller now precedes both — the lease acquisition below still reads
    // `abortController.signal` exactly as before.
    const coordinator = AIChatConversationTurnCoordinator.getInstance();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      SCHEDULED_LOOP_RUN_TIMEOUT_MS
    );
    this.runRegistry.register(runId, abortController);
    let lease: ConversationTurnLease | null = null;

    // Unit 6 (GAP-S2 #8/#9) + T02: enroll this occurrence into the completion
    // policy BEFORE the engine runs, through the SAME trusted decision
    // boundary as manual runs (resolver → criteria compile → contract freeze
    // → startScheduled, see ScheduledExecutionEnroller). The enrollment
    // creates the durable execution row (single owner via the claim's
    // idempotency key) and builds the loop binding the engine consults with
    // at round_cap/response_end (same-occurrence continuation, FR-05/07).
    // Fail-closed: any enrollment error leaves policyBinding undefined and
    // the run proceeds with the legacy blind mapping (no consult, no
    // missing-outcome rejection) — the scheduled turn itself must never crash
    // on policy plumbing. Flag-off: skipped entirely.
    let policyBinding: ScheduledLoopPolicyBinding | undefined;
    // Snapshot captured at enrollment so finalizeChatRun can CAS-finalize the
    // execution row after the turn ends. Fresh scheduled executions start at
    // execution_state_version = 0; T03 evidence writes bump it during the run,
    // so finalizeScheduledPolicyRun re-reads the version before finalizing.
    let policyExecution: {
      readonly executionId: string;
      readonly expectedVersion: number;
      readonly idempotencyKey: string;
    } | null = null;
    // T02 (D1): the loop binding built by the enroller, passed into
    // submitMessage so the loop's maybeConsultPolicy consults for scheduled
    // turns identically to manual ones.
    let loopBinding: LoopTaskExecutionBinding | undefined;
    if (isAiTaskCompletionPolicyV1Enabled()) {
      try {
        const enrollResult = await enrollScheduledExecution({
          conversationId,
          sourceUserMessageId: `scheduled-user-${scheduleId}-${occurrence}`,
          taskMessage: task.message || "",
          taskId,
          runId,
          scheduleId,
          occurrence,
          occurrenceKey:
            input.idempotencyKey ??
            `scheduled-loop:${scheduleId}:${occurrence}`,
          budgetLimits: buildScheduledBudgetLimits({
            maxContinueCalls: task.max_continue_calls,
            maxToolCalls: task.max_tool_calls,
            maxRuntimeMs: task.max_runtime_ms,
          }),
          // T04: thread the run-scoped abort signal into the consult closure
          // so the checker dispatch races Stop / run-cancel + a deadline.
          getAbortSignal: () => abortController.signal,
        });
        if (enrollResult.status === "created") {
          policyBinding = enrollResult.policyBinding;
          policyExecution = enrollResult.policyExecution ?? null;
          loopBinding = enrollResult.loopBinding;
        } else if (enrollResult.status === "reused") {
          // Crash-retry of the same occurrence: the execution row already
          // exists (same occurrence key). No fresh binding — the existing
          // row's status is authoritative and its finalization already
          // happened (or belongs to another attempt). Finalize the run row
          // with the existing state so the claim is not stuck "running".
          console.log(
            `[scheduled-loop] occurrence already enrolled (runId=${runId}) — transport retry, no fresh consult`
          );
          return this.finalizeChatRun({
            runId,
            taskId,
            scheduleId,
            startedAt,
            outcome: { kind: "failed", errorMessage: "OCCURRENCE_ALREADY_ENROLLED" },
            errorCode: "OCCURRENCE_ALREADY_ENROLLED",
            conversationId,
          });
        } else if (enrollResult.status === "skipped") {
          // T02 (D5): the resolver classified the task message as not
          // actionable (response_only/preparation). No execution row, no
          // consult — run the turn with the legacy blind mapping and record
          // the honest reason on the run row.
          console.log(
            `[scheduled-loop] occurrence not actionable (route=${enrollResult.skipReason}, runId=${runId}) — skipping enrollment`
          );
        } else {
          console.error(
            `[scheduled-loop] occurrence enrollment conflict (runId=${runId}) — skipping consult`
          );
        }
      } catch (err) {
        console.error("[scheduled-loop] completion-policy enrollment failed:", err);
        policyBinding = undefined;
      }
    }

    const engineRegistry = ScheduledLoopEngineRegistry.getInstance();
    let permissionBackstopHandle: ReturnType<typeof setTimeout> | null = null;
    const clearPermissionBackstop = (): void => {
      if (permissionBackstopHandle) {
        clearTimeout(permissionBackstopHandle);
        permissionBackstopHandle = null;
      }
    };
    // Bounded resume await (adversarial F1/F2): armed in the sink callback the
    // moment the turn RESUMES (a `tool_result` with `replacesPermissionPromptForToolId`
    // — emitted by both grant and deny BEFORE the resumed `loop.run` starts). The
    // runtime `timeoutHandle` was cleared at the pause and is NOT re-armed on the
    // resumed turn; the provider's own timeout only guards header arrival, so a
    // silent mid-stream stall (headers arrived, body hung) never resolves
    // `sink.waitForTerminalOutcome()` — the runner hangs indefinitely holding the
    // run row + conversation lease. This cap force-resolves the sink via
    // `failOutstanding` and stops the engine so the run finalizes. It bounds only
    // the resumed turn (phase 2); the park window (phase 1) stays bounded by the
    // 1h permission backstop. Cleared in `finally` on every exit path.
    let resumeTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const clearResumeTimeout = (): void => {
      if (resumeTimeoutHandle) {
        clearTimeout(resumeTimeoutHandle);
        resumeTimeoutHandle = null;
      }
    };

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
      const policy = this.parseTaskPolicy(task);
      const engine = await new AIChatQueryEngineFactory().createScheduled(
        policy,
        conversationId
      );
      // Trusted scheduled-loop pre-authorization for the outbound send gate
      // (see executeRunLoop for the rationale): the user pre-allowlisted
      // start_email_send_task via the typed confirmation at loop creation.
      // That typed pre-allowlist IS the trusted authorization AD-003 requires
      // for an unattended send — there is no human present to click Review.
      const outboundSendPreAuthorized =
        policy.autoApproveTools &&
        policy.allowedTools.includes(OUTBOUND_EMAIL_SEND_TOOL);
      engineRegistry.register({
        conversationId,
        engine,
        runId,
        scheduleId,
        clearPermissionBackstop,
      });
      const assistantMessageId = `scheduled-assistant-${scheduleId}-${occurrence}`;
      const sink = new ScheduledLoopEventSink(
        (event) => {
        // Gated tool paused for permission: suspend the runtime timeout,
        // notify, broadcast, publish pending metadata, and start the
        // 1h auto-deny backstop. This branch runs BEFORE token/complete/error
        // forwarding so the pause is observed even when the engine emits a
        // tool_result mid-stream.
        if (
          event.type === "tool_result" &&
          event.toolResult?.needsPermissionPrompt === true
        ) {
          clearTimeout(timeoutHandle);
          engineRegistry.setPendingPermission(conversationId, {
            toolId: event.toolCallId,
          });
          try {
            showNotification(
              "AiFetchly — permission required",
              `A scheduled run wants to use ${event.toolName}. Click to review.`
            );
          } catch {
            /* notification must never fail the run */
          }
          try {
            this.broadcaster.emit({
              conversationId,
              reason: "scheduled_turn_permission_requested",
              scheduleId,
              runId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              occurredAt: new Date().toISOString(),
            });
          } catch {
            /* broadcast failure is non-fatal */
          }
          permissionBackstopHandle = setTimeout(() => {
            void engine
              .denyToolPermission({
                toolId: event.toolCallId,
                conversationId,
              })
              .then((result) => {
                // Only clear pending metadata when this backstop actually matched
                // and denied the tool. If a newer tool replaced the pending
                // entry (ok:false → "no active permission-gated tool call" or
                // toolId mismatch), clearing would orphan the new permission
                // card. The IPC grant/deny path owns the clear in that case.
                if (result.ok) {
                  engineRegistry.clearPendingPermission(conversationId);
                }
              })
              .catch((err: unknown) => {
                console.error(
                  "[scheduled-loop] backstop auto-deny failed:",
                  err
                );
              });
          }, SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS);
          return;
        }
        // Resume signal (adversarial F1/F2): the resumed turn has re-entered
        // the loop after a grant/deny. Both grant and deny emit a `tool_result`
        // carrying `replacesPermissionPromptForToolId` BEFORE restarting
        // `loop.run`. At the pause we cleared the runtime timeout and it is
        // NOT re-armed on the resumed turn — re-arm it here so a silent
        // provider mid-stream stall (which never resolves
        // `waitForTerminalOutcome`) is bounded: the timer force-resolves the
        // sink via `failOutstanding` and stops the engine. The 1h backstop is
        // irrelevant now (the user already responded), so it stays untouched;
        // its own `clearPermissionBackstop` runs in `finally`.
        if (
          event.type === "tool_result" &&
          event.replacesPermissionPromptForToolId
        ) {
          clearResumeTimeout();
          resumeTimeoutHandle = setTimeout(() => {
            sink.failOutstanding(
              `Scheduled loop resume timed out after ${SCHEDULED_LOOP_RESUME_TIMEOUT_MS}ms without a terminal event.`
            );
            try {
              engine.stopActiveTurn(conversationId);
            } catch (err) {
              console.error(
                "[scheduled-loop] stopActiveTurn after resume timeout failed:",
                err
              );
            }
          }, SCHEDULED_LOOP_RESUME_TIMEOUT_MS);
          return;
        }
        // Forward start/token/done/error chunks for live streaming to a
        // renderer viewing this conversation (technical-design §13.2). Strict
        // routing is enforced renderer-side; forwarding failures are non-fatal.
        // `start` is emitted by the engine when the turn begins (before the
        // first token) so the renderer can show an immediate "Generating…"
        // loading indicator instead of waiting for the first token to know
        // the run is in flight.
        if (event.type === "start") {
          this.broadcaster.emitScheduledStream({
            conversationId,
            runId,
            messageId: assistantMessageId,
            kind: "start",
          });
        } else if (event.type === "token") {
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
        },
        policyBinding
      );
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
        // T02 (D1): the loop binding from the enroller — the engine consults
        // at round_cap/response_end for scheduled turns (same-occurrence
        // continuation). Undefined when the flag is off, enrollment failed,
        // or the route skipped enrollment (legacy blind mapping).
        taskExecutionBinding: loopBinding,
        outboundSendPreAuthorized,
      });
      // `submitMessage` resolves on a permission pause (the engine parks the
      // turn in `pendingPermissions` and returns without emitting a terminal
      // event). When that happens, stay alive — engine registered, runtime
      // timeout cleared, 1h backstop armed — and wait for the resumed loop
      // (grant / deny / backstop auto-deny) to emit the terminal outcome.
      // Without this wait, the `finally` below would unregister the engine
      // and clear the backstop before the user can respond, orphaning every
      // permission card (the headline feature would be non-functional).
      outcome = sink.getOutcome() ?? (await sink.waitForTerminalOutcome());
    } finally {
      clearTimeout(timeoutHandle);
      clearPermissionBackstop();
      clearResumeTimeout();
      this.runRegistry.unregister(runId);
      engineRegistry.unregister(conversationId);
      if (lease) lease.release();
    }

    return this.finalizeChatRun({
      runId,
      taskId,
      scheduleId,
      startedAt,
      outcome,
      conversationId,
      policyExecution,
      policyBinding,
    });
  }

  /**
   * Finalize a chat-bound occurrence: map the engine outcome to a run status,
   * persist the run + schedule counters, and broadcast a refresh hint (FR-11,
   * FR-12, FR-15). Status mapping per technical-design §17.3.
   *
   * Unit 6 (GAP-S2 #9, FR-12/13/15/17/18): when the occurrence was enrolled
   * into the completion policy (policyExecution present) and the flag is on,
   * finalization delegates to the atomic single-transaction
   * `finalizeScheduledExecution` — CAS execution + ledger release + run row +
   * schedule counters + pause, exactly once (AC-16/20/21/22) — and the legacy
   * inline run-row persistence + schedule accounting are SKIPPED (the model
   * transaction owns both; running them too would double-account).
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
    policyExecution?: {
      readonly executionId: string;
      readonly expectedVersion: number;
      readonly idempotencyKey: string;
    } | null;
    policyBinding?: ScheduledLoopPolicyBinding | undefined;
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
      policyExecution,
      policyBinding,
    } = input;
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    // T16: a policyExecution captured at enrollment means the run was
    // accepted under the flag. Finalize it through the policy path even if
    // the flag was turned off midstream — never convert accepted unfinished
    // scheduled work to unchecked success via the legacy switch below
    // (NFR-12, AC-12/32). The live flag controls only NEW enrollment
    // (line 302 above).
    if (policyExecution) {
      return this.finalizeScheduledPolicyRun({
        runId,
        taskId,
        scheduleId,
        startedAt,
        outcome,
        conversationId,
        policyExecution,
        policyBinding,
      });
    }

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
    } catch (err) {
      // AC-15: persistence failures are never swallowed — the run row is the
      // durable record of the occurrence; a silent failure would leave the
      // claim's run stuck and the scheduler blind to the crash.
      console.error("[scheduled-loop] run-row persistence failed:", err);
      throw err instanceof Error ? err : new Error(String(err));
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
   * Flag-on finalization for an enrolled occurrence (Unit 6, FR-12/13/15/17/18,
   * AC-16/20/21/22): map the turn outcome to a `FinalizeScheduledInput` and
   * delegate to the model's atomic single-transaction
   * `finalizeScheduledExecution` (CAS execution + ledger release + run row +
   * schedule counters + pause, exactly once). Skips the legacy inline run-row
   * persistence + schedule accounting in {@link finalizeChatRun} — the
   * transaction owns both, and running them too would double-account.
   *
   * Outcome mapping (§6.1): verified_complete → "verified_complete";
   * incomplete / missing_outcome / failed / cancelled → honest outcome with
   * incrementFailure=true except cancelled (FR-12: cancelled never increments
   * the failure streak); blocked → "blocked_by_policy" + schedule pause.
   * A finalization failure is thrown (AC-15: never swallow — the scheduler's
   * claim must see the failure), while a `!ok` typed result is logged and
   * surfaced on the returned error message.
   */
  private async finalizeScheduledPolicyRun(input: {
    runId: number;
    taskId: number;
    scheduleId: number;
    startedAt: Date;
    outcome: ScheduledTurnOutcome;
    conversationId?: string;
    policyExecution: {
      readonly executionId: string;
      readonly expectedVersion: number;
      readonly idempotencyKey: string;
    };
    policyBinding?: ScheduledLoopPolicyBinding | undefined;
  }): Promise<ScheduledAiMessageRunResult> {
    const { runId, taskId, scheduleId, startedAt, outcome, conversationId } =
      input;
    const policyExecution = input.policyExecution;
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    // T03 (FR-24, AC-32): read the CAS token fresh before finalizing.
    // Evidence writes (loop consult + sink fallback consult) bump
    // execution_state_version during the run, so the enrollment snapshot
    // (policyExecution.expectedVersion) is stale by finalize time. The
    // binding's `resolveExpectedStateVersion` reads the authoritative row
    // version; if it returns undefined (binding missing or read failed) we
    // fall back to the snapshot — `finalizeScheduled` has no CAS retry, so a
    // stale token surfaces STATE_CONFLICT rather than silently double-
    // finalizing, and the runner maps that to missing_outcome (never
    // success, AC-15/17).
    const freshVersion = await input.policyBinding?.evidenceContext
      ?.resolveExpectedStateVersion?.()
      .catch(() => undefined);
    const expectedVersion = freshVersion ?? policyExecution.expectedVersion;

    // Compute the next occurrence + terminal state from the schedule row —
    // same derivation as the legacy block so the transaction's schedule
    // accounting matches regardless of which path finalizes.
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

    const mapping = mapOutcomeToFinalizeInput(outcome, durationMs);
    // Same threshold derivation as the legacy block: a failed/incomplete
    // outcome past the repeated-failure threshold marks the schedule terminal
    // inside the transaction. Computed BEFORE the literal so the input stays
    // immutable (no post-construction mutation of readonly fields).
    const consecutive = (schedule?.consecutive_failure_count ?? 0) + 1;
    const thresholdHit =
      mapping.terminalStatus === undefined &&
      mapping.taskOutcome !== "verified_complete" &&
      mapping.incrementFailure &&
      consecutive >= SCHEDULED_LOOP_MAX_CONSECUTIVE_FAILURES;
    const finalizeInput: FinalizeScheduledInput = {
      executionId: policyExecution.executionId,
      expectedVersion,
      runId,
      scheduleId,
      taskOutcome: mapping.taskOutcome,
      reasonCode: mapping.reasonCode,
      summary: mapping.summary,
      evidenceIds: [],
      remainingWork: mapping.remainingWork,
      idempotencyKey: policyExecution.idempotencyKey,
      incrementFailure: mapping.incrementFailure,
      nextRunAt,
      terminalStatus:
        mapping.terminalStatus ?? (thresholdHit ? "failed" : undefined),
      terminalReason:
        mapping.terminalReason ??
        (thresholdHit ? "REPEATED_RUN_FAILURE" : undefined),
      pause: mapping.pause,
      assistantResultMessageId: mapping.assistantResultMessageId ?? null,
    };

    try {
      const result = await new TaskExecutionCoordinator().finalizeScheduled(
        finalizeInput
      );
      if (!result.ok) {
        console.error(
          `[scheduled-loop] scheduled finalization not applied (runId=${runId}):`,
          result.reasonCode
        );
        throw new Error(
          `SCHEDULED_FINALIZATION_FAILED: ${result.reasonCode ?? "unknown"}`
        );
      }
    } catch (err) {
      console.error(
        "[scheduled-loop] scheduled finalization transaction failed:",
        err
      );
      throw err instanceof Error ? err : new Error(String(err));
    }

    // Broadcast a narrow refresh hint to any open renderer (FR-11).
    if (conversationId) {
      const event: ChatV2ConversationUpdatedEvent = {
        conversationId,
        reason:
          mapping.taskOutcome === "verified_complete"
            ? "scheduled_turn_completed"
            : "scheduled_turn_failed",
        scheduleId,
        runId,
        assistantMessageId: mapping.assistantResultMessageId ?? undefined,
        occurredAt: new Date().toISOString(),
      };
      try {
        this.broadcaster.emit(event);
      } catch {
        // Renderer delivery failure does not fail the run (FR-12).
      }
    }

    return {
      runId,
      status: mapOutcomeToRunStatus(mapping.taskOutcome),
      assistantFinalMessage: mapping.summary,
      toolCallsCount: 0,
      blockedToolCalls: [],
      errorMessage:
        mapping.taskOutcome === "verified_complete"
          ? undefined
          : mapping.reasonCode,
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
   * Approve the task's stored folder as the conversation workspace so file
   * tools in the scheduled run stay inside that directory.
   */
  private async bindTaskWorkspace(
    task: AiMessageTaskEntity,
    conversationId: string
  ): Promise<string | null> {
    const stored = task.workspace_path?.trim();
    if (!stored) {
      return null;
    }
    try {
      const canonical = await bindApprovedWorkspace(conversationId, stored);
      if (canonical !== stored) {
        // Persist the canonicalized path durably; do NOT mutate the passed-in
        // task entity. Nothing downstream in the run reads workspace_path
        // (file tools resolve the bound workspace via the workspace service,
        // not via this entity field), so an in-memory mutation would be dead
        // state that violates immutability without serving a consumer.
        await this.taskModule.updateTask({
          id: task.id,
          workspacePath: canonical,
        });
      }
      return null;
    } catch (error: unknown) {
      return error instanceof Error ? error.message : "Invalid workspace path";
    }
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
    const engineRegistry = ScheduledLoopEngineRegistry.getInstance();
    let permissionBackstopHandle: ReturnType<typeof setTimeout> | null = null;
    const clearPermissionBackstop = (): void => {
      if (permissionBackstopHandle) {
        clearTimeout(permissionBackstopHandle);
        permissionBackstopHandle = null;
      }
    };
    // Bounded resume await (adversarial F1/F2) — see runOnce for the full
    // rationale. Armed on the resume signal, cleared in `finally`.
    let resumeTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const clearResumeTimeout = (): void => {
      if (resumeTimeoutHandle) {
        clearTimeout(resumeTimeoutHandle);
        resumeTimeoutHandle = null;
      }
    };
    let outcome: ScheduledTurnOutcome = {
      kind: "failed",
      errorMessage: "NO_TERMINAL_EVENT",
    };

    // Trusted scheduled-loop pre-authorization for the outbound send gate.
    // The user pre-allowlisted start_email_send_task via the typed
    // confirmation at loop creation (policy.autoApproveTools AND the tool is
    // in policy.allowedTools). That typed pre-allowlist IS the trusted
    // authorization AD-003 requires for an unattended send — there is no human
    // present to click Review. The gate (AIChatQueryLoop.evaluateOutboundEmailGate)
    // consults this to honor skip_review=true even for blocking reasonCodes
    // (e.g. a dedup negation the pure resolver misreads as do-not-send),
    // unblocking the scheduled outreach deadlock. Never true for interactive
    // chat — scheduledContext is absent there and the renderer cannot forge it.
    const outboundSendPreAuthorized =
      policy.autoApproveTools &&
      policy.allowedTools.includes(OUTBOUND_EMAIL_SEND_TOOL);

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

      const engine = await new AIChatQueryEngineFactory().createScheduled(
        policy,
        conversationId
      );
      engineRegistry.register({
        conversationId,
        engine,
        runId,
        scheduleId: scheduleKey,
        clearPermissionBackstop,
      });
      const assistantMessageId = `scheduled-assistant-${scheduleKey}-${runId}`;
      const sink = new ScheduledLoopEventSink((event) => {
        // Gated tool paused for permission: suspend the runtime timeout,
        // notify, broadcast, publish pending metadata, and start the
        // 1h auto-deny backstop. This branch runs BEFORE token/complete/error
        // forwarding so the pause is observed even when the engine emits a
        // tool_result mid-stream.
        if (
          event.type === "tool_result" &&
          event.toolResult?.needsPermissionPrompt === true
        ) {
          clearTimeout(timeoutHandle);
          engineRegistry.setPendingPermission(conversationId, {
            toolId: event.toolCallId,
          });
          try {
            showNotification(
              "AiFetchly — permission required",
              `A scheduled run wants to use ${event.toolName}. Click to review.`
            );
          } catch {
            /* notification must never fail the run */
          }
          try {
            this.broadcaster.emit({
              conversationId,
              reason: "scheduled_turn_permission_requested",
              scheduleId: scheduleKey,
              runId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              occurredAt: new Date().toISOString(),
            });
          } catch {
            /* broadcast failure is non-fatal */
          }
          permissionBackstopHandle = setTimeout(() => {
            void engine
              .denyToolPermission({
                toolId: event.toolCallId,
                conversationId,
              })
              .then((result) => {
                // Only clear pending metadata when this backstop actually matched
                // and denied the tool. If a newer tool replaced the pending
                // entry (ok:false → "no active permission-gated tool call" or
                // toolId mismatch), clearing would orphan the new permission
                // card. The IPC grant/deny path owns the clear in that case.
                if (result.ok) {
                  engineRegistry.clearPendingPermission(conversationId);
                }
              })
              .catch((err: unknown) => {
                console.error(
                  "[scheduled-loop] backstop auto-deny failed:",
                  err
                );
              });
          }, SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS);
          return;
        }
        // Resume signal (adversarial F1/F2) — see runOnce for the full
        // rationale. Re-arm the runtime cap on the resumed turn so a silent
        // provider mid-stream stall is bounded instead of hanging the runner.
        if (
          event.type === "tool_result" &&
          event.replacesPermissionPromptForToolId
        ) {
          clearResumeTimeout();
          resumeTimeoutHandle = setTimeout(() => {
            sink.failOutstanding(
              `Scheduled loop resume timed out after ${SCHEDULED_LOOP_RESUME_TIMEOUT_MS}ms without a terminal event.`
            );
            try {
              engine.stopActiveTurn(conversationId);
            } catch (err) {
              console.error(
                "[scheduled-loop] stopActiveTurn after resume timeout failed:",
                err
              );
            }
          }, SCHEDULED_LOOP_RESUME_TIMEOUT_MS);
          return;
        }
        if (event.type === "start") {
          this.broadcaster.emitScheduledStream({
            conversationId,
            runId,
            messageId: assistantMessageId,
            kind: "start",
          });
        } else if (event.type === "token") {
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
        outboundSendPreAuthorized,
      });
      // `submitMessage` resolves on a permission pause (the engine parks the
      // turn in `pendingPermissions` and returns without emitting a terminal
      // event). When that happens, stay alive — engine registered, runtime
      // timeout cleared, 1h backstop armed — and wait for the resumed loop
      // (grant / deny / backstop auto-deny) to emit the terminal outcome.
      // Without this wait, the `finally` below would unregister the engine
      // and clear the backstop before the user can respond, orphaning every
      // permission card (the headline feature would be non-functional).
      outcome = sink.getOutcome() ?? (await sink.waitForTerminalOutcome());
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
      clearPermissionBackstop();
      clearResumeTimeout();
      this.runRegistry.unregister(runId);
      engineRegistry.unregister(conversationId);
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

/** Pure mapping from a turn outcome to the scheduled finalize input fields. */
interface ScheduledFinalizeMapping {
  readonly taskOutcome: FinalizeScheduledInput["taskOutcome"];
  readonly reasonCode: string;
  readonly summary: string;
  readonly remainingWork: readonly string[];
  readonly incrementFailure: boolean;
  readonly terminalStatus?: "expired" | "failed" | "stopped";
  readonly terminalReason?: string;
  readonly pause?: { readonly reason: string };
  readonly assistantResultMessageId?: string | null;
}

/**
 * Map a ScheduledTurnOutcome onto the scheduled finalization's typed fields
 * (Unit 6, §6.1). Pure — no I/O — so the mapping stays testable in one place.
 * incrementFailure follows FR-12: failed/incomplete/missing increment the
 * failure streak; cancelled and blocked never do.
 */
export function mapOutcomeToFinalizeInput(
  outcome: ScheduledTurnOutcome,
  durationMs: number
): ScheduledFinalizeMapping {
  switch (outcome.kind) {
    case "completed":
      return {
        taskOutcome: "verified_complete",
        reasonCode: "CRITERIA_SATISFIED",
        summary: outcome.content,
        remainingWork: [],
        incrementFailure: false,
        assistantResultMessageId: outcome.assistantMessageId ?? null,
      };
    case "incomplete":
      return {
        taskOutcome: "incomplete",
        reasonCode: outcome.reasonCode,
        summary: outcome.content || outcome.reasonCode,
        remainingWork: outcome.remainingWork,
        incrementFailure: true,
        assistantResultMessageId: outcome.assistantMessageId ?? null,
      };
    case "missing_outcome":
      return {
        taskOutcome: "incomplete",
        reasonCode: outcome.reasonCode,
        summary: outcome.reasonCode,
        remainingWork: [],
        incrementFailure: true,
        assistantResultMessageId: outcome.assistantMessageId ?? null,
      };
    case "failed":
      return {
        taskOutcome: "failed",
        reasonCode: outcome.errorMessage || "REMOTE_AI_ERROR",
        summary: outcome.errorMessage || "REMOTE_AI_ERROR",
        remainingWork: [],
        incrementFailure: true,
        assistantResultMessageId: outcome.assistantMessageId ?? null,
      };
    case "blocked":
      return {
        taskOutcome: "blocked_by_policy",
        reasonCode: outcome.reason || "BLOCKED_BY_POLICY",
        summary: outcome.reason || "BLOCKED_BY_POLICY",
        remainingWork: [],
        incrementFailure: false,
        pause: { reason: outcome.reason || "BLOCKED_BY_POLICY" },
      };
    case "cancelled":
      return {
        taskOutcome: "cancelled",
        reasonCode: "RUN_INTERRUPTED",
        summary: outcome.content || "RUN_INTERRUPTED",
        remainingWork: [],
        incrementFailure: false,
        assistantResultMessageId: outcome.assistantMessageId ?? null,
      };
  }
}

/** Map a TaskOutcome to the run row's terminal status (§17.3). */
export function mapOutcomeToRunStatus(
  outcome: FinalizeScheduledInput["taskOutcome"]
): ScheduledAiMessageRunResult["status"] {
  switch (outcome) {
    case "verified_complete":
      return "completed";
    case "blocked_by_policy":
      return "blocked_by_policy";
    case "cancelled":
      return "failed";
    case "timeout":
      return "timeout";
    case "incomplete":
    case "needs_user_input":
    case "failed":
      return "failed";
  }
}
