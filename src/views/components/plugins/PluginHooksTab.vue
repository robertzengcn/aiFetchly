<template>
  <div>
    <v-table v-if="detail.hooks && detail.hooks.length > 0">
      <thead>
        <tr>
          <th>{{ t("plugins.column_hook") }}</th>
          <th>{{ t("plugins.column_event") }}</th>
          <th>{{ t("plugins.column_matcher") }}</th>
          <th>{{ t("plugins.column_type") }}</th>
          <th>{{ t("plugins.column_status") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="h in detail.hooks" :key="h.id">
          <td>
            <div>{{ h.id }}</div>
          </td>
          <td>{{ h.eventName }}</td>
          <td>
            <span v-if="h.matcher">{{ h.matcher }}</span>
            <span v-else class="text-grey">—</span>
          </td>
          <td>{{ h.type }}</td>
          <td>
            <v-chip :color="h.enabled ? 'success' : 'default'" size="small">
              {{ h.enabled ? t("plugins.enabled_label") : t("plugins.status_disabled") }}
            </v-chip>
          </td>
        </tr>
      </tbody>
    </v-table>
    <div v-else class="text-grey pa-4">
      {{ t("plugins.no_hooks") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PluginDetail } from "@/views/api/plugins";

defineProps<{ detail: PluginDetail }>();
const { t } = useI18n();
</script>
