/**
 * Capability RESPONSE schema (design §15.2).
 *
 * NOTE: this lives in `schemas/api/` (NOT `schemas/ipc/`) because it validates a
 * backend HTTP response envelope, not an IPC request payload. The IPC request
 * schemas remain in `schemas/ipc/aiContentReport.ts`.
 *
 * Validates the `CommonApiresp<AIContentReportCapabilities>` envelope plus
 * every numeric limit. Rejects negative, fractional, missing, and unknown
 * values BEFORE the service clamps accepted limits.
 */
import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";

const positiveInt = z.number().int().positive();

const capabilitiesDataSchema = z.strictObject({
  acceptedSchemaVersions: z.array(positiveInt).min(1),
  conversationReporting: z.strictObject({
    enabled: z.boolean(),
    maxAIItems: positiveInt,
    maxUserItems: positiveInt,
    maxTotalItems: positiveInt,
    maxItemTextChars: positiveInt,
    maxAggregateTextChars: positiveInt,
    maxImages: positiveInt,
  }),
});

export const aiContentReportCapabilitiesResponseSchema = lazySchema(() =>
  z.strictObject({
    status: z.boolean(),
    code: z.number(),
    msg: z.string(),
    data: capabilitiesDataSchema,
  })
);

export type AIContentReportCapabilitiesResponse = z.infer<
  ReturnType<typeof aiContentReportCapabilitiesResponseSchema>
>;
