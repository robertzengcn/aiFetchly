import { parseAiGoalCommand, isValidLoopCount } from "@/views/utils/aiGoalCommand";
import { parseAiLoopCommand } from "@/service/slashCommands/AiChatLoopCommandParser";
import {
  parseSkillSlashCommand,
  SKILL_SLASH_DEFAULT_TASK,
} from "@/service/slashCommands/skillSlashCommand";
import type { SlashCommandDispatchResponse } from "@/entityTypes/slashCommandTypes";
import type { ScheduledLoopParseErrorCode } from "@/entityTypes/aiChatScheduledLoopTypes";

/**
 * Shared chat command routing (capability-parity PRD FR-CMD-001..009,
 * FR-SKL-005; technical design §7).
 *
 * Extracts the command section of `AiChatV2.vue`'s `onSend` into a typed,
 * renderer-safe router with injected ports. The workspace center and Chat V2
 * can share this decision logic so slash/goal/loop/skill behavior cannot
 * drift between surfaces. The router owns NO reactivity and NO IPC modules —
 * every side effect goes through {@link ChatCommandRoutingPorts}, which the
 * composing surface binds to its own APIs and stores.
 *
 * Routing order mirrors the Chat V2 reference exactly:
 *   1. busy guard for command-like input (FR-SUB-009)
 *   2. `/loop` unified parse (goal loop / scheduled loop / control / invalid)
 *   3. `/goal` (create-or-replace + Plan Mode prompt)
 *   4. `/skill` (prompt-skill invocation, never a model fallback)
 *   5. generic slash registry dispatch (prompt expansion exactly once)
 */

/** A staged scheduled loop awaiting the user's tool-policy approval. */
export interface StagedScheduledLoop {
  readonly intervalMs: number;
  readonly prompt: string;
  readonly maxRuns: number;
  readonly maxLifetimeMs: number;
}

export type ChatCommandDisposition =
  /** Ordinary message — continue the standard submission path. */
  | { readonly kind: "not_command" }
  /**
   * Command fully handled (local exchange / loop start / clear). When the
   * command expanded into a prompt send, `acceptedSend` reports that send's
   * outcome — `false` means the draft must NOT be cleared (FR-SUB-002).
   * `acceptanceDelegated` (audit 2026-10-20 B04) is true when the expanded
   * send itself owns the composer acceptance (it fired through the ordinary
   * submission's accepted-send rule, including the park/rep replay path);
   * the disposition handler must not fire it a second time.
   */
  | {
      readonly kind: "completed";
      readonly acceptedSend?: boolean;
      readonly acceptanceDelegated?: boolean;
    }
  /**
   * The command produced a prompt the caller must submit through its
   * ordinary send path ONCE, marked as an expanded prompt so it is never
   * re-dispatched as a command (FR-CMD-003).
   */
  | {
      readonly kind: "submit_prompt";
      readonly prompt: string;
      readonly mode: "chat" | "plan";
    }
  /** Validation/lookup failure — the draft must be retained for retry. */
  | { readonly kind: "rejected"; readonly code: string; readonly message: string }
  /** Scheduled loop staged; the caller must open the approval dialog. */
  | {
      readonly kind: "needs_scheduled_approval";
      readonly action: StagedScheduledLoop;
      readonly rawCommand: string;
    };

export interface ChatCommandRoutingPorts {
  /** True while the SELECTED conversation runs an interactive turn. */
  readonly isBusy: () => boolean;
  /** Create + select a chat when none is selected; returns its id or null. */
  readonly ensureConversationId: () => Promise<string | null>;
  /** The selected conversation's active goal (goal-loop precondition). */
  readonly activeGoal: () => { goalId: string } | null;
  /**
   * Render a local user/assistant exchange (non-persisted receipt).
   * B07: originConversationId scopes the receipt — the port must suppress
   * the append when the selection no longer owns the command, so A's
   * delayed outcome never pollutes B's transcript.
   */
  readonly appendLocalExchange: (
    userText: string,
    assistantText: string,
    originConversationId?: string
  ) => void;
  /**
   * Surface a transient error message (null clears). B07: origin-scoped
   * like appendLocalExchange — a stale command must not set B's composer
   * error.
   */
  readonly setError: (message: string | null, originConversationId?: string) => void;
  /** i18n accessor: the composable stays translation-free. */
  readonly translate: (
    key: string,
    fallback: string,
    vars?: Record<string, unknown>
  ) => string;
  readonly createGoal: (input: {
    conversationId: string;
    objective: string;
    replace: boolean;
  }) => Promise<{ planPrompt: string } | null>;
  readonly startGoalLoop: (input: {
    conversationId: string;
    goalId: string;
    maxIterations: number;
  }) => Promise<boolean>;
  readonly invokePromptSkill: (input: {
    conversationId: string;
    skill: string;
    arguments?: string;
  }) => Promise<boolean>;
  readonly createScheduledLoop: (input: {
    conversationId: string;
    rawCommand: string;
    prompt: string;
    intervalMs: number;
    maxRuns: number;
    maxLifetimeMs: number;
    allowedTools?: string[];
    autoApproveTools?: boolean;
    allowSkills?: boolean;
    allowMcp?: boolean;
    allowSubagents?: boolean;
  }) => Promise<{ conversationId: string } | null>;
  readonly controlScheduledLoop: (
    conversationId: string,
    operation: "pause" | "resume" | "stop"
  ) => Promise<unknown>;
  readonly getScheduledLoopStatus: (conversationId: string) => Promise<unknown>;
  readonly dispatchSlashCommand: (input: {
    conversationId: string;
    rawInput: string;
  }) => Promise<SlashCommandDispatchResponse>;
  /**
   * Submit a registry-expanded prompt through the ordinary send path.
   * Returns whether the send was ACCEPTED (false = rejected/parked — the
   * caller must keep the draft). Receives the conversation the command was
   * issued in so a mid-dispatch selection change can abort safely.
   */
  readonly onSlashPromptExpand: (
    prompt: string,
    pastedContents?: Record<string, string>,
    conversationId?: string,
    onAccepted?: () => void,
    /**
     * B11: files attached to the command input. Preserved through expansion
     * into the ordinary send (which validates them); the expanded send
     * carries the same attachments instead of silently dropping them.
     */
    files?: readonly File[]
  ) => Promise<boolean>;
  /**
   * Built-in `/clear` — receives the conversation the command was issued in.
   * R10: TRUE when the clear actually ran (draft may be cleared); FALSE when
   * it was stale-aborted, denied or failed (draft must be retained).
   */
  readonly onClearConversation: (conversationId: string) => Promise<boolean>;
}

export interface RouteCommandOptions {
  readonly pastedContents?: Record<string, string>;
  /** Attachments present — generic slash interception is skipped (V2 parity). */
  readonly hasFiles?: boolean;
  /**
   * B11: the attached files themselves. Generic slash commands have no file
   * channel, so command+files is explicitly rejected (draft retained);
   * goal/skill expansions preserve these through the ordinary send.
   */
  readonly files?: readonly File[];
  /**
   * The composer's acceptance callback (Codex P2): threaded through to the
   * expanded-prompt send so a parked (image dialog) or rejected expansion
   * keeps the draft and the replayed send clears it exactly once.
   */
  readonly onAccepted?: () => void;
}

export interface ScheduledLoopApprovalPayload {
  readonly allowedTools: string[];
  readonly autoApproveTools: boolean;
  readonly allowSkills: boolean;
  readonly allowMcp: boolean;
  readonly allowSubagents: boolean;
}

export interface ChatCommandRouter {
  routeCommand(
    text: string,
    options: RouteCommandOptions
  ): Promise<ChatCommandDisposition>;
  /**
   * User approved the staged scheduled loop — persist it now. TRUE exactly
   * when the loop is durably created; FALSE when there was no stage or the
   * create failed (the error is already surfaced via setError) — a FALSE
   * means the composer draft is still needed (R09-1: acceptance only after
   * durable persistence).
   */
  confirmScheduledLoop(approval: ScheduledLoopApprovalPayload): Promise<boolean>;
  /** User cancelled the approval dialog — discard the staged loop. */
  cancelScheduledLoop(): void;
  /** Selection changed — discard conversation-scoped staging state. */
  resetConversationState(): void;
}

/** Localized message for a scheduled-loop parser error code (V2 parity). */
function scheduledLoopErrorMessage(
  translate: ChatCommandRoutingPorts["translate"],
  code: ScheduledLoopParseErrorCode
): string {
  const fallback: Record<ScheduledLoopParseErrorCode, string> = {
    INVALID_LOOP_SYNTAX: "The /loop command could not be parsed.",
    INVALID_INTERVAL: "The interval must be between 1 minute and 24 hours.",
    INVALID_LOOP_LIMIT: "The run count or lifetime limit is invalid.",
    PROMPT_REQUIRED: "A prompt is required for a scheduled loop.",
  };
  return translate(`aiChatV2.scheduledLoop.errors.${code}`, fallback[code]);
}

export function useChatCommandRouting(
  ports: ChatCommandRoutingPorts
): ChatCommandRouter {
  let stagedLoop: {
    action: StagedScheduledLoop;
    rawCommand: string;
  } | null = null;

  /**
   * `/loop <count>` goal-loop start with V2's local-exchange error paths
   * (count missing / out of range / no active goal / start failure).
   */
  async function runGoalLoop(count: number | null): Promise<ChatCommandDisposition> {
    const command = `/loop${count === null ? "" : ` ${count}`}`;
    if (count === null) {
      ports.appendLocalExchange(
        command,
        ports.translate(
          "aiChatV2.goalLoop.countRequired",
          "Please provide an iteration count."
        )
      );
      return { kind: "completed" };
    }
    if (!isValidLoopCount(count)) {
      ports.appendLocalExchange(
        command,
        ports.translate(
          "aiChatV2.goalLoop.countRange",
          "Iteration count must be between 1 and 10."
        )
      );
      return { kind: "completed" };
    }
    const goal = ports.activeGoal();
    if (!goal) {
      ports.appendLocalExchange(
        command,
        ports.translate(
          "aiChatV2.goalLoop.noActiveGoal",
          "Set a goal first with /goal <objective>."
        )
      );
      return { kind: "completed" };
    }
    const conversationId = await ports.ensureConversationId();
    if (!conversationId) return { kind: "rejected", code: "no_conversation", message: "" };
    const started = await ports.startGoalLoop({
      conversationId,
      goalId: goal.goalId,
      maxIterations: count,
    });
    if (!started) {
      // R10: the await may have spanned a selection switch — scope the
      // error to the conversation that owns the command so B never shows
      // A's failure notice.
      ports.setError(
        ports.translate(
          "aiChatV2.goalLoop.startFailed",
          "Could not start the loop."
        ),
        conversationId
      );
      return { kind: "rejected", code: "goal_loop_start_failed", message: "" };
    }
    return { kind: "completed" };
  }

  /**
   * `/loop pause|resume|stop` — selected conversation only (FR-CMD-008).
   * R09: a control that fails (transport throw) or does nothing (null view —
   * no loop in the required state) is a FAILURE disposition with a localized
   * error, never a silent "completed": a failed stop must not erase the
   * retryable command input while the schedule keeps running.
   */
  async function runScheduledLoopControl(
    operation: "pause" | "resume" | "stop"
  ): Promise<ChatCommandDisposition> {
    const conversationId = await ports.ensureConversationId();
    if (!conversationId) return { kind: "rejected", code: "no_conversation", message: "" };
    // R09 (i18n): the operation is localized BY KEY (loopControlFailed.pause/
    // resume/stop) instead of interpolating the English verb into CJK locales.
    const failureMessage = (): string =>
      ports.translate(
        `workspaceChat.command.loopControlFailed.${operation}`,
        `Could not ${operation} the scheduled loop. Check /loop status and try again.`
      );
    try {
      const view = await ports.controlScheduledLoop(conversationId, operation);
      if (view === null || view === undefined) {
        // R10: the control IPC awaited — a mid-flight switch must not drop
        // the failure notice into another conversation, so the port receives
        // the commanding conversation id.
        ports.setError(failureMessage(), conversationId);
        return {
          kind: "rejected",
          code: "loop_control_failed",
          message: failureMessage(),
        };
      }
    } catch {
      // R10: same origin-scoping for transport failures.
      ports.setError(failureMessage(), conversationId);
      return {
        kind: "rejected",
        code: "loop_control_failed",
        message: failureMessage(),
      };
    }
    return { kind: "completed" };
  }

  /**
   * Generic registry dispatch (FR-CMD-001..004). Returns the acceptance of
   * the command's send (true for locally-handled commands; the expanded
   * prompt's actual send outcome otherwise), an explicit files-unsupported
   * rejection (B11 — draft retained, nothing silently dropped), or null
   * when the input was not registry-owned.
   */
  type GenericSlashOutcome =
    | {
        kind: "handled";
        acceptedSend: boolean;
        /** True when the expanded send fired the composer acceptance (B04). */
        acceptanceDelegated: boolean;
      }
    | { kind: "rejected_files"; message: string }
    | null;

  function filesNotSupportedMessage(): string {
    return ports.translate(
      "workspaceChat.command.filesNotSupported",
      "This command does not support file attachments. Remove the files or send your message without the /command prefix."
    );
  }

  async function dispatchGenericSlash(
    rawInput: string,
    pastedContents?: Record<string, string>,
    onAccepted?: () => void,
    files?: readonly File[]
  ): Promise<GenericSlashOutcome> {
    const conversationId = await ports.ensureConversationId();
    if (!conversationId) {
      // Never a silent vanish (review F4): the user keeps their draft.
      ports.setError(
        ports.translate(
          "workspaceChat.command.noConversation",
          "No chat is selected — the command was not run."
        )
      );
      return { kind: "handled", acceptedSend: false, acceptanceDelegated: false };
    }
    const hasFiles = (files?.length ?? 0) > 0;
    let result: SlashCommandDispatchResponse;
    try {
      result = await ports.dispatchSlashCommand({
        conversationId,
        rawInput,
      });
    } catch (err) {
      // B07: a command TRANSPORT failure is handled-but-rejected — render the
      // receipt against the origin conversation only, and report FALSE so
      // the caller retains the draft (it was never accepted for execution).
      // Returning true here cleared the draft as though execution began.
      ports.appendLocalExchange(
        rawInput,
        err instanceof Error ? err.message : String(err),
        conversationId
      );
      return { kind: "handled", acceptedSend: false, acceptanceDelegated: false };
    }
    if (!result.status) {
      ports.appendLocalExchange(rawInput, result.msg, conversationId);
      return { kind: "handled", acceptedSend: true, acceptanceDelegated: false };
    }
    if (result.action === "submit_prompt") {
      // The expanded prompt is submitted exactly once through the ordinary
      // path; the port marks it as expanded so a body beginning with `/` is
      // chat content, not a second command (FR-CMD-003). The port reports
      // acceptance so a rejected/parked send keeps the draft (FR-SUB-002).
      // B11: attached files ride through expansion (validated downstream);
      // they are never silently dropped from an accepted command.
      try {
        const acceptedSend = await ports.onSlashPromptExpand(
          result.prompt,
          pastedContents,
          conversationId,
          onAccepted,
          files
        );
        // B04 (audit 2026-10-20): the expanded send fires the composer
        // acceptance itself — the disposition handler must not fire it
        // again, and a parked/replayed send keeps its single firing.
        return { kind: "handled", acceptedSend, acceptanceDelegated: true };
      } catch {
        return { kind: "handled", acceptedSend: false, acceptanceDelegated: false };
      }
    }
    // B11: non-expanding outcomes (receipts, /clear) have no file channel —
    // an attached file would be silently discarded, so reject explicitly
    // with all draft content retained instead of changing command meaning.
    if (hasFiles) {
      const message = filesNotSupportedMessage();
      ports.setError(message, conversationId);
      return { kind: "rejected_files", message };
    }
    if (result.commandId === "built-in:command:clear") {
      // R10: a stale-aborted / denied / failed clear never accepted the
      // command — the caller keeps the draft instead of silently dropping it.
      const cleared = await ports.onClearConversation(conversationId);
      return { kind: "handled", acceptedSend: cleared, acceptanceDelegated: false };
    }
    ports.appendLocalExchange(rawInput, result.content, conversationId);
    return { kind: "handled", acceptedSend: true, acceptanceDelegated: false };
  }

  async function routeCommand(
    text: string,
    options: RouteCommandOptions
  ): Promise<ChatCommandDisposition> {
    const loopCmd = parseAiLoopCommand(text);
    const goalCmd = parseAiGoalCommand(text);
    const skillCmd = parseSkillSlashCommand(text);
    const isCommandLike =
      loopCmd.type !== "none" ||
      goalCmd.type !== "none" ||
      skillCmd.type !== "none" ||
      text.trim().startsWith("/");
    // FR-SUB-009: command-like inputs keep their dedicated paths and stay
    // blocked while the selected conversation runs an interactive turn —
    // exactly as the Chat V2 reference does (silently there; explained here).
    if (isCommandLike && ports.isBusy()) {
      return {
        kind: "rejected",
        code: "command_busy",
        message: ports.translate(
          "workspaceChat.command.busy",
          "Commands are unavailable while this chat is running. Wait for it to finish or stop it first."
        ),
      };
    }

    // R09 (FR-SUB-001, FR-CMD-007): loop-family commands have NO attachment
    // or pasted-block channel — the scheduled prompt is a plain string, so
    // files/pasted bodies staged with the composer draft would silently
    // vanish when the loop is created. Reject explicitly (draft retained),
    // mirroring the generic-command B11 contract, instead of dropping them.
    const loopHasAttachments =
      loopCmd.type !== "none" &&
      loopCmd.type !== "invalid_loop" &&
      ((options.files?.length ?? 0) > 0 ||
        Object.keys(options.pastedContents ?? {}).length > 0);
    if (loopHasAttachments) {
      return {
        kind: "rejected",
        code: "loop_attachments_not_supported",
        message: ports.translate(
          "workspaceChat.command.loopAttachmentsNotSupported",
          "Loop commands do not support file attachments or pasted blocks. Send the loop command on its own, then share the content in a follow-up message."
        ),
      };
    }

    // --- Unified /loop parse (before /goal: /loop N is the goal loop) ---
    if (loopCmd.type === "goal_loop") {
      return runGoalLoop(loopCmd.maxIterations);
    }
    if (loopCmd.type === "scheduled_loop") {
      // Stage first; persistence happens only after the user approves the
      // tool policy up front (FR-CMD-007).
      stagedLoop = {
        action: {
          intervalMs: loopCmd.intervalMs,
          prompt: loopCmd.prompt,
          maxRuns: loopCmd.maxRuns,
          maxLifetimeMs: loopCmd.maxLifetimeMs,
        },
        rawCommand: text,
      };
      return {
        kind: "needs_scheduled_approval",
        action: stagedLoop.action,
        rawCommand: text,
      };
    }
    if (loopCmd.type === "scheduled_loop_control") {
      if (loopCmd.operation === "status") {
        const conversationId = await ports.ensureConversationId();
        if (conversationId) {
          await ports.getScheduledLoopStatus(conversationId);
        }
        return { kind: "completed" };
      }
      return runScheduledLoopControl(loopCmd.operation);
    }
    if (loopCmd.type === "invalid_loop") {
      const message = scheduledLoopErrorMessage(ports.translate, loopCmd.code);
      ports.setError(message);
      return { kind: "rejected", code: loopCmd.code, message };
    }

    // --- /goal: create-or-replace, then stream the Plan Mode prompt ---
    if (goalCmd.type === "goal") {
      if (!goalCmd.objective) {
        const message = ports.translate(
          "aiChatV2.goalLoop.objectiveRequired",
          "Please provide a goal objective. Usage: /goal <objective>"
        );
        ports.setError(message);
        return { kind: "rejected", code: "goal_objective_required", message };
      }
      const conversationId = await ports.ensureConversationId();
      if (!conversationId) {
        return { kind: "rejected", code: "no_conversation", message: "" };
      }
      try {
        // /goal is create-or-replace: a retry after a failed stream must not
        // hit the module's "active goal already exists" guard.
        const created = await ports.createGoal({
          conversationId,
          objective: goalCmd.objective,
          replace: true,
        });
        if (!created) {
          const message = ports.translate(
            "aiChatV2.goalLoop.createFailed",
            "Could not create the goal."
          );
          ports.appendLocalExchange(text, message, conversationId);
          ports.setError(message, conversationId);
          return { kind: "rejected", code: "goal_create_failed", message };
        }
        return { kind: "submit_prompt", prompt: created.planPrompt, mode: "plan" };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : ports.translate(
                "aiChatV2.goalLoop.createFailed",
                "Could not create the goal."
              );
        ports.appendLocalExchange(text, message, conversationId);
        ports.setError(message, conversationId);
        return { kind: "rejected", code: "goal_create_failed", message };
      }
    }

    // --- /skill: explicit prompt-skill invocation (FR-SKL-005) ---
    if (skillCmd.type === "skill_invoke") {
      const conversationId = await ports.ensureConversationId();
      if (!conversationId) {
        return { kind: "rejected", code: "no_conversation", message: "" };
      }
      // An acknowledgement failure (missing skill OR transport error) must
      // NOT fall through to ordinary model text — the invoked instructions
      // would be missing from the turn.
      let ack = false;
      try {
        ack = await ports.invokePromptSkill({
          conversationId,
          skill: skillCmd.name,
          ...(skillCmd.taskText ? { arguments: skillCmd.taskText } : {}),
        });
      } catch {
        ack = false;
      }
      if (!ack) {
        const message = ports.translate(
          "aiChatV2.skillSlash.notFound",
          `No installed prompt skill matches '${skillCmd.name}'.`,
          { name: skillCmd.name }
        );
        // R10: the acknowledgement resolved AFTER an await — a mid-flight
        // switch must not land this failure in the newly selected chat. The
        // router has no selection-guard hook, so origin-scoping of the
        // notice (the port filters stale origins) is the contract here.
        ports.setError(message, conversationId);
        return { kind: "rejected", code: "skill_not_found", message };
      }
      return {
        kind: "submit_prompt",
        prompt: skillCmd.taskText || SKILL_SLASH_DEFAULT_TASK,
        mode: "chat",
      };
    }

    // --- Generic slash registry (goal/loop already above) ---
    // B11: the dispatcher owns every command-like input — including with
    // files. Expansions preserve files through the ordinary send; outcomes
    // without a file channel reject explicitly (draft retained) instead of
    // silently reinterpreting raw command text as model input.
    if (goalCmd.type === "none" && text.trim().startsWith("/")) {
      const outcome = await dispatchGenericSlash(
        text.trim(),
        options.pastedContents,
        options.onAccepted,
        options.files
      );
      if (outcome === null) {
        return { kind: "not_command" };
      }
      if (outcome.kind === "rejected_files") {
        return {
          kind: "rejected",
          code: "command_files_not_supported",
          message: outcome.message,
        };
      }
      return {
        kind: "completed",
        acceptedSend: outcome.acceptedSend,
        acceptanceDelegated: outcome.acceptanceDelegated,
      };
    }

    return { kind: "not_command" };
  }

  /**
   * R09-1: reports whether the staged loop is DURABLY created so the caller
   * can fire the composer acceptance exactly once — a failed create must
   * retain the retryable draft instead of consuming it. Both failure modes
   * (transport throw and null envelope) surface the localized error first.
   */
  async function confirmScheduledLoop(
    approval: ScheduledLoopApprovalPayload
  ): Promise<boolean> {
    const staged = stagedLoop;
    stagedLoop = null;
    if (!staged) return false;
    const conversationId = await ports.ensureConversationId();
    if (!conversationId) return false;
    const createFailedMessage = (): string =>
      ports.translate(
        "aiChatV2.scheduledLoop.createFailed",
        "Could not create the scheduled loop."
      );
    const failed = (message: string): boolean => {
      ports.appendLocalExchange(staged.rawCommand, message, conversationId);
      ports.setError(message, conversationId);
      return false;
    };
    let created: { conversationId: string } | null = null;
    try {
      created = await ports.createScheduledLoop({
        conversationId,
        rawCommand: staged.rawCommand,
        prompt: staged.action.prompt,
        intervalMs: staged.action.intervalMs,
        maxRuns: staged.action.maxRuns,
        maxLifetimeMs: staged.action.maxLifetimeMs,
        allowedTools: approval.allowedTools,
        autoApproveTools: approval.autoApproveTools,
        allowSkills: approval.allowSkills,
        allowMcp: approval.allowMcp,
        allowSubagents: approval.allowSubagents,
      });
    } catch (err: unknown) {
      return failed(
        err instanceof Error ? err.message : createFailedMessage()
      );
    }
    if (!created) {
      return failed(createFailedMessage());
    }
    // Reload history/summaries so the persisted command + confirmation
    // rows render immediately (V2 parity — the port owns the reload).
    // R09-1: the reload is BEST-EFFORT — the loop is already durable, so a
    // stale view refresh must not reclassify success as failure (the user
    // would retry against a schedule that actually exists).
    await ports.getScheduledLoopStatus(conversationId).catch(() => undefined);
    return true;
  }

  function cancelScheduledLoop(): void {
    stagedLoop = null;
  }

  function resetConversationState(): void {
    stagedLoop = null;
  }

  return {
    routeCommand,
    confirmScheduledLoop,
    cancelScheduledLoop,
    resetConversationState,
  };
}
