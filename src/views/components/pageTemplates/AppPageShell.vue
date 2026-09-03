<template>
  <!--
    Page identity, status, actions, toolbar, and content hierarchy
    (design §11.1, IPR-003..006). One programmatic h1; at most one
    page-owned status; one primary action; infrequent actions in overflow.
  -->
  <section
    class="app-page-shell"
    :class="[`width-${contentWidth}`, `density-${density}`]"
    :aria-busy="busy"
    data-testid="app-page-shell"
  >
    <header class="page-header">
      <div class="page-heading">
        <!-- Context slot: optional bounded breadcrumb/label (IPR-003). -->
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
      <!-- One summarized status owned by the page-level object (IPR-004). -->
      <div v-if="$slots.status" class="page-status">
        <slot name="status" />
      </div>
      <div class="page-actions">
        <slot name="primary-action" />
        <slot name="overflow" />
      </div>
    </header>

    <!-- Search/filters/sort/bulk live BELOW the header (IPR-005). -->
    <div v-if="$slots.toolbar" class="page-toolbar">
      <slot name="toolbar" />
    </div>

    <div class="page-content">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    pageId: string;
    titleKey: string;
    descriptionKey?: string;
    contentWidth?: "reading" | "form" | "wide" | "full";
    density?: "compact" | "comfortable";
    busy?: boolean;
  }>(),
  {
    descriptionKey: "",
    contentWidth: "full",
    density: "comfortable",
    busy: false,
  }
);

const { t } = useI18n();
const heading = ref<HTMLElement | null>(null);

/** Stable focus target for post-navigation focus (design §22.2). */
function focusHeading(): void {
  heading.value?.focus();
}

defineExpose({ focusHeading, pageId: props.pageId });
</script>

<style scoped>
.app-page-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: var(--app-space-4) var(--app-space-6);
  background: var(--app-canvas);
}

.width-form .page-content,
.width-reading .page-content {
  max-width: var(--app-width-form);
  width: 100%;
}

.width-wide .page-content {
  max-width: var(--app-width-wide);
  width: 100%;
}

.density-compact {
  padding: var(--app-space-3) var(--app-space-4);
}

.page-header {
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

.page-toolbar {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  flex-wrap: wrap;
  padding: var(--app-space-3) 0;
  flex-shrink: 0;
}

.page-content {
  flex: 1;
  min-height: 0;
}
</style>
