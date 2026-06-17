<template>
  <v-dialog
    :model-value="true"
    @update:model-value="$emit('close')"
    max-width="900"
  >
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ detail?.displayName || detail?.name || name }}</span>
        <v-btn icon size="small" variant="text" @click="$emit('close')">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text v-if="!detail"> Loading… </v-card-text>
      <v-card-text v-else>
        <v-tabs v-model="tab">
          <v-tab value="overview">{{ t("plugins.tab_overview") }}</v-tab>
          <v-tab value="skills">{{ t("plugins.tab_skills") }}</v-tab>
          <v-tab value="mcp">{{ t("plugins.tab_mcp_servers") }}</v-tab>
          <v-tab value="permissions">{{ t("plugins.tab_permissions") }}</v-tab>
          <v-tab value="diagnostics">{{ t("plugins.tab_diagnostics") }}</v-tab>
          <v-tab value="manifest">{{ t("plugins.tab_manifest") }}</v-tab>
        </v-tabs>
        <v-window v-model="tab" class="mt-4">
          <v-window-item value="overview">
            <PluginOverviewTab :detail="detail" />
          </v-window-item>
          <v-window-item value="skills">
            <PluginSkillsTab :detail="detail" @changed="reload" />
          </v-window-item>
          <v-window-item value="mcp">
            <PluginMcpServersTab :detail="detail" @changed="reload" />
          </v-window-item>
          <v-window-item value="permissions">
            <PluginPermissionsTab :detail="detail" />
          </v-window-item>
          <v-window-item value="diagnostics">
            <PluginDiagnosticsTab :name="name" />
          </v-window-item>
          <v-window-item value="manifest">
            <PluginManifestTab :detail="detail" />
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getPlugin, type PluginDetail } from "@/views/api/plugins";
import PluginOverviewTab from "./PluginOverviewTab.vue";
import PluginSkillsTab from "./PluginSkillsTab.vue";
import PluginMcpServersTab from "./PluginMcpServersTab.vue";
import PluginPermissionsTab from "./PluginPermissionsTab.vue";
import PluginDiagnosticsTab from "./PluginDiagnosticsTab.vue";
import PluginManifestTab from "./PluginManifestTab.vue";

const props = defineProps<{ name: string }>();
defineEmits<{ close: [] }>();

const { t } = useI18n();
const detail = ref<PluginDetail | null>(null);
const tab = ref("overview");

async function reload(): Promise<void> {
  detail.value = await getPlugin(props.name);
}

watch(() => props.name, reload);
onMounted(reload);
</script>
