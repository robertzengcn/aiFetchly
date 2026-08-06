import { BaseModule } from "@/modules/baseModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { ScheduleTaskModel } from "@/model/ScheduleTask.model";
import { AiMessageTaskModel } from "@/model/AiMessageTask.model";
import { AiMessageTaskRunModel } from "@/model/AiMessageTaskRun.model";
import { ScheduledLoopRunRegistry } from "@/service/ScheduledLoopRunRegistry";
import {
  SCHEDULED_LOOP_MAX_ALLOWED_TOOLS,
  validateScheduledLoopAllowedTools,
} from "@/service/ScheduledAiToolPolicy";
import {
  SCHEDULED_LOOP_DEFAULT_MISFIRE_POLICY,
  SCHEDULED_LOOP_DEFAULT_OVERLAP_POLICY,
  isValidIntervalMs,
  isValidMaxLifetimeMs,
  isValidMaxRuns,
} from "@/config/aiChatScheduledLoopConfig";
import type { ScheduleTaskEntity } from "@/entity/ScheduleTask.entity";
import type {
  CreateScheduledLoopRequest,
  CreateScheduledLoopResponse,
  ScheduledLoopErrorCode,
  ScheduledLoopStatus,
  ScheduledLoopView,
} from "@/entityTypes/aiChatScheduledLoopTypes";

/**
 * Error carrying a stable machine-readable scheduled-loop error code. IPC
 * handlers map the code to a localized user message; logs may keep the code.
 */
export class ScheduledLoopError extends Error {
  readonly code: ScheduledLoopErrorCode;
  constructor(code: ScheduledLoopErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ScheduledLoopError";
    this.code = code;
  }
}

const V2_CONVERSATION_PREFIX = "v2-";
const ACTIVE_RUN_STATES: ReadonlySet<string> = new Set([
  "running",
  "pending",
  "waiting_for_conversation",
]);

function uuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Human-readable English interval description for the confirmation fallback. */
function describeInterval(ms: number): string {
  if (ms % 3_600_000 === 0) {
    const h = ms / 3_600_000;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  const m = ms / 60_000;
  return m === 1 ? "1 minute" : `${m} minutes`;
}

/** Human-readable English lifetime description for the confirmation fallback. */
function describeLifetime(ms: number): string {
  if (ms % 3_600_000 === 0) {
    const h = ms / 3_600_000;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  const m = ms / 60_000;
  return m === 1 ? "1 minute" : `${m} minutes`;
}

/** Format a schedule timestamp in the user's local wall-clock timezone. */
function formatLocalDateTime(value: Date): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const fields = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}`;
}

/** De-duplicate and trim a requested allowed-tools list, dropping empties. */
function dedupeTools(tools: readonly string[] | undefined): string[] {
  if (!tools) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tools) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Main-process orchestration for AI Chat V2 scheduled loops.
 *
 * Coordinates AIChatV2Module (conversation + messages) and the schedule/task/run
 * models. Contains no direct repository access and no Electron imports. Control
 * operations are conversation-scoped: the backend resolves the one active
 * chat-created schedule rather than trusting a renderer-supplied schedule id
 * (technical-design §11).
 */
export class AIChatScheduledLoopModule extends BaseModule {
  private readonly chatV2: AIChatV2Module;
  private readonly scheduleModel: ScheduleTaskModel;
  private readonly taskModel: AiMessageTaskModel;
  private readonly runModel: AiMessageTaskRunModel;
  private readonly runRegistry: ScheduledLoopRunRegistry;

  constructor() {
    super();
    this.chatV2 = new AIChatV2Module();
    this.scheduleModel = new ScheduleTaskModel(this.dbpath);
    this.taskModel = new AiMessageTaskModel(this.dbpath);
    this.runModel = new AiMessageTaskRunModel(this.dbpath);
    this.runRegistry = ScheduledLoopRunRegistry.getInstance();
  }

  /**
   * Create a bounded scheduled loop bound to one authoritative v2-* conversation.
   * Saves the visible /loop command and a local confirmation row, creates the
   * task and interval schedule, and compensates partial creation on failure.
   */
  async create(
    request: CreateScheduledLoopRequest
  ): Promise<CreateScheduledLoopResponse> {
    if (!request.prompt || request.prompt.trim() === "") {
      throw new ScheduledLoopError("PROMPT_REQUIRED");
    }
    if (!isValidIntervalMs(request.intervalMs)) {
      throw new ScheduledLoopError("INVALID_INTERVAL");
    }
    if (!isValidMaxRuns(request.maxRuns)) {
      throw new ScheduledLoopError("INVALID_LOOP_LIMIT");
    }
    if (!isValidMaxLifetimeMs(request.maxLifetimeMs)) {
      throw new ScheduledLoopError("INVALID_LOOP_LIMIT");
    }

    // Tool approval (FR-16): only curated schedulable built-in tools may run
    // unattended. Validate BEFORE any persistence so a bad request leaves no
    // command/confirmation rows.
    //
    // autoApproveTools=true with an empty allowedTools list is intentional:
    // it enables the read-only auto-approve tier (no per-tool selection).
    // Explicit allowedTools entries are required only for high-impact /
    // automation tools.
    const requestedTools = dedupeTools(request.allowedTools);
    if (requestedTools.length > SCHEDULED_LOOP_MAX_ALLOWED_TOOLS) {
      throw new ScheduledLoopError("INVALID_LOOP_LIMIT");
    }
    const toolValidation = validateScheduledLoopAllowedTools(requestedTools);
    if (!toolValidation.valid) {
      throw new ScheduledLoopError("BLOCKED_BY_POLICY");
    }
    const autoApproveTools = request.autoApproveTools === true;

    // Resolve one authoritative v2-* conversation id (never an ai-msg-* fallback).
    const conversationId = this.chatV2.createConversationIfNeeded(
      request.conversationId
    );
    if (!conversationId.startsWith(V2_CONVERSATION_PREFIX)) {
      throw new ScheduledLoopError("CONVERSATION_REQUIRED");
    }

    // Enforce one active scheduled loop per conversation.
    const existing = await this.scheduleModel.findChatScheduledLoop(
      conversationId
    );
    if (existing) {
      throw new ScheduledLoopError("LOOP_ALREADY_ACTIVE");
    }

    const now = new Date();
    const anchorAt = now;
    const nextRunAt = new Date(now.getTime() + request.intervalMs);
    const expiresAt = new Date(now.getTime() + request.maxLifetimeMs);
    const commandMessageId = `scheduled-loop-command-${uuid()}`;
    const resultMessageId = `scheduled-loop-result-${uuid()}`;

    // Save the raw slash command so the conversation is durable immediately.
    await this.chatV2.saveUserMessage({
      conversationId,
      content: request.rawCommand,
      messageId: commandMessageId,
      metadata: {
        source: "slash-command",
        localOnly: true,
        slashCommandName: "loop",
      },
    });

    // Create task then schedule; compensate on partial failure so we never
    // leave an active schedule pointing at a missing task (or vice versa).
    let taskId: number | null = null;
    let scheduleId: number | null = null;
    try {
      taskId = await this.taskModel.createChatScheduledTask({
        name: `scheduled-loop-${conversationId}`,
        message: request.prompt,
        conversationId,
        model: request.model,
        allowedTools: requestedTools,
        autoApproveTools,
        maxToolCalls: 10,
        maxRuntimeMs: 300_000,
        maxContinueCalls: 10,
        sourceType: "chat_scheduled_loop",
      });
      scheduleId = await this.scheduleModel.createIntervalSchedule({
        name: `scheduled-loop-${conversationId}`,
        taskId,
        conversationId,
        intervalMs: request.intervalMs,
        anchorAt,
        nextRunAt,
        maxExecutionCount: request.maxRuns,
        expiresAt,
        misfirePolicy: SCHEDULED_LOOP_DEFAULT_MISFIRE_POLICY,
        overlapPolicy: SCHEDULED_LOOP_DEFAULT_OVERLAP_POLICY,
      });

      const summary = this.buildConfirmationContent(
        request.intervalMs,
        request.maxRuns,
        request.maxLifetimeMs,
        nextRunAt,
        requestedTools,
        autoApproveTools
      );
      await this.chatV2.saveAssistantMessage({
        conversationId,
        content: summary,
        messageId: resultMessageId,
        metadata: {
          source: "slash-command",
          localOnly: true,
          slashCommandResult: true,
          slashCommandName: "scheduled-loop-create",
        },
      });

      const schedule = await this.scheduleModel.getScheduleById(scheduleId);
      const loop = await this.toView(schedule);
      return { conversationId, commandMessageId, resultMessageId, loop };
    } catch (err) {
      await this.compensate(taskId, scheduleId);
      throw err;
    }
  }

  /** Renderer-safe schedule view for the conversation's loop (any state). */
  async getStatus(conversationId: string): Promise<ScheduledLoopView | null> {
    const schedule = await this.scheduleModel.findLatestChatScheduledLoop(
      conversationId
    );
    if (!schedule) return null;
    return this.toView(schedule);
  }

  /** Pause future occurrences. Idempotent; history is kept. */
  async pause(conversationId: string): Promise<ScheduledLoopView | null> {
    const schedule = await this.scheduleModel.findLatestChatScheduledLoop(
      conversationId
    );
    if (!schedule) return null;
    if (schedule.is_active) {
      await this.scheduleModel.pauseWithReason(schedule.id, "PAUSED");
    }
    const refreshed = await this.scheduleModel.getScheduleById(schedule.id);
    return refreshed ? this.toView(refreshed) : null;
  }

  /** Resume: recompute a future next run; never replay missed occurrences. */
  async resume(conversationId: string): Promise<ScheduledLoopView | null> {
    const schedule = await this.scheduleModel.findLatestChatScheduledLoop(
      conversationId
    );
    if (!schedule) return null;
    if (schedule.interval_ms == null) return this.toView(schedule);
    // Validate the bound task and conversation still exist.
    const task = await this.taskModel.findChatScheduledTask(schedule.task_id);
    if (!task || task.conversation_id !== conversationId) {
      throw new ScheduledLoopError("CONVERSATION_NOT_FOUND");
    }
    const nextRunAt = new Date(Date.now() + schedule.interval_ms);
    await this.scheduleModel.resumeIntervalSchedule(schedule.id, nextRunAt);
    const refreshed = await this.scheduleModel.getScheduleById(schedule.id);
    return refreshed ? this.toView(refreshed) : null;
  }

  /** Stop future occurrences and deactivate the task. Idempotent. */
  async stop(conversationId: string): Promise<ScheduledLoopView | null> {
    const schedule = await this.scheduleModel.findLatestChatScheduledLoop(
      conversationId
    );
    if (!schedule) return null;
    if (schedule.is_active) {
      await this.scheduleModel.stopWithReason(schedule.id, "STOPPED");
    }
    await this.taskModel
      .deactivateChatScheduledTask(schedule.task_id)
      .catch(() => {
        /* task may already be inactive; idempotent */
      });
    const refreshed = await this.scheduleModel.getScheduleById(schedule.id);
    return refreshed ? this.toView(refreshed) : null;
  }

  /**
   * Abort the currently-running occurrence (if any) and persist a cancelled
   * run. Does not stop future occurrences. The live engine abort is delivered
   * through the in-memory run registry; the runner's finally block finalizes
   * the run and schedule counters.
   */
  async stopCurrentRun(
    conversationId: string
  ): Promise<{ cancelled: boolean }> {
    const schedule = await this.scheduleModel.findLatestChatScheduledLoop(
      conversationId
    );
    if (!schedule) return { cancelled: false };
    const latest = await this.runModel.getLatestBySchedule(schedule.id);
    if (!latest || !ACTIVE_RUN_STATES.has(latest.status)) {
      return { cancelled: false };
    }
    const aborted = this.runRegistry.abort(latest.id);
    if (!aborted) {
      // No live controller in this process (e.g. run claimed but not yet
      // executing). Persist a cancelled run so recovery sees a clean state.
      await this.runModel
        .updateStatus(latest.id, "cancelled", {
          error_code: "RUN_INTERRUPTED",
          finished_at: new Date(),
        })
        .catch(() => {
          /* ignore */
        });
    }
    return { cancelled: true };
  }

  /** Return the active schedule for clear/delete preflight (FR-14). */
  async getActiveSchedule(
    conversationId: string
  ): Promise<ScheduledLoopView | null> {
    const schedule = await this.scheduleModel.findChatScheduledLoop(
      conversationId
    );
    if (!schedule) return null;
    return this.toView(schedule);
  }

  private buildConfirmationContent(
    intervalMs: number,
    maxRuns: number,
    maxLifetimeMs: number,
    nextRunAt: Date,
    allowedTools: readonly string[],
    autoApproveTools: boolean
  ): string {
    const next = formatLocalDateTime(nextRunAt);
    let toolsLine: string;
    if (autoApproveTools && allowedTools.length > 0) {
      toolsLine = ` Unattended tools enabled — read-only auto-approved; explicitly approved: ${allowedTools.join(
        ", "
      )}.`;
    } else if (autoApproveTools) {
      toolsLine = " Unattended tools enabled — read-only auto-approved.";
    } else {
      toolsLine =
        " No tools approved — the loop can only respond from context.";
    }
    return (
      `Scheduled every ${describeInterval(intervalMs)}. ` +
      `Maximum ${maxRuns} runs or ${describeLifetime(maxLifetimeMs)}. ` +
      `Next run: ${next}.` +
      toolsLine
    );
  }

  private async compensate(
    taskId: number | null,
    scheduleId: number | null
  ): Promise<void> {
    if (scheduleId !== null) {
      await this.scheduleModel
        .stopWithReason(scheduleId, "CREATE_FAILED")
        .catch(() => {
          /* best effort */
        });
    }
    if (taskId !== null) {
      await this.taskModel.deactivateChatScheduledTask(taskId).catch(() => {
        /* best effort */
      });
    }
  }

  private async toView(
    schedule: ScheduleTaskEntity | null
  ): Promise<ScheduledLoopView> {
    if (!schedule) {
      throw new ScheduledLoopError("CONVERSATION_REQUIRED");
    }
    const task = schedule.task_id
      ? await this.taskModel.findChatScheduledTask(schedule.task_id)
      : null;
    const latest = await this.runModel.getLatestBySchedule(schedule.id);
    const successful = await this.runModel.countBySchedule(
      schedule.id,
      "completed"
    );
    const hasActiveRun = !!latest && ACTIVE_RUN_STATES.has(latest.status);
    const expiresAt = schedule.expires_at ?? new Date(0);

    return {
      scheduleId: schedule.id,
      taskId: schedule.task_id,
      conversationId: schedule.source_conversation_id ?? "",
      prompt: task?.message ?? "",
      status: this.deriveStatus(schedule, hasActiveRun),
      intervalMs: schedule.interval_ms ?? 0,
      maxRuns: schedule.max_execution_count ?? 0,
      claimedRuns: schedule.claimed_execution_count,
      successfulRuns: successful,
      consecutiveFailures: schedule.consecutive_failure_count,
      nextRunAt: schedule.next_run_time?.toISOString(),
      expiresAt: expiresAt.toISOString(),
      latestRunId: latest?.id,
      latestErrorCode: latest?.error_code ?? undefined,
    };
  }

  private deriveStatus(
    schedule: ScheduleTaskEntity,
    hasActiveRun: boolean
  ): ScheduledLoopStatus {
    if (hasActiveRun) return "running";
    switch (schedule.status) {
      case "active":
        return "active";
      case "paused":
        return "paused";
      case "expired":
        return "expired";
      case "failed":
        return "failed";
      case "stopped":
        return "stopped";
      default:
        return "stopped"; // legacy "inactive" treated as stopped
    }
  }
}
