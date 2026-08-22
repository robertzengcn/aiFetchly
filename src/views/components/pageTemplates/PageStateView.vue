<template>
  <!--
    Shared loading/first-use/no-results/error/forbidden states (design §12,
    IPR-043). Raw exceptions never enter props — messageKey only.
  -->
  <div
    class="page-state-view"
    :class="`state-${loadState.state}`"
    :data-testid="`page-state-${loadState.state}`"
    role="status"
  >
    <template v-if="loadState.state === 'loading'">
      <div class="skeleton-stack" aria-hidden="true">
        <div v-for="row in rows" :key="row" class="skeleton-row" :style="{ width: widthFor(row) }" />
      </div>
      <span class="state-sr">{{ t('ui.state.loading') || 'Loading…' }}</span>
    </template>

    <template v-else-if="loadState.state === 'empty'">
      <div class="state-card">
        <h3 class="state-title">
          {{ loadState.kind === 'no-results'
            ? (t('ui.state.noResultsTitle') || 'No matching records')
            : (emptyTitleKey ? t(emptyTitleKey) : (t('ui.state.emptyTitle') || 'Nothing here yet')) }}
        </h3>
        <p class="state-body">
          {{ loadState.kind === 'no-results'
            ? (t('ui.state.noResultsBody') || 'Records may be hidden by the current filters.')
            : (emptyBodyKey ? t(emptyBodyKey) : (t('ui.state.emptyBody') || 'Get started by creating your first record.')) }}
        </p>
        <button
          v-if="loadState.kind === 'no-results'"
          type="button"
          class="state-action"
          data-testid="page-state-clear-filters"
          @click="emit('clear-filters')"
        >
          {{ t('ui.state.clearFilters') || 'Clear filters' }}
        </button>
        <button
          v-else-if="$slots['empty-action']"
          type="button"
          class="state-action primary"
          data-testid="page-state-empty-action"
          @click="emit('empty-action')"
        >
          <slot name="empty-action" />
        </button>
      </div>
    </template>

    <template v-else-if="loadState.state === 'error'">
      <div class="state-card" role="alert">
        <h3 class="state-title">{{ t('ui.state.errorTitle') || 'Something went wrong' }}</h3>
        <p class="state-body">{{ t(loadState.messageKey) || t('ui.state.errorBody') || 'The operation failed. Try again.' }}</p>
        <button
          v-if="loadState.recoverable"
          type="button"
          class="state-action primary"
          data-testid="page-state-retry"
          @click="emit('retry')"
        >
          {{ t('ui.actions.retry') || 'Retry' }}
        </button>
      </div>
    </template>

    <template v-else-if="loadState.state === 'forbidden'">
      <div class="state-card">
        <h3 class="state-title">{{ t('ui.state.forbiddenTitle') || 'Capability unavailable' }}</h3>
        <p class="state-body">
          {{ t(loadState.capabilityKey) || (t('ui.state.forbiddenBody') || 'This capability is not enabled for your plan.') }}
        </p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PageLoadState } from "@/views/types/uiConvergenceTypes";

const props = withDefaults(
  defineProps<{
    loadState: PageLoadState;
    /** Skeleton shape hint for loading rows. */
    skeletonRows?: number;
    emptyTitleKey?: string;
    emptyBodyKey?: string;
  }>(),
  { skeletonRows: 5, emptyTitleKey: "", emptyBodyKey: "" }
);

const emit = defineEmits<{
  (e: "retry"): void;
  (e: "clear-filters"): void;
  (e: "empty-action"): void;
}>();

const { t } = useI18n();

const rows = Array.from({ length: props.skeletonRows }, (_, i) => i + 1);

function widthFor(row: number): string {
  return `${100 - ((row - 1) % 3) * 12}%`;
}
</script>

<style scoped>
.page-state-view {
  display: flex;
  flex-direction: column;
  gap: var(--app-space-2);
  padding: var(--app-space-6) 0;
}

.state-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.skeleton-stack {
  display: flex;
  flex-direction: column;
  gap: var(--app-space-2);
}

.skeleton-row {
  height: 14px;
  border-radius: var(--app-radius-control);
  background: var(--app-surface-variant);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-row {
    animation: none;
  }
}

.state-card {
  display: flex;
  flex-direction: column;
  gap: var(--app-space-2);
  max-width: 460px;
  padding: var(--app-space-5);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-panel);
}

.state-title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
}

.state-body {
  margin: 0;
  font-size: 13px;
  color: var(--app-text-soft);
}

.state-action {
  align-self: flex-start;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-control);
  background: transparent;
  padding: 6px 14px;
  font-size: 12.5px;
  cursor: pointer;
  color: var(--app-text);
}

.state-action.primary {
  background: var(--app-accent);
  border-color: var(--app-accent);
  color: var(--app-canvas);
  font-weight: 600;
}

.state-action:focus-visible {
  outline: 2px solid var(--app-focus);
}
</style>
