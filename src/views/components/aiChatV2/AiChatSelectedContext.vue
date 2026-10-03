<template>
  <v-sheet
    v-if="selections.length > 0"
    class="ai-selected-context pa-2"
    elevation="0"
    rounded
    color="surface-variant"
    data-testid="ai-selected-context"
  >
    <div class="d-flex align-center ga-1">
      <v-icon size="small" color="primary">mdi-comment-quote-outline</v-icon>
      <span class="text-subtitle-2">
        {{ t("aiChatHistory.selected_context") || "Selected context" }}
      </span>
      <span class="text-caption text-medium-emphasis ml-2">
        {{ t("aiChatHistory.estimated_cost", { tokens: estimatedTokens }) || `Estimated cost: ${estimatedTokens} tokens` }}
      </span>
      <v-spacer />
      <v-btn
        size="x-small"
        variant="text"
        data-testid="ai-selected-context-clear"
        :aria-label="t('aiChatHistory.clear_selections') || 'Clear selections'"
        @click="emitClear"
        @keydown.enter="emitClear"
        @keydown.space.prevent="emitClear"
      >
        {{ t("aiChatHistory.clear_selections") || "Clear selections" }}
      </v-btn>
    </div>
    <div class="d-flex flex-wrap ga-1 mt-1">
      <v-chip
        v-for="sel in selections"
        :key="sel.sourceId"
        size="x-small"
        variant="tonal"
        :color="sel.rejected ? 'error' : sel.refreshed ? 'warning' : 'default'"
        :title="
          sel.rejected
            ? t('aiChatHistory.source_unavailable') || 'This passage is no longer available.'
            : sel.refreshed
              ? t('aiChatHistory.source_changed') || 'This passage changed since selection and was refreshed.'
              : undefined
        "
        closable
        @click:close="emitRemove(sel.sourceId)"
      >
        <span class="text-truncate" style="max-width: 220px">
          {{ sel.preview }}
        </span>
      </v-chip>
    </div>
  </v-sheet>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";

/**
 * Selected-context panel (technical-design §13.3).
 *
 * Renders the user's drafted history selections above the composer. Draft refs
 * are per-conversation; the backend re-resolves them on submit (no renderer text
 * is trusted as the original quote). Rejected selections (SOURCE_UNAVAILABLE)
 * are flagged with the error color so the user can act before sending.
 */
export interface SelectedContextItem {
  /** Opaque source id — the only value trusted across the boundary. */
  sourceId: string;
  /** Short preview text for display only (never re-sent as original quote). */
  preview: string;
  /** Estimated tokens for this selection (chars/4 heuristic). */
  estimatedTokens: number;
  /** True when the backend re-resolution refreshed a stale reference. */
  refreshed?: boolean;
  /** True when the backend rejected this source id (no longer available). */
  rejected?: boolean;
}

const props = defineProps<{
  selections: ReadonlyArray<SelectedContextItem>;
}>();

const emit = defineEmits<{
  (e: "remove", sourceId: string): void;
  (e: "clear"): void;
}>();

const { t } = useI18n();

const estimatedTokens = computed(() =>
  props.selections.reduce((sum, sel) => sum + sel.estimatedTokens, 0)
);

function emitRemove(sourceId: string): void {
  emit("remove", sourceId);
}

function emitClear(): void {
  emit("clear");
}

// HistoryExcerpt re-export for consumers that build items from resolved
// excerpts (keeps the type boundary in one place).
export type { HistoryExcerpt };
</script>
