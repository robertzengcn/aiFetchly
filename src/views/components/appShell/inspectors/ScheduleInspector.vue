<template>
  <!--
    Schedule inspector panel (design §9.3): loads its record through the
    existing renderer API, validates every state, cancels stale responses
    via request generation, and clears content on close/owner change.
  -->
  <aside
    v-if="visible"
    class="app-inspector"
    :class="{ overlay: shell.mode !== 'wide' }"
    :style="shell.mode === 'wide' ? { width: `${shell.inspectorWidth}px` } : undefined"
    :aria-label="t('ui.inspector.region')"
    data-testid="app-inspector-schedule"
  >
    <header class="inspector-header">
      <h2>{{ t('ui.inspector.scheduleTitle') || 'Schedule details' }}</h2>
      <button
        type="button"
        class="inspector-close"
        :aria-label="t('ui.inspector.close') || 'Close inspector'"
        data-testid="app-inspector-close"
        @click="close"
      >
        <v-icon icon="mdi-close" size="18" aria-hidden="true" />
      </button>
    </header>

    <div class="inspector-body">
      <p v-if="loadState.state === 'loading'" class="inspector-state">
        {{ t('ui.state.loading') || 'Loading…' }}
      </p>
      <p
        v-else-if="loadState.state === 'error'"
        class="inspector-state error"
        role="alert"
      >
        {{ t('ui.state.errorLoad') || 'Failed to load the record.' }}
      </p>
      <template v-else-if="schedule">
        <h3 class="inspector-title">{{ schedule.name || schedule.taskName || `#${scheduleId}` }}</h3>
        <dl class="inspector-facts">
          <div class="fact-row">
            <dt>{{ t('ui.detail.status') || 'Status' }}</dt>
            <dd>{{ schedule.enabled === false ? (t('ui.task.paused') || 'Paused') : (t('ui.task.active') || 'Active') }}</dd>
          </div>
          <div v-if="schedule.cronExpression" class="fact-row">
            <dt>{{ t('ui.detail.schedule') || 'Schedule' }}</dt>
            <dd class="mono">{{ schedule.cronExpression }}</dd>
          </div>
          <div v-if="schedule.updatedAt" class="fact-row">
            <dt>{{ t('ui.detail.updated') || 'Updated' }}</dt>
            <dd>{{ formatTime(schedule.updatedAt) }}</dd>
          </div>
        </dl>
        <slot />
      </template>
      <p v-else class="inspector-state">
        {{ t('ui.state.missingRecord') || 'This record is no longer available.' }}
      </p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAppInspectorStore } from "@/views/store/appInspector";
import { useAppShellStore } from "@/views/store/appShell";
import type { PageLoadState } from "@/views/types/uiConvergenceTypes";

const inspector = useAppInspectorStore();
const shell = useAppShellStore();
const { t } = useI18n();

/** Minimal structural view of the existing schedule record. */
interface ScheduleRecordView {
  id?: number;
  name?: string;
  taskName?: string;
  cronExpression?: string;
  enabled?: boolean;
  updatedAt?: string;
}

const schedule = ref<ScheduleRecordView | null>(null);
const loadState = ref<PageLoadState>({ state: "loading" });

const scheduleId = computed(() => {
  const target = inspector.target;
  return target?.kind === "schedule" ? target.scheduleId : null;
});

const visible = computed(
  () => scheduleId.value !== null && shell.inspectorOpen
);

async function load(): Promise<void> {
  const id = scheduleId.value;
  if (id === null) return;
  const generation = inspector.beginRequest();
  loadState.value = { state: "loading" };
  schedule.value = null;
  try {
    // Existing renderer API stays authoritative (design §9.3); resolved
    // lazily to keep this component testable without the API module.
    const { getScheduleById } = await import("@/views/api/schedule");
    const detail = await getScheduleById(id);
    if (!inspector.isCurrent(generation)) return; // stale response
    const found = (detail?.schedule ?? null) as ScheduleRecordView | null;
    schedule.value =
      found && Number(found.id ?? id) === id ? found : (found ?? null);
    loadState.value = found
      ? { state: "ready" }
      : { state: "error", messageKey: "ui.state.missingRecord", recoverable: false };
  } catch {
    if (inspector.isCurrent(generation)) {
      loadState.value = { state: "error", messageKey: "ui.state.errorLoad", recoverable: true };
    }
  }
}

function close(): void {
  const originId = inspector.focusOriginId;
  inspector.close();
  shell.setInspectorOpen(false);
  restoreFocus(originId);
}

/** Focus restoration (design §9.5): origin element id, else page heading. */
function restoreFocus(originId: string | null): void {
  if (originId) {
    const el = document.getElementById(originId);
    if (el) {
      el.focus();
      return;
    }
  }
  const heading = document.querySelector<HTMLElement>("h1");
  heading?.focus();
}

function formatTime(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}

onMounted(() => {
  void load();
});

watch(scheduleId, () => {
  void load();
});
</script>

<style scoped>
.app-inspector {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  background: var(--app-surface);
  border-left: 1px solid var(--app-border);
  z-index: 30;
}

.app-inspector.overlay {
  width: min(92vw, 520px);
  box-shadow: -6px 0 24px rgba(0, 0, 0, 0.18);
}

.inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--app-space-3) var(--app-space-4);
  border-bottom: 1px solid var(--app-border);
  flex-shrink: 0;
}

.inspector-header h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}

.inspector-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--app-radius-control);
  background: transparent;
  color: var(--app-text-soft);
  cursor: pointer;
}

.inspector-close:hover {
  background: var(--app-surface-variant);
}

.inspector-close:focus-visible {
  outline: 2px solid var(--app-focus);
}

.inspector-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--app-space-4);
}

.inspector-title {
  font-size: 15px;
  margin: 0 0 var(--app-space-3);
}

.inspector-state {
  color: var(--app-text-muted);
  font-size: 13px;
}

.inspector-state.error {
  color: var(--app-danger);
}

.inspector-facts {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--app-space-2);
}

.fact-row dt {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-muted);
}

.fact-row dd {
  margin: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.mono {
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
  font-size: 12px;
}
</style>
