<template>
  <!--
    Settings category navigation (design §17.1, IPR-032): tabs for 5-7
    categories inside the center page — never a third permanent sidebar.
  -->
  <div class="settings-shell" data-testid="settings-shell">
    <nav class="settings-nav" :aria-label="t('ui.settings.categories') || 'Settings categories'">
      <component
        :is="shell.mode === 'narrow' ? 'select' : 'div'"
        v-bind="shell.mode === 'narrow' ? selectBindings : {}"
        class="settings-nav-control"
      >
        <template v-if="shell.mode !== 'narrow'">
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            class="settings-tab"
            :class="{ active: category.id === activeId }"
            role="tab"
            :aria-selected="category.id === activeId"
            :data-testid="`settings-tab-${category.id}`"
            @click="emit('select', category.id)"
          >
            {{ category.label }}
          </button>
        </template>
        <template v-else>
          <option
            v-for="category in categories"
            :key="category.id"
            :value="category.id"
            :selected="category.id === activeId"
          >
            {{ category.label }}
          </option>
        </template>
      </component>
    </nav>
    <div class="settings-body" role="tabpanel">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useAppShellStore } from "@/views/store/appShell";

export interface SettingsCategory {
  readonly id: string;
  /** Pre-localized category label. */
  readonly label: string;
  /** Optional route to push on select; else emit only. */
  readonly routeName?: string;
}

const props = defineProps<{
  categories: readonly SettingsCategory[];
  activeId: string;
}>();

const emit = defineEmits<{
  (e: "select", categoryId: string): void;
}>();

const { t } = useI18n();
const shell = useAppShellStore();

const selectBindings = computed(() => ({
  class: "settings-select",
  value: props.activeId,
  onChange: (event: Event) => {
    const value = (event.target as HTMLSelectElement).value;
    emit("select", value);
  },
}));
</script>

<style scoped>
.settings-shell {
  display: flex;
  flex-direction: column;
  gap: var(--app-space-3);
}

.settings-nav {
  border-bottom: 1px solid var(--app-border);
}

.settings-nav-control {
  display: flex;
  gap: var(--app-space-1);
  overflow-x: auto;
}

.settings-tab {
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  padding: var(--app-space-2) var(--app-space-3);
  font-size: 13px;
  color: var(--app-text-soft);
  cursor: pointer;
  white-space: nowrap;
}

.settings-tab.active {
  color: var(--app-text);
  border-bottom-color: var(--app-accent);
  font-weight: 600;
}

.settings-tab:focus-visible {
  outline: 2px solid var(--app-focus);
}

.settings-select {
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-control);
  padding: var(--app-space-2);
  font-size: 13px;
  background: var(--app-surface);
  color: var(--app-text);
}

.settings-body {
  padding-top: var(--app-space-2);
}
</style>
