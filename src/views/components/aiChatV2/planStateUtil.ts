import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";

/**
 * Statuses where the plan has left the planning conversation and the chat
 * should behave as plain chat again: the lifecycle ended (completed /
 * cancelled / rejected), or the user already approved the plan so execution
 * runs with the normal chat prompt and full tool access.
 */
const NON_PLAN_MODE_STATUSES = new Set([
  "approved",
  "completed",
  "cancelled",
  "rejected",
]);

/**
 * Returns true when the given plan state represents an active, in-progress
 * plan (draft / awaiting_question / awaiting_approval / executing).
 * Returns false when there is no plan, the plan reached a terminal status
 * (completed / cancelled / rejected), or the plan was approved — approval
 * hands control back to the user, so execution rounds run in chat mode.
 *
 * Used to decide whether the chat mode selector should reflect "plan". Keeping
 * this as a pure predicate makes the transition rule unit-testable and ensures
 * the mode is reset to "chat" whenever a plan ends — not only when it starts.
 */
export const isPlanStateActive = (
  state: AIChatPlanStateView | null
): boolean => {
  if (!state) return false;
  return !NON_PLAN_MODE_STATUSES.has(state.status);
};
