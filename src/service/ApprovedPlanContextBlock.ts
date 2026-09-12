import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";

/**
 * Maximum plan markdown characters injected into the execution-round system
 * context. Mirrors the cap used by the plan-mode prompt
 * (PlanModePromptBuilder.buildPlanStateBlock) so the execution context is no
 * larger than the planning context that produced it.
 */
const APPROVED_PLAN_MARKDOWN_MAX_CHARS = 4000;

export interface BuildApprovedPlanContextBlockInput {
  readonly planState: AIChatPlanStateView;
}

/**
 * Build a self-contained system block that carries an approved plan's
 * markdown into the model's context for EXECUTION rounds — independent of
 * plan mode.
 *
 * Why this exists: `buildPlanModeSystemPrompt` (PlanModePromptBuilder) is the
 * ONLY path that inlines `planState.latestVersion.planMarkdown` into the
 * system prompt, and it is gated on `mode === "plan"`. After a user approves
 * a plan the execution round runs in chat mode (the mode selector returns to
 * "chat"), so the plan steps would vanish from the model's context — leaving
 * it unable to execute the plan it just drafted. This block is injected by
 * the context assembler whenever an approved plan exists, regardless of the
 * conversation mode, so the plan content survives the mode transition.
 *
 * The block is deliberately compact: status, title, objective, and the plan
 * markdown itself. It does NOT carry the full plan-mode workflow prompt —
 * execution rounds use the normal chat system prompt plus this context.
 */
export function buildApprovedPlanContextBlock(
  input: BuildApprovedPlanContextBlockInput
): string {
  const plan = input.planState;
  const lines: string[] = [
    "# Approved Plan — Execution Context",
    "The user has approved the following plan. Execute its steps now using the available tools.",
    `Status: ${plan.status}`,
    `Plan ID: ${plan.planId}`,
    `Title: ${plan.title}`,
    `Objective: ${plan.objective || "(not set)"}`,
    `Current version: ${plan.currentVersion}`,
  ];
  if (plan.approvedAt) {
    lines.push(`Approved at: ${plan.approvedAt}`);
  }
  if (plan.latestVersion) {
    lines.push(
      `Plan markdown (v${plan.latestVersion.version}):`,
      "```",
      plan.latestVersion.planMarkdown.slice(0, APPROVED_PLAN_MARKDOWN_MAX_CHARS),
      "```"
    );
  }
  return lines.join("\n");
}
