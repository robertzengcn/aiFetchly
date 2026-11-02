/**
 * browser_execute_task tool schema (PRD D-FR-05..10; technical design §6.1).
 *
 * One outer tool invocation runs a bounded multi-step browser task. The
 * caller cannot inject provider config, cookies, paths, scripts, credentials,
 * or approval grants — only goal, constraints, typed completion criteria, and
 * budget REDUCTIONS (never raises).
 */
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

export const browserCompletionCriterionSchema = lazySchema(() =>
  z.strictObject({
    kind: z.enum(["url_contains", "element_present", "extract_nonempty", "text_contains"]),
    value: z.string().min(1).max(500),
  })
);

export const browserExecuteTaskToolSchema = lazySchema(() =>
  z.strictObject({
    session_id: z.string().min(1).max(64),
    goal: z.string().min(1).max(2000),
    constraints: z.array(z.string().min(1).max(256)).max(16).optional(),
    completion_criteria: z
      .array(browserCompletionCriterionSchema())
      .max(8)
      .optional(),
    budget: z
      .strictObject({
        activeRuntimeMs: z.number().int().positive().optional(),
        leafSteps: z.number().int().positive().optional(),
        decisionRequests: z.number().int().positive().optional(),
        requestTimeoutMs: z.number().int().positive().optional(),
      })
      .optional(),
  })
);
