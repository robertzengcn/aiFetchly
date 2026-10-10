import {
  isPlanStatusPlanningActive,
  type AIChatPlanStateView,
} from "@/entityTypes/aiChatPlanTypes";

/**
 * Returns true when the given plan state represents an active, in-progress
 * plan (draft / awaiting_question / awaiting_approval).
 * Returns false when there is no plan, the plan reached a terminal status
 * (completed / cancelled / rejected), or the plan was approved — approval
 * hands control back to the user, so execution rounds run in chat mode.
 *
 * Delegates to the shared isPlanStatusPlanningActive (aiChatPlanTypes.ts) —
 * the single status list used by both the renderer and the main process —
 * so the two processes can never disagree about which prompt/toolset a
 * round uses after approval.
 *
 * Used to decide whether the chat mode selector should reflect "plan". Keeping
 * this as a pure predicate makes the transition rule unit-testable and ensures
 * the mode is reset to "chat" whenever a plan ends — not only when it starts.
 */
export const isPlanStateActive = (
  state: AIChatPlanStateView | null
): boolean => {
  if (!state) return false;
  return isPlanStatusPlanningActive(state.status);
};
