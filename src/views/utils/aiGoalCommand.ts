import {
  GOAL_LOOP_MAX_ITERATIONS,
  GOAL_LOOP_MIN_ITERATIONS,
} from "@/config/aiChatGoalConfig";

/**
 * Pure parser for the /goal and /loop commands in AI Chat V2.
 *
 * Goal and loop execution is intercepted before the generic slash dispatcher
 * so /goal can create state and stream its Plan Mode prompt through Chat V2.
 * It only classifies input; it does no IPC, database, or streaming work.
 */
export type AiGoalCommandAction =
  | { readonly type: "none" }
  | { readonly type: "goal"; readonly objective: string }
  | { readonly type: "loop"; readonly count: number | null };

export function parseAiGoalCommand(input: string): AiGoalCommandAction {
  const text = input.trim();
  if (!text.startsWith("/")) return { type: "none" };

  const goalMatch = /^\/goal(?:\s+([\s\S]+))?$/i.exec(text);
  if (goalMatch) {
    return { type: "goal", objective: (goalMatch[1] ?? "").trim() };
  }

  const loopMatch = /^\/loop(?:\s+(\d+))?\s*$/i.exec(text);
  if (loopMatch) {
    const count = loopMatch[1] ? Number.parseInt(loopMatch[1], 10) : null;
    return { type: "loop", count };
  }

  return { type: "none" };
}

/** True when a parsed /loop count is within the configured bounds. */
export function isValidLoopCount(count: number): boolean {
  return (
    Number.isFinite(count) &&
    count >= GOAL_LOOP_MIN_ITERATIONS &&
    count <= GOAL_LOOP_MAX_ITERATIONS
  );
}
