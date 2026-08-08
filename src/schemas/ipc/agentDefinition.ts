import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { noInputSchema } from "@/schemas/ipc/_shared/common";

// IMPORTANT (Decision D1): bare "zod", NOT "zod/v4". registerValidatedHandler
// imports `ZodType` from bare "zod"; a zod/v4 schema is not assignable and
// would fail tsc. Keep this file consistent with sibling agentRuntime.ts.

export const agentDefinitionListInputSchema = noInputSchema;

export const agentDefinitionByIdInputSchema = lazySchema(() =>
  z.strictObject({
    agentId: z.string().min(1).max(256),
  })
);

export const agentDefinitionCreateInputSchema = lazySchema(() =>
  z.strictObject({
    idSlug: z.string().min(1).max(100),
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(2000),
    systemPrompt: z.string().min(1).max(100000),
    allowedTools: z.array(z.string().min(1).max(256)).max(200),
    defaultModel: z.string().max(120).optional(),
    mode: z.enum(["coordinator", "specialist", "verifier", "formatter"]),
    maxToolCalls: z.number().int().positive().max(100),
    maxRuntimeMs: z.number().int().positive().max(3600000),
    maxContinueCalls: z.number().int().positive().max(100),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
);

export const agentDefinitionUpdateInputSchema = lazySchema(() =>
  agentDefinitionCreateInputSchema()
    .partial()
    .extend({
      agentId: z.string().min(1).max(256),
    })
);

export const agentDefinitionToggleInputSchema = lazySchema(() =>
  z.strictObject({
    agentId: z.string().min(1).max(256),
    enabled: z.boolean(),
  })
);

export const agentDefinitionDeleteInputSchema = agentDefinitionByIdInputSchema;
