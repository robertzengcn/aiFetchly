import { windowInvoke } from "@/views/utils/apirequest";
import {
  AI_CHAT_V2_GOAL_CREATE,
  AI_CHAT_V2_GOAL_GET,
  AI_CHAT_V2_GOAL_LOOP_START,
  AI_CHAT_V2_GOAL_LOOP_STOP,
} from "@/config/channellist";
import type {
  AIChatGoalCriterion,
  AIChatGoalLoopLimits,
  AIChatGoalRunView,
  AIChatGoalView,
} from "@/entityTypes/aiChatGoalTypes";

/**
 * Renderer API for the /goal and /loop feature.
 *
 * `windowInvoke` returns the unwrapped `result.data` from the IPC handler.
 * Renderer-side: must not import TypeORM, models, or modules.
 */

export interface CreateGoalRequest {
  conversationId: string;
  objective: string;
  /** Optional; when omitted the backend supplies a default manual criterion. */
  criteria?: AIChatGoalCriterion[];
  planId?: string;
  loopLimits?: AIChatGoalLoopLimits;
  replace?: boolean;
}

export interface CreateGoalResponse {
  goal: AIChatGoalView;
  /** Plan Mode prompt the renderer should send next via the V2 stream. */
  planPrompt: string;
}

export interface StartLoopRequest {
  conversationId: string;
  goalId: string;
  maxIterations?: number;
}

export interface StartLoopResponse {
  run: AIChatGoalRunView;
}

export async function createGoal(
  req: CreateGoalRequest
): Promise<CreateGoalResponse | null> {
  const resp = await windowInvoke(AI_CHAT_V2_GOAL_CREATE, req);
  return (resp as CreateGoalResponse | null) ?? null;
}

export async function getActiveGoal(
  conversationId: string
): Promise<AIChatGoalView | null> {
  const resp = await windowInvoke(AI_CHAT_V2_GOAL_GET, { conversationId });
  return (resp as AIChatGoalView | null) ?? null;
}

export async function startGoalLoop(
  req: StartLoopRequest
): Promise<StartLoopResponse | null> {
  const resp = await windowInvoke(AI_CHAT_V2_GOAL_LOOP_START, req);
  return (resp as StartLoopResponse | null) ?? null;
}

export async function stopGoalLoop(
  conversationId: string
): Promise<{ cancelled: boolean } | null> {
  const resp = await windowInvoke(AI_CHAT_V2_GOAL_LOOP_STOP, {
    conversationId,
  });
  return (resp as { cancelled: boolean } | null) ?? null;
}
