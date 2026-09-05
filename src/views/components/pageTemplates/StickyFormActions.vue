<template>
  <!--
    Reachable form actions (design §14.4, IPR-022/023): sticky INSIDE the
    center scroll container. Cancel secondary, one commit primary,
    destructive separated into overflow.
  -->
  <div class="sticky-form-actions" data-testid="sticky-form-actions">
    <div class="left-slot"><slot name="destructive" /></div>
    <div class="right-actions">
      <slot name="cancel" />
      <slot name="commit" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Pure presentation: handlers stay in the owning feature form.
</script>

<style scoped>
.sticky-form-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-space-2);
  padding: var(--app-space-3) 0;
  margin-top: var(--app-space-4);
  background: var(--app-canvas);
  border-top: 1px solid var(--app-border);
  z-index: 5;
}

.right-actions {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  margin-left: auto;
}
</style>
