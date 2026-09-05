<template>
  <!-- Compact durable receipt for resolved plan transitions (FR-052/059). -->
  <div
    class="plan-receipt"
    :class="`receipt-${kind}`"
    :data-testid="`workspace-plan-receipt-${kind}`"
  >
    <v-icon :icon="icon" size="16" aria-hidden="true" />
    <span class="receipt-label">{{ label }}</span>
    <span class="receipt-meta">v{{ plan.version }}</span>
    <button
      type="button"
      class="receipt-details"
      data-testid="workspace-plan-receipt-details"
      @click="emit('open-activity')"
    >
      {{ t('workspaceChat.plan.viewInActivity') || 'View in Activity' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PlanPresentationView } from "./planPresentationProjection";

const props = defineProps<{
  plan: PlanPresentationView;
}>();

const emit = defineEmits<{
  (e: "open-activity"): void;
}>();

const { t } = useI18n();

const RECEIPTS = {
  approved_receipt: {
    icon: "mdi-check-circle-outline",
    key: "workspaceChat.plan.receiptApproved",
    fallback: "Plan approved",
  },
  completed_receipt: {
    icon: "mdi-check-all",
    key: "workspaceChat.plan.receiptCompleted",
    fallback: "Plan completed",
  },
  rejected_receipt: {
    icon: "mdi-close-circle-outline",
    key: "workspaceChat.plan.receiptRejected",
    fallback: "Plan discarded",
  },
  cancelled_receipt: {
    icon: "mdi-stop-circle-outline",
    key: "workspaceChat.plan.receiptCancelled",
    fallback: "Plan cancelled",
  },
  changes_requested: {
    icon: "mdi-comment-edit-outline",
    key: "workspaceChat.plan.receiptChangesRequested",
    fallback: "Changes requested",
  },
} as const;

const kind = computed(
  () => props.plan.surface as keyof typeof RECEIPTS
);

const icon = computed(
  () => RECEIPTS[kind.value]?.icon ?? "mdi-clipboard-outline"
);

const label = computed(() => {
  const entry = RECEIPTS[kind.value];
  if (!entry) return props.plan.title;
  return t(entry.key) || entry.fallback;
});
</script>

<style scoped>
.plan-receipt {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 12px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.14);
  background: rgba(var(--v-theme-surface), 1);
  font-size: 12px;
}

.receipt-approved_receipt,
.receipt-completed_receipt {
  border-color: rgba(var(--v-theme-success), 0.4);
}

.receipt-rejected_receipt {
  border-color: rgba(var(--v-theme-error), 0.4);
}

.receipt-label {
  font-weight: 600;
}

.receipt-meta {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 11px;
}

.receipt-details {
  margin-left: auto;
  border: none;
  background: none;
  color: rgb(var(--v-theme-primary));
  font-size: 11.5px;
  cursor: pointer;
  text-decoration: underline;
}

.receipt-details:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
</style>
