<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t("plugins.title") }}</span>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-tabs
          :model-value="tab"
          density="comfortable"
          color="primary"
          @update:model-value="selectTab"
        >
          <v-tab value="discover">{{
            t("plugins.tabs.discover") || "Discover"
          }}</v-tab>
          <v-tab value="installed">{{
            t("plugins.tabs.installed") || "Installed"
          }}</v-tab>
          <v-tab value="sources">{{
            t("plugins.tabs.sources") || "Sources"
          }}</v-tab>
          <v-tab value="issues">{{
            t("plugins.tabs.issues") || "Issues"
          }}</v-tab>
        </v-tabs>
        <v-window :model-value="tab" class="mt-4">
          <!-- Discover: kept alive (no v-if) so search/filter state and the
               WebSocket listener survive Manage navigation and sync round-trips
               (tech design TD-7). -->
          <v-window-item value="discover">
            <CommunityPluginCatalog
              ref="communityRef"
              @installed="onCommunityInstalled"
              @manage="onCommunityManage"
            />
          </v-window-item>
          <v-window-item value="installed">
            <PluginInstalledTab
              :plugins="plugins"
              :is-loading="isLoading"
              :reloading="reloading"
              @reload="reload"
              @import="showImport = true"
              @install-source="showInstallSource = true"
              @select="selectPlugin"
              @toggle="toggle"
              @uninstall="confirmUninstall"
            />
          </v-window-item>
          <v-window-item value="sources">
            <PluginSourcesTab ref="sourcesRef" />
          </v-window-item>
          <v-window-item value="issues">
            <PluginMarketplaceErrorsTab />
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>

    <PluginDetailPanel
      v-if="selectedName"
      :name="selectedName"
      @close="selectedName = null"
    />
    <PluginImportDialog v-model="showImport" @imported="onImported" />
    <PluginInstallSourceDialog v-model="showInstallSource" @imported="onImported" />

    <v-dialog v-model="showUninstall" max-width="500">
      <v-card>
        <v-card-title>{{ t("plugins.uninstall_button") }}</v-card-title>
        <v-card-text>{{ t("plugins.uninstall_confirm") }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showUninstall = false">{{
            t("common.cancel") || "Cancel"
          }}</v-btn>
          <v-btn color="error" @click="doUninstall">{{
            t("plugins.uninstall_button")
          }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  listPlugins,
  togglePlugin,
  uninstallPlugin,
  reloadPlugins,
  type PluginSummary,
} from "@/views/api/plugins";
import PluginDetailPanel from "./PluginDetailPanel.vue";
import PluginImportDialog from "./PluginImportDialog.vue";
import PluginInstallSourceDialog from "./PluginInstallSourceDialog.vue";
import PluginInstalledTab from "./PluginInstalledTab.vue";
import PluginMarketplaceErrorsTab from "./PluginMarketplaceErrorsTab.vue";
import PluginSourcesTab from "./PluginSourcesTab.vue";
import CommunityPluginCatalog from "./CommunityPluginCatalog.vue";
import {
  isPluginManagerTab,
  parsePluginManagerTab,
  withPluginManagerTab,
  type PluginManagerTab,
} from "@/views/utils/pluginManagerRoute";

/**
 * Unified Plugin page (unified plugin page PRD §8 / tech design §11).
 *
 * One visible Plugin destination with four task-oriented sections — Discover
 * (Community Hub), Installed, Sources (external marketplaces), Issues —
 * whose active section is carried in `route.query.tab` so refresh, deep
 * links, AI navigation, and browser history behave deterministically. Install
 * and uninstall state reconcile through authoritative main-process reads,
 * coordinated here so Discover and Installed stay consistent without a full
 * app reload.
 */

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const tab = ref<PluginManagerTab>(parsePluginManagerTab(route.query.tab));
const plugins = ref<PluginSummary[]>([]);
const isLoading = ref(false);
const reloading = ref(false);
const selectedName = ref<string | null>(null);
const showImport = ref(false);
const showInstallSource = ref(false);
const uninstallTarget = ref<string | null>(null);
const showUninstall = ref(false);
const communityRef = ref<{ reload: (force?: boolean) => Promise<void> } | null>(
  null
);
const sourcesRef = ref<{ reloadBrowse: () => Promise<void> } | null>(null);

/** Browser back/forward updates the local tab from the query. */
watch(
  () => route.query.tab,
  (value) => {
    const parsed = parsePluginManagerTab(value);
    if (tab.value !== parsed) tab.value = parsed;
  }
);

async function loadInstalledPlugins(): Promise<void> {
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
    await loadInstalledPlugins();
  } finally {
    reloading.value = false;
  }
}

function selectPlugin(name: string): void {
  selectedName.value = name;
}

async function toggle(name: string, enabled: boolean): Promise<void> {
  await togglePlugin(name, enabled);
  await loadInstalledPlugins();
}

function confirmUninstall(name: string): void {
  uninstallTarget.value = name;
  showUninstall.value = true;
}

/** User tab selection pushes the query (creating history) without a reload. */
async function selectTab(value: unknown): Promise<void> {
  if (!isPluginManagerTab(value)) return;
  tab.value = value;
  if (parsePluginManagerTab(route.query.tab) === value) return;
  await router.push({
    name: "PluginsManagement",
    query: withPluginManagerTab(route.query, value),
  });
}

/** Community install succeeded — the Installed collection is now stale. */
async function onCommunityInstalled(_pluginName: string): Promise<void> {
  await loadInstalledPlugins();
}

/** Community Manage — switch to Installed and surface the matching detail. */
async function onCommunityManage(pluginName: string): Promise<void> {
  selectedName.value = pluginName;
  await selectTab("installed");
}

async function doUninstall(): Promise<void> {
  if (!uninstallTarget.value) return;
  const name = uninstallTarget.value;
  uninstallTarget.value = null;
  showUninstall.value = false;

  await uninstallPlugin(name);
  if (selectedName.value === name) selectedName.value = null;
  // Reload both Installed (authoritative) and Discover (recompute installed
  // cross-reference). Both are read-only after uninstall; each child owns
  // its own display error.
  await Promise.all([
    loadInstalledPlugins(),
    communityRef.value?.reload(false),
  ]);
}

async function onImported(): Promise<void> {
  await Promise.all([
    loadInstalledPlugins(),
    sourcesRef.value?.reloadBrowse(),
  ]);
}

onMounted(async (): Promise<void> => {
  await loadInstalledPlugins();
  // Canonicalize a missing/invalid tab to Discover without adding history.
  if (
    route.query.tab !== "discover" &&
    !isPluginManagerTab(route.query.tab)
  ) {
    await router.replace({
      name: "PluginsManagement",
      query: withPluginManagerTab(route.query, "discover"),
    });
  }
});
</script>
