import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";

/**
 * Terminal plan statuses — the plan has finished its lifecycle and the
 * conversation should behave as plain chat again. While a plan is in any
 * other status, the conversation is "in plan mode".
 */
const TERMINAL_PLAN_STATUSES = new Set(["completed", "cancelled", "rejected"]);

/**
 * Returns true when the given plan state represents an active, in-progress
 * plan (draft / awaiting_question / awaiting_approval / approved / executing).
 * Returns false when there is no plan, or the plan has reached a terminal
 * status (completed / cancelled / rejected).
 *
 * Used to decide whether the chat mode selector should reflect "plan". Keeping
 * this as a pure predicate makes the transition rule unit-testable and ensures
 * the mode is reset to "chat" whenever a plan ends — not only when it starts.
 */
export const isPlanStateActive = (
  state: AIChatPlanStateView | null
): boolean => {
  if (!state) return false;
  return !TERMINAL_PLAN_STATUSES.has(state.status);
};
