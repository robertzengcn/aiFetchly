<template>
  <div>
    <div class="d-flex justify-end mb-2">
      <v-btn size="small" variant="outlined" @click="exportDiag">
        <v-icon left>mdi-download</v-icon>
        {{ t("plugins.export_diagnostics") }}
      </v-btn>
    </div>
    <pre v-if="bundle">{{ JSON.stringify(bundle, null, 2) }}</pre>
    <div v-else class="text-grey">No diagnostics available.</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  exportPluginDiagnostics,
  type PluginDiagnosticsBundle,
} from "@/views/api/plugins";

const props = defineProps<{ name: string }>();
const { t } = useI18n();
const bundle = ref<PluginDiagnosticsBundle | null>(null);

async function exportDiag(): Promise<void> {
  bundle.value = await exportPluginDiagnostics(props.name);
}
</script>
