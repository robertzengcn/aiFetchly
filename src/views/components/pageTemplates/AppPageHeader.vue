<template>
  <!--
    Page heading and bounded controls (design §11.1, §27.2 file map).
    Extracted from AppPageShell slots for file-map conformance.
  -->
  <div class="app-page-header">
    <div class="page-heading">
      <div v-if="$slots.context" class="page-context">
        <slot name="context" />
      </div>
      <h1 ref="heading" class="page-title" tabindex="-1" data-testid="app-page-title">
        <slot name="title">{{ t(titleKey) || titleKey }}</slot>
      </h1>
      <p v-if="descriptionKey || $slots.description" class="page-description">
        <slot name="description">{{ t(descriptionKey || "") }}</slot>
      </p>
    </div>
    <div v-if="$slots.status" class="page-status">
      <slot name="status" />
    </div>
    <div class="page-actions">
      <slot name="primary-action" />
      <slot name="overflow" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    titleKey: string;
    descriptionKey?: string;
  }>(),
  { descriptionKey: "" }
);
const { t } = useI18n();
const heading = ref<HTMLElement | null>(null);
void props;

function focusHeading(): void {
  heading.value?.focus();
}

defineExpose({ focusHeading });
</script>

<style scoped>
.app-page-header {
  display: flex;
  align-items: flex-start;
  gap: var(--app-space-3);
  padding-bottom: var(--app-space-3);
  border-bottom: 1px solid var(--app-border);
  flex-shrink: 0;
}

.page-heading {
  flex: 1;
  min-width: 0;
}

.page-context {
  font-size: 11.5px;
  color: var(--app-text-muted);
  margin-bottom: 2px;
}

.page-title {
  font-size: 18px;
  font-weight: 650;
  margin: 0;
  overflow-wrap: anywhere;
}

.page-title:focus {
  outline: none;
}

.page-title:focus-visible {
  outline: 2px solid var(--app-focus);
}

.page-description {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--app-text-soft);
}

.page-status {
  flex-shrink: 0;
  align-self: center;
}

.page-actions {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  flex-shrink: 0;
}
</style>
