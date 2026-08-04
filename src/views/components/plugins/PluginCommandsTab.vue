<template>
  <div>
    <v-table v-if="detail.commands && detail.commands.length > 0">
      <thead>
        <tr>
          <th>{{ t("plugins.column_command") }}</th>
          <th>{{ t("plugins.column_description") }}</th>
          <th>{{ t("plugins.column_aliases") }}</th>
          <th>{{ t("plugins.column_argument_hint") }}</th>
          <th>{{ t("plugins.column_status") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in detail.commands" :key="c.sourceId + ':' + c.name">
          <td>
            <div>/{{ c.name }}</div>
            <div class="text-grey text-caption">{{ c.sourceId }}</div>
          </td>
          <td>{{ c.description }}</td>
          <td>
            <span v-if="c.aliases && c.aliases.length > 0">
              {{ c.aliases.map((a) => "/" + a).join(", ") }}
            </span>
            <span v-else class="text-grey">—</span>
          </td>
          <td>
            <span v-if="c.argumentHint">{{ c.argumentHint }}</span>
            <span v-else class="text-grey">—</span>
          </td>
          <td>
            <v-chip
              :color="c.enabled ? 'success' : 'default'"
              size="small"
            >
              {{ c.enabled ? t("plugins.enabled_label") : t("plugins.status_disabled") }}
            </v-chip>
          </td>
        </tr>
      </tbody>
    </v-table>
    <div v-else class="text-grey pa-4">
      {{ t("plugins.no_commands") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PluginDetail } from "@/views/api/plugins";

defineProps<{ detail: PluginDetail }>();
const { t } = useI18n();
</script>
