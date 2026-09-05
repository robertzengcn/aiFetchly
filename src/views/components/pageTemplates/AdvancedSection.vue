<template>
  <!-- Accessible disclosure for advanced settings (design §14.5, IPR-025). -->
  <div class="advanced-section">
    <button
      type="button"
      class="advanced-toggle"
      :aria-expanded="open"
      :data-testid="testid"
      @click="open = !open"
    >
      <v-icon
        :icon="open ? 'mdi-chevron-down' : 'mdi-chevron-right'"
        size="16"
        aria-hidden="true"
      />
      {{ title }}
    </button>
    <div v-if="open" class="advanced-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

withDefaults(
  defineProps<{
    /** Pre-localized disclosure title. */
    title: string;
    testid?: string;
  }>(),
  { testid: "advanced-section" }
);

const open = ref(false);
</script>

<style scoped>
.advanced-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  padding: var(--app-space-2) 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--app-text-soft);
  cursor: pointer;
}

.advanced-toggle:focus-visible {
  outline: 2px solid var(--app-focus);
}

.advanced-body {
  padding-top: var(--app-space-2);
}
</style>
