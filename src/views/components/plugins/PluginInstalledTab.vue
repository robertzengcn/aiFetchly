<template>
  <div>
    <div class="d-flex justify-end ga-2 mb-2">
      <v-btn variant="text" size="small" @click="$emit('reload')" :loading="reloading">
        <v-icon left>mdi-refresh</v-icon>
        {{ t("plugins.reload_button") }}
      </v-btn>
      <v-btn color="primary" @click="$emit('import')">
        <v-icon left>mdi-upload</v-icon>
        {{ t("plugins.import_button") }}
      </v-btn>
      <v-btn color="primary" variant="tonal" @click="$emit('install-source')">
        <v-icon left>mdi-source-branch</v-icon>
        {{ t("plugins.install_source.button") || "Install from Source" }}
      </v-btn>
    </div>

    <div v-if="isLoading" class="text-center pa-4">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <div v-else-if="plugins.length === 0" class="text-center pa-4">
      <v-icon size="64" color="grey-lighten-2">mdi-puzzle</v-icon>
      <p class="mt-4 text-grey">{{ t("plugins.empty_state") }}</p>
    </div>
    <div v-else>
      <v-table>
        <thead>
          <tr>
            <th>{{ t("plugins.column_plugin") }}</th>
            <th>{{ t("plugins.column_version") }}</th>
            <th>{{ t("plugins.column_source") }}</th>
            <th>{{ t("plugins.column_source_path") }}</th>
            <th>{{ t("plugins.column_sub_agent") }}</th>
            <th>{{ t("plugins.column_skills") }}</th>
            <th>{{ t("plugins.column_mcp_servers") }}</th>
            <th>{{ t("plugins.column_status") }}</th>
            <th>{{ t("plugins.column_actions") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in plugins" :key="p.name" @click="$emit('select', p.name)" style="cursor: pointer">
            <td>{{ p.displayName || p.name }}</td>
            <td>{{ p.version }}</td>
            <td><v-chip size="small">{{ sourceLabel(p.source) }}</v-chip></td>
            <td class="plugin-path-cell">
              <span v-if="displayPath(p)" class="plugin-path-text">
                {{ displayPath(p) }}
                <v-tooltip activator="parent" location="top">
                  {{ displayPath(p) }}
                </v-tooltip>
              </span>
              <span v-else class="text-medium-emphasis">
                {{ t("plugins.source_path_unknown") }}
              </span>
            </td>
            <td>{{ p.agentCount }}</td>
            <td>{{ p.skillCount }}</td>
            <td>{{ p.mcpServerCount }}</td>
            <td><v-chip :color="healthColor(p)" size="small">{{ healthLabel(p) }}</v-chip></td>
            <td>
              <v-switch
:model-value="p.enabled" color="success" hide-details density="compact"
                @click.stop @update:model-value="(v) => $emit('toggle', p.name, v === true)" />
              <v-btn icon size="x-small" variant="text" color="error" @click.stop="$emit('uninstall', p.name)">
                <v-icon>mdi-delete</v-icon>
                <v-tooltip activator="parent" location="top">{{ t("plugins.uninstall_button") }}</v-tooltip>
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PluginSummary } from "@/views/api/plugins";

defineProps<{
  plugins: PluginSummary[];
  isLoading: boolean;
  reloading: boolean;
}>();
defineEmits<{
  reload: [];
  import: [];
  "install-source": [];
  select: [string];
  toggle: [string, boolean];
  uninstall: [string];
}>();

const { t } = useI18n();
function sourceLabel(source: string): string {
  if (source === "builtin") return t("plugins.source_builtin");
  if (source === "marketplace") return t("plugins.source_marketplace");
  return t("plugins.source_local");
}
function displayPath(p: PluginSummary): string | undefined {
  return p.sourceUri || p.installPath;
}
function healthLabel(p: PluginSummary): string {
  if (!p.enabled) return t("plugins.status_disabled");
  return t(`plugins.status_${p.health}`);
}
function healthColor(p: PluginSummary): string {
  if (!p.enabled) return "grey";
  if (p.health === "healthy") return "success";
  if (p.health === "missing_files" || p.health === "invalid") return "error";
  return "warning";
}
</script>

<style scoped>
.plugin-path-cell {
  max-width: 280px;
}

.plugin-path-text {
  display: inline-block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
  white-space: nowrap;
}
</style>
