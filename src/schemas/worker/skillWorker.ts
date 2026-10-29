import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Skill Worker inbound message contract (WS-4 R4.6 Zod migration).
 *
 * Replaces the hand-written `validateExecuteSkillMessage` type-guard in
 * SkillWorker.ts. The worker validates inbound via `parseWorkerMessage` at the
 * parentPort boundary — a malformed payload is dropped with a warning + a
 * SKILL_ERROR reply, never crashed on.
 *
 * Only EXECUTE_SKILL is active (the dead EXECUTE_HOOK path was removed during
 * migration). `context` is validated downstream by SandboxedSkillExecutor, so
 * the schema models it permissively (record) rather than duplicating
 * SkillExecutionContext.
 */
export const skillWorkerInboundSchema = lazySchema(() =>
  z.object({
    type: z.literal("EXECUTE_SKILL"),
    requestId: z.string().min(1, "requestId is required"),
    code: z.string(),
    args: z.record(z.unknown()),
    context: z.record(z.unknown()),
  })
);

export type SkillWorkerInbound = z.infer<
  ReturnType<typeof skillWorkerInboundSchema>
>;
