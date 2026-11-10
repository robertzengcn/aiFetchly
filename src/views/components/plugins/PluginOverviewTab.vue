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
    <p>
      <strong>{{ t("plugins.command_count", { count: detail.commandCount }) }}</strong>
    </p>
    <p>
      <strong>{{ t("plugins.hook_count", { count: detail.hookCount }) }}</strong>
    </p>
    <p v-if="detail.author"><strong>Author:</strong> {{ detail.author }}</p>
    <p v-if="detail.sourceKind">
      <strong>
        {{
          t("plugins.install_source.source_kind") || "Install source"
        }}:
      </strong>
      {{ detail.sourceKind }}<span v-if="detail.sourceRef"> · {{ detail.sourceRef }}</span>
    </p>
    <p
      v-if="resolvedCommitSha"
      data-testid="plugin-resolved-revision"
      class="d-flex align-center"
    >
      <strong class="mr-1">{{ t("plugins.resolved_revision") }}:</strong>
      <code
        :aria-label="t('plugins.resolved_revision')"
        :title="resolvedCommitSha"
        >{{ shortResolvedCommitSha }}</code
      >
    </p>
    <p v-if="detail.marketplaceName">
      <strong>{{ t("plugins.marketplace.column_marketplace") || "Marketplace" }}:</strong>
      {{ detail.marketplaceName }}<span v-if="detail.entryName"> · {{ detail.entryName }}</span>
    </p>
    <p class="mt-2">{{ detail.description }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PluginDetail } from "@/views/api/plugins";

const props = defineProps<{ detail: PluginDetail }>();
const { t } = useI18n();

/** Trusted GitHub-archive provenance (US-06): the immutable commit the
 *  plugin was installed from. Fetcher-generated, so it cannot be spoofed
 *  by renderer input; undefined for non-archive sources. */
const resolvedCommitSha = computed<string | undefined>(() => {
  const raw = props.detail.sourceMeta?.resolvedCommitSha;
  return typeof raw === "string" && /^[0-9a-f]{40}$/i.test(raw)
    ? raw.toLowerCase()
    : undefined;
});
const shortResolvedCommitSha = computed(
  () => resolvedCommitSha.value?.slice(0, 7)
);
</script>
