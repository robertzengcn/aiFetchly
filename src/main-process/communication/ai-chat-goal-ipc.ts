import { ipcMain } from "electron";
import { ensureHostedAiEnabled } from "@/service/AiFeatureGate";
import {
  AI_CHAT_V2_GOAL_CREATE,
  AI_CHAT_V2_GOAL_GET,
  AI_CHAT_V2_GOAL_LOOP_START,
  AI_CHAT_V2_GOAL_LOOP_STOP,
} from "@/config/channellist";
import { AIChatGoalModule } from "@/modules/AIChatGoalModule";
import {
  clampGoalLoopIterations,
  GOAL_LOOP_DEFAULT_ITERATIONS,
  GOAL_LOOP_DEFAULT_MAX_RUNTIME_MS,
  GOAL_LOOP_DEFAULT_REPEATED_FAILURE_THRESHOLD,
} from "@/config/aiChatGoalConfig";
import { userSafeError } from "@/service/AIChatErrorMapper";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  AIChatGoalCriterion,
  GoalVerificationKind,
} from "@/entityTypes/aiChatGoalTypes";

// Reuses the CommonMessage envelope shape used by the other Chat V2 handlers.
function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}
function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

function parsePayload(data: unknown): Record<string, unknown> | null {
  let raw: unknown = data;
  if (typeof raw === "string" && raw.length > 0) {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

const VERIFICATION_KINDS: ReadonlySet<GoalVerificationKind> = new Set([
  "command",
  "file",
  "manual",
  "llm",
]);

/** Validate externally-supplied criteria shape. Returns cleaned criteria or null. */
function validateCriteria(raw: unknown): readonly AIChatGoalCriterion[] | null {
  if (!Array.isArray(raw)) return null;
  const cleaned: AIChatGoalCriterion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const c = item as Record<string, unknown>;
    const criterionId = typeof c.criterionId === "string" ? c.criterionId : "";
    const description = typeof c.description === "string" ? c.description : "";
    if (!criterionId || !description) return null;
    const verification = c.verification as Record<string, unknown> | undefined;
    const kind = verification?.kind;
    if (
      typeof kind !== "string" ||
      !VERIFICATION_KINDS.has(kind as GoalVerificationKind)
    ) {
      return null;
    }
    cleaned.push({
      criterionId,
      description,
      required: c.required === true,
      verification: {
        kind: kind as GoalVerificationKind,
        command:
          typeof verification?.command === "string"
            ? verification.command
            : undefined,
        expectedExitCode:
          typeof verification?.expectedExitCode === "number"
            ? verification.expectedExitCode
            : undefined,
        expectedOutputPattern:
          typeof verification?.expectedOutputPattern === "string"
            ? verification.expectedOutputPattern
            : undefined,
        filePath:
          typeof verification?.filePath === "string"
            ? verification.filePath
            : undefined,
        expectedFileState:
          verification?.expectedFileState === "exists" ||
          verification?.expectedFileState === "changed"
            ? verification.expectedFileState
            : undefined,
      },
    });
  }
  return cleaned;
}

function defaultCriterionFor(objective: string): AIChatGoalCriterion {
  return {
    criterionId: "goal-objective-met",
    description: objective,
    required: true,
    verification: { kind: "manual" },
  };
}

function buildPlanPrompt(objective: string): string {
  return [
    `Plan how to accomplish this goal: ${objective}`,
    "",
    "Break the work into safe, ordered steps. For the overall goal, propose explicit acceptance criteria and how each will be verified (for example: a command that exits 0, a file that must exist, or a manual confirmation). Do not begin execution until the plan is approved.",
  ].join("\n");
}

async function handleGoalCreate(
  data: unknown
): Promise<CommonMessage<unknown>> {
  if (!(await ensureHostedAiEnabled())) {
    return denied("AI functionality is only available to subscribers.");
  }
  const p = parsePayload(data);
  if (!p) return denied("Invalid request payload");
  const conversationId =
    typeof p.conversationId === "string" ? p.conversationId : "";
  const objective = typeof p.objective === "string" ? p.objective : "";
  if (!conversationId) return denied("conversationId is required");
  if (!objective.trim()) return denied("objective must be non-empty");

  // Criteria come from Plan Mode; a fresh /goal starts with a single manual
  // criterion derived from the objective, refined during planning.
  let criteria: readonly AIChatGoalCriterion[];
  if (p.criteria !== undefined && p.criteria !== null) {
    const validated = validateCriteria(p.criteria);
    if (!validated)
      return denied("criteria must be an array of valid criteria");
    criteria = validated;
  } else {
    criteria = [defaultCriterionFor(objective)];
  }

  const module = new AIChatGoalModule();
  try {
    const goal = await module.createDraftGoal({
      conversationId,
      objective,
      criteria,
      planId: typeof p.planId === "string" ? p.planId : undefined,
      replace: p.replace === true,
    });
    return ok({ goal, planPrompt: buildPlanPrompt(objective) });
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleGoalGet(data: unknown): Promise<CommonMessage<unknown>> {
  if (!(await ensureHostedAiEnabled())) {
    return denied("AI functionality is only available to subscribers.");
  }
  const p = parsePayload(data);
  if (!p) return denied("Invalid request payload");
  const conversationId =
    typeof p.conversationId === "string" ? p.conversationId : "";
  if (!conversationId) return denied("conversationId is required");
  const module = new AIChatGoalModule();
  try {
    const goal = await module.getActiveGoal(conversationId);
    return ok(goal);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleLoopStart(data: unknown): Promise<CommonMessage<unknown>> {
  if (!(await ensureHostedAiEnabled())) {
    return denied("AI functionality is only available to subscribers.");
  }
  const p = parsePayload(data);
  if (!p) return denied("Invalid request payload");
  const conversationId =
    typeof p.conversationId === "string" ? p.conversationId : "";
  const goalId = typeof p.goalId === "string" ? p.goalId : "";
  if (!conversationId || !goalId) {
    return denied("conversationId and goalId are required");
  }
  const requested =
    typeof p.maxIterations === "number"
      ? p.maxIterations
      : GOAL_LOOP_DEFAULT_ITERATIONS;
  const maxIterations = clampGoalLoopIterations(requested);
  if (maxIterations === null) return denied("maxIterations must be a number");

  const module = new AIChatGoalModule();
  try {
    const goal = await module.getGoal(goalId);
    if (!goal || goal.conversationId !== conversationId) {
      return denied("Goal not found for this conversation.");
    }
    if (goal.status !== "active") {
      return denied(
        "An active, approved goal is required before starting a loop."
      );
    }
    const run = await module.createRun({
      goalId,
      conversationId,
      maxIterations,
      maxRuntimeMs: GOAL_LOOP_DEFAULT_MAX_RUNTIME_MS,
      repeatedFailureThreshold: GOAL_LOOP_DEFAULT_REPEATED_FAILURE_THRESHOLD,
    });
    await module.transitionGoalStatus(goalId, "running", {
      terminalReason: undefined,
    });
    // NOTE: the bounded maker-turn iteration engine is added in a later phase.
    return ok({ run });
  } catch (err) {
    return denied(userSafeError(err));
  }
}

async function handleLoopStop(data: unknown): Promise<CommonMessage<unknown>> {
  if (!(await ensureHostedAiEnabled())) {
    return denied("AI functionality is only available to subscribers.");
  }
  const p = parsePayload(data);
  if (!p) return denied("Invalid request payload");
  const conversationId =
    typeof p.conversationId === "string" ? p.conversationId : "";
  if (!conversationId) return denied("conversationId is required");
  const module = new AIChatGoalModule();
  try {
    const result = await module.cancelActiveRun(conversationId);
    return ok(result);
  } catch (err) {
    return denied(userSafeError(err));
  }
}

/**
 * Register /goal and /loop IPC handlers.
 *
 * Every handler checks USER_AI_ENABLED before parsing request data. Handlers
 * contain no direct database access — they delegate to AIChatGoalModule.
 */
export function registerAiChatGoalIpcHandlers(): void {
  ipcMain.handle(AI_CHAT_V2_GOAL_CREATE, async (_e, data: unknown) =>
    handleGoalCreate(data)
  );
  ipcMain.handle(AI_CHAT_V2_GOAL_GET, async (_e, data: unknown) =>
    handleGoalGet(data)
  );
  ipcMain.handle(AI_CHAT_V2_GOAL_LOOP_START, async (_e, data: unknown) =>
    handleLoopStart(data)
  );
  ipcMain.handle(AI_CHAT_V2_GOAL_LOOP_STOP, async (_e, data: unknown) =>
    handleLoopStop(data)
  );
}
