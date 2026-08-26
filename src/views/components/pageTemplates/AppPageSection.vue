<template>
  <!--
    Flat section hierarchy (design §11.3, §27.2).
    Replaces nested card wrappers with spacing + separators (IPR-010).
  -->
  <section class="app-page-section" :data-testid="testid">
    <h2 v-if="title" class="section-heading">{{ title }}</h2>
    <p v-if="description" class="section-description">{{ description }}</p>
    <div class="section-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    testid?: string;
  }>(),
  { testid: "app-page-section" }
);
</script>

<style scoped>
.app-page-section {
  padding: var(--app-space-4) 0;
  border-bottom: 1px solid var(--app-border);
}

.app-page-section:last-of-type {
  border-bottom: none;
}

.section-heading {
  margin: 0 0 var(--app-space-2);
  font-size: 13.5px;
  font-weight: 650;
}

.section-description {
  margin: 0 0 var(--app-space-3);
  font-size: 12.5px;
  color: var(--app-text-soft);
}

.section-body {
  display: flex;
  flex-direction: column;
  gap: var(--app-space-3);
}
</style>
