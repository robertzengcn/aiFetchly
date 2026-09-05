<template>
  <!-- Flat labelled form section (design §14.1, IPR-020): separator-first,
       never a nested card. -->
  <section class="form-section" :data-testid="testid">
    <h2 class="section-heading">{{ title }}</h2>
    <p v-if="description" class="section-description">{{ description }}</p>
    <div class="section-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Pre-localized section title (feature owns its nouns). */
    title: string;
    description?: string;
    testid?: string;
  }>(),
  { description: "", testid: "form-section" }
);
</script>

<style scoped>
.form-section {
  padding: var(--app-space-4) 0;
  border-bottom: 1px solid var(--app-border);
}

.form-section:last-of-type {
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
