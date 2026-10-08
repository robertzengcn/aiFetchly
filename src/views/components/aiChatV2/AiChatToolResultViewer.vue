<template>
  <div class="tool-output-viewer" data-testid="tool-output-viewer">
    <div class="tool-output-viewer__header">
      <div>
        <strong data-testid="viewer-title">
          {{ t("aiChatV2.toolOutput.view") || "View full result" }}
        </strong>
        <div class="tool-output-viewer__meta">
          <span data-testid="viewer-size">
            {{ t("aiChatV2.toolOutput.size") || "Saved size" }}: {{ formattedSize }}
          </span>
          <span v-if="recordCount !== null" data-testid="viewer-records">
            · {{ recordCount }} {{ t("aiChatV2.toolOutput.records") || "records" }}
          </span>
        </div>
      </div>
      <div class="tool-output-viewer__actions">
        <v-btn
          size="small"
          variant="text"
          :aria-label="t('aiChatV2.toolOutput.export') || 'Export result'"
          data-testid="viewer-export"
          @click="onExport"
        >
          {{ t("aiChatV2.toolOutput.export") || "Export result" }}
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          :aria-label="t('aiChatV2.toolOutput.close') || 'Close'"
          data-testid="viewer-close"
          @click="emit('close')"
        >
          {{ t("aiChatV2.toolOutput.close") || "Close" }}
        </v-btn>
      </div>
    </div>

    <!--
      A partial capture and a producer that truncated upstream are DIFFERENT
      problems, and both are stated rather than hidden.
    -->
    <v-alert
      v-if="descriptor && descriptor.preservation === 'partial'"
      type="warning"
      density="compact"
      class="mb-2"
      data-testid="viewer-partial-notice"
    >
      {{ t("aiChatV2.toolOutput.partial") || "Part of the output was saved" }}
    </v-alert>
    <v-alert
      v-if="descriptor && descriptor.sourceCompleteness !== 'complete'"
      type="info"
      density="compact"
      class="mb-2"
      data-testid="viewer-source-incomplete"
    >
      {{
        t("aiChatV2.toolOutput.source_incomplete") ||
          "The tool itself stopped early, so this output may be missing content"
      }}
    </v-alert>
    <v-alert
      v-if="descriptor && descriptor.state !== 'committed'"
      type="warning"
      density="compact"
      class="mb-2"
      data-testid="viewer-unavailable-notice"
    >
      {{ t("aiChatV2.toolOutput.not_available") || "This saved output is not available" }}
    </v-alert>

    <div class="tool-output-viewer__search">
      <v-text-field
        v-model="searchQuery"
        :label="t('aiChatV2.toolOutput.search') || 'Search'"
        :placeholder="t('aiChatV2.toolOutput.search_placeholder') || 'Search this output'"
        density="compact"
        hide-details
        data-testid="viewer-search-input"
        @keyup.enter="runSearch()"
      />
      <v-btn
        size="small"
        variant="tonal"
        class="ml-2"
        :aria-label="t('aiChatV2.toolOutput.search') || 'Search'"
        data-testid="viewer-search-submit"
        @click="runSearch()"
      >
        {{ t("aiChatV2.toolOutput.search") || "Search" }}
      </v-btn>
    </div>

    <div
      v-if="searchResults"
      class="tool-output-viewer__matches"
      data-testid="viewer-matches"
    >
      <div
        v-if="searchResults.matches.length === 0"
        data-testid="viewer-no-matches"
      >
        {{
          searchResults.scanComplete
            ? t("aiChatV2.toolOutput.search_no_matches") ||
              "No matches in the saved output"
            : t("aiChatV2.toolOutput.search_incomplete") ||
              "Search stopped early — more content may not have been checked"
        }}
      </div>
      <ul v-else>
        <li
          v-for="(match, index) in searchResults.matches"
          :key="`${match.startByte}-${index}`"
          class="tool-output-viewer__match"
          data-testid="viewer-match"
        >
          <button
            type="button"
            class="tool-output-viewer__match-button"
            data-testid="viewer-match-button"
            @click="openMatch(match.readCursor)"
          >
            {{ match.excerpt }}
          </button>
        </li>
      </ul>
      <!--
        "No matches" is only a real answer when the scan reached the end. A
        partial scan is labelled, so absence is never overclaimed.
      -->
      <div
        v-if="!searchResults.scanComplete"
        class="tool-output-viewer__notice"
        data-testid="viewer-search-incomplete"
      >
        {{
          t("aiChatV2.toolOutput.search_incomplete") ||
            "Search stopped early — more content may not have been checked"
        }}
      </div>
    <!--
        A partial scan returns a continuation cursor. Without a way to follow
        it the viewer can only ever show the FIRST page of matches, so a hit
        beyond the scan ceiling was unreachable from the UI entirely.
      -->
      <v-btn
        v-if="searchResults.nextCursor"
        size="small"
        variant="tonal"
        class="mt-2"
        :disabled="searchLoadingMore"
        :aria-label="
          t('aiChatV2.toolOutput.search_more') || 'Search for more matches'
        "
        data-testid="viewer-search-more"
        @click="runSearch(searchCursor, true)"
      >
        {{
          searchLoadingMore
            ? t("aiChatV2.toolOutput.searching") || "Searching…"
            : t("aiChatV2.toolOutput.search_more") || "Search for more matches"
        }}
      </v-btn>
    </div>

    <div
      v-if="errorCode"
      class="tool-output-viewer__error"
      role="alert"
      data-testid="viewer-error"
    >
      {{ errorLabel }}
    </div>
    <div
      v-else-if="loading"
      class="tool-output-viewer__loading"
      role="status"
      data-testid="viewer-loading"
    >
      {{ t("aiChatV2.toolOutput.loading") || "Loading…" }}
    </div>

    <!--
      Content is rendered as escaped text via interpolation, never v-html:
      tool output is untrusted data and must never become executable markup.
    -->
    <pre v-if="page" class="tool-output-viewer__page" data-testid="viewer-page">{{
      page.text
    }}</pre>

    <div class="tool-output-viewer__footer">
      <v-btn
        size="small"
        variant="text"
        :disabled="!canGoBack"
        :aria-label="t('aiChatV2.toolOutput.previous_page') || 'Previous page'"
        data-testid="viewer-prev"
        @click="goBack"
      >
        {{ t("aiChatV2.toolOutput.previous_page") || "Previous page" }}
      </v-btn>
      <span class="tool-output-viewer__position" data-testid="viewer-position">
        {{
          (t("aiChatV2.toolOutput.page_of") || "Page {page}").replace(
            "{page}",
            String(pageIndex + 1)
          )
        }}
      </span>
      <v-btn
        size="small"
        variant="text"
        :disabled="!nextCursor"
        :aria-label="t('aiChatV2.toolOutput.next_page') || 'Next page'"
        data-testid="viewer-next"
        @click="goNext"
      >
        {{ t("aiChatV2.toolOutput.next_page") || "Next page" }}
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        class="ml-2"
        :aria-label="t('aiChatV2.toolOutput.copy_page') || 'Copy this page'"
        data-testid="viewer-copy"
        @click="copyPage"
      >
        {{
          copied
            ? t("aiChatV2.toolOutput.copied") || "Copied"
            : t("aiChatV2.toolOutput.copy_page") || "Copy this page"
        }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  exportToolOutput,
  getToolOutput,
  readToolOutput,
  searchToolOutput,
  type ToolOutputDescriptorView,
  type ToolResultReadPageView,
  type ToolResultSearchPageView,
} from "@/views/api/aiToolResult";

/**
 * Paged viewer for a preserved tool output (technical design §11.2).
 *
 * Memory rules this component exists to enforce:
 *   - the first page is loaded ONLY when the viewer opens, so reopening a long
 *     conversation never loads raw output for messages the user did not open;
 *   - at most {@link MAX_CACHED_PAGES} pages are retained, so opening and
 *     closing repeatedly does not accumulate page data (NFR-08);
 *   - pages are never concatenated into one growing string;
 *   - stale requests are abandoned on close/conversation change, so a slow
 *     response cannot overwrite a newer one.
 *
 * Output is rendered as escaped text, never as HTML, and long unbroken lines
 * wrap so a minified document stays reviewable.
 */
const props = defineProps<{
  conversationId: string;
  outputId: string;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useI18n();

/** Retained page budget. Older pages are evicted, not accumulated. */
const MAX_CACHED_PAGES = 5;

interface CachedPage {
  text: string;
  startByte: number;
  endByte: number;
  totalBytes: number;
  nextCursor: string | null;
  complete: boolean;
}

const descriptor = ref<ToolOutputDescriptorView | null>(null);
const page = ref<CachedPage | null>(null);
const searchResults = ref<ToolResultSearchPageView | null>(null);
const loading = ref(false);
const errorCode = ref<string | null>(null);
const copied = ref(false);
const pageIndex = ref(0);

/** Visited pages, oldest first, capped at MAX_CACHED_PAGES. */
const history = ref<CachedPage[]>([]);
const nextCursor = ref<string | null>(null);
let requestToken = 0;
/** Current literal search query, bound with v-model on the search field. */
const searchQuery = ref("");
/**
 * Continuation cursor for the current literal search.
 *
 * Kept separately from `searchResults.nextCursor` so "load more" can pass an
 * explicit cursor while the displayed page keeps its own value.
 */
const searchCursor = ref<string | null>(null);
const searchLoadingMore = ref(false);

const canGoBack = computed(() => pageIndex.value > 0);

const formattedSize = computed(() => {
  const bytes = descriptor.value?.capturedBytes ?? 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
});

const recordCount = computed<number | null>(
  () => descriptor.value?.recordCount ?? null
);

/** Translate a machine code; never show the raw code as prose. */
const errorLabel = computed(() => {
  switch (errorCode.value) {
    case "OUTPUT_NOT_AVAILABLE":
      return (
        t("aiChatV2.toolOutput.not_available") ||
        "This saved output is not available"
      );
    case "RETRIEVAL_NOT_ENABLED":
      return (
        t("aiChatV2.toolOutput.retrieval_not_enabled") ||
        "Saved-output retrieval is not enabled for this conversation"
      );
    case "OUTPUT_FORMAT_UNSUPPORTED":
      return (
        t("aiChatV2.toolOutput.binary_unsupported") ||
        "This output cannot be displayed as text; export it instead"
      );
    case "OUTPUT_QUOTA_EXCEEDED":
      return (
        t("aiChatV2.toolOutput.quota_reached") ||
        "Storage quota reached; only part of this result was kept"
      );
    case "OUTPUT_DELETED":
      return (
        t("aiChatV2.toolOutput.deleted") ||
        "This saved output is no longer available"
      );
    default:
      return (
        t("aiChatV2.toolOutput.not_available") ||
        "This saved output is not available"
      );
  }
});

function pushHistory(entry: CachedPage): void {
  history.value = [...history.value, entry].slice(-MAX_CACHED_PAGES);
  pageIndex.value = history.value.length - 1;
}

/**
 * Load one page. `token` guards against out-of-order responses: a late reply
 * from a superseded request is discarded rather than rendered.
 */
async function loadPage(cursor?: string): Promise<void> {
  const token = ++requestToken;
  loading.value = true;
  errorCode.value = null;
  try {
    const result: ToolResultReadPageView | null = await readToolOutput({
      conversationId: props.conversationId,
      outputId: props.outputId,
      cursor,
    });
    if (token !== requestToken) return;
    if (!result) {
      errorCode.value = "OUTPUT_NOT_AVAILABLE";
      return;
    }
    const entry: CachedPage = {
      text: result.text,
      startByte: result.startByte,
      endByte: result.endByte,
      totalBytes: result.totalBytes,
      nextCursor: result.nextCursor,
      complete: result.complete,
    };
    if (cursor) {
      // Re-visiting a known page should not duplicate it in the history.
      const existing = history.value.findIndex((p) => p.startByte === entry.startByte);
      if (existing >= 0) {
        history.value.splice(existing, 1);
        pageIndex.value = Math.max(0, existing);
      }
    }
    pushHistory(entry);
    page.value = entry;
    nextCursor.value = result.nextCursor;
  } catch (error: unknown) {
    if (token !== requestToken) return;
    // windowInvoke throws with the machine code as the message.
    errorCode.value =
      error instanceof Error ? error.message : "OUTPUT_NOT_AVAILABLE";
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

/**
 * Load the public descriptor.
 *
 * Guarded by the same request token as the page load: without it, a slow
 * descriptor response for a previous output can land after the user has moved
 * on and overwrite the header of the artifact now being shown.
 */
async function loadDescriptor(token: number): Promise<void> {
  try {
    const result = await getToolOutput(props.conversationId, props.outputId);
    if (token !== requestToken) return;
    descriptor.value = result;
  } catch {
    if (token !== requestToken) return;
    descriptor.value = null;
  }
}

async function goNext(): Promise<void> {
  if (!nextCursor.value) return;
  await loadPage(nextCursor.value);
}

async function goBack(): Promise<void> {
  if (pageIndex.value <= 0) return;
  const target = pageIndex.value - 1;
  pageIndex.value = target;
  page.value = history.value[target] ?? null;
  // Stepping back must not discard the forward cursor, so returning forward
  // does not re-read from the beginning.
  nextCursor.value = history.value[target]?.nextCursor ?? null;
}

async function openMatch(readCursor: string): Promise<void> {
  searchResults.value = null;
  await loadPage(readCursor);
}

async function runSearch(
  cursor?: string | null,
  append = false
): Promise<void> {
  const token = ++requestToken;
  if (append) searchLoadingMore.value = true;
  else loading.value = true;
  errorCode.value = null;
  try {
    // Read the bound query, not `document.querySelector`: the element only
    // exists if this component is attached to the document, and a global
    // lookup would silently yield an empty query instead.
    const query = searchQuery.value.trim();
    if (!query) {
      searchResults.value = null;
      searchCursor.value = null;
      return;
    }
    // A bare `@click="runSearch"` receives the DOM event as the first
    // argument. That object is truthy, so it was sent as `cursor` and the
    // main process rejected it. The viewer then showed the generic
    // "saved output is not available" message for a perfectly valid search.
    // Only an explicit continuation string is a cursor.
    const continuation =
      typeof cursor === "string" && cursor.length > 0 ? cursor : undefined;
    const result: ToolResultSearchPageView | null = await searchToolOutput({
      conversationId: props.conversationId,
      outputId: props.outputId,
      query,
      ...(continuation !== undefined ? { cursor: continuation } : {}),
    });
    if (token !== requestToken) return;
    if (!result) {
      searchResults.value = null;
      searchCursor.value = null;
      return;
    }
    // APPEND rather than replace, so following a continuation grows the match
    // list instead of discarding the matches already shown. The backend
    // suppresses matches it already committed, so the merged list has no
    // duplicates.
    searchResults.value = append && searchResults.value
      ? {
          ...result,
          matches: [...searchResults.value.matches, ...result.matches],
        }
      : result;
    searchCursor.value = result.nextCursor;
  } catch (error: unknown) {
    if (token !== requestToken) return;
    errorCode.value =
      error instanceof Error ? error.message : "OUTPUT_NOT_AVAILABLE";
  } finally {
    if (token === requestToken) {
      loading.value = false;
      searchLoadingMore.value = false;
    }
  }
}

/** Copy ONLY the currently displayed page, and say so in the label. */
async function copyPage(): Promise<void> {
  if (!page.value) return;
  try {
    await navigator.clipboard.writeText(page.value.text);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    copied.value = false;
  }
}

async function onExport(): Promise<void> {
  try {
    await exportToolOutput(props.conversationId, props.outputId);
  } catch {
    errorCode.value = "OUTPUT_WRITE_FAILED";
  }
}

function reset(): void {
  // Invalidate in-flight requests so nothing repopulates the viewer after a
  // close or a conversation switch.
  requestToken += 1;
  history.value = [];
  page.value = null;
  nextCursor.value = null;
  searchResults.value = null;
  searchCursor.value = null;
  searchLoadingMore.value = false;
  pageIndex.value = 0;
  errorCode.value = null;
  copied.value = false;
}

onBeforeUnmount(reset);

// Load the first page only when this viewer is actually shown.
watch(
  () => [props.conversationId, props.outputId] as const,
  async () => {
    reset();
    const token = requestToken;
    loading.value = true;
    await loadDescriptor(token);
    if (token !== requestToken) return;
    await loadPage();
  },
  { immediate: true }
);
</script>

<style scoped>
.tool-output-viewer {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  padding: 12px;
}

.tool-output-viewer__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.tool-output-viewer__meta,
.tool-output-viewer__position,
.tool-output-viewer__notice {
  font-size: 12px;
  opacity: 0.75;
}

.tool-output-viewer__search {
  display: flex;
  align-items: center;
  margin: 8px 0;
}

.tool-output-viewer__page {
  /* Long unbroken lines must stay reviewable instead of forcing a
     horizontal scrollbar the user cannot reach. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 50vh;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.04);
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
}

.tool-output-viewer__match-button {
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-family: monospace;
  font-size: 12px;
  padding: 2px 0;
  width: 100%;
}

.tool-output-viewer__footer {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
}

.tool-output-viewer__error {
  color: rgb(var(--v-theme-error));
  font-size: 13px;
}
</style>
