import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * YellowPages Scraper Process inbound contract (WS-4 R4.6 Zod migration).
 *
 * Replaces the bare `process.on("message", async (message: any) => ...)`.
 * Models the 7 inbound message types the process handles (START_TASK through
 * EXIT) as a discriminatedUnion on `type`. The base IPCMessage fields (id,
 * timestamp, sourceProcessId, targetProcessId, taskId) are validated strictly;
 * type-specific extras (parameters, taskData) permissively.
 */
const baseFields = {
  id: z.string(),
  timestamp: z.number(),
  sourceProcessId: z.string(),
  targetProcessId: z.string(),
  taskId: z.string(),
};

export const yellowPagesScraperProcessInboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    z.object({
      ...baseFields,
      type: z.literal("START_TASK"),
      parameters: z.unknown().optional(),
    }),
    z.object({ ...baseFields, type: z.literal("STOP_TASK") }),
    z.object({ ...baseFields, type: z.literal("PAUSE_TASK") }),
    z.object({ ...baseFields, type: z.literal("RESUME_TASK") }),
    z.object({
      ...baseFields,
      type: z.literal("TASK_DATA"),
      taskData: z.unknown(),
    }),
    z.object({ ...baseFields, type: z.literal("HEALTH_CHECK") }),
    z.object({ ...baseFields, type: z.literal("EXIT") }),
  ])
);

export type YellowPagesScraperProcessInbound = z.infer<
  ReturnType<typeof yellowPagesScraperProcessInboundSchema>
>;
