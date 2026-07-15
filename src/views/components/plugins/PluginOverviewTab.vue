<template>
  <div>
    <p><strong>{{ t("plugins.column_version") }}:</strong> {{ detail.version }}</p>
    <p><strong>{{ t("plugins.column_source") }}:</strong> {{ detail.source }}</p>
    <p v-if="detail.sourceUri">
      <strong>{{ t("plugins.source_path_imported_from") }}:</strong>
      <code>{{ detail.sourceUri }}</code>
    </p>
    <p v-if="detail.installPath">
      <strong>{{ t("plugins.source_path_installed_at") }}:</strong>
      <code>{{ detail.installPath }}</code>
    </p>
    <p><strong>{{ t("plugins.column_status") }}:</strong> {{ detail.health }}</p>
    <p v-if="detail.author"><strong>Author:</strong> {{ detail.author }}</p>
    <p v-if="detail.sourceKind">
      <strong>
        {{
          t("plugins.install_source.source_kind") || "Install source"
        }}:
      </strong>
      {{ detail.sourceKind }}<span v-if="detail.sourceRef"> · {{ detail.sourceRef }}</span>
    </p>
    <p v-if="detail.marketplaceName">
      <strong>{{ t("plugins.marketplace.column_marketplace") || "Marketplace" }}:</strong>
      {{ detail.marketplaceName }}<span v-if="detail.entryName"> · {{ detail.entryName }}</span>
    </p>
    <p class="mt-2">{{ detail.description }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PluginDetail } from "@/views/api/plugins";

defineProps<{ detail: PluginDetail }>();
const { t } = useI18n();
</script>
