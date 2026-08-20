<template>
  <!-- Complete versioned plan document in Activity (FR-054/055): structured
       hierarchy, change reason, decisions — no nested conversation scroller. -->
  <section
    v-if="plan"
    class="plan-activity"
    data-testid="workspace-plan-activity"
    aria-live="polite"
  >
    <header class="plan-header">
      <h3 class="plan-title">{{ plan.title }}</h3>
      <span class="plan-status">
        {{ t(`workspaceChat.plan.status.${plan.status}`) || plan.status }}
      </span>
      <span class="plan-version">v{{ version.version }}</span>
    </header>
    <p v-if="plan.objective" class="plan-objective">{{ plan.objective }}</p>
    <p v-if="version.changeReason" class="plan-change-reason">
      <strong>
        {{ t('workspaceChat.plan.changedSince', { version: version.version - 1 }) || `Changed since v${version.version - 1}` }}:
      </strong>
      {{ version.changeReason }}
    </p>

    <div class="plan-document">
      <SafePlanMarkdown :markdown="version.planMarkdown || ''" />
    </div>

    <p v-if="plan.approvedAt" class="plan-timeline">
      {{ t('workspaceChat.plan.approvedAt') || 'Approved' }}:
      {{ formatTime(plan.approvedAt) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PlanPresentationView } from "./planPresentationProjection";
import SafePlanMarkdown from "./SafePlanMarkdown.vue";

const props = defineProps<{
  plan: PlanPresentationView | null;
}>();

const { t } = useI18n();

// Render only when a version document exists; versionless states (draft
// before first save) show nothing rather than an empty shell.
const plan = computed(() =>
  props.plan?.latestVersion ? props.plan : null
);
const version = computed(
  // Non-null inside the template: `plan` renders only when latestVersion
  // exists (computed guard above).
  () => plan.value?.latestVersion ?? { version: 0, planMarkdown: "", changeReason: undefined }
);

function formatTime(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleString();
}
</script>

<style scoped>
.plan-activity {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 2px 12px;
}

.plan-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plan-title {
  font-size: 13.5px;
  font-weight: 700;
  margin: 0;
  flex: 1;
}

.plan-status {
  font-size: 11px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 999px;
  padding: 0 8px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.plan-version {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.plan-objective {
  margin: 0;
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.plan-change-reason {
  margin: 0;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.plan-document {
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.14);
  border-radius: 8px;
  padding: 10px 12px;
  max-height: 100%;
  overflow-y: auto;
}

.plan-timeline {
  margin: 0;
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
