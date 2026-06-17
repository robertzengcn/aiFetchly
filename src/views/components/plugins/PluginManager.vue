<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t("plugins.title") }}</span>
        <div class="d-flex align-center ga-2">
          <v-btn
            variant="text"
            size="small"
            @click="reload"
            :loading="reloading"
          >
            <v-icon left>mdi-refresh</v-icon>
            {{ t("plugins.reload_button") }}
          </v-btn>
          <v-btn color="primary" @click="showImport = true">
            <v-icon left>mdi-upload</v-icon>
            {{ t("plugins.import_button") }}
          </v-btn>
        </div>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
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
                <th>{{ t("plugins.column_status") }}</th>
                <th>{{ t("plugins.column_skills") }}</th>
                <th>{{ t("plugins.column_mcp_servers") }}</th>
                <th>{{ t("plugins.column_actions") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in plugins"
                :key="p.name"
                @click="selectPlugin(p.name)"
                style="cursor: pointer"
              >
                <td>{{ p.displayName || p.name }}</td>
                <td>{{ p.version }}</td>
                <td>
                  <v-chip size="small">{{ sourceLabel(p.source) }}</v-chip>
                </td>
                <td>
                  <v-chip :color="healthColor(p)" size="small">
                    {{ healthLabel(p) }}
                  </v-chip>
                </td>
                <td>{{ p.skillCount }}</td>
                <td>{{ p.mcpServerCount }}</td>
                <td>
                  <v-switch
                    :model-value="p.enabled"
                    color="success"
                    hide-details
                    density="compact"
                    @click.stop
                    @update:model-value="(v) => toggle(p.name, v === true)"
                  />
                  <v-btn
                    icon
                    size="x-small"
                    variant="text"
                    color="error"
                    @click.stop="confirmUninstall(p.name)"
                  >
                    <v-icon>mdi-delete</v-icon>
                    <v-tooltip activator="parent" location="top">
                      {{ t("plugins.uninstall_button") }}
                    </v-tooltip>
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card-text>
    </v-card>

    <PluginDetailPanel
      v-if="selectedName"
      :name="selectedName"
      @close="selectedName = null"
    />

    <PluginImportDialog
      v-model="showImport"
      @imported="onImported"
    />

    <v-dialog v-model="showUninstall" max-width="500">
      <v-card>
        <v-card-title>{{ t("plugins.uninstall_button") }}</v-card-title>
        <v-card-text>
          {{ t("plugins.uninstall_confirm") }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showUninstall = false">Cancel</v-btn>
          <v-btn color="error" @click="doUninstall">Uninstall</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  listPlugins,
  togglePlugin,
  uninstallPlugin,
  reloadPlugins,
  type PluginSummary,
} from "@/views/api/plugins";
import PluginDetailPanel from "./PluginDetailPanel.vue";
import PluginImportDialog from "./PluginImportDialog.vue";

const { t } = useI18n();
const plugins = ref<PluginSummary[]>([]);
const isLoading = ref(false);
const reloading = ref(false);
const selectedName = ref<string | null>(null);
const showImport = ref(false);
const uninstallTarget = ref<string | null>(null);
const showUninstall = ref(false);

async function load(): Promise<void> {
  isLoading.value = true;
  try {
    const data = await listPlugins();
    plugins.value = data ?? [];
  } finally {
    isLoading.value = false;
  }
}

async function reload(): Promise<void> {
  reloading.value = true;
  try {
    await reloadPlugins();
    await load();
  } finally {
    reloading.value = false;
  }
}

function selectPlugin(name: string): void {
  selectedName.value = name;
}

async function toggle(name: string, enabled: boolean): Promise<void> {
  await togglePlugin(name, enabled);
  await load();
}

function confirmUninstall(name: string): void {
  uninstallTarget.value = name;
  showUninstall.value = true;
}

async function doUninstall(): Promise<void> {
  if (!uninstallTarget.value) return;
  const name = uninstallTarget.value;
  uninstallTarget.value = null;
  showUninstall.value = false;
  await uninstallPlugin(name);
  if (selectedName.value === name) selectedName.value = null;
  await load();
}

function onImported(): Promise<void> {
  return load();
}

function sourceLabel(source: string): string {
  if (source === "builtin") return t("plugins.source_builtin");
  if (source === "marketplace") return t("plugins.source_marketplace");
  return t("plugins.source_local");
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

onMounted(load);
</script>
