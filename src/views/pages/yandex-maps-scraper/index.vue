<template>
  <v-container fluid>
    <!-- Header -->
    <v-row class="mb-4">
      <v-col cols="12">
        <h2 class="text-h4 font-weight-bold">
          <v-icon class="mr-2">mdi-map-search-outline</v-icon>
          {{ t('yandexMaps.title') || 'Yandex Maps Scraper' }}
        </h2>
        <p class="text-subtitle-1 text-medium-emphasis">
          {{ t('yandexMaps.description') || 'Search Yandex Maps for local businesses by keyword and location' }}
        </p>
      </v-col>
    </v-row>

    <!-- Search Form -->
    <v-card class="mb-4">
      <v-card-text>
        <v-row>
          <v-col cols="12" md="5">
            <v-text-field
              v-model="query"
              :label="t('yandexMaps.query_label') || 'Business Keyword'"
              :placeholder="t('yandexMaps.query_placeholder') || 'e.g. dentist, Italian restaurant'"
              :hint="t('yandexMaps.query_hint') || 'Enter a business type or name to search for'"
              persistent-hint
              :disabled="searchState === 'running'"
              prepend-inner-icon="mdi-magnify"
              variant="outlined"
              density="compact"
            />
          </v-col>
          <v-col cols="12" md="5">
            <v-text-field
              v-model="location"
              :label="t('yandexMaps.location_label') || 'Location'"
              :placeholder="t('yandexMaps.location_placeholder') || 'e.g. Moscow, Saint Petersburg, Russia'"
              :hint="t('yandexMaps.location_hint') || 'Enter a city or region to search in'"
              persistent-hint
              :disabled="searchState === 'running'"
              prepend-inner-icon="mdi-map-marker"
              variant="outlined"
              density="compact"
            />
          </v-col>
          <v-col cols="12" md="2" class="d-flex align-center ga-2">
            <v-btn
              color="primary"
              :disabled="!canStartSearch"
              :loading="searchState === 'running'"
              @click="handleStartSearch"
            >
              {{ t('yandexMaps.start_search') || 'Start Search' }}
            </v-btn>
            <v-btn
              v-if="searchState === 'running'"
              color="error"
              variant="outlined"
              @click="handleCancelSearch"
            >
              {{ t('yandexMaps.cancel_search') || 'Cancel' }}
            </v-btn>
          </v-col>
        </v-row>

        <!-- Options row -->
        <v-row class="mt-2">
          <v-col cols="12" md="4">
            <v-slider
              v-model="maxResults"
              :label="t('yandexMaps.max_results_label') || 'Maximum Results'"
              :min="1"
              :max="50"
              :step="1"
              thumb-label
              :disabled="searchState === 'running'"
            />
          </v-col>
          <v-col cols="12" md="2" class="d-flex align-center">
            <v-switch
              v-model="includeWebsite"
              :label="t('yandexMaps.include_website') || 'Include Website'"
              color="primary"
              :disabled="searchState === 'running'"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="2" class="d-flex align-center">
            <v-switch
              v-model="includeReviews"
              :label="t('yandexMaps.include_reviews') || 'Include Reviews'"
              color="primary"
              :disabled="searchState === 'running'"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="2" class="d-flex align-center">
            <v-switch
              v-model="showBrowser"
              :label="t('yandexMaps.show_browser') || 'Show Browser'"
              color="warning"
              :disabled="searchState === 'running'"
              density="compact"
              hide-details
            />
          </v-col>
        </v-row>

        <!-- Language and Region row -->
        <v-row class="mt-2">
          <v-col cols="12" md="4">
            <v-text-field
              v-model="language"
              :label="t('yandexMaps.language_label') || 'Language'"
              :placeholder="t('yandexMaps.language_placeholder') || 'e.g. ru, en, tr'"
              :hint="t('yandexMaps.language_hint') || 'Yandex Maps UI language code'"
              persistent-hint
              :disabled="searchState === 'running'"
              clearable
              variant="outlined"
              density="compact"
              prepend-inner-icon="mdi-translate"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="region"
              :label="t('yandexMaps.region_label') || 'Region'"
              :placeholder="t('yandexMaps.region_placeholder') || 'e.g. ru, kz, by'"
              :hint="t('yandexMaps.region_hint') || 'Region code for search context'"
              persistent-hint
              :disabled="searchState === 'running'"
              clearable
              variant="outlined"
              density="compact"
              prepend-inner-icon="mdi-earth"
            />
          </v-col>
        </v-row>

        <!-- Account and Proxy row -->
        <v-row class="mt-2">
          <v-col cols="12" md="3">
            <v-select
              v-model="selectedAccountId"
              :items="yandexAccounts"
              item-title="user"
              item-value="id"
              :label="t('yandexMaps.account_label') || 'Yandex Account'"
              :hint="t('yandexMaps.account_hint') || 'Select an account to use its cookies'"
              persistent-hint
              :disabled="searchState === 'running'"
              clearable
              variant="outlined"
              density="compact"
            >
              <template #selection="{ item }">
                {{ item.title }}
              </template>
            </v-select>
          </v-col>
          <v-col cols="12" md="3">
            <v-select
              v-model="selectedProxyIds"
              :items="proxyItems"
              item-title="label"
              item-value="id"
              :label="t('yandexMaps.proxy_label') || 'Proxies'"
              :placeholder="t('yandexMaps.proxy_placeholder') || 'Select proxies...'"
              :hint="t('yandexMaps.proxy_hint') || 'Rotate through selected proxies per card'"
              persistent-hint
              multiple
              chips
              clearable
              :disabled="searchState === 'running'"
              variant="outlined"
              density="compact"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Progress Section -->
    <v-card v-if="searchState === 'running'" class="mb-4">
      <v-card-text>
        <div class="d-flex align-center mb-2">
          <v-progress-circular
            :model-value="progressPercent"
            :indeterminate="progressPercent === 0"
            color="primary"
            size="40"
            class="mr-3"
          >
            <template #default>
              <span class="text-caption">{{ progressPercent }}%</span>
            </template>
          </v-progress-circular>
          <div>
            <div class="text-body-1 font-weight-medium">
              {{ progressStatusText || (t('yandexMaps.searching') || 'Searching...') }}
            </div>
            <div v-if="progressTotal > 0" class="text-caption text-medium-emphasis">
              {{ t('yandexMaps.progress_label', { current: progressCurrent, total: progressTotal }) || `${progressCurrent} / ${progressTotal} businesses` }}
            </div>
          </div>
        </div>
        <v-progress-linear
          :model-value="progressPercent"
          color="primary"
          height="8"
          rounded
          class="mt-2"
        />
      </v-card-text>
    </v-card>

    <!-- Error Alert -->
    <v-alert
      v-if="error"
      type="error"
      closable
      class="mb-4"
      @click:close="error = null"
    >
      {{ error }}
    </v-alert>

    <!-- Results Section -->
    <v-card v-if="results.length > 0">
      <v-card-title class="d-flex align-center flex-wrap">
        <span>
          {{
            t('yandexMaps.found_results', {
              count: results.length,
              query: lastQuery,
              location: lastLocation,
            }) || `Found ${results.length} businesses for '${lastQuery}' in '${lastLocation}'`
          }}
        </span>
        <v-spacer />
        <v-btn
          color="secondary"
          variant="outlined"
          size="small"
          class="mr-2"
          prepend-icon="mdi-content-copy"
          @click="copyAll"
        >
          {{ t('yandexMaps.copy_all') || 'Copy All' }}
        </v-btn>
        <v-btn
          color="success"
          variant="outlined"
          size="small"
          class="mr-2"
          prepend-icon="mdi-file-delimited"
          @click="exportCSV"
        >
          {{ t('yandexMaps.export_csv') || 'Export CSV' }}
        </v-btn>
        <v-btn
          color="info"
          variant="outlined"
          size="small"
          prepend-icon="mdi-code-json"
          @click="exportJSON"
        >
          {{ t('yandexMaps.export_json') || 'Export JSON' }}
        </v-btn>
      </v-card-title>

      <v-data-table
        :items="results"
        :headers="tableHeaders"
        :items-per-page="20"
        hover
        density="compact"
        class="elevation-1"
      >
        <template #item.name="{ item }">
          <a
            v-if="item.maps_url"
            :href="item.maps_url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-decoration-none font-weight-medium"
          >
            {{ item.name }}
            <v-icon size="x-small" class="ml-1">mdi-open-in-new</v-icon>
          </a>
          <span v-else class="font-weight-medium">{{ item.name }}</span>
        </template>

        <template #item.rating="{ item }">
          <span v-if="item.rating">
            <v-icon size="x-small" color="amber">mdi-star</v-icon>
            {{ item.rating }}
          </span>
          <span v-else class="text-medium-emphasis">--</span>
        </template>

        <template #item.review_count="{ item }">
          <span v-if="item.review_count != null">
            {{ t('yandexMaps.reviews_count', { count: item.review_count }) || `${item.review_count} reviews` }}
          </span>
          <span v-else class="text-medium-emphasis">--</span>
        </template>

        <template #item.website="{ item }">
          <a
            v-if="item.website"
            :href="item.website"
            target="_blank"
            rel="noopener noreferrer"
            class="text-decoration-none"
          >
            {{ truncateUrl(item.website) }}
          </a>
          <span v-else class="text-medium-emphasis">--</span>
        </template>
      </v-data-table>
    </v-card>

    <!-- No Results -->
    <v-card v-else-if="searchState === 'completed' && results.length === 0">
      <v-card-text class="text-center py-8">
        <v-icon size="64" color="grey">mdi-map-search-outline</v-icon>
        <p class="text-h6 mt-4 text-medium-emphasis">
          {{ t('yandexMaps.no_results') || 'No businesses found' }}
        </p>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import Papa from "papaparse";
import {
  startYandexMapsSearch,
  cancelYandexMapsSearch,
  onYandexMapsProgress,
  onYandexMapsResult,
  type YandexMapsResultEvent,
} from "@/views/api/yandexMaps";
import { getSocialAccountlist } from "@/views/api/socialaccount";
import { getProxyList } from "@/views/api/proxy";
import type {
  YandexMapsBusinessResult,
  YandexMapsProgressEvent,
} from "@/entityTypes/yandexMapsTypes";
import type { SocialAccountListData } from "@/entityTypes/socialaccount-type";

const { t } = useI18n();

// ── Form state ──────────────────────────────────────────────────────────
const query = ref("");
const location = ref("");
const maxResults = ref(20);
const includeWebsite = ref(true);
const includeReviews = ref(false);
const showBrowser = ref(false);
const language = ref("");
const region = ref("");

// ── Account state ────────────────────────────────────────────────────────
const yandexAccounts = ref<SocialAccountListData[]>([]);
const selectedAccountId = ref<number | null>(null);

// ── Proxy state ──────────────────────────────────────────────────────────
const proxyItems = ref<Array<{ id: number; label: string }>>([]);
const selectedProxyIds = ref<number[]>([]);

// ── Search state ────────────────────────────────────────────────────────
type SearchState = "idle" | "running" | "completed" | "cancelled" | "failed";
const searchState = ref<SearchState>("idle");
const requestId = ref<string | null>(null);
const error = ref<string | null>(null);
const lastQuery = ref("");
const lastLocation = ref("");

// ── Results ─────────────────────────────────────────────────────────────
const results = ref<YandexMapsBusinessResult[]>([]);

// ── Progress ────────────────────────────────────────────────────────────
const progressCurrent = ref(0);
const progressTotal = ref(0);
const progressStatusText = ref("");
const progressPercent = computed(() =>
  progressTotal.value > 0
    ? Math.round((progressCurrent.value / progressTotal.value) * 100)
    : 0
);

// ── Can start search ────────────────────────────────────────────────────
const canStartSearch = computed(
  () => query.value.trim().length > 0 && location.value.trim().length > 0 && searchState.value !== "running"
);

// ── Table headers ───────────────────────────────────────────────────────
const tableHeaders = computed(() => [
  { title: t("yandexMaps.col_name") || "Name", key: "name", sortable: true },
  { title: t("yandexMaps.col_category") || "Category", key: "category", sortable: true },
  { title: t("yandexMaps.col_rating") || "Rating", key: "rating", sortable: true },
  { title: t("yandexMaps.col_reviews") || "Reviews", key: "review_count", sortable: true },
  { title: t("yandexMaps.col_address") || "Address", key: "address", sortable: true },
  { title: t("yandexMaps.col_phone") || "Phone", key: "phone" },
  { title: t("yandexMaps.col_website") || "Website", key: "website" },
]);

// ── Event subscriptions ─────────────────────────────────────────────────
let unsubscribeResult: (() => void) | null = null;
let unsubscribeProgress: (() => void) | null = null;

function setupResultListener(): void {
  if (unsubscribeResult) {
    unsubscribeResult();
    unsubscribeResult = null;
  }
  if (unsubscribeProgress) {
    unsubscribeProgress();
    unsubscribeProgress = null;
  }

  unsubscribeProgress = onYandexMapsProgress((event: YandexMapsProgressEvent) => {
    if (event.requestId !== requestId.value) return;
    progressCurrent.value = event.current;
    progressTotal.value = event.total;
    progressStatusText.value = event.message;
  });

  unsubscribeResult = onYandexMapsResult((event: YandexMapsResultEvent) => {
    if (event.requestId !== requestId.value) return;

    results.value = [...event.result.results];
    searchState.value = event.result.success ? "completed" : "failed";

    if (!event.result.success) {
      error.value =
        t("yandexMaps.error_search_failed", { error: event.result.summary }) ||
        event.result.summary;
    }

    requestId.value = null;
  });
}

// ── Handlers ────────────────────────────────────────────────────────────
async function loadYandexAccounts(): Promise<void> {
  try {
    const result = await getSocialAccountlist({
      page: 1,
      size: 100,
      where: "Yandex",
    });
    yandexAccounts.value = result.data ?? [];
  } catch (err) {
    console.error("Failed to load Yandex accounts:", err);
  }
}

async function loadProxyList(): Promise<void> {
  try {
    const result = await getProxyList({ page: 1, size: 500, search: "" });
    proxyItems.value = (result.data ?? []).map((p) => ({
      id: p.id ?? 0,
      label: `${p.host}:${p.port}${p.protocol ? " (" + p.protocol + ")" : ""}`,
    }));
  } catch (err) {
    console.error("Failed to load proxy list:", err);
  }
}

async function handleStartSearch(): Promise<void> {
  if (!query.value.trim() || !location.value.trim()) return;

  error.value = null;
  results.value = [];
  searchState.value = "running";
  progressCurrent.value = 0;
  progressTotal.value = maxResults.value;
  progressStatusText.value = "";
  lastQuery.value = query.value.trim();
  lastLocation.value = location.value.trim();

  try {
    setupResultListener();
    const resp = await startYandexMapsSearch({
      query: query.value.trim(),
      location: location.value.trim(),
      max_results: maxResults.value,
      include_website: includeWebsite.value,
      include_reviews: includeReviews.value,
      show_browser: showBrowser.value,
      language: language.value.trim() || undefined,
      region: region.value.trim() || undefined,
      account_id: selectedAccountId.value ?? undefined,
      proxy_ids: selectedProxyIds.value.length > 0 ? selectedProxyIds.value : undefined,
    });
    requestId.value = resp.requestId;
  } catch (err) {
    searchState.value = "failed";
    error.value =
      err instanceof Error ? err.message : String(err);
  }
}

async function handleCancelSearch(): Promise<void> {
  if (!requestId.value) return;

  try {
    await cancelYandexMapsSearch(requestId.value);
  } catch {
    // Cancel may fail if worker already exited
  }

  searchState.value = "cancelled";
  requestId.value = null;
  cleanupListeners();
}

function cleanupListeners(): void {
  if (unsubscribeResult) {
    unsubscribeResult();
    unsubscribeResult = null;
  }
  if (unsubscribeProgress) {
    unsubscribeProgress();
    unsubscribeProgress = null;
  }
}

// ── Export ──────────────────────────────────────────────────────────────
function copyAll(): void {
  const json = JSON.stringify(results.value, null, 2);
  navigator.clipboard.writeText(json).catch((err) => {
    console.error("Failed to copy to clipboard:", err);
  });
}

function exportCSV(): void {
  const data = results.value.map((r) => ({
    name: r.name,
    category: r.category ?? "",
    rating: r.rating ?? "",
    review_count: r.review_count ?? "",
    address: r.address ?? "",
    phone: r.phone ?? "",
    website: r.website ?? "",
    hours: r.hours ?? "",
    maps_url: r.maps_url ?? "",
  }));
  const csv = Papa.unparse(data);
  downloadFile(
    csv,
    `yandex-maps-${sanitizeFilename(lastQuery.value)}-${sanitizeFilename(lastLocation.value)}.csv`,
    "text/csv"
  );
}

function exportJSON(): void {
  const json = JSON.stringify(results.value, null, 2);
  downloadFile(
    json,
    `yandex-maps-${sanitizeFilename(lastQuery.value)}-${sanitizeFilename(lastLocation.value)}.json`,
    "application/json"
  );
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function truncateUrl(url: string, maxLen = 30): string {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen) + "...";
}

function sanitizeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9 _-]/g, "_").slice(0, 50);
}

// ── Init ───────────────────────────────────────────────────────────────
onMounted(() => {
  loadYandexAccounts();
  loadProxyList();
});

// ── Cleanup ────────────────────────────────────────────────────────────
onUnmounted(() => {
  cleanupListeners();
  if (requestId.value && searchState.value === "running") {
    cancelYandexMapsSearch(requestId.value).catch(() => { /* worker may already have exited */ });
  }
});
</script>
