<template>
  <!--
    Safe compatibility geometry for unmigrated families (design §6.3):
    normalizes ONLY outer background, height, padding, and overflow. It must
    never restyle feature-internal cards or controls.
  -->
  <div class="legacy-page-frame" data-testid="legacy-page-frame">
    <slot />
  </div>
</template>

<script setup lang="ts">
// Presentation-free by design: the frame is pure geometry.
</script>

<style scoped>
.legacy-page-frame {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--app-canvas);
  padding: var(--app-space-4);
}

@media (max-width: 900px) {
  .legacy-page-frame {
    padding: var(--app-space-2);
  }
}
</style>
