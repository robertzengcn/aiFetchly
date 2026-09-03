<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import PluginDiscoverTab from "./PluginDiscoverTab.vue";
import PluginMarketplacesTab from "./PluginMarketplacesTab.vue";

/**
 * Sources section wrapper (unified plugin page tech design §10).
 *
 * Groups the external plugin marketplace catalog ("Browse sources") and
 * marketplace source management ("Manage sources") behind a secondary tab
 * level so the top-level Plugin page keeps Discover / Installed / Sources /
 * Issues. When a marketplace source is added/removed/refreshed, the Browse
 * view is reloaded so its catalog stays in sync. Local `sourceTab` state is
 * intentionally not URL-encoded in this release.
 */

const { t } = useI18n();

const sourceTab = ref<"browse" | "manage">("browse");
const browseRef = ref<{ reload: () => Promise<void> } | null>(null);

async function reloadBrowse(): Promise<void> {
  await browseRef.value?.reload();
}

async function onMarketplacesChanged(): Promise<void> {
  await reloadBrowse();
}

defineExpose<{ reloadBrowse: () => Promise<void> }>({ reloadBrowse });
</script>

<template>
  <div class="plugin-sources-tab">
    <v-tabs v-model="sourceTab" density="compact" color="primary">
      <v-tab value="browse">{{
        t("plugins.sources.browse") || "Browse sources"
      }}</v-tab>
      <v-tab value="manage">{{
        t("plugins.sources.manage") || "Manage sources"
      }}</v-tab>
    </v-tabs>

    <v-window v-model="sourceTab" class="mt-4">
      <v-window-item value="browse">
        <PluginDiscoverTab ref="browseRef" />
      </v-window-item>
      <v-window-item value="manage">
        <PluginMarketplacesTab @changed="onMarketplacesChanged" />
      </v-window-item>
    </v-window>
  </div>
</template>
