<template>
  <!--
    Infrequent page-level actions in an overflow menu (design §11.5, IPR-006).
    Destructive actions are visually separated within the menu (IPR-023).
  -->
  <v-menu location="bottom end">
    <template #activator="{ props: menuProps }">
      <button
        v-bind="menuProps"
        type="button"
        class="overflow-trigger"
        :aria-label="ariaLabel || 'More actions'"
        data-testid="app-page-overflow"
      >
        <v-icon icon="mdi-dots-horizontal" size="20" aria-hidden="true" />
      </button>
    </template>
    <v-list density="compact" role="menu">
      <slot />
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    ariaLabel?: string;
  }>(),
  {}
);
</script>

<style scoped>
.overflow-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: var(--app-radius-control);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: pointer;
}

.overflow-trigger:hover {
  background: rgba(var(--v-theme-on-surface), 0.07);
}

.overflow-trigger:focus-visible {
  outline: 2px solid var(--app-focus);
}
</style>
