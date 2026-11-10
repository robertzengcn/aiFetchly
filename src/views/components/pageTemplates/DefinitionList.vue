<template>
  <!-- Semantic read-only metadata (design §15.3, IPR-027): <dl> rows, never
       disabled inputs. -->
  <dl class="definition-list" :data-testid="testid">
    <div v-for="entry in entries" :key="entry.term" class="definition-row">
      <dt>{{ entry.termLabel ?? entry.term }}</dt>
      <dd>
        <a
          v-if="entry.href && /^https?:\/\//i.test(entry.href)"
          :href="entry.href"
          target="_blank"
          rel="noopener noreferrer"
        >{{ entry.value }}</a>
        <button
          v-else-if="entry.copyable && entry.value"
          type="button"
          class="copy-value"
          :aria-label="t('ui.actions.copy') || 'Copy'"
          @click="copyValue(String(entry.value))"
        >
          {{ entry.value }}
          <v-icon icon="mdi-content-copy" size="12" aria-hidden="true" />
        </button>
        <span v-else :class="{ mono: entry.mono }">{{ entry.value }}</span>
      </dd>
    </div>
  </dl>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

export interface DefinitionEntry {
  readonly term: string;
  /** Optional i18n-resolved label override. */
  readonly termLabel?: string;
  readonly value: unknown;
  readonly mono?: boolean;
  readonly copyable?: boolean;
  /** Safe http(s) link only — validated scheme, external open. */
  readonly href?: string;
}

withDefaults(
  defineProps<{
    entries: readonly DefinitionEntry[];
    testid?: string;
  }>(),
  { testid: "definition-list" }
);

const { t } = useI18n();

async function copyValue(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard denied — the value stays visible for manual copy.
  }
}
</script>

<style scoped>
.definition-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--app-space-2);
}

.definition-row dt {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-muted);
}

.definition-row dd {
  margin: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.mono {
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
  font-size: 12px;
}

a {
  color: var(--app-accent);
}

.copy-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  padding: 0;
  color: var(--app-text);
  font-size: inherit;
  cursor: copy;
}

.copy-value:focus-visible {
  outline: 2px solid var(--app-focus);
}
</style>
