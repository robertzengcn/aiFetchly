<template>
  <!--
    Authenticated account zone (shell footer): avatar + email activator with a
    popover menu carrying the plan label, Upgrade (free plans only), System
    setting, and Login out — the same entries the legacy drawer offered.
  -->
  <div class="account-menu">
    <v-menu location="top">
      <template v-slot:activator="{ props }">
        <button
          type="button"
          class="account-menu__activator"
          v-bind="props"
          :aria-label="accountEmail || 'Account'"
          :title="accountEmail || undefined"
          data-testid="account-menu-activator"
        >
          <v-avatar class="account-menu__avatar" size="32">
            <v-icon icon="mdi-account-circle" size="20" aria-hidden="true" />
          </v-avatar>
          <span class="account-menu__email">{{ accountEmail }}</span>
          <v-icon icon="mdi-chevron-up" size="small" aria-hidden="true" />
        </button>
      </template>
      <v-list nav data-testid="account-menu">
        <v-list-item
          v-if="accountPlanLabel"
          :title="accountPlanLabel"
          :prepend-icon="accountPlanIcon"
          data-testid="account-plan"
        />
        <v-list-item
          v-if="showUpgradePlan"
          :title="t('layout.upgrade_plan') || 'Upgrade'"
          prepend-icon="mdi-rocket-launch"
          data-testid="account-upgrade"
          @click="openPricingPlan"
        />
        <v-list-item
          :title="t('layout.system_setting') || 'System Setting'"
          prepend-icon="mdi-cog"
          data-testid="account-settings"
          @click="gotoSystemSetting"
        />
        <v-list-item
          :title="t('layout.login_out') || 'Login Out'"
          prepend-icon="mdi-login"
          data-testid="account-signout"
          @click="signOut"
        />
      </v-list>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { GetloginUserInfo, Signout } from "@/views/api/users";
import { getIpcTransport } from "@/views/utils/ipcTransport";
import { USER_OPEN_PRICING_PLAN } from "@/config/channellist";
import { useEntitlement } from "@/views/utils/subscriptionEntitlement";
import type { UserPlanType } from "@/entityTypes/userType";

const { t } = useI18n();
const router = useRouter();

const userName = ref("");
const userEmail = ref("");
const userPlan = ref("");
const currentPlans = ref<UserPlanType[]>([]);
const isPlusPlan = ref(false);

const accountEmail = computed(() => userEmail.value || userName.value);

function normalizePlanName(planName: string): string {
  return planName.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function isPlusSubscriptionPlan(plan: UserPlanType): boolean {
  const planName = normalizePlanName(plan.planName || "");
  const planId = (plan.planId || "").toUpperCase();
  return planName.includes("aifetchplus") || planId === "PLUS";
}
function isFreeSubscriptionPlan(plan: UserPlanType): boolean {
  const planName = normalizePlanName(plan.planName || "");
  const planId = (plan.planId || "").toUpperCase();
  return (
    planName.includes("community") ||
    planName.includes("free") ||
    planId === "FREE"
  );
}
function getDisplayPlans(plans: UserPlanType[]): UserPlanType[] {
  const namedPlans = plans.filter((plan) => Boolean(plan.planName?.trim()));
  const activePlans = namedPlans.filter(
    (plan) => plan.status?.toLowerCase() === "active"
  );
  return activePlans.length > 0 ? activePlans : namedPlans;
}
/** Apply a plan set to the account chrome (label, Plus flag, Upgrade row). */
function applyPlans(plans: UserPlanType[]): void {
  if (plans && plans.length > 0) {
    const displayPlans = getDisplayPlans(plans);
    currentPlans.value = displayPlans;
    isPlusPlan.value = displayPlans.some(isPlusSubscriptionPlan);
    userPlan.value = displayPlans.map((plan) => plan.planName).join(", ");
  }
}

const accountPlanLabel = computed(() => userPlan.value);
const accountPlanIcon = computed(() => {
  if (isPlusPlan.value) {
    return "mdi-plus-circle";
  }
  if (userPlan.value) {
    return "mdi-star-circle";
  }
  return "mdi-account-circle";
});
const showUpgradePlan = computed(
  () =>
    currentPlans.value.length > 0 &&
    currentPlans.value.every(isFreeSubscriptionPlan)
);

// Live plan refresh without navigation (same subscription as the legacy
// drawer): entitlement broadcasts update the label/Upgrade row in place.
useEntitlement({
  onPlansChanged: (plans) => applyPlans(plans),
});

function gotoSystemSetting(): void {
  void router.push("/systemsetting/index");
}

async function signOut(): Promise<void> {
  await Signout();
  void router.push("/login");
}

async function openPricingPlan(): Promise<void> {
  // Route through the main process so it records pricingOpenedAt and starts
  // the retry loop that recovers a missed WebSocket notify (PRD FR-3).
  const res = await getIpcTransport().invoke(USER_OPEN_PRICING_PLAN);
  if (!res || !res.status) {
    console.warn("Pricing page URL is not configured");
  }
}

onMounted(async () => {
  try {
    const res = await GetloginUserInfo();
    userName.value = res.name;
    userEmail.value = res.email;
    if (res.plans && res.plans.length > 0) {
      applyPlans(res.plans);
    }
  } catch (error) {
    console.error("Failed to load login user info:", error);
  }
});
</script>

<style scoped>
.account-menu {
  width: 100%;
}
.account-menu__activator {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.account-menu__activator:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}
.account-menu__activator:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
.account-menu__avatar {
  flex: 0 0 auto;
}
.account-menu__email {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
