/**
 * Zod contract for browser decision envelopes v1 (technical design §9–§10).
 *
 * Mirrors the hosted decision contract (server design §5). Adapters validate
 * every provider response through these schemas before the runner sees it;
 * chat-model JSON that fails here is a validation failure, not an action.
 */
import { z } from "zod";

export const BROWSER_DECISION_OPERATIONS = [
  "CLICK",
  "FILL",
  "SELECT",
  "PRESS_KEY",
  "NAVIGATE",
  "GO_BACK",
  "HOVER",
  "SCROLL_UP",
  "SCROLL_DOWN",
  "WAIT",
  "EXTRACT",
  "SIGN_IN",
  "DONE",
  "ESCALATE",
] as const;

export const BROWSER_DECISION_PRESS_KEY_VALUES = [
  "Enter",
  "Escape",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
] as const;

/** Operations that require a target candidate id. */
export const TARGETED_OPERATIONS = new Set(["CLICK", "FILL", "SELECT", "HOVER", "EXTRACT"]);

export const browserDecisionOperationSchema = z.enum(BROWSER_DECISION_OPERATIONS);
export type BrowserDecisionOperationSchema = z.infer<typeof browserDecisionOperationSchema>;

export const decisionCandidateSchema = z.object({
  candidate_id: z.string().min(1).max(64),
  role: z.string().min(1).max(64),
  name: z.string().max(200),
  allowed_operations: z.array(browserDecisionOperationSchema).max(14),
  disabled: z.boolean().optional(),
  checked: z.boolean().optional(),
  selected: z.boolean().optional(),
  expanded: z.boolean().optional(),
  option_ids: z.array(z.string().max(64)).max(50).optional(),
  option_labels: z.array(z.string().max(200)).max(50).optional(),
});

export const decisionInputSchema = z.object({
  schema_version: z.literal(1),
  request_id: z.string().min(1).max(128),
  task_id: z.string().min(1).max(128),
  step_id: z.string().min(1).max(128),
  observation_id: z.string().min(1).max(128),
  page_revision: z.number().int().nonnegative(),
  goal: z.string().min(1).max(2000),
  subgoal: z.string().max(1000).nullable().optional(),
  constraints: z.array(z.string().max(256)).max(16),
  // P1/D-FR-24: completion criteria reach the model input.
  completion_criteria: z.array(z.string().max(256)).max(8).optional(),
  url: z.string().max(2048),
  title: z.string().max(512),
  candidates: z.array(decisionCandidateSchema).max(120),
  recent_actions: z
    .array(
      z.object({
        operation: browserDecisionOperationSchema,
        target_descriptor: z.string().max(300).nullable().optional(),
        outcome: z.enum(["executed", "failed", "effect_unknown"]),
        error_code: z.string().max(64).nullable().optional(),
      }),
    )
    .max(6),
  allowed_operations: z.array(browserDecisionOperationSchema).max(14),
  deadline_ms: z.number().int().positive().max(60000),
});

export type DecisionInput = z.infer<typeof decisionInputSchema>;

const uncertaintySchema = z.object({
  source: z.enum(["native_distribution", "unavailable"]),
  confidence: z.number().min(0).max(1).nullable(),
  calibration_version: z.string().max(64).nullable().optional(),
        usage_total_tokens: z.number().int().nonnegative().optional(),
});

const proposedActionSchema = z.object({
  operation: browserDecisionOperationSchema,
  target_id: z.string().max(64).nullable(),
  option_id: z.string().max(64).nullable(),
  key: z.enum(BROWSER_DECISION_PRESS_KEY_VALUES).nullable(),
  url: z.string().max(2048).nullable(),
  text: z.string().min(1).max(2000).nullable(),
});

export const decisionResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("decided"),
    action: proposedActionSchema,
    uncertainty: uncertaintySchema,
  }),
  z.object({ status: z.literal("llm_required"), reason_code: z.string().min(1).max(64) }),
  z.object({ status: z.literal("invalid_input"), reason_code: z.string().min(1).max(64) }),
  z.object({ status: z.literal("input_budget_exceeded"), reason_code: z.string().min(1).max(64) }),
  z.object({ status: z.literal("provider_error"), reason_code: z.string().min(1).max(64) }),
]);

export type DecisionResultWire = z.infer<typeof decisionResultSchema>;

/**
 * Structural validation of a decided action against its input. Returns the
 * first violation found, or null when the action is well-formed for the
 * offered candidates. Semantic checks (candidate membership, option
 * membership, same-site URL) live in BrowserDecisionValidator.
 */
export function validateDecisionActionStructure(
  result: DecisionResultWire,
  input: DecisionInput,
): string | null {
  if (result.status !== "decided") {
    return null;
  }
  const { operation, target_id, option_id, key, url } = result.action;
  if (!input.allowed_operations.includes(operation)) {
    return "operation_not_allowed";
  }
  if (TARGETED_OPERATIONS.has(operation)) {
    if (!target_id) {
      return "target_required";
    }
    if (operation === "FILL" && (!result.action.text || result.action.text.length === 0)) {
      return "text_required";
    }
    const candidate = input.candidates.find((c) => c.candidate_id === target_id);
    if (!candidate) {
      return "unknown_target";
    }
    if (!candidate.allowed_operations.includes(operation)) {
      return "operation_not_supported_by_target";
    }
    if (operation === "SELECT") {
      if (!option_id) {
        return "option_required";
      }
      if (!candidate.option_ids?.includes(option_id)) {
        return "unknown_option";
      }
    }
    return null;
  }
  if (operation === "PRESS_KEY") {
    if (!key) {
      return "key_required";
    }
    return null;
  }
  if (operation === "NAVIGATE") {
    if (!url) {
      return "url_required";
    }
    return null;
  }
  // SCROLL_*, WAIT, GO_BACK, DONE, ESCALATE take no target.
  if (
    target_id !== null ||
    option_id !== null ||
    key !== null ||
    url !== null ||
    result.action.text !== null
  ) {
    return "unexpected_fields";
  }
  return null;
}
