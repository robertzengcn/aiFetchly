<template>
  <v-container fluid>
    <!-- Header -->
    <v-row class="mb-4">
      <v-col cols="12">
        <h2 class="text-h4 font-weight-bold">
          <v-icon class="mr-2">mdi-map-marker-radius</v-icon>
          {{ t('googleMaps.title') || 'Google Maps Scraper' }}
        </h2>
        <p class="text-subtitle-1 text-medium-emphasis">
          {{ t('googleMaps.description') || 'Search Google Maps for local businesses by keyword and location' }}
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
              :label="t('googleMaps.query_label') || 'Business Keyword'"
              :placeholder="t('googleMaps.query_placeholder') || 'e.g. dentist, Italian restaurant'"
              :hint="t('googleMaps.query_hint') || 'Enter a business type or name to search for'"
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
              :label="t('googleMaps.location_label') || 'Location'"
              :placeholder="t('googleMaps.location_placeholder') || 'e.g. New York, London, 90210'"
              :hint="t('googleMaps.location_hint') || 'Enter a city, address, or zip code'"
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
              {{ t('googleMaps.start_search') || 'Start Search' }}
            </v-btn>
            <v-btn
              v-if="searchState === 'running'"
              color="error"
              variant="outlined"
              @click="handleCancelSearch"
            >
              {{ t('googleMaps.cancel_search') || 'Cancel' }}
            </v-btn>
          </v-col>
        </v-row>

        <!-- Options row -->
        <v-row class="mt-2">
          <v-col cols="12" md="4">
            <v-slider
              v-model="maxResults"
              :label="t('googleMaps.max_results_label') || 'Maximum Results'"
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
              :label="t('googleMaps.include_website') || 'Include Website'"
              color="primary"
              :disabled="searchState === 'running'"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="2" class="d-flex align-center">
            <v-switch
              v-model="includeReviews"
              :label="t('googleMaps.include_reviews') || 'Include Reviews'"
              color="primary"
              :disabled="searchState === 'running'"
              density="compact"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="2" class="d-flex align-center">
            <v-switch
              v-model="showBrowser"
              :label="t('googleMaps.show_browser') || 'Show Browser'"
              color="warning"
              :disabled="searchState === 'running'"
              density="compact"
              hide-details
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
            indeterminate
            color="primary"
            size="24"
            class="mr-3"
          />
          <span class="text-body-1">
            {{ t('googleMaps.searching') || 'Searching...' }}
          </span>
        </div>
        <v-progress-linear
          :model-value="progressPercent"
          color="primary"
          height="6"
          rounded
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
            t('googleMaps.found_results', {
              count: results.length,
              query: lastQuery,
              location: lastLocation,
            }) || `Found ${results.length} businesses for '${lastQuery}' in '${lastLocation}'`
          }}
        </span>
        <v-spacer />
        <v-btn
          color="success"
          variant="outlined"
          size="small"
          class="mr-2"
          prepend-icon="mdi-file-delimited"
          @click="exportCSV"
        >
          {{ t('googleMaps.export_csv') || 'Export CSV' }}
        </v-btn>
        <v-btn
          color="info"
          variant="outlined"
          size="small"
          prepend-icon="mdi-code-json"
          @click="exportJSON"
        >
          {{ t('googleMaps.export_json') || 'Export JSON' }}
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
        <!-- Name column with link -->
        <template #item.name="{ item }">
          <a
            v-if="item.maps_url"
            :href="item.maps_url"
            target="_blank"
            rel="noopener"
            class="text-decoration-none font-weight-medium"
          >
            {{ item.name }}
            <v-icon size="x-small" class="ml-1">mdi-open-in-new</v-icon>
          </a>
          <span v-else class="font-weight-medium">{{ item.name }}</span>
        </template>

        <!-- Rating column -->
        <template #item.rating="{ item }">
          <span v-if="item.rating">
            <v-icon size="x-small" color="amber">mdi-star</v-icon>
            {{ item.rating }}
          </span>
          <span v-else class="text-medium-emphasis">—</span>
        </template>

        <!-- Reviews column -->
        <template #item.review_count="{ item }">
          <span v-if="item.review_count != null">
            {{ t('googleMaps.reviews_count', { count: item.review_count }) || `${item.review_count} reviews` }}
          </span>
          <span v-else class="text-medium-emphasis">—</span>
        </template>

        <!-- Website column -->
        <template #item.website="{ item }">
          <a
            v-if="item.website"
            :href="item.website"
            target="_blank"
            rel="noopener"
            class="text-decoration-none"
          >
            {{ truncateUrl(item.website) }}
          </a>
          <span v-else class="text-medium-emphasis">—</span>
        </template>

        <!-- Expandable detail row -->
        <template #expanded-row="{ item }">
          <tr>
            <td :colspan="tableHeaders.length" class="pa-4 bg-grey-lighten-4">
              <v-row dense>
                <v-col v-if="item.hours" cols="12" md="4">
                  <strong>{{ t('googleMaps.col_hours') || 'Hours' }}:</strong>
                  {{ item.hours }}
                </v-col>
                <v-col v-if="item.maps_url" cols="12" md="4">
                  <v-btn
                    :href="item.maps_url"
                    target="_blank"
                    rel="noopener"
                    size="small"
                    color="primary"
                    variant="text"
                    prepend-icon="mdi-map"
                  >
                    {{ t('googleMaps.view_on_maps') || 'View on Google Maps' }}
                  </v-btn>
                </v-col>
              </v-row>
            </td>
          </tr>
        </template>
      </v-data-table>
    </v-card>

    <!-- No Results -->
    <v-card v-else-if="searchState === 'completed' && results.length === 0">
      <v-card-text class="text-center py-8">
        <v-icon size="64" color="grey">mdi-map-search-outline</v-icon>
        <p class="text-h6 mt-4 text-medium-emphasis">
          {{ t('googleMaps.no_results') || 'No businesses found' }}
        </p>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import Papa from "papaparse";
import {
  startGoogleMapsSearch,
  cancelGoogleMapsSearch,
  onGoogleMapsResult,
  type GoogleMapsResultEvent,
} from "@/views/api/googleMaps";
import type { GoogleMapsBusinessResult } from "@/entityTypes/googleMapsTypes";

const { t } = useI18n();

// ── Form state ──────────────────────────────────────────────────────────
const query = ref("");
const location = ref("");
const maxResults = ref(20);
const includeWebsite = ref(true);
const includeReviews = ref(false);
const showBrowser = ref(false);

// ── Search state ────────────────────────────────────────────────────────
type SearchState = "idle" | "running" | "completed" | "cancelled" | "failed";
const searchState = ref<SearchState>("idle");
const requestId = ref<string | null>(null);
const error = ref<string | null>(null);
const lastQuery = ref("");
const lastLocation = ref("");

// ── Results ─────────────────────────────────────────────────────────────
const results = ref<GoogleMapsBusinessResult[]>([]);

// ── Progress ────────────────────────────────────────────────────────────
const progressCurrent = ref(0);
const progressTotal = ref(0);
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
  { title: t("googleMaps.col_name") || "Name", key: "name", sortable: true },
  { title: t("googleMaps.col_category") || "Category", key: "category", sortable: true },
  { title: t("googleMaps.col_rating") || "Rating", key: "rating", sortable: true },
  { title: t("googleMaps.col_reviews") || "Reviews", key: "review_count", sortable: true },
  { title: t("googleMaps.col_address") || "Address", key: "address", sortable: true },
  { title: t("googleMaps.col_phone") || "Phone", key: "phone" },
  { title: t("googleMaps.col_website") || "Website", key: "website" },
]);

// ── Event subscription ──────────────────────────────────────────────────
let unsubscribe: (() => void) | null = null;

function setupResultListener(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = onGoogleMapsResult((event: GoogleMapsResultEvent) => {
    if (event.requestId !== requestId.value) return;

    results.value = event.result.results;
    searchState.value = event.result.success ? "completed" : "failed";

    if (!event.result.success) {
      error.value =
        t("googleMaps.error_search_failed", { error: event.result.summary }) ||
        event.result.summary;
    }

    requestId.value = null;
  });
}

// ── Handlers ────────────────────────────────────────────────────────────
async function handleStartSearch(): Promise<void> {
  if (!query.value.trim() || !location.value.trim()) return;

  error.value = null;
  results.value = [];
  searchState.value = "running";
  progressCurrent.value = 0;
  progressTotal.value = maxResults.value;
  lastQuery.value = query.value.trim();
  lastLocation.value = location.value.trim();

  try {
    const resp = await startGoogleMapsSearch({
      query: query.value.trim(),
      location: location.value.trim(),
      max_results: maxResults.value,
      include_website: includeWebsite.value,
      include_reviews: includeReviews.value,
      show_browser: showBrowser.value,
    });
    requestId.value = resp.requestId;
    setupResultListener();
  } catch (err) {
    searchState.value = "failed";
    error.value =
      err instanceof Error ? err.message : String(err);
  }
}

async function handleCancelSearch(): Promise<void> {
  if (!requestId.value) return;

  try {
    await cancelGoogleMapsSearch(requestId.value);
  } catch {
    // Cancel may fail if worker already exited
  }

  searchState.value = "cancelled";
  requestId.value = null;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

// ── Export ──────────────────────────────────────────────────────────────
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
  downloadFile(csv, `google-maps-${lastQuery.value}-${lastLocation.value}.csv`, "text/csv");
}

function exportJSON(): void {
  const json = JSON.stringify(results.value, null, 2);
  downloadFile(json, `google-maps-${lastQuery.value}-${lastLocation.value}.json`, "application/json");
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

// ── Cleanup ────────────────────────────────────────────────────────────
onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (requestId.value && searchState.value === "running") {
    cancelGoogleMapsSearch(requestId.value).catch(() => {});
  }
});
</script>
