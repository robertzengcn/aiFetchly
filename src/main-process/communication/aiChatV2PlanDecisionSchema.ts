import { z } from "zod/v4";

/**
 * Zod schemas for the plan decision IPC channels (approve / reject /
 * request-changes / list versions), validated at the IPC boundary (project
 * rule: every cross-process payload is validated with Zod on the receiving
 * side). Audit R2 N07: replaces `JSON.parse(...)` + property casts in
 * `ai-chat-v2-ipc.ts` with these bounded contracts.
 *
 * The caps bound persisted identity fields and stop an unbounded feedback
 * paste from bloating `plan_feedback` SQLite rows and AI token usage
 * (mirrors the plan-answer caps in `aiChatV2PlanAnswerSchema.ts`).
 */

/** Bounded plan/conversation identifier (SQLite TEXT, log/IPC safe). */
const boundedId = z.string().min(1).max(100);

/**
 * Base contract for a versioned plan decision. Renderer-supplied state
 * (status, timestamps) must never ride into the main process.
 */
export const PlanDecisionBaseSchema = z.strictObject({
  planId: boundedId,
  conversationId: boundedId,
  version: z.number().int().positive(),
});

export const PlanApproveInputSchema = PlanDecisionBaseSchema;

export const PlanRejectInputSchema = PlanDecisionBaseSchema.extend({
  feedback: z.string().max(5000).optional(),
});

export const PlanRequestChangesInputSchema = PlanDecisionBaseSchema.extend({
  feedback: z
    .string()
    .max(5000)
    .refine((value) => value.trim().length > 0, {
      message: "feedback is required",
    }),
});

export const PlanVersionsInputSchema = z.strictObject({
  planId: boundedId,
});

export type ValidatedPlanApproveInput = z.infer<typeof PlanApproveInputSchema>;
export type ValidatedPlanRejectInput = z.infer<typeof PlanRejectInputSchema>;
export type ValidatedPlanRequestChangesInput = z.infer<
  typeof PlanRequestChangesInputSchema
>;
export type ValidatedPlanVersionsInput = z.infer<typeof PlanVersionsInputSchema>;

/** Parse a raw IPC payload against one of the plan decision schemas. */
export function parsePlanDecisionInput<T>(
  data: string,
  schema: z.ZodType<T>
): { ok: true; value: T } | { ok: false; error: string } {
  let raw: unknown = {};
  if (data) {
    try {
      raw = JSON.parse(data);
    } catch {
      return { ok: false, error: "plan decision payload is not valid JSON" };
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: "plan decision payload is invalid" };
  }
  return { ok: true, value: result.data };
}
