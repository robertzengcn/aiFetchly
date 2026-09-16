<template>
  <v-navigation-drawer
    :model-value="modelValue"
    location="right"
    width="420"
    temporary
    data-testid="ai-history-drawer"
    role="dialog"
    :aria-label="t('aiChatHistory.drawer_title') || 'Conversation History'"
    @update:model-value="emitUpdate"
  >
    <div class="d-flex align-center pa-3">
      <span class="text-subtitle-1">
        {{ t("aiChatHistory.drawer_title") || "Conversation History" }}
      </span>
      <v-spacer />
      <v-btn
        icon="mdi-close"
        variant="text"
        size="small"
        :aria-label="t('aiChatHistory.close') || 'Close history'"
        data-testid="ai-history-close"
        @click="emitClose"
      />
    </div>
    <v-divider />
    <v-tabs v-model="tab" density="compact" data-testid="ai-history-tabs">
      <v-tab value="browse" data-testid="ai-history-tab-browse">
        {{ t("aiChatHistory.tab_browse") || "Browse" }}
      </v-tab>
      <v-tab value="search" data-testid="ai-history-tab-search">
        {{ t("aiChatHistory.tab_search") || "Search" }}
      </v-tab>
    </v-tabs>
    <v-divider />

    <div v-if="tab === 'search'" class="pa-3">
      <v-text-field
        ref="searchInput"
        v-model="query"
        density="compact"
        variant="outlined"
        hide-details="auto"
        prepend-inner-icon="mdi-magnify"
        :placeholder="t('aiChatHistory.search_placeholder') || 'Search archived history…'"
        :aria-label="t('aiChatHistory.search_placeholder') || 'Search archived history'"
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
        {{ t("aiChatHistory.search_button") || "Search" }}
      </v-btn>
    </div>

    <div v-if="loadError" class="pa-3 text-error text-body-2" data-testid="ai-history-error" role="alert">
      {{ t("aiChatHistory.load_error", { message: loadError }) || `Failed to load history. ${loadError}` }}
    </div>

    <div v-if="statusBanner" class="pa-3 text-caption text-medium-emphasis">
      <v-icon v-if="statusIcon" size="x-small" start>{{ statusIcon }}</v-icon>
      {{ statusBanner }}
    </div>

    <v-list
      v-if="records.length > 0"
      lines="three"
      class="flex-grow-1"
      data-testid="ai-history-list"
      role="list"
    >
      <v-list-item
        v-for="(rec, idx) in records"
        :key="rec.sourceId"
        class="px-2"
        tabindex="0"
        role="listitem"
        :aria-label="`${rec.role} message, ${rec.timestamp}`"
        data-testid="ai-history-item"
        @keydown.enter="onItemKey(rec)"
        @keydown.space.prevent="onItemKey(rec)"
      >
        <AiChatHistoryMessage
          :excerpt="rec"
          @select="onSelect"
          @expand="onExpand(rec, idx)"
          @navigate="onNavigate(rec)"
        />
      </v-list-item>
    </v-list>

    <div v-else-if="!loading && tab === 'search' && searched" class="pa-3 text-body-2 text-medium-emphasis">
      {{ t("aiChatHistory.no_match") || "No matching messages found." }}
    </div>

    <div v-else-if="!loading && tab === 'browse' && browsed" class="pa-3 text-body-2 text-medium-emphasis">
      {{ t("aiChatHistory.empty") || "No archived history yet for this conversation." }}
    </div>

    <div v-if="nextCursor" class="pa-3 d-flex justify-center">
      <v-btn
        size="small"
        variant="text"
        :loading="loading"
        data-testid="ai-history-load-more"
        @click="loadMore"
      >
        {{ t("aiChatHistory.read_more") || "Load more" }}
      </v-btn>
    </div>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";
import {
  browseHistory,
  readHistory,
  searchHistory,
  type HistorySearchResult,
} from "@/views/api/aiChatV2";
import AiChatHistoryMessage from "@/views/components/aiChatV2/AiChatHistoryMessage.vue";

/**
 * History browser drawer (technical-design §13.1).
 *
 * Two independent modes:
 * - Browse: paginated chronological read of archived originals (loaded on
 *   open — viewing never mutates model context).
 * - Search: literal query over the archive index with continuation cursors.
 *
 * Local browsing only — search/read happen over IPC to the retrieval service,
 * no AI calls. Keyboard: Tab through items, Enter/Space to expand a passage,
 * Esc closes with focus restoration to the opener.
 */
const props = defineProps<{
  modelValue: boolean;
  conversationId: string;
  /** Initial tab (browse default). Exposed for tests + deep-linking search. */
  initialTab?: "browse" | "search";
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "select", excerpt: HistoryExcerpt): void;
  (e: "navigate", excerpt: HistoryExcerpt): void;
}>();

const { t } = useI18n();

const tab = ref<"browse" | "search">(props.initialTab ?? "browse");
const query = ref("");
const loading = ref(false);
const searched = ref(false);
const browsed = ref(false);
const loadError = ref<string | null>(null);
const records = ref<HistoryExcerpt[]>([]);
const nextCursor = ref<string | null>(null);
const scanComplete = ref(true);
const indexComplete = ref(true);
const errorCode = ref<string | undefined>(undefined);
const searchInput = useTemplateRef("searchInput");
let previouslyFocused: Element | null = null;

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

async function runBrowse(reset: boolean): Promise<void> {
  loading.value = true;
  loadError.value = null;
  const cursor = reset ? undefined : nextCursor.value ?? undefined;
  try {
    const page = await browseHistory(props.conversationId, cursor);
    records.value = reset ? [...page.records] : [...records.value, ...page.records];
    nextCursor.value = page.nextCursor;
    scanComplete.value = page.nextCursor === null;
    errorCode.value = undefined;
    browsed.value = true;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

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

function loadMore(): void {
  if (tab.value === "browse") {
    void runBrowse(false);
  } else {
    void runSearch(false);
  }
}

// Auto-search when the query changes (debounced), but only after the first
// explicit search. This avoids firing on every keystroke before the user
// commits to a query.
watch(query, () => {
  if (!searched.value) return;
  if (debounceId) clearTimeout(debounceId);
  debounceId = setTimeout(() => {
    void runSearch(true);
  }, 400);
});

// Switching tabs resets the list: browse and search have independent cursors.
watch(tab, (next) => {
  records.value = [];
  nextCursor.value = null;
  loadError.value = null;
  errorCode.value = undefined;
  if (next === "browse" && !browsed.value) {
    void runBrowse(true);
  }
});

// Load when the drawer opens, and reload when the conversation changes
// while open. Without this, opening the drawer on the same conversation and
// tab triggers no fetch (mount ran while closed) and the list stays empty.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      previouslyFocused = document.activeElement;
      records.value = [];
      nextCursor.value = null;
      loadError.value = null;
      errorCode.value = undefined;
      searched.value = false;
      browsed.value = false;
      if (tab.value === "browse") {
        void runBrowse(true);
      }
    }
  }
);

// Reload when the conversation changes while open.
watch(
  () => props.conversationId,
  () => {
    records.value = [];
    nextCursor.value = null;
    searched.value = false;
    browsed.value = false;
    if (props.modelValue) {
      void runBrowse(true);
    }
  }
);

function onSelect(excerpt: HistoryExcerpt): void {
  emit("select", excerpt);
}

function onItemKey(rec: HistoryExcerpt): void {
  onExpand(rec, records.value.findIndex((r) => r.sourceId === rec.sourceId));
}

/** Expand a truncated passage in place via a bounded source read. */
async function onExpand(rec: HistoryExcerpt, idx: number): Promise<void> {
  if (!rec.hasMore) return;
  try {
    const result = await readHistory(props.conversationId, {
      source_id: rec.sourceId,
    });
    const full = result.records[0];
    if (full) {
      const next = [...records.value];
      next[idx] = full;
      records.value = next;
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  }
}

/** Source navigation: let the parent reveal the original message context. */
function onNavigate(rec: HistoryExcerpt): void {
  emit("navigate", rec);
}

function emitClose(): void {
  emit("update:modelValue", false);
}

function emitUpdate(value: boolean): void {
  emit("update:modelValue", value);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && props.modelValue) {
    emitClose();
  }
}

onMounted(() => {
  // Focus is captured per-open in the modelValue watcher (not here): at mount
  // the opener is rarely focused yet, so a mount-time capture would restore
  // to the wrong element (typically body).
  if (props.modelValue) {
    previouslyFocused = document.activeElement;
    void runBrowse(true);
  }
  document.addEventListener("keydown", onKeydown);
  // Focus the search input when the drawer opens on the search tab.
  if (tab.value === "search") {
    void nextTick(() => {
      const el = searchInput.value as unknown as { focus?: () => void } | null;
      el?.focus?.();
    });
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  if (debounceId) clearTimeout(debounceId);
  // Focus restoration (§13.2): return focus to whatever opened the drawer.
  if (previouslyFocused instanceof HTMLElement) {
    previouslyFocused.focus();
  }
});
</script>
