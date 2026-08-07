<template>
  <v-table v-if="detail.agents && detail.agents.length > 0">
    <thead>
      <tr>
        <th>{{ t("subagents.column_agent") }}</th>
        <th>{{ t("subagents.column_mode") }}</th>
        <th>{{ t("subagents.column_tools") }}</th>
        <th>{{ t("subagents.column_health") }}</th>
        <th>{{ t("subagents.column_status") }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="a in detail.agents" :key="a.id">
        <td>
          <div>{{ a.name }}</div>
          <div class="text-grey text-caption">{{ a.id }}</div>
        </td>
        <td>{{ a.mode }}</td>
        <td>{{ a.toolCount }}</td>
        <td>
          <v-chip
            :color="a.health === 'healthy' ? 'success' : 'warning'"
            size="small"
          >
            {{ a.health }}
          </v-chip>
        </td>
        <td>
          <v-switch
            :model-value="a.enabled"
            color="success"
            hide-details
            density="compact"
            @update:model-value="(v) => onToggle(a.id, v === true)"
          />
        </td>
      </tr>
    </tbody>
  </v-table>
  <div v-else class="text-grey pa-4">
    {{ t("subagents.plugin_empty") }}
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PluginDetail } from "@/views/api/plugins";
import { toggleAgentDefinition } from "@/views/api/agents";

defineProps<{ detail: PluginDetail }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();

async function onToggle(agentId: string, enabled: boolean): Promise<void> {
  await toggleAgentDefinition(agentId, enabled);
  emit("changed");
}
</script>
