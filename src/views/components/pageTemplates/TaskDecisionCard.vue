<template>
  <!--
    Blocking customer decision (design §18.3, IPR-039): permission or
    user-input requirement as a focused surface with ordered actions.
  -->
  <section
    class="task-decision-card"
    :class="`decision-${tone}`"
    role="alertdialog"
    :aria-labelledby="headingId"
    data-testid="task-decision-card"
  >
    <h2 :id="headingId" class="decision-heading">
      <v-icon :icon="icon" size="18" aria-hidden="true" />
      {{ title }}
    </h2>
    <p class="decision-body">{{ body }}</p>
    <div class="decision-actions">
      <button
        type="button"
        class="decision-action"
        data-testid="task-decision-cancel"
        @click="emit('cancel')"
      >
        {{ cancelLabel || (t('ui.actions.cancel') || 'Cancel') }}
      </button>
      <button
        type="button"
        class="decision-action primary"
        data-testid="task-decision-primary"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    /** Pre-localized decision title. */
    title: string;
    /** Pre-localized consequence explanation. */
    body: string;
    /** Pre-localized primary (confirm) action label. */
    confirmLabel: string;
    cancelLabel?: string;
    tone?: "permission" | "input" | "danger";
  }>(),
  { cancelLabel: "", tone: "permission" }
);

const emit = defineEmits<{
  (e: "confirm"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
const headingId = `decision-heading-${Math.random().toString(36).slice(2, 8)}`;

const icon = computed(() => {
  switch (props.tone) {
    case "danger":
      return "mdi-alert";
    case "input":
      return "mdi-help-circle-outline";
    default:
      return "mdi-lock-outline";
  }
});
</script>

<style scoped>
.task-decision-card {
  display: flex;
  flex-direction: column;
  gap: var(--app-space-2);
  padding: var(--app-space-4);
  border: 1px solid var(--app-warning);
  border-radius: var(--app-radius-panel);
  background: var(--app-warning-soft);
  max-width: 560px;
}

.decision-danger {
  border-color: var(--app-danger);
  background: var(--app-danger-soft);
}

.decision-heading {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}

.decision-body {
  margin: 0;
  font-size: 13px;
  color: var(--app-text-soft);
}

.decision-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--app-space-2);
}

.decision-action {
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-control);
  background: transparent;
  padding: 6px 14px;
  font-size: 12.5px;
  cursor: pointer;
  color: var(--app-text);
}

.decision-action.primary {
  background: var(--app-accent);
  border-color: var(--app-accent);
  color: var(--app-canvas);
  font-weight: 600;
}

.decision-action:focus-visible {
  outline: 2px solid var(--app-focus);
}
</style>
