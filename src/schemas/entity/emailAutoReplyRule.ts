import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link EmailAutoReplyRuleEntity}. */
export const emailAutoReplyRuleWriteSchema = lazySchema(() =>
  z.object({
    emailServiceId: z.number().int(),
    name: z.string().min(1),
    enabled: z.number().int().optional(),
    allowedClassificationsJson: z.string(),
    blockedSenderPatternsJson: z.string().nullable().optional(),
    blockedDomainPatternsJson: z.string().nullable().optional(),
    dailySendLimit: z.number().int().optional(),
    perThreadReplyLimit: z.number().int().optional(),
    confidenceThreshold: z.number().optional(),
    quietHoursJson: z.string().nullable().optional(),
    requireApprovalBelowThreshold: z.number().optional(),
  }),
);
