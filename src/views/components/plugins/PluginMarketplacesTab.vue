<template>
  <div>
    <div class="d-flex justify-end ga-2 mb-2">
      <v-btn variant="text" size="small" @click="refreshAll" :loading="refreshingAll">
        <v-icon left>mdi-refresh</v-icon>
        {{ t("plugins.marketplace.refresh_all_button") || "Refresh All" }}
      </v-btn>
      <v-btn color="primary" @click="showAdd = true">
        <v-icon left>mdi-plus</v-icon>
        {{ t("plugins.marketplace.add_button") || "Add Marketplace" }}
      </v-btn>
    </div>

    <div v-if="loading" class="text-center pa-4"><v-progress-circular indeterminate color="primary" /></div>
    <v-table v-else>
      <thead><tr>
        <th>{{ t("plugins.marketplace.column_marketplace") }}</th>
        <th>{{ t("plugins.marketplace.column_owner") }}</th>
        <th>{{ t("plugins.marketplace.column_plugins") }}</th>
        <th>{{ t("plugins.marketplace.health_label") || "Status" }}</th>
        <th>{{ t("plugins.marketplace.column_last_fetched") }}</th>
        <th>{{ t("plugins.column_actions") }}</th>
      </tr></thead>
      <tbody>
        <tr v-for="m in marketplaces" :key="m.name">
          <td>{{ m.displayName || m.name }}</td>
          <td>{{ m.ownerName }}</td>
          <td>{{ m.pluginCount }}</td>
          <td><v-chip size="small" :color="healthColor(m.health)">{{ healthLabel(m.health) }}</v-chip></td>
          <td>{{ m.lastFetchedAt ? new Date(m.lastFetchedAt).toLocaleString() : "—" }}</td>
          <td>
            <v-btn icon size="x-small" variant="text" @click="refresh(m.name)" :loading="refreshingName === m.name">
              <v-icon>mdi-refresh</v-icon>
            </v-btn>
            <v-btn icon size="x-small" variant="text" color="error" @click="confirmRemove(m.name)">
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>

    <PluginMarketplaceAddDialog v-model="showAdd" @added="onAdded" />

    <v-dialog v-model="showRemove" max-width="520">
      <v-card>
        <v-card-title>{{ t("plugins.marketplace.remove_button") || "Remove Marketplace" }}</v-card-title>
        <v-card-text>{{ t("plugins.marketplace.confirm_remove") || "Remove this marketplace? Installed plugins from it will remain installed." }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showRemove = false">{{ t("common.cancel") || "Cancel" }}</v-btn>
          <v-btn color="error" @click="doRemove">{{ t("plugins.marketplace.remove_button") || "Remove" }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  listPluginMarketplaces, refreshPluginMarketplace, removePluginMarketplace,
  type PluginMarketplaceSummary,
} from "@/views/api/pluginMarketplaces";
import PluginMarketplaceAddDialog from "./PluginMarketplaceAddDialog.vue";

const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const marketplaces = ref<PluginMarketplaceSummary[]>([]);
const loading = ref(false);
const showAdd = ref(false);
const showRemove = ref(false);
const removeTarget = ref<string | null>(null);
const refreshingName = ref<string | null>(null);
const refreshingAll = ref(false);

function healthLabel(h: string): string { return t(`plugins.marketplace.health_${h}`) || h; }
function healthColor(h: string): string {
  if (h === "healthy") return "success";
  if (h === "disabled") return "grey";
  return "error";
}

async function load(): Promise<void> {
  loading.value = true;
  try { marketplaces.value = (await listPluginMarketplaces()) ?? []; } finally { loading.value = false; }
}
async function refresh(name: string): Promise<void> {
  refreshingName.value = name;
  try { await refreshPluginMarketplace(name); await load(); emit("changed"); } finally { refreshingName.value = null; }
}
async function refreshAll(): Promise<void> {
  refreshingAll.value = true;
  try { for (const m of marketplaces.value) await refreshPluginMarketplace(m.name); await load(); emit("changed"); } finally { refreshingAll.value = false; }
}
function confirmRemove(name: string): void { removeTarget.value = name; showRemove.value = true; }
async function doRemove(): Promise<void> {
  if (!removeTarget.value) return;
  const name = removeTarget.value; removeTarget.value = null; showRemove.value = false;
  await removePluginMarketplace(name); await load(); emit("changed");
}
async function onAdded(): Promise<void> { showAdd.value = false; await load(); emit("changed"); }
onMounted(load);
</script>
