<template>
  <v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" max-width="720">
    <v-card>
      <v-card-title>{{ detail ? (detail.displayName || detail.name) : "..." }}</v-card-title>
      <v-card-text v-if="detail">
        <p>{{ detail.description || "" }}</p>
        <p class="mt-2"><strong>{{ t("plugins.marketplace.column_marketplace") }}:</strong> {{ detail.marketplaceDisplayName || detail.marketplaceName }}</p>
        <p><strong>{{ t("plugins.column_version") }}:</strong> {{ detail.version || "—" }}</p>
        <p><strong>{{ t("plugins.marketplace.column_status") }}:</strong> <v-chip size="small" variant="tonal" :color="statusColor(detail.status)">{{ statusLabel(detail.status) }}</v-chip></p>
        <p v-if="detail.author"><strong>Author:</strong> {{ detail.author }}</p>
        <p v-if="detail.resolvedSourceKind"><strong>{{ t("plugins.install_source.source_kind") || "Source" }}:</strong> {{ detail.resolvedSourceKind }}<span v-if="detail.resolvedSourceUri"> · {{ detail.resolvedSourceUri }}</span></p>
        <p v-if="!detail.pinnedToCommit" class="text-warning">{{ t("plugins.marketplace.risk_unpinned_git") || "This plugin is not pinned to a commit." }}</p>

        <div v-if="riskFlags.length" class="mt-3">
          <v-chip v-for="f in riskFlags" :key="f" color="warning" size="small" class="mr-1">{{ riskLabel(f) }}</v-chip>
        </div>

        <v-checkbox v-if="canInstall" v-model="confirmRisk" :label="t('plugins.marketplace.confirm_risk') || 'I understand the risks and want to install.'" hide-details density="compact" />

        <v-alert v-if="errorMsg" type="error" variant="tonal" class="mt-3" closable @click:close="errorMsg = ''">
          {{ errorMsg }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">{{ t("common.cancel") || "Close" }}</v-btn>
        <v-btn v-if="detail?.status === 'installed'" disabled>
          {{ statusLabel("installed") }}
        </v-btn>
        <v-btn v-else color="primary" :disabled="!canInstall || (riskFlags.length > 0 && !confirmRisk)" :loading="installing" @click="doInstall">
          {{ installButtonLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getMarketplacePlugin, installMarketplacePlugin, type PluginMarketplacePluginDetail } from "@/views/api/pluginMarketplaces";

const props = defineProps<{ modelValue: boolean; pluginId: string | null }>();
const emit = defineEmits<{ "update:modelValue": [boolean]; installed: [] }>();
const { t } = useI18n();
const detail = ref<PluginMarketplacePluginDetail | null>(null);
const installing = ref(false);
const confirmRisk = ref(false);
const errorMsg = ref("");
type PluginMarketplaceStatus = PluginMarketplacePluginDetail["status"];

const riskFlags = computed<string[]>(() => {
  if (!detail.value) return [];
  const f: string[] = [];
  if (detail.value.capabilitySummary.hasMcpServers) f.push("mcp");
  if (detail.value.capabilitySummary.hasHooks) f.push("hooks");
  if (detail.value.capabilitySummary.hasMonitors) f.push("monitors");
  if (detail.value.sourceKind === "npm") f.push("npm");
  if (!detail.value.pinnedToCommit && (detail.value.sourceKind === "github" || detail.value.sourceKind === "url" || detail.value.sourceKind === "git")) f.push("unpinnedGit");
  return f;
});
const canInstall = computed<boolean>(() => {
  if (!detail.value) return false;
  return detail.value.status !== "installed" && detail.value.status !== "unsupported" && detail.value.status !== "error";
});
const installButtonLabel = computed<string>(() => {
  if (detail.value?.status === "different_version") {
    return t("plugins.marketplace.reinstall_button") || "Reinstall";
  }
  return t("plugins.marketplace.install_button") || "Install";
});
function riskLabel(f: string): string {
  const map: Record<string, string> = {
    mcp: t("plugins.marketplace.risk_mcp") || "MCP servers",
    hooks: t("plugins.marketplace.risk_hooks") || "Hooks",
    monitors: t("plugins.marketplace.risk_monitors") || "Monitors",
    npm: t("plugins.marketplace.risk_npm") || "Installs from npm",
    unpinnedGit: t("plugins.marketplace.risk_unpinned_git") || "Not pinned to commit",
  };
  return map[f] || f;
}
function statusLabel(status: PluginMarketplaceStatus): string {
  const labels: Record<PluginMarketplaceStatus, string> = {
    not_installed: t("plugins.marketplace.status_not_installed") || "Not installed",
    installed: t("plugins.marketplace.status_installed") || "Installed",
    different_version: t("plugins.marketplace.status_different_version") || "Different version installed",
    unsupported: t("plugins.marketplace.status_unsupported") || "Unsupported source",
    error: t("plugins.marketplace.status_error") || "Error",
  };
  return labels[status];
}
function statusColor(status: PluginMarketplaceStatus): string {
  const colors: Record<PluginMarketplaceStatus, string> = {
    not_installed: "default",
    installed: "success",
    different_version: "warning",
    unsupported: "default",
    error: "error",
  };
  return colors[status];
}
function asInstalledDetail(
  current: PluginMarketplacePluginDetail
): PluginMarketplacePluginDetail {
  return {
    ...current,
    installed: true,
    installedVersion: current.installedVersion ?? current.version,
    status: "installed",
  };
}

watch(() => [props.modelValue, props.pluginId], async ([open, id]) => {
  if (open && id) {
    errorMsg.value = "";
    confirmRisk.value = false;
    try {
      detail.value = await getMarketplacePlugin(id as string);
    } catch (e: unknown) {
      detail.value = null;
      errorMsg.value = e instanceof Error ? e.message : String(e);
    }
  }
}, { immediate: true });

async function doInstall(): Promise<void> {
  if (!detail.value) return;
  installing.value = true;
  errorMsg.value = "";
  try {
    const pluginId = detail.value.pluginId;
    await installMarketplacePlugin({ pluginId, overwrite: true });
    const updated = await getMarketplacePlugin(pluginId);
    detail.value =
      updated && updated.status !== "not_installed"
        ? updated
        : asInstalledDetail(detail.value);
    confirmRisk.value = false;
    emit("installed");
  } catch (e: unknown) {
    // windowInvoke throws on backend {status:false}; surface it to the user.
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    installing.value = false;
  }
}
</script>
