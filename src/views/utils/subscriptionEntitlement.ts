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
  /**
   * Reads the caller's owned AI-enabled baseline (e.g. a ref seeded by the
   * local `GetloginUserInfo()` read on mount). Used to decide whether a
   * `changed` broadcast is a *transition* (free→paid / paid→free, which
   * toasts) or a no-op refresh for an already-paid user (which must not
   * toast). The caller's ref must be populated before the first broadcast is
   * processed; in practice `onMounted` runs before any main→renderer IPC.
   *
   * Defaults to `() => false`, so callers that don't already track an
   * AI-enabled ref only mis-toast once — but layout always passes one.
   */
  readBaselineAiEnabled?: () => boolean;
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
 *
 * MUST be called synchronously during component setup (not inside an async
 * `onMounted`), because it registers `onUnmounted` to clean up the IPC
 * listener — registering lifecycle hooks outside setup is a no-op and would
 * leak the listener.
 */
export function useEntitlement(options: UseEntitlementOptions = {}) {
  const currentPlans = ref<UserPlanType[]>([]);
  const aiEnabled = ref(false);
  const readBaseline = options.readBaselineAiEnabled ?? (() => false);

  const handleEvent = (value: unknown) => {
    const event = value as Partial<UserInfoUpdatedEvent> | undefined;
    if (!event || event.changed !== true) {
      return;
    }

    const plans = Array.isArray(event.plans)
      ? (event.plans as UserPlanType[])
      : [];
    const enabled = event.aiEnabled === true;

    // Compare against the caller's owned baseline (the local cache), which
    // `onMounted` seeds before any main→renderer broadcast can arrive. This
    // prevents a spurious "upgrade" toast for a returning Plus/Pro user whose
    // first `changed:true` broadcast simply confirms an already-paid state.
    const wasAiEnabled = readBaseline();

    currentPlans.value = plans;
    aiEnabled.value = enabled;

    if (enabled && !wasAiEnabled) {
      options.onUpgrade?.();
    } else if (!enabled && wasAiEnabled) {
      options.onDowngrade?.();
    }

    options.onPlansChanged?.(plans, enabled);
  };

  getIpcTransport().receive(
    USER_INFO_UPDATED,
    handleEvent as (value: unknown) => void
  );

  onUnmounted(() => {
    getIpcTransport().removeListener(
      USER_INFO_UPDATED,
      handleEvent as (value: unknown) => void
    );
  });

  return { currentPlans, aiEnabled };
}
