<template>
  <!--
    Search, filters, sort, view, and bulk actions (design §11.2, §27.2).
    Toolbar appears BELOW the identity header, not in it (IPR-005).
  -->
  <div v-if="$slots.default || $slots['bulk-actions']" class="app-page-toolbar" data-testid="app-page-toolbar">
    <slot />
    <div v-if="$slots['bulk-actions']" class="toolbar-bulk">
      <slot name="bulk-actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Pure presentation: the owning page owns handlers.
</script>

<style scoped>
.app-page-toolbar {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  flex-wrap: wrap;
  padding: var(--app-space-3) 0;
  flex-shrink: 0;
}

.toolbar-bulk {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  margin-left: auto;
}
</style>
