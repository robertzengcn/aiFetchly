<template>
  <div>
    <div class="d-flex ga-2 mb-2 flex-wrap">
      <v-text-field
v-model="search" density="compact" hide-details style="max-width: 280px"
        :label="t('plugins.marketplace.search_label') || 'Search'" @update:model-value="onSearchInput" />
      <v-select
v-model="marketplaceName" :items="marketplaceItems" item-title="label" item-value="value"
        density="compact" hide-details style="max-width: 220px" clearable
        :label="t('plugins.marketplace.column_marketplace')" @update:model-value="reload" />
      <v-select
v-model="installedFilter" :items="installedItems" item-title="label" item-value="value"
        density="compact" hide-details style="max-width: 180px"
        :label="t('plugins.marketplace.column_status')" @update:model-value="reload" />
    </div>

    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-2" closable @click:close="loadError = ''">
      {{ loadError }}
    </v-alert>

    <div v-if="loading" class="text-center pa-4"><v-progress-circular indeterminate color="primary" /></div>
    <v-table v-else>
      <thead><tr>
        <th>{{ t("plugins.column_plugin") }}</th>
        <th>{{ t("plugins.marketplace.column_marketplace") }}</th>
        <th>{{ t("plugins.column_version") }}</th>
        <th>{{ t("plugins.marketplace.column_status") }}</th>
        <th>{{ t("plugins.column_actions") }}</th>
      </tr></thead>
      <tbody>
        <tr v-for="p in items" :key="p.pluginId">
          <td>{{ p.displayName || p.name }}<div class="text-caption text-grey">{{ p.description }}</div></td>
          <td>{{ p.marketplaceDisplayName || p.marketplaceName }}</td>
          <td>{{ p.version || "—" }}</td>
          <td><v-chip size="small" variant="tonal" :color="statusColor(p.status)">{{ statusLabel(p.status) }}</v-chip></td>
          <td>
            <v-btn size="small" variant="text" @click="openDetail(p.pluginId)">{{ t("plugins.marketplace.view_details") || "Details" }}</v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>

    <PluginMarketplacePluginDetailDialog v-model="showDetail" :plugin-id="detailId" @installed="reload" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  listMarketplacePlugins, listPluginMarketplaces,
  type PluginMarketplacePluginSummary, type PluginMarketplacePluginFilter,
} from "@/views/api/pluginMarketplaces";
import PluginMarketplacePluginDetailDialog from "./PluginMarketplacePluginDetailDialog.vue";

const { t } = useI18n();
const items = ref<PluginMarketplacePluginSummary[]>([]);
const loading = ref(false);
const search = ref("");
const marketplaceName = ref<string | null>(null);
const installedFilter = ref<"all" | "installed" | "not_installed">("all");
const marketplaceItems = ref<Array<{ label: string; value: string }>>([]);
const installedItems = ref([
  { label: t("plugins.marketplace.status_all") || "All", value: "all" },
  { label: t("plugins.marketplace.status_installed") || "Installed", value: "installed" },
  { label: t("plugins.marketplace.status_not_installed") || "Not installed", value: "not_installed" },
]);
const showDetail = ref(false);
const detailId = ref<string | null>(null);
const loadError = ref("");
let searchTimer: ReturnType<typeof setTimeout> | null = null;
type PluginMarketplaceStatus = PluginMarketplacePluginSummary["status"];

async function reload(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    const filter: PluginMarketplacePluginFilter = {};
    if (search.value) filter.search = search.value;
    if (marketplaceName.value) filter.marketplaceName = marketplaceName.value;
    if (installedFilter.value === "installed") filter.installed = true;
    if (installedFilter.value === "not_installed") filter.installed = false;
    items.value = (await listMarketplacePlugins(filter)) ?? [];
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
// Debounce search so each keystroke does not fire an IPC round-trip.
function onSearchInput(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    reload();
  }, 300);
}
function openDetail(pluginId: string): void { detailId.value = pluginId; showDetail.value = true; }
function statusLabel(status: PluginMarketplaceStatus): string {
  const labels: Record<PluginMarketplaceStatus, string> = {
    not_installed: t("plugins.marketplace.status_not_installed") || "Not installed",
    installed: t("plugins.marketplace.status_installed") || "Installed",
    different_version: t("plugins.marketplace.status_different_version") || "Different version installed",
    unsupported: t("plugins.marketplace.status_unsupported") || "Unsupported source",
    error: t("plugins.marketplace.status_error") || "Error",
  };
  return labels[status];
}
function statusColor(status: PluginMarketplaceStatus): string {
  const colors: Record<PluginMarketplaceStatus, string> = {
    not_installed: "default",
    installed: "success",
    different_version: "warning",
    unsupported: "default",
    error: "error",
  };
  return colors[status];
}
async function loadMarketplaceOptions(): Promise<void> {
  try {
    const list = (await listPluginMarketplaces()) ?? [];
    marketplaceItems.value = list.map((m) => ({ label: m.displayName || m.name, value: m.name }));
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
}
defineExpose({ reload });
onMounted(async () => { await loadMarketplaceOptions(); await reload(); });
</script>
