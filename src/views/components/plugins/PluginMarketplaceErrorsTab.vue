<template>
  <div>
    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-2" closable @click:close="loadError = ''">
      {{ loadError }}
    </v-alert>
    <div v-if="loading" class="text-center pa-4"><v-progress-circular indeterminate color="primary" /></div>
    <div v-else-if="rows.length === 0" class="text-center pa-4 text-grey">{{ t("plugins.marketplace.no_errors") || "No marketplace errors." }}</div>
    <v-table v-else>
      <thead><tr>
        <th>{{ t("plugins.marketplace.column_marketplace") }}</th>
        <th>{{ t("plugins.marketplace.health_label") || "Health" }}</th>
        <th>{{ t("plugins.marketplace.errors_label") || "Errors" }}</th>
      </tr></thead>
      <tbody>
        <tr v-for="m in rows" :key="m.name">
          <td>{{ m.name }}</td>
          <td><v-chip size="small" color="error">{{ m.health }}</v-chip></td>
          <td>{{ errorText(m) }}</td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { listPluginMarketplaces, type PluginMarketplaceSummary } from "@/views/api/pluginMarketplaces";

const { t } = useI18n();
const rows = ref<PluginMarketplaceSummary[]>([]);
const loading = ref(false);
const loadError = ref("");

function errorText(m: PluginMarketplaceSummary): string {
  // Detailed errors come from getPluginMarketplace(name).errors; show health here.
  return t("plugins.marketplace.health_" + m.health) || m.health;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const all = (await listPluginMarketplaces()) ?? [];
    rows.value = all.filter((m) => m.health !== "healthy");
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
defineExpose({ reload: load });
onMounted(load);
</script>
