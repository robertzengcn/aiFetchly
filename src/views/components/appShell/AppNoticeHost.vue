<template>
  <!--
    One global notice host (design §20.1): restrained live regions with
    translation keys and action IDs — never closures or raw errors.
  -->
  <div class="app-notice-host" aria-live="polite" data-testid="app-notice-host">
    <div
      v-for="notice in noticeList"
      :key="notice.id"
      class="app-notice"
      :class="`tone-${notice.tone}`"
      role="status"
    >
      <v-icon :icon="iconFor(notice.tone)" size="16" aria-hidden="true" />
      <span class="notice-text">
        {{ t(notice.messageKey, notice.parameters ?? {}) || notice.messageKey }}
      </span>
      <button
        v-if="notice.action"
        type="button"
        class="notice-action"
        :data-notice-action="notice.action.actionId"
        @click="emit('action', notice.action.actionId)"
      >
        {{ t(notice.action.labelKey) || notice.action.labelKey }}
      </button>
      <button
        type="button"
        class="notice-dismiss"
        :aria-label="t('ui.actions.dismiss') || 'Dismiss'"
        @click="noticeStore.dismiss(notice.id)"
      >
        <v-icon icon="mdi-close" size="14" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useAppNoticesStore } from "@/views/store/appNotices";

const emit = defineEmits<{
  /** Owning dispatcher resolves allowlisted action ids (design §20.1). */
  (e: "action", actionId: string): void;
}>();

const { t } = useI18n();
const noticeStore = useAppNoticesStore();
import { computed } from "vue";

const noticeList = computed(() => noticeStore.notices);

function iconFor(tone: "success" | "info" | "warning" | "error"): string {
  switch (tone) {
    case "success":
      return "mdi-check-circle-outline";
    case "warning":
      return "mdi-alert-outline";
    case "error":
      return "mdi-close-circle-outline";
    default:
      return "mdi-information-outline";
  }
}
</script>

<style scoped>
.app-notice-host {
  position: fixed;
  right: var(--app-space-4);
  bottom: var(--app-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--app-space-2);
  z-index: 200;
  max-width: min(420px, 92vw);
}

.app-notice {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  padding: var(--app-space-2) var(--app-space-3);
  border-radius: var(--app-radius-panel);
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  font-size: 13px;
}

.app-notice.tone-success { color: var(--app-success); }
.app-notice.tone-warning { color: var(--app-warning); }
.app-notice.tone-error { color: var(--app-danger); }

.notice-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.notice-action {
  border: none;
  background: none;
  color: var(--app-accent);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}

.notice-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--app-text-muted);
  cursor: pointer;
  width: 24px;
  height: 24px;
  border-radius: var(--app-radius-control);
}

.notice-dismiss:focus-visible,
.notice-action:focus-visible {
  outline: 2px solid var(--app-focus);
}
</style>
