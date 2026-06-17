<template>
  <div v-if="detail.mcpServers.length === 0" class="text-grey pa-4">
    No MCP servers in this plugin.
  </div>
  <v-list v-else lines="two">
    <v-list-item v-for="s in detail.mcpServers" :key="s.name">
      <v-list-item-title>
        {{ s.name }}
        <v-chip size="x-small" class="ml-2">{{ s.transport }}</v-chip>
      </v-list-item-title>
      <v-list-item-subtitle>
        <v-switch
          :model-value="s.enabled"
          color="success"
          hide-details
          density="compact"
          :label="t('plugins.enabled_label')"
          @update:model-value="(v) => toggleServer(s, v === true)"
        />
      </v-list-item-subtitle>
    </v-list-item>
  </v-list>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PluginDetail, PluginMcpServerComponent } from "@/views/api/plugins";
import { togglePluginMcpServer } from "@/views/api/plugins";

const props = defineProps<{ detail: PluginDetail }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();

async function toggleServer(
  _s: PluginMcpServerComponent,
  _enabled: boolean
): Promise<void> {
  // Component-level toggling requires a serverId; the detail payload exposes
  // names but not ids in v1. Disabled state is tracked at the plugin level
  // until the detail payload carries serverId. Emit changed to refresh.
  emit("changed");
}
</script>
