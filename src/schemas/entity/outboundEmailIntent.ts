import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";
import {
  outboundEmailDeliveryModeSchema,
  outboundEmailIntentReasonCodeSchema,
} from "@/entityTypes/outboundEmailDeliveryTypes";

/** Write-boundary schema for {@link OutboundEmailIntentEntity}. */
export const outboundEmailIntentWriteSchema = lazySchema(() =>
  z.object({
    conversationId: z.string().min(1).max(100),
    sourceUserMessageId: z.string().min(1).max(100),
    mode: outboundEmailDeliveryModeSchema,
    reasonCode: outboundEmailIntentReasonCodeSchema,
    confidence: z.number().min(0).max(1),
    evidenceJson: z.string(),
    sourceTextHash: z.string().length(64),
    resolverVersion: z.string().min(1).max(50),
    previousAssistantMessageId: z.string().max(100).nullable().optional(),
  })
);
