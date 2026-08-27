<template>
  <!--
    Landing pattern (design §19, IPR acceptance 7): continue/attention/
    outcomes/suggested actions as rows — never an equal-weight metric grid.
  -->
  <div class="landing-page" data-testid="landing-page">
    <section v-if="continueItems.length > 0" class="landing-section">
      <h2 class="landing-heading">{{ t('ui.landing.continue') || 'Continue your work' }}</h2>
      <ul class="landing-list">
        <li v-for="item in continueItems" :key="item.id">
          <button type="button" class="landing-row" :data-testid="`landing-continue-${item.id}`" @click="emit('navigate', item)">
            <span class="row-title">{{ item.title }}</span>
            <span v-if="item.description" class="row-description">{{ item.description }}</span>
          </button>
        </li>
      </ul>
    </section>

    <section v-if="attentionItems.length > 0" class="landing-section">
      <h2 class="landing-heading">{{ t('ui.landing.attention') || 'Needs attention' }}</h2>
      <ul class="landing-list">
        <li v-for="item in attentionItems" :key="item.id">
          <button type="button" class="landing-row attention" :data-testid="`landing-attention-${item.id}`" @click="emit('navigate', item)">
            <v-icon icon="mdi-alert-outline" size="16" aria-hidden="true" />
            <span class="row-title">{{ item.title }}</span>
            <span v-if="item.description" class="row-description">{{ item.description }}</span>
          </button>
        </li>
      </ul>
    </section>

    <section v-if="outcomeItems.length > 0" class="landing-section">
      <h2 class="landing-heading">{{ t('ui.landing.recentOutcomes') || 'Recent outcomes' }}</h2>
      <ul class="landing-list">
        <li v-for="item in outcomeItems" :key="item.id">
          <div class="landing-row static">
            <span class="row-title">{{ item.title }}</span>
            <span v-if="item.description" class="row-description">{{ item.description }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="suggestedItems.length > 0" class="landing-section">
      <h2 class="landing-heading">{{ t('ui.landing.suggested') || 'Suggested actions' }}</h2>
      <ul class="landing-list">
        <li v-for="item in suggestedItems" :key="item.id">
          <button type="button" class="landing-row" :data-testid="`landing-suggested-${item.id}`" @click="emit('navigate', item)">
            <span class="row-title">{{ item.title }}</span>
            <span v-if="item.description" class="row-description">{{ item.description }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

/** Landing row: pre-localized title/description + stable route target. */
export interface LandingItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly routeName?: string;
  readonly routeParams?: Record<string, string | number>;
}

withDefaults(
  defineProps<{
    continueItems?: readonly LandingItem[];
    attentionItems?: readonly LandingItem[];
    outcomeItems?: readonly LandingItem[];
    suggestedItems?: readonly LandingItem[];
  }>(),
  {
    continueItems: () => [],
    attentionItems: () => [],
    outcomeItems: () => [],
    suggestedItems: () => [],
  }
);

const emit = defineEmits<{
  (e: "navigate", item: LandingItem): void;
}>();

const { t } = useI18n();
</script>

<style scoped>
.landing-page {
  display: flex;
  flex-direction: column;
  gap: var(--app-space-5);
  max-width: 720px;
}

.landing-heading {
  margin: 0 0 var(--app-space-2);
  font-size: 13px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-muted);
}

.landing-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.landing-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--app-space-2);
  width: 100%;
  padding: var(--app-space-3) var(--app-space-2);
  border: none;
  border-bottom: 1px solid var(--app-border);
  background: none;
  text-align: left;
  cursor: pointer;
  color: var(--app-text);
}

.landing-row.static {
  cursor: default;
}

.landing-row:hover:not(.static) {
  background: var(--app-surface-variant);
}

.landing-row:focus-visible {
  outline: 2px solid var(--app-focus);
}

.landing-row.attention .row-title {
  color: var(--app-warning);
}

.row-title {
  font-size: 13.5px;
  font-weight: 600;
}

.row-description {
  font-size: 12px;
  color: var(--app-text-soft);
}
</style>
