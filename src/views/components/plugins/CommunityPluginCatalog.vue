<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  installCommunityPlugin,
  listCommunityPlugins,
  openCommunityPlansPage,
} from "@/views/api/communityPlugins";
import { getLoginUrl } from "@/views/api/users";
import { windowReceive, windowRemoveListener } from "@/views/utils/apirequest";
import { WEBSOCKET_EVENT } from "@/config/channellist";
import {
  isSessionExpiredMessage,
} from "@/views/utils/communityPluginCta";
import {
  buildCommunityTagFacets,
  filterCommunityPlugins,
  visibleCommunityTagFacets,
  type CommunityAvailabilityFilter,
  type CommunityTagFacet,
} from "@/views/utils/communityPluginFilters";
import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";
import CommunityPluginCard from "./CommunityPluginCard.vue";

/**
 * Community Plugin catalog (unified plugin page tech design §9).
 *
 * Owns the full Hub catalog (cached once, filtered locally), loading/refresh/
 * error/install-error states, the search/tag/availability filters and derived
 * facets, the Community install/upgrade/sign-in actions, and the
 * user_info_updated WebSocket lifecycle. Emits `installed` (Installed
 * collection is stale) and `manage` (navigation intent to the Installed
 * section with the canonical installed-plugin name).
 */

const emit = defineEmits<{
  installed: [pluginName: string];
  manage: [pluginName: string];
}>();

defineExpose<{
  reload: (force?: boolean) => Promise<void>;
}>();

const { t } = useI18n();

const entries = ref<PluginCommunityEntry[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref<string | null>(null);
const installError = ref<string | null>(null);
const installBusySlug = ref<string | null>(null);
const search = ref("");
const selectedTagKey = ref<string | null>(null);
const availability = ref<CommunityAvailabilityFilter>("all");
const installedNameBySlug = ref(new Map<string, string>());
/** Request counter so overlapping loads ignore stale responses (§14.4/§14.5). */
let activeLoadRequest = 0;

const sessionExpired = computed<boolean>(() =>
  isSessionExpiredMessage(errorMessage.value)
);

const tagFacets = computed<CommunityTagFacet[]>(() =>
  buildCommunityTagFacets(entries.value)
);

const visibleFacets = computed<CommunityTagFacet[]>(() =>
  visibleCommunityTagFacets(tagFacets.value, selectedTagKey.value)
);

/** Facets hidden behind the More affordance (full catalog counts). */
const overflowFacets = computed<CommunityTagFacet[]>(() => {
  const visibleKeys = new Set(visibleFacets.value.map((f) => f.key));
  return tagFacets.value.filter((f) => !visibleKeys.has(f.key));
});

const filteredEntries = computed<PluginCommunityEntry[]>(() =>
  filterCommunityPlugins(entries.value, {
    search: search.value,
    selectedTagKey: selectedTagKey.value,
    availability: availability.value,
  })
);

const showGrid = computed<boolean>(
  () => !loading.value && entries.value.length > 0
);
const showEmptyCatalog = computed<boolean>(
  () => !loading.value && entries.value.length === 0 && !errorMessage.value
);
const showNoMatches = computed<boolean>(
  () =>
    !loading.value &&
    entries.value.length > 0 &&
    filteredEntries.value.length === 0
);

async function reload(force = false): Promise<void> {
  const requestId = ++activeLoadRequest;
  if (entries.value.length === 0) loading.value = true;
  else refreshing.value = true;
  errorMessage.value = null;

  try {
    const data = await listCommunityPlugins({ forceRefresh: force });
    if (requestId !== activeLoadRequest) return; // stale
    entries.value = data ?? [];
  } catch (error: unknown) {
    if (requestId !== activeLoadRequest) return; // stale
    errorMessage.value =
      error instanceof Error ? error.message : String(error);
  } finally {
    if (requestId === activeLoadRequest) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}

async function onInstall(entry: PluginCommunityEntry): Promise<void> {
  if (installBusySlug.value) return; // one global install in flight
  installBusySlug.value = entry.slug;
  installError.value = null;

  try {
    const installed = await installCommunityPlugin(entry.slug);
    if (!installed) {
      throw new Error(
        t("communityPlugins.installFailed") || "Install failed"
      );
    }
    // Use the install result's canonical name for Manage, not the slug.
    installedNameBySlug.value.set(entry.slug, installed.name);
    // Immutable entry-array replacement so computed filters update predictably.
    entries.value = entries.value.map((candidate) =>
      candidate.slug === entry.slug
        ? { ...candidate, installed: true }
        : candidate
    );
    emit("installed", installed.name);
  } catch (error: unknown) {
    installError.value =
      error instanceof Error ? error.message : String(error);
  } finally {
    installBusySlug.value = null;
  }
}

function onManage(entry: PluginCommunityEntry): void {
  emit("manage", installedNameBySlug.value.get(entry.slug) ?? entry.name);
}

async function onUpgrade(): Promise<void> {
  try {
    await openCommunityPlansPage();
  } catch (error: unknown) {
    installError.value =
      error instanceof Error ? error.message : String(error);
  }
}

async function onSignIn(): Promise<void> {
  try {
    await getLoginUrl();
  } catch (error: unknown) {
    installError.value =
      error instanceof Error ? error.message : String(error);
  }
}

function clearFilters(): void {
  search.value = "";
  selectedTagKey.value = null;
  availability.value = "all";
}

function selectTag(key: string | null): void {
  selectedTagKey.value = selectedTagKey.value === key ? null : key;
}

/**
 * Live re-fetch on plan change: WebSocketClient broadcasts user_info_updated
 * (nested in WEBSOCKET_EVENT) after refreshUserInfoOnSubscriptionChange. The
 * stable named reference is registered and removed verbatim so tab switches
 * never accumulate duplicate listeners (unified plugin page PRD §13.5).
 */
function onWebSocketEvent(event: unknown): void {
  const candidate = event as
    | { type?: string; data?: { type?: string } }
    | null;
  if (
    candidate?.type === "message" &&
    candidate.data?.type === "user_info_updated"
  ) {
    void reload(true);
  }
}

onMounted((): void => {
  void reload(false);
  windowReceive(WEBSOCKET_EVENT, onWebSocketEvent);
});

onUnmounted((): void => {
  // Bump the counter so any late IPC response cannot touch disposed state.
  activeLoadRequest += 1;
  windowRemoveListener(WEBSOCKET_EVENT, onWebSocketEvent);
});
</script>

<template>
  <div class="community-plugin-catalog">
    <!-- Search and refresh toolbar -->
    <div class="community-plugin-toolbar">
      <v-text-field
        v-model="search"
        class="community-plugin-search"
        density="compact"
        variant="outlined"
        prepend-inner-icon="mdi-magnify"
        :label="t('communityPlugins.searchLabel') || 'Search plugins'"
        :placeholder="t('communityPlugins.searchPlaceholder') || 'Search by name, description, author, or tag'"
        clearable
        hide-details
        :aria-label="t('communityPlugins.searchLabel') || 'Search plugins'"
        data-testid="community-plugins-search"
      />
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-refresh"
        :loading="refreshing"
        :disabled="loading"
        data-testid="community-plugins-refresh"
        @click="reload(true)"
      >
        {{ t("communityPlugins.refresh") || "Refresh" }}
      </v-btn>
    </div>

    <!-- Tag filter row -->
    <v-chip-group
      class="community-plugin-tags mt-3"
      :model-value="selectedTagKey ?? ''"
      mandatory
      @update:model-value="selectTag($event === '' ? null : ($event as string))"
    >
      <v-chip
        size="small"
        variant="tonal"
        value=""
        :data-testid="`community-plugin-tag-all`"
      >
        {{ t("communityPlugins.allTags") || "All" }}
      </v-chip>
      <v-chip
        v-for="facet in visibleFacets"
        :key="facet.key"
        size="small"
        variant="tonal"
        :value="facet.key"
        :data-testid="`community-plugin-tag-${facet.key}`"
      >
        {{ facet.label }} ({{ facet.count }})
      </v-chip>
      <v-menu
        v-if="overflowFacets.length > 0"
        location="bottom end"
      >
        <template #activator="{ props: slotProps }">
          <v-chip
            size="small"
            variant="text"
            v-bind="slotProps"
            data-testid="community-plugin-tag-more"
          >
            {{ t("communityPlugins.moreTags") || "More" }}
          </v-chip>
        </template>
        <v-list>
          <v-list-item
            v-for="facet in overflowFacets"
            :key="facet.key"
            :data-testid="`community-plugin-tag-overflow-${facet.key}`"
            @click="selectTag(facet.key)"
          >
            <v-list-item-title>{{ facet.label }} ({{ facet.count }})</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-chip-group>

    <!-- Result summary and availability filter -->
    <div class="community-plugin-summary mt-3">
      <div
        class="text-body-2"
        aria-live="polite"
        aria-atomic="true"
        data-testid="community-plugins-result-count"
      >
        {{ t("communityPlugins.resultCount", { count: filteredEntries.length }) || `${filteredEntries.length} plugins` }}
      </div>
      <v-btn-toggle
        v-model="availability"
        mandatory
        density="compact"
        variant="outlined"
        color="primary"
        divided
        :aria-label="t('communityPlugins.filterLabel') || 'Availability'"
      >
        <v-btn value="all" size="small" data-testid="community-plugins-filter-all">
          {{ t("communityPlugins.filterAll") || "All" }}
        </v-btn>
        <v-btn value="available" size="small" data-testid="community-plugins-filter-available">
          {{ t("communityPlugins.filterAvailable") || "Available" }}
        </v-btn>
        <v-btn value="installed" size="small" data-testid="community-plugins-filter-installed">
          {{ t("communityPlugins.filterInstalled") || "Installed" }}
        </v-btn>
      </v-btn-toggle>
    </div>

    <!-- Catalog state region (precedence per §9.8) -->
    <v-alert
      v-if="errorMessage && sessionExpired"
      type="warning"
      variant="tonal"
      class="mt-4"
      data-testid="community-plugins-session-expired"
    >
      {{ t("communityPlugins.sessionExpired") || "Your session expired" }}
      <template #append>
        <v-btn color="warning" variant="tonal" @click="onSignIn">
          {{ t("communityPlugins.signInAgain") || "Sign in again" }}
        </v-btn>
      </template>
    </v-alert>

    <v-alert
      v-else-if="errorMessage && !loading"
      type="error"
      variant="tonal"
      class="mt-4"
      data-testid="community-plugins-error"
    >
      {{ t("communityPlugins.error") || "Couldn't reach the Plugin Hub" }}
      <template #append>
        <v-btn color="error" variant="tonal" @click="reload(true)">
          {{ t("communityPlugins.retry") || "Retry" }}
        </v-btn>
      </template>
    </v-alert>

    <v-alert
      v-if="installError"
      type="error"
      density="compact"
      variant="outlined"
      class="mt-4"
      closable
      data-testid="community-plugins-install-error"
      @click:close="installError = null"
    >
      {{ t("communityPlugins.installFailed") || "Install failed" }}: {{ installError }}
    </v-alert>

    <!-- Initial loading skeleton -->
    <div
      v-if="loading"
      class="community-plugin-grid"
      role="status"
      :aria-label="t('communityPlugins.loading') || 'Loading plugins'"
      data-testid="community-plugins-loading"
    >
      <v-skeleton-loader
        v-for="i in 6"
        :key="i"
        type="article"
        class="community-plugin-card"
      />
    </div>

    <!-- Empty full catalog -->
    <div
      v-else-if="showEmptyCatalog"
      class="text-center py-10"
      data-testid="community-plugins-empty"
    >
      <v-icon size="48" class="mb-2">mdi-store-search-outline</v-icon>
      <div class="text-body-1">
        {{ t("communityPlugins.empty") || "No plugins available" }}
      </div>
      <v-btn class="mt-3" variant="tonal" @click="reload(true)">
        {{ t("communityPlugins.refresh") || "Refresh" }}
      </v-btn>
    </div>

    <!-- No matching results (distinct from empty catalog) -->
    <div
      v-else-if="showNoMatches"
      class="text-center py-10"
      data-testid="community-plugins-no-matches"
    >
      <v-icon size="48" class="mb-2">mdi-magnify-close</v-icon>
      <div class="text-body-1">
        {{
          t("communityPlugins.noMatchesTitle", { query: search }) ||
          `No plugins match "${search}"`
        }}
      </div>
      <div class="text-body-2 text-medium-emphasis mt-1">
        {{
          t("communityPlugins.noMatchesDescription") ||
          "Try another search or clear your filters."
        }}
      </div>
      <v-btn
        class="mt-3"
        variant="tonal"
        data-testid="community-plugins-clear-filters"
        @click="clearFilters"
      >
        {{ t("communityPlugins.clearFilters") || "Clear filters" }}
      </v-btn>
    </div>

    <!-- Plugin grid -->
    <div v-if="showGrid" class="community-plugin-grid mt-4">
      <CommunityPluginCard
        v-for="entry in filteredEntries"
        :key="entry.slug"
        :entry="entry"
        :installing="installBusySlug === entry.slug"
        :install-busy="installBusySlug !== null"
        @install="onInstall"
        @manage="onManage"
        @upgrade="onUpgrade"
        @signin="onSignIn"
      />
    </div>
  </div>
</template>

<style scoped>
.community-plugin-toolbar {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}

.community-plugin-search {
  flex: 1 1 360px;
  max-width: 560px;
}

.community-plugin-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.community-plugin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(290px, 100%), 1fr));
  gap: 16px;
  align-items: stretch;
}
</style>
