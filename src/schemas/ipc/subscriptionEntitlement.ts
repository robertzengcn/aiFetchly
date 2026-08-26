/**
 * Zod v4 schemas for the Subscription Entitlement Reconciliation IPC boundary.
 *
 * Per CLAUDE.md: new IPC payloads must be validated with `zod/v4` on the
 * receiving side. These schemas validate the `USER_REFRESH_ENTITLEMENT` and
 * `USER_OPEN_PRICING_PLAN` invoke inputs, and the `USER_INFO_UPDATED`
 * main→renderer broadcast payload.
 *
 * Schemas are wrapped with {@link lazySchema} so they are constructed once on
 * first use and share the `zodToJsonSchema` WeakMap cache with other schemas.
 *
 * @see docs/prd/subscription-entitlement-reconciliation-technical-design.md §5.4
 */

import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";
import { ENTITLEMENT_TRIGGERS } from "@/entityTypes/subscriptionEntitlementTypes";

/** Trigger enum. Mirrors {@link ENTITLEMENT_TRIGGERS}. */
export const entitlementTriggerSchema = z.enum(ENTITLEMENT_TRIGGERS);

/** A single user subscription plan, as returned by GET /api/user/info. */
export const userPlanSchema = z.object({
  planName: z.string(),
  planId: z.string().optional(),
  status: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
  billingPeriod: z.string().optional(),
});

/** Derived type: a validated user plan entry. */
export type UserPlanInput = z.infer<typeof userPlanSchema>;

/**
 * `USER_INFO_UPDATED` broadcast payload (main → renderer).
 *
 * Main constructs this from the new snapshot and validates it before send,
 * so the renderer can trust the shape without re-validating (main is the
 * trusted origin), but the single type keeps both sides honest.
 */
export const userInfoUpdatedEventSchema = lazySchema(() =>
  z.object({
    reason: entitlementTriggerSchema,
    notificationType: z.string().optional(),
    plans: z.array(userPlanSchema),
    aiEnabled: z.boolean(),
    changed: z.boolean(),
  }),
);

/** `USER_REFRESH_ENTITLEMENT` invoke input. `trigger` defaults to "manual". */
export const refreshEntitlementInputSchema = lazySchema(() =>
  z.strictObject({
    trigger: entitlementTriggerSchema.default("manual"),
  }),
);

/** `USER_OPEN_PRICING_PLAN` invoke input (no parameters). */
export const openPricingPlanInputSchema = lazySchema(() =>
  z.strictObject({}).optional(),
);
