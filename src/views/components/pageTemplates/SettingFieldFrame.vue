<template>
  <!--
    One setting row (design §17.2, IPR-033/034): label, explanation,
    control slot, and per-setting save state — never a giant green banner.
  -->
  <div class="setting-field-frame" :data-testid="`setting-${id}`">
    <div class="setting-text">
      <label class="setting-label" :for="controlId">{{ label }}</label>
      <p class="setting-description">{{ description }}</p>
    </div>
    <div class="setting-control">
      <slot />
      <span
        v-if="saveState !== 'idle'"
        class="setting-save-state"
        :class="`save-${saveState}`"
        :data-testid="`setting-save-${saveState}`"
        role="status"
      >
        {{ stateLabel }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { SettingSaveState } from "@/views/types/uiConvergenceTypes";

const props = withDefaults(
  defineProps<{
    id: string;
    /** Pre-localized label. */
    label: string;
    /** Pre-localized explanation (IPR-033). */
    description: string;
    saveState?: SettingSaveState;
    errorText?: string;
  }>(),
  { saveState: "idle", errorText: "" }
);

const { t } = useI18n();

const controlId = computed(() => `setting-control-${props.id}`);

const stateLabel = computed(() => {
  if (props.saveState === "error") {
    return props.errorText || (t("ui.settings.saveFailed") || "Save failed");
  }
  if (props.saveState === "saving") {
    return t("ui.settings.saving") || "Saving…";
  }
  return t("ui.settings.saved") || "Saved";
});
</script>

<style scoped>
.setting-field-frame {
  display: flex;
  align-items: flex-start;
  gap: var(--app-space-4);
  padding: var(--app-space-3) 0;
  border-bottom: 1px solid var(--app-border);
}

.setting-text {
  flex: 1;
  min-width: 0;
}

.setting-label {
  font-size: 13px;
  font-weight: 600;
}

.setting-description {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--app-text-soft);
}

.setting-control {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}

.setting-save-state {
  font-size: 11px;
  color: var(--app-text-muted);
}

.save-saving { color: var(--app-text-muted); }
.save-saved { color: var(--app-success); }
.save-error { color: var(--app-danger); }
</style>
