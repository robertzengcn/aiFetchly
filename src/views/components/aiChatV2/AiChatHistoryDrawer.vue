<template>
  <v-navigation-drawer
    :model-value="modelValue"
    @update:model-value="emitUpdate"
    location="right"
    width="420"
    temporary
    data-testid="ai-history-drawer"
  >
    <div class="d-flex align-center pa-3">
      <span class="text-subtitle-1">
        {{ t("aiChatHistory.drawer_title") || "Conversation History" }}
      </span>
      <v-spacer />
      <v-btn icon="mdi-close" variant="text" size="small" @click="emitClose" />
    </div>
    <v-divider />
    <div class="pa-3">
      <v-text-field
        v-model="query"
        density="compact"
        variant="outlined"
        hide-details="auto"
        prepend-inner-icon="mdi-magnify"
        :placeholder="t('aiChatHistory.search_placeholder') || 'Search archived history…'"
        :error-messages="queryError"
        data-testid="ai-history-search-input"
        @keydown.enter="runSearch(true)"
      />
      <v-btn
        class="mt-2"
        size="small"
        variant="tonal"
        color="primary"
        :loading="loading"
        :disabled="query.trim().length === 0"
        data-testid="ai-history-search-button"
        @click="runSearch(true)"
      >
        {{ t("aiChatHistory.search_placeholder") || "Search" }}
      </v-btn>
    </div>

    <v-divider />

    <div v-if="loadError" class="pa-3 text-error text-body-2" data-testid="ai-history-error">
      {{ t("aiChatHistory.load_error", { message: loadError }) || `Failed to load history. ${loadError}` }}
    </div>

    <div v-if="statusBanner" class="pa-3 text-caption text-medium-emphasis">
      <v-icon v-if="statusIcon" size="x-small" start>{{ statusIcon }}</v-icon>
      {{ statusBanner }}
    </div>

    <v-list v-if="records.length > 0" lines="three" class="flex-grow-1">
      <v-list-item v-for="rec in records" :key="rec.sourceId" class="px-2">
        <AiChatHistoryMessage :excerpt="rec" @select="onSelect" />
      </v-list-item>
    </v-list>

    <div v-else-if="!loading && searched" class="pa-3 text-body-2 text-medium-emphasis">
      {{ t("aiChatHistory.no_match") || "No matching messages found." }}
    </div>

    <div v-else-if="!loading && !searched" class="pa-3 text-body-2 text-medium-emphasis">
      {{ t("aiChatHistory.empty") || "No archived history yet for this conversation." }}
    </div>

    <div v-if="nextCursor" class="pa-3 d-flex justify-center">
      <v-btn
        size="small"
        variant="text"
        :loading="loading"
        data-testid="ai-history-load-more"
        @click="runSearch(false)"
      >
        {{ t("aiChatHistory.read_more") || "Load more" }}
      </v-btn>
    </div>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";
import { searchHistory, type HistorySearchResult } from "@/views/api/aiChatV2";
import AiChatHistoryMessage from "@/views/components/aiChatV2/AiChatHistoryMessage.vue";

/**
 * History browser drawer (technical-design §13.1).
 *
 * Local browsing only — search/read happen over IPC to the retrieval service,
 * no AI calls. Supports paginated continuation via a cursor and surfaces the
 * recoverable-history error codes (partial-scan, no-match, scope-invalid) so
 * the user understands incomplete results.
 */
const props = defineProps<{
  modelValue: boolean;
  conversationId: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "select", excerpt: HistoryExcerpt): void;
}>();

const { t } = useI18n();

const query = ref("");
const loading = ref(false);
const searched = ref(false);
const loadError = ref<string | null>(null);
const records = ref<HistoryExcerpt[]>([]);
const nextCursor = ref<string | null>(null);
const scanComplete = ref(true);
const indexComplete = ref(true);
const errorCode = ref<string | undefined>(undefined);

const queryError = computed(() => {
  if (query.value.length > 200) {
    return t("aiChatHistory.search_query_too_long") || "Query too long";
  }
  return "";
});

const statusBanner = computed(() => {
  if (errorCode.value === "HISTORY_NO_MATCH") {
    return t("aiChatHistory.no_match") || "No matching messages found.";
  }
  if (errorCode.value === "HISTORY_PARTIAL_SCAN" || !scanComplete.value) {
    return t("aiChatHistory.partial_scan") || "Partial results — scan incomplete.";
  }
  if (!indexComplete.value) {
    return t("aiChatHistory.index_incomplete") || "Indexing in progress; results may be incomplete.";
  }
  if (errorCode.value === "HISTORY_SCOPE_INVALID") {
    return t("aiChatHistory.scope_invalid") || "Invalid scope. Retry.";
  }
  return "";
});

const statusIcon = computed(() => {
  if (!scanComplete.value || !indexComplete.value) return "mdi-progress-clock";
  if (errorCode.value) return "mdi-alert-circle-outline";
  return "";
});

let debounceId: ReturnType<typeof setTimeout> | null = null;

async function runSearch(reset: boolean): Promise<void> {
  if (query.value.trim().length === 0 && reset) return;
  if (query.value.length > 200) return;
  loading.value = true;
  loadError.value = null;
  const cursor = reset ? undefined : nextCursor.value ?? undefined;
  try {
    const result: HistorySearchResult = await searchHistory(
      props.conversationId,
      query.value.trim(),
      cursor
    );
    if (reset) {
      records.value = [...result.records];
    } else {
      records.value = [...records.value, ...result.records];
    }
    nextCursor.value = result.nextCursor;
    scanComplete.value = result.scanComplete;
    indexComplete.value = result.indexComplete;
    errorCode.value = result.errorCode;
    searched.value = true;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

// Auto-search when the query changes (debounced), but only after the first
// explicit search. This avoids firing on every keystroke before the user
// commits to a query.
watch(query, (val, prev) => {
  void val;
  void prev;
  if (!searched.value) return;
  if (debounceId) clearTimeout(debounceId);
  debounceId = setTimeout(() => {
    void runSearch(true);
  }, 400);
});

function onSelect(excerpt: HistoryExcerpt): void {
  emit("select", excerpt);
}

function emitClose(): void {
  emit("update:modelValue", false);
}

function emitUpdate(value: boolean): void {
  emit("update:modelValue", value);
}
</script>
