<template>
  <!-- Concise awaiting-approval decision card (PRD §12.7, FR-053/056):
       no nested scrolling plan document — the complete version lives in
       Activity, reachable BEFORE approval. -->
  <section
    class="plan-decision-card"
    data-testid="workspace-plan-decision-card"
    aria-labelledby="plan-decision-heading"
  >
    <h2 id="plan-decision-heading" class="decision-heading">
      {{ t('workspaceChat.plan.readyForReview') || 'Plan ready for review' }}
    </h2>
    <p class="decision-objective">
      <strong>{{ plan.title }}</strong>
      <span v-if="plan.objective" class="objective-text">{{ plan.objective }}</span>
    </p>
    <p class="decision-meta">
      <span class="version-chip">v{{ plan.version }}</span>
      <span v-if="stepCount !== undefined">
        {{ t('workspaceChat.plan.steps', { count: stepCount }) || `${stepCount} steps` }}
      </span>
    </p>
    <p v-if="plan.changeReason" class="decision-changes">
      {{ t('workspaceChat.plan.changedSince', { version: plan.version - 1 }) || `Changed since v${plan.version - 1}` }}:
      {{ plan.changeReason }}
    </p>

    <div class="decision-actions" role="group">
      <button
        type="button"
        class="decision-secondary"
        data-testid="workspace-plan-review-full"
        @click="emit('review-full-plan')"
      >
        {{ t('workspaceChat.plan.reviewFullPlan') || 'Review full plan' }}
      </button>
      <button
        type="button"
        class="decision-secondary"
        data-testid="workspace-plan-request-changes"
        @click="emit('request-changes')"
      >
        {{ t('workspaceChat.plan.requestChanges') || 'Request changes' }}
      </button>
      <!-- Approve is the PRIMARY action (FR-056). -->
      <button
        type="button"
        class="decision-primary"
        data-testid="workspace-plan-approve"
        @click="emit('approve')"
      >
        {{ t('workspaceChat.plan.approve') || 'Approve plan' }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PlanPresentationView } from "./planPresentationProjection";

const props = defineProps<{
  plan: PlanPresentationView;
}>();

const emit = defineEmits<{
  (e: "approve"): void;
  (e: "request-changes"): void;
  (e: "review-full-plan"): void;
}>();

const { t } = useI18n();

const stepCount = computed(() => props.plan.scopeSummary?.stepCount);
</script>

<style scoped>
.plan-decision-card {
  border: 1px solid rgba(var(--v-theme-warning), 0.45);
  border-radius: 10px;
  background: rgba(var(--v-theme-warning), 0.06);
  padding: 12px 14px;
  margin: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.decision-heading {
  font-size: 13.5px;
  font-weight: 700;
  margin: 0;
}

.decision-objective {
  margin: 0;
  font-size: 12.5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.objective-text {
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.decision-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.version-chip {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 999px;
  padding: 0 8px;
  font-size: 10.5px;
}

.decision-changes {
  margin: 0;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.decision-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.decision-primary {
  border: none;
  border-radius: 6px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 600;
  font-size: 12.5px;
  padding: 6px 16px;
  cursor: pointer;
}

.decision-secondary {
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.25);
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-size: 12.5px;
  padding: 6px 14px;
  cursor: pointer;
}

.decision-primary:focus-visible,
.decision-secondary:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
</style>
