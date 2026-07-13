<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t("plugins.title") }}</span>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-tabs v-model="tab">
          <v-tab value="installed">{{ t("plugins.marketplace.tab_installed") || "Installed" }}</v-tab>
          <v-tab value="discover">{{ t("plugins.marketplace.tab_discover") || "Discover" }}</v-tab>
          <v-tab value="marketplaces">{{ t("plugins.marketplace.tab_marketplaces") || "Marketplaces" }}</v-tab>
          <v-tab value="errors">{{ t("plugins.marketplace.tab_errors") || "Errors" }}</v-tab>
        </v-tabs>
        <v-window v-model="tab" class="mt-4">
          <v-window-item value="installed">
            <PluginInstalledTab
              :plugins="plugins" :is-loading="isLoading" :reloading="reloading"
              @reload="reload" @import="showImport = true" @install-source="showInstallSource = true"
              @select="selectPlugin" @toggle="toggle" @uninstall="confirmUninstall" />
          </v-window-item>
          <v-window-item value="discover">
            <PluginDiscoverTab ref="discoverRef" />
          </v-window-item>
          <v-window-item value="marketplaces">
            <PluginMarketplacesTab @changed="onMarketplacesChanged" />
          </v-window-item>
          <v-window-item value="errors">
            <PluginMarketplaceErrorsTab />
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>

    <PluginDetailPanel v-if="selectedName" :name="selectedName" @close="selectedName = null" />
    <PluginImportDialog v-model="showImport" @imported="onImported" />
    <PluginInstallSourceDialog v-model="showInstallSource" @imported="onImported" />

    <v-dialog v-model="showUninstall" max-width="500">
      <v-card>
        <v-card-title>{{ t("plugins.uninstall_button") }}</v-card-title>
        <v-card-text>{{ t("plugins.uninstall_confirm") }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showUninstall = false">{{ t("common.cancel") || "Cancel" }}</v-btn>
          <v-btn color="error" @click="doUninstall">{{ t("plugins.uninstall_button") }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { listPlugins, togglePlugin, uninstallPlugin, reloadPlugins, type PluginSummary } from "@/views/api/plugins";
import PluginDetailPanel from "./PluginDetailPanel.vue";
import PluginImportDialog from "./PluginImportDialog.vue";
import PluginInstallSourceDialog from "./PluginInstallSourceDialog.vue";
import PluginInstalledTab from "./PluginInstalledTab.vue";
import PluginDiscoverTab from "./PluginDiscoverTab.vue";
import PluginMarketplacesTab from "./PluginMarketplacesTab.vue";
import PluginMarketplaceErrorsTab from "./PluginMarketplaceErrorsTab.vue";

const { t } = useI18n();
const tab = ref("installed");
const plugins = ref<PluginSummary[]>([]);
const isLoading = ref(false);
const reloading = ref(false);
const selectedName = ref<string | null>(null);
const showImport = ref(false);
const showInstallSource = ref(false);
const uninstallTarget = ref<string | null>(null);
const showUninstall = ref(false);
const discoverRef = ref<{ reload: () => Promise<void> } | null>(null);

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
  try { await reloadPlugins(); await load(); } finally { reloading.value = false; }
}
function selectPlugin(name: string): void { selectedName.value = name; }
async function toggle(name: string, enabled: boolean): Promise<void> { await togglePlugin(name, enabled); await load(); }
function confirmUninstall(name: string): void { uninstallTarget.value = name; showUninstall.value = true; }
async function doUninstall(): Promise<void> {
  if (!uninstallTarget.value) return;
  const name = uninstallTarget.value;
  uninstallTarget.value = null; showUninstall.value = false;
  await uninstallPlugin(name);
  if (selectedName.value === name) selectedName.value = null;
  await load();
}
async function onImported(): Promise<void> { await load(); await discoverRef.value?.reload(); }
async function onMarketplacesChanged(): Promise<void> { await discoverRef.value?.reload(); }
onMounted(load);
</script>
