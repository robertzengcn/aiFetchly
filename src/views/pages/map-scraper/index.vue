<template>
  <v-container fluid>
    <v-row class="mb-4">
      <v-col cols="12">
        <div class="d-flex align-center flex-wrap ga-3">
          <div>
            <h2 class="text-h4 font-weight-bold">
              <v-icon class="mr-2">mdi-map-marker-multiple</v-icon>
              {{ t("mapScraper.title") || "Map Scraper" }}
            </h2>
            <p class="text-subtitle-1 text-medium-emphasis mb-0">
              {{
                t("mapScraper.description") ||
                "Search local businesses across Google Maps and Yandex Maps"
              }}
            </p>
          </div>
          <v-spacer />
          <v-btn-toggle
            v-model="provider"
            mandatory
            variant="outlined"
            density="comfortable"
            divided
            :disabled="searchState === 'running'"
          >
            <v-btn
              v-for="item in providerOptions"
              :key="item.value"
              :value="item.value"
              :prepend-icon="item.icon"
            >
              {{ item.title }}
            </v-btn>
          </v-btn-toggle>
        </div>
      </v-col>
    </v-row>

    <v-tabs v-model="activeTab" class="mb-4">
      <v-tab value="search">{{ t("mapScraper.search_tab") || "Search" }}</v-tab>
      <v-tab value="history" @click="loadHistory">
        {{ t("mapScraper.history_tab") || "History" }}
      </v-tab>
    </v-tabs>

    <v-window v-model="activeTab">
      <v-window-item value="search">
        <v-card class="mb-4">
          <v-card-text>
            <v-row>
              <v-col cols="12" md="5">
                <v-text-field
                  v-model="query"
                  :label="t('mapScraper.query_label') || 'Business Keyword'"
                  :placeholder="
                    t('mapScraper.query_placeholder') ||
                    'e.g. dentist, Italian restaurant, plumber'
                  "
                  :hint="
                    t('mapScraper.query_hint') ||
                    'Enter a business type or name to search for'
                  "
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
                  :label="t('mapScraper.location_label') || 'Location'"
                  :placeholder="locationPlaceholder"
                  :hint="locationHint"
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
                  {{ t("mapScraper.start_search") || "Start Search" }}
                </v-btn>
                <v-btn
                  v-if="searchState === 'running'"
                  color="error"
                  variant="outlined"
                  @click="handleCancelSearch"
                >
                  {{ t("mapScraper.cancel_search") || "Cancel" }}
                </v-btn>
              </v-col>
            </v-row>

            <v-row class="mt-2">
              <v-col cols="12" md="4">
                <v-slider
                  v-model="maxResults"
                  :label="t('mapScraper.max_results_label') || 'Maximum Results'"
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
                  :label="t('mapScraper.include_website') || 'Include Website'"
                  color="primary"
                  :disabled="searchState === 'running'"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="12" md="2" class="d-flex align-center">
                <v-switch
                  v-model="includeReviews"
                  :label="t('mapScraper.include_reviews') || 'Include Reviews'"
                  color="primary"
                  :disabled="searchState === 'running'"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="12" md="2" class="d-flex align-center">
                <v-switch
                  v-model="showBrowser"
                  :label="t('mapScraper.show_browser') || 'Show Browser'"
                  color="warning"
                  :disabled="searchState === 'running'"
                  density="compact"
                  hide-details
                />
              </v-col>
            </v-row>

            <v-row v-if="provider === 'yandex'" class="mt-2">
              <v-col cols="12" md="4">
                <v-text-field
                  v-model="language"
                  :label="t('mapScraper.language_label') || 'Language'"
                  :placeholder="t('mapScraper.language_placeholder') || 'e.g. ru, en, tr'"
                  :hint="t('mapScraper.language_hint') || 'Yandex Maps UI language code'"
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
                  :label="t('mapScraper.region_label') || 'Region'"
                  :placeholder="t('mapScraper.region_placeholder') || 'e.g. ru, kz, by'"
                  :hint="t('mapScraper.region_hint') || 'Region code for search context'"
                  persistent-hint
                  :disabled="searchState === 'running'"
                  clearable
                  variant="outlined"
                  density="compact"
                  prepend-inner-icon="mdi-earth"
                />
              </v-col>
            </v-row>

            <v-row class="mt-2">
              <v-col cols="12" md="3">
                <v-select
                  v-model="selectedAccountId"
                  :items="providerAccounts"
                  item-title="user"
                  item-value="id"
                  :label="accountLabel"
                  :hint="t('mapScraper.account_hint') || 'Select an account to use its cookies'"
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
                  :label="t('mapScraper.proxy_label') || 'Proxies'"
                  :placeholder="t('mapScraper.proxy_placeholder') || 'Select proxies...'"
                  :hint="t('mapScraper.proxy_hint') || 'Rotate through selected proxies per card'"
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
                  {{ progressStatusText || (t("mapScraper.searching") || "Searching...") }}
                </div>
                <div v-if="progressTotal > 0" class="text-caption text-medium-emphasis">
                  {{
                    t("mapScraper.progress_label", {
                      current: progressCurrent,
                      total: progressTotal,
                    }) || `${progressCurrent} / ${progressTotal} businesses`
                  }}
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

        <v-alert
          v-if="error"
          type="error"
          closable
          class="mb-4"
          @click:close="error = null"
        >
          {{ error }}
        </v-alert>

        <v-card v-if="results.length > 0">
          <v-card-title class="d-flex align-center flex-wrap">
            <span>
              {{
                t("mapScraper.found_results", {
                  provider: currentProviderTitle,
                  count: results.length,
                  query: lastQuery,
                  location: lastLocation,
                }) ||
                `Found ${results.length} ${currentProviderTitle} businesses for '${lastQuery}' in '${lastLocation}'`
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
              {{ t("mapScraper.copy_all") || "Copy All" }}
            </v-btn>
            <v-btn
              color="success"
              variant="outlined"
              size="small"
              class="mr-2"
              prepend-icon="mdi-file-delimited"
              @click="exportCSV"
            >
              {{ t("mapScraper.export_csv") || "Export CSV" }}
            </v-btn>
            <v-btn
              color="info"
              variant="outlined"
              size="small"
              prepend-icon="mdi-code-json"
              @click="exportJSON"
            >
              {{ t("mapScraper.export_json") || "Export JSON" }}
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
                {{
                  t("mapScraper.reviews_count", { count: item.review_count }) ||
                  `${item.review_count} reviews`
                }}
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

            <template #expanded-row="{ item }">
              <tr>
                <td :colspan="tableHeaders.length" class="pa-4 bg-grey-lighten-4">
                  <v-row dense>
                    <v-col v-if="item.hours" cols="12" md="4">
                      <strong>{{ t("mapScraper.col_hours") || "Hours" }}:</strong>
                      {{ item.hours }}
                    </v-col>
                    <v-col v-if="item.maps_url" cols="12" md="4">
                      <v-btn
                        :href="item.maps_url"
                        target="_blank"
                        rel="noopener noreferrer"
                        size="small"
                        color="primary"
                        variant="text"
                        prepend-icon="mdi-map"
                      >
                        {{
                          t("mapScraper.view_on_maps", { provider: currentProviderTitle }) ||
                          `View on ${currentProviderTitle}`
                        }}
                      </v-btn>
                    </v-col>
                  </v-row>
                </td>
              </tr>
            </template>
          </v-data-table>
        </v-card>

        <v-card v-else-if="searchState === 'completed' && results.length === 0">
          <v-card-text class="text-center py-8">
            <v-icon size="64" color="grey">mdi-map-search-outline</v-icon>
            <p class="text-h6 mt-4 text-medium-emphasis">
              {{ t("mapScraper.no_results") || "No businesses found" }}
            </p>
          </v-card-text>
        </v-card>
      </v-window-item>

      <v-window-item value="history">
        <v-card>
          <v-card-title class="d-flex align-center">
            {{ t("mapScraper.history_title", { provider: currentProviderTitle }) || "History" }}
            <v-spacer />
            <v-btn
              icon="mdi-refresh"
              variant="text"
              size="small"
              :loading="historyLoading"
              @click="loadHistory"
            />
          </v-card-title>
          <v-data-table
            v-if="historyRecords.length > 0"
            :items="historyRecords"
            :headers="historyHeaders"
            :items-per-page="20"
            hover
            density="compact"
            class="elevation-1"
          >
            <template #item.createdAt="{ item }">
              {{ formatDate(item.createdAt) }}
            </template>
            <template #item.totalResults="{ item }">
              {{ item.totalResults }}
            </template>
            <template #item.actions="{ item }">
              <v-btn
                size="small"
                variant="text"
                color="primary"
                prepend-icon="mdi-eye"
                @click="loadHistoryResults(item.id)"
              >
                {{ t("mapScraper.view_results") || "View" }}
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                color="error"
                prepend-icon="mdi-delete"
                @click="deleteRecord(item.id)"
              >
                {{ t("mapScraper.delete_btn") || "Delete" }}
              </v-btn>
            </template>
          </v-data-table>
          <v-card-text v-else-if="!historyLoading" class="text-center py-8">
            <v-icon size="64" color="grey">mdi-history</v-icon>
            <p class="text-h6 mt-4 text-medium-emphasis">
              {{ t("mapScraper.history_empty") || "No search history yet" }}
            </p>
          </v-card-text>
        </v-card>
      </v-window-item>
    </v-window>
  </v-container>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Papa from "papaparse";
import {
  cancelGoogleMapsSearch,
  deleteGoogleMapsHistoryRecord,
  getGoogleMapsHistory,
  getGoogleMapsHistoryDetail,
  onGoogleMapsResult,
  startGoogleMapsSearch,
  type GoogleMapsHistoryRecord,
  type GoogleMapsResultEvent,
} from "@/views/api/googleMaps";
import {
  cancelYandexMapsSearch,
  deleteYandexMapsHistoryRecord,
  getYandexMapsHistory,
  getYandexMapsHistoryDetail,
  onYandexMapsProgress,
  onYandexMapsResult,
  startYandexMapsSearch,
  type YandexMapsHistoryRecord,
  type YandexMapsResultEvent,
} from "@/views/api/yandexMaps";
import { getSocialAccountlist } from "@/views/api/socialaccount";
import { getProxyList } from "@/views/api/proxy";
import type { GoogleMapsBusinessResult } from "@/entityTypes/googleMapsTypes";
import type {
  YandexMapsBusinessResult,
  YandexMapsProgressEvent,
} from "@/entityTypes/yandexMapsTypes";
import type { SocialAccountListData } from "@/entityTypes/socialaccount-type";
import {
  getMapScraperProviderMeta,
  normalizeMapScraperProvider,
  type MapScraperProvider,
} from "./mapScraperProvider";

const props = defineProps<{
  initialProvider?: MapScraperProvider;
}>();

const { t } = useI18n();

type SearchState = "idle" | "running" | "completed" | "cancelled" | "failed";
type MapBusinessResult = GoogleMapsBusinessResult | YandexMapsBusinessResult;
type MapHistoryRecord = GoogleMapsHistoryRecord | YandexMapsHistoryRecord;

const activeTab = ref<"search" | "history">("search");
const provider = ref<MapScraperProvider>(
  normalizeMapScraperProvider(props.initialProvider)
);
const query = ref("");
const location = ref("");
const maxResults = ref(20);
const includeWebsite = ref(true);
const includeReviews = ref(false);
const showBrowser = ref(false);
const language = ref("");
const region = ref("");
const providerAccounts = ref<SocialAccountListData[]>([]);
const selectedAccountId = ref<number | null>(null);
const proxyItems = ref<Array<{ id: number; label: string }>>([]);
const selectedProxyIds = ref<number[]>([]);
const searchState = ref<SearchState>("idle");
const requestId = ref<string | null>(null);
const error = ref<string | null>(null);
const lastQuery = ref("");
const lastLocation = ref("");
const results = ref<MapBusinessResult[]>([]);
const progressCurrent = ref(0);
const progressTotal = ref(0);
const progressStatusText = ref("");
const historyRecords = ref<MapHistoryRecord[]>([]);
const historyLoading = ref(false);

let unsubscribeResult: (() => void) | null = null;
let unsubscribeProgress: (() => void) | null = null;

const providerMeta = computed(() => getMapScraperProviderMeta(provider.value));
const providerOptions = computed(() => [
  {
    value: "google" as const,
    title: t("mapScraper.provider_google") || "Google Maps",
    icon: getMapScraperProviderMeta("google").icon,
  },
  {
    value: "yandex" as const,
    title: t("mapScraper.provider_yandex") || "Yandex Maps",
    icon: getMapScraperProviderMeta("yandex").icon,
  },
]);

const currentProviderTitle = computed(
  () =>
    providerOptions.value.find((item) => item.value === provider.value)?.title ??
    providerMeta.value.label
);

const locationPlaceholder = computed(() =>
  provider.value === "yandex"
    ? t("mapScraper.location_placeholder_yandex") ||
      "e.g. Moscow, Saint Petersburg, Russia"
    : t("mapScraper.location_placeholder_google") ||
      "e.g. New York, London, 90210"
);

const locationHint = computed(() =>
  provider.value === "yandex"
    ? t("mapScraper.location_hint_yandex") ||
      "Enter a city or region to search in"
    : t("mapScraper.location_hint_google") ||
      "Enter a city, address, or zip code"
);

const accountLabel = computed(() =>
  provider.value === "yandex"
    ? t("mapScraper.yandex_account_label") || "Yandex Account"
    : t("mapScraper.google_account_label") || "Google Account"
);

const progressPercent = computed(() =>
  progressTotal.value > 0
    ? Math.round((progressCurrent.value / progressTotal.value) * 100)
    : 0
);

const canStartSearch = computed(
  () =>
    query.value.trim().length > 0 &&
    location.value.trim().length > 0 &&
    searchState.value !== "running"
);

const tableHeaders = computed(() => [
  { title: t("mapScraper.col_name") || "Name", key: "name", sortable: true },
  {
    title: t("mapScraper.col_category") || "Category",
    key: "category",
    sortable: true,
  },
  {
    title: t("mapScraper.col_rating") || "Rating",
    key: "rating",
    sortable: true,
  },
  {
    title: t("mapScraper.col_reviews") || "Reviews",
    key: "review_count",
    sortable: true,
  },
  {
    title: t("mapScraper.col_address") || "Address",
    key: "address",
    sortable: true,
  },
  { title: t("mapScraper.col_phone") || "Phone", key: "phone" },
  { title: t("mapScraper.col_website") || "Website", key: "website" },
]);

const historyHeaders = computed(() => [
  { title: t("mapScraper.col_query") || "Query", key: "query", sortable: true },
  {
    title: t("mapScraper.col_location") || "Location",
    key: "location",
    sortable: true,
  },
  {
    title: t("mapScraper.col_results") || "Results",
    key: "totalResults",
    sortable: true,
  },
  { title: t("mapScraper.col_date") || "Date", key: "createdAt", sortable: true },
  {
    title: t("mapScraper.col_actions") || "Actions",
    key: "actions",
    sortable: false,
  },
]);

watch(
  () => props.initialProvider,
  (nextProvider) => {
    provider.value = normalizeMapScraperProvider(nextProvider);
  }
);

watch(provider, () => {
  selectedAccountId.value = null;
  results.value = [];
  historyRecords.value = [];
  error.value = null;
  searchState.value = "idle";
  progressCurrent.value = 0;
  progressTotal.value = 0;
  progressStatusText.value = "";
  cleanupListeners();
  loadProviderAccounts();
  if (activeTab.value === "history") {
    loadHistory();
  }
});

function setupResultListener(): void {
  cleanupListeners();

  if (provider.value === "yandex") {
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
          t("mapScraper.error_search_failed", { error: event.result.summary }) ||
          event.result.summary;
      }
      requestId.value = null;
    });
    return;
  }

  unsubscribeResult = onGoogleMapsResult((event: GoogleMapsResultEvent) => {
    if (event.requestId !== requestId.value) return;
    results.value = event.result.results;
    progressCurrent.value = event.result.results.length;
    searchState.value = event.result.success ? "completed" : "failed";
    if (!event.result.success) {
      error.value =
        t("mapScraper.error_search_failed", { error: event.result.summary }) ||
        event.result.summary;
    }
    requestId.value = null;
  });
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

async function loadProviderAccounts(): Promise<void> {
  try {
    const result = await getSocialAccountlist({
      page: 1,
      size: 100,
      where: providerMeta.value.accountWhere,
    });
    providerAccounts.value = result.data ?? [];
  } catch (err) {
    console.error("Failed to load map scraper accounts:", err);
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
    const baseParams = {
      query: query.value.trim(),
      location: location.value.trim(),
      max_results: maxResults.value,
      include_website: includeWebsite.value,
      include_reviews: includeReviews.value,
      show_browser: showBrowser.value,
      account_id: selectedAccountId.value ?? undefined,
      proxy_ids:
        selectedProxyIds.value.length > 0 ? selectedProxyIds.value : undefined,
    };

    const resp =
      provider.value === "yandex"
        ? await startYandexMapsSearch({
            ...baseParams,
            language: language.value.trim() || undefined,
            region: region.value.trim() || undefined,
          })
        : await startGoogleMapsSearch(baseParams);

    requestId.value = resp.requestId;
  } catch (err) {
    searchState.value = "failed";
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function handleCancelSearch(): Promise<void> {
  if (!requestId.value) return;

  try {
    if (provider.value === "yandex") {
      await cancelYandexMapsSearch(requestId.value);
    } else {
      await cancelGoogleMapsSearch(requestId.value);
    }
  } catch {
    // Cancel may fail if worker already exited.
  }

  searchState.value = "cancelled";
  requestId.value = null;
  cleanupListeners();
}

async function loadHistory(): Promise<void> {
  historyLoading.value = true;
  try {
    const data =
      provider.value === "yandex"
        ? await getYandexMapsHistory(50, 0)
        : await getGoogleMapsHistory(50, 0);
    historyRecords.value = data.records;
  } catch (err) {
    console.error("Failed to load map scraper history:", err);
  } finally {
    historyLoading.value = false;
  }
}

async function loadHistoryResults(id: number): Promise<void> {
  try {
    const record =
      provider.value === "yandex"
        ? await getYandexMapsHistoryDetail(id)
        : await getGoogleMapsHistoryDetail(id);
    if (record.results) {
      try {
        results.value = JSON.parse(record.results) as MapBusinessResult[];
      } catch {
        console.error("Failed to parse history results");
        results.value = [];
      }
      lastQuery.value = record.query;
      lastLocation.value = record.location;
      searchState.value = "completed";
      activeTab.value = "search";
    }
  } catch (err) {
    console.error("Failed to load map scraper history record:", err);
  }
}

async function deleteRecord(id: number): Promise<void> {
  try {
    if (provider.value === "yandex") {
      await deleteYandexMapsHistoryRecord(id);
    } else {
      await deleteGoogleMapsHistoryRecord(id);
    }
    historyRecords.value = historyRecords.value.filter((r) => r.id !== id);
  } catch (err) {
    console.error("Failed to delete map scraper history record:", err);
  }
}

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
  downloadFile(csv, buildExportFilename("csv"), "text/csv");
}

function exportJSON(): void {
  const json = JSON.stringify(results.value, null, 2);
  downloadFile(json, buildExportFilename("json"), "application/json");
}

function buildExportFilename(extension: "csv" | "json"): string {
  return `${providerMeta.value.filenamePrefix}-${sanitizeFilename(
    lastQuery.value
  )}-${sanitizeFilename(lastLocation.value)}.${extension}`;
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
  return `${url.slice(0, maxLen)}...`;
}

function sanitizeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9 _-]/g, "_").slice(0, 50);
}

function formatDate(date: Date | string | undefined): string {
  if (!date) return "--";
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

onMounted(() => {
  loadProviderAccounts();
  loadProxyList();
});

onUnmounted(() => {
  cleanupListeners();
  if (requestId.value && searchState.value === "running") {
    if (provider.value === "yandex") {
      cancelYandexMapsSearch(requestId.value).catch(() => {
        // Worker may already have exited.
      });
    } else {
      cancelGoogleMapsSearch(requestId.value).catch(() => {
        // Worker may already have exited.
      });
    }
  }
});
</script>
