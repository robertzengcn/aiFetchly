/**
 * useEntitlement — renderer composable for subscription entitlement updates.
 *
 * Subscribes to the `USER_INFO_UPDATED` broadcast (main → renderer) and
 * centralizes the chrome-update + toast rules so individual views do not
 * duplicate them. Layout uses this to refresh the plan label, Upgrade button,
 * and AI-enabled UI without navigation (PRD FR-7).
 *
 * Toast rules (PRD §10):
 * - Community/free → paid AI: success toast ("subscription is active").
 * - Paid → cancelled/free: non-blocking info toast.
 * - Unchanged or GET failure: no toast.
 *
 * @see docs/prd/subscription-entitlement-reconciliation-technical-design.md §8
 */

import { ref, onUnmounted } from "vue";
import { getIpcTransport } from "@/views/utils/ipcTransport";
import { USER_INFO_UPDATED } from "@/config/channellist";
import type { UserPlanType } from "@/entityTypes/userType";
import type { UserInfoUpdatedEvent } from "@/entityTypes/subscriptionEntitlementTypes";

export interface UseEntitlementOptions {
  /** Called with the new plans after every changed broadcast. */
  onPlansChanged?: (plans: UserPlanType[], aiEnabled: boolean) => void;
  /** Called when reconciliation upgrades free → paid AI. */
  onUpgrade?: () => void;
  /** Called when reconciliation moves paid → cancelled/free. */
  onDowngrade?: () => void;
}

/**
 * Subscribe to USER_INFO_UPDATED. Returns the latest plans/aiEnabled refs and
 * automatically removes the listener on unmount. Callers pass toast callbacks
 * via options so the toast surface stays layout-owned.
 */
export function useEntitlement(options: UseEntitlementOptions = {}) {
  const currentPlans = ref<UserPlanType[]>([]);
  const aiEnabled = ref(false);
  let wasAiEnabled = false;

  const handleEvent = (value: unknown) => {
    const event = value as Partial<UserInfoUpdatedEvent> | undefined;
    if (!event || event.changed !== true) {
      return;
    }

    const plans = Array.isArray(event.plans) ? (event.plans as UserPlanType[]) : [];
    const enabled = event.aiEnabled === true;

    currentPlans.value = plans;
    aiEnabled.value = enabled;

    if (enabled && !wasAiEnabled) {
      options.onUpgrade?.();
    } else if (!enabled && wasAiEnabled) {
      options.onDowngrade?.();
    }
    wasAiEnabled = enabled;

    options.onPlansChanged?.(plans, enabled);
  };

  getIpcTransport().receive(USER_INFO_UPDATED, handleEvent as (value: unknown) => void);

  onUnmounted(() => {
    getIpcTransport().removeListener(
      USER_INFO_UPDATED,
      handleEvent as (value: unknown) => void
    );
  });

  return { currentPlans, aiEnabled };
}
