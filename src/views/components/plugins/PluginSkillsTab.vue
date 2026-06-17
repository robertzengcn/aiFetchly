<template>
  <v-table v-if="detail.skills.length > 0">
    <thead>
      <tr>
        <th>{{ t("plugins.column_plugin") }}</th>
        <th>{{ t("plugins.column_status") }}</th>
        <th>{{ t("plugins.column_actions") }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="s in detail.skills" :key="s.name">
        <td>{{ s.name }}</td>
        <td>
          <v-chip :color="s.health === 'healthy' ? 'success' : 'error'" size="small">
            {{ s.health }}
          </v-chip>
        </td>
        <td>
          <v-switch
            :model-value="s.enabled"
            color="success"
            hide-details
            density="compact"
            @update:model-value="(v) => onToggle(s.name, v === true)"
          />
        </td>
      </tr>
    </tbody>
  </v-table>
  <div v-else class="text-grey pa-4">No skills in this plugin.</div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PluginDetail } from "@/views/api/plugins";
import { togglePluginSkill } from "@/views/api/plugins";

const props = defineProps<{ detail: PluginDetail }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();

async function onToggle(skillName: string, enabled: boolean): Promise<void> {
  await togglePluginSkill(skillName, enabled);
  emit("changed");
}
</script>
