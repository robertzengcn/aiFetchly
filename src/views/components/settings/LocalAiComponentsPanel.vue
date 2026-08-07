<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2">mdi-chip</v-icon>
      {{ t('localAiRuntime.title') }}
      <v-spacer />
      <v-btn
        size="small"
        variant="text"
        :loading="refreshing"
        :aria-label="t('localAiRuntime.check_update')"
        @click="refresh"
      >
        <v-icon left>mdi-refresh</v-icon>
        {{ t('localAiRuntime.check_update') }}
      </v-btn>
    </v-card-title>

    <v-card-text>
      <v-alert
        v-if="lastError"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        {{ lastError }}
      </v-alert>

      <div v-for="row in rows" :key="row.runtimeId" class="mb-4">
        <div class="d-flex align-center mb-1">
          <strong>{{ runtimeTitle(row.runtimeId) }}</strong>
          <v-chip
            size="x-small"
            class="ml-2"
            :color="stateColor(row.status.state)"
            variant="tonal"
          >
            {{ stateLabel(row.status.state) }}
          </v-chip>
          <span v-if="row.status.installedVersion" class="text-medium-emphasis ml-2 text-caption">
            {{ t('localAiRuntime.version') }} {{ row.status.installedVersion }}
          </span>
          <v-spacer />
          <div class="d-flex ga-1">
            <v-btn
              v-if="canInstall(row.status.state)"
              size="small"
              color="primary"
              variant="outlined"
              :loading="row.busy"
              :disabled="row.busy"
              @click="onInstall(row)"
            >
              {{ t('localAiRuntime.install') }}
            </v-btn>
            <v-btn
              v-if="row.status.state === 'ready' || row.status.state === 'corrupted'"
              size="small"
              variant="outlined"
              :loading="row.busy"
              :disabled="row.busy"
              @click="onRepair(row)"
            >
              {{ t('localAiRuntime.repair') }}
            </v-btn>
            <v-btn
              v-if="row.status.installedVersion"
              size="small"
              color="error"
              variant="text"
              :loading="row.busy"
              :disabled="row.busy"
              :aria-label="t('localAiRuntime.remove')"
              @click="onRemove(row)"
            >
              <v-icon left>mdi-delete</v-icon>
              {{ t('localAiRuntime.remove') }}
            </v-btn>
          </div>
        </div>

        <div v-if="row.status.archiveSizeBytes || row.status.installedSizeBytes" class="text-caption text-medium-emphasis mb-1">
          <span v-if="row.status.archiveSizeBytes">
            {{ t('localAiRuntime.download_size') }}: {{ formatBytes(row.status.archiveSizeBytes) }}
          </span>
          <span v-if="row.status.installedSizeBytes" class="ml-3">
            {{ t('localAiRuntime.installed_size') }}: {{ formatBytes(row.status.installedSizeBytes) }}
          </span>
        </div>

        <v-progress-linear
          v-if="row.progress && isActiveProgress(row.progress.phase)"
          :model-value="row.progress.percent ?? 0"
          height="8"
          color="primary"
          rounded
          class="mb-1"
        />
        <div v-if="row.progress && isActiveProgress(row.progress.phase)" class="text-caption">
          {{ phaseLabel(row.progress.phase) }}
          <span v-if="row.progress.totalBytes" class="ml-2">
            {{ formatBytes(row.progress.downloadedBytes ?? 0) }} / {{ formatBytes(row.progress.totalBytes) }}
          </span>
          <v-btn
            v-if="row.progress.phase === 'downloading'"
            size="x-small"
            variant="text"
            class="ml-2"
            @click="onCancel(row)"
          >
            {{ t('localAiRuntime.cancel') }}
          </v-btn>
        </div>
      </div>
    </v-card-text>

    <v-dialog v-model="confirmDialog" max-width="520">
      <v-card>
        <v-card-text>{{ confirmMessage }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dismissConfirm(false)">{{ t('localAiRuntime.cancel') }}</v-btn>
          <v-btn color="primary" @click="dismissConfirm(true)">{{ confirmActionLabel }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import {
  listLocalAiRuntimes,
  prepareLocalAiRuntimeInstall,
  installLocalAiRuntime,
  cancelLocalAiRuntimeInstall,
  checkLocalAiRuntimeUpdate,
  repairLocalAiRuntime,
  removeLocalAiRuntime,
  onLocalAiRuntimeProgress,
} from "@/views/api/localAiRuntime";
import type {
  LocalAiRuntimeDownloadPhase,
  LocalAiRuntimeDownloadProgress,
  LocalAiRuntimeId,
  LocalAiRuntimeInstallOffer,
  LocalAiRuntimeStatus,
} from "@/entityTypes/localAiRuntimeTypes";

const { t } = useI18n();

interface RuntimeRow {
  runtimeId: LocalAiRuntimeId;
  status: LocalAiRuntimeStatus;
  progress?: LocalAiRuntimeDownloadProgress;
  busy: boolean;
}

const rows = reactive<RuntimeRow[]>([]);
const refreshing = ref(false);
const lastError = ref("");
const confirmDialog = ref(false);
const confirmMessage = ref("");
const confirmActionLabel = ref("");
let confirmResolver: ((ok: boolean) => void) | null = null;

let unsubscribeProgress: (() => void) | null = null;

function runtimeTitle(id: LocalAiRuntimeId): string {
  return id === "embedding-xenova"
    ? t("localAiRuntime.embedding_title")
    : t("localAiRuntime.voice_title");
}

function stateLabel(state: LocalAiRuntimeStatus["state"]): string {
  const key = `localAiRuntime.${state}`;
  const fallback = state.replace(/_/g, " ");
  return (t(key) as string) || fallback;
}

function stateColor(state: LocalAiRuntimeStatus["state"]): string {
  switch (state) {
    case "ready":
      return "success";
    case "incompatible":
    case "corrupted":
    case "error":
      return "error";
    case "update_available":
      return "info";
    case "download_required":
      return "warning";
    default:
      return "default";
  }
}

function phaseLabel(phase: LocalAiRuntimeDownloadPhase): string {
  const key = `localAiRuntime.${phase}`;
  return (t(key) as string) || phase;
}

function isActiveProgress(phase: LocalAiRuntimeDownloadPhase): boolean {
  return (
    phase === "downloading" ||
    phase === "verifying" ||
    phase === "extracting" ||
    phase === "testing" ||
    phase === "activating" ||
    phase === "resolving"
  );
}

function canInstall(state: LocalAiRuntimeStatus["state"]): boolean {
  return state === "not_installed" || state === "download_required" || state === "incompatible";
}

function formatBytes(bytes?: number): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function errorMessageFor(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Best-effort mapping to localized strings.
  if (/checksum|integrity/i.test(message)) return t("localAiRuntime.errors.checksum_mismatch") as string;
  if (/safety|unsafe|archive/i.test(message)) return t("localAiRuntime.errors.archive_unsafe") as string;
  if (/health/i.test(message)) return t("localAiRuntime.errors.health_check_failed") as string;
  if (/busy|in progress/i.test(message)) return t("localAiRuntime.errors.busy") as string;
  if (/catalog/i.test(message)) return t("localAiRuntime.errors.catalog_unavailable") as string;
  if (/compatible|incompat/i.test(message)) return t("localAiRuntime.errors.incompatible") as string;
  if (/download/i.test(message)) return t("localAiRuntime.errors.download_failed") as string;
  return message;
}

function setRow(id: LocalAiRuntimeId, patch: Partial<RuntimeRow>): void {
  const row = rows.find((r) => r.runtimeId === id);
  if (row) Object.assign(row, patch);
}

async function refresh(): Promise<void> {
  refreshing.value = true;
  try {
    const statuses = await listLocalAiRuntimes();
    rows.splice(
      0,
      rows.length,
      ...statuses.map<RuntimeRow>((status) => ({
        runtimeId: status.runtimeId,
        status,
        busy: false,
      })),
    );
    // Best-effort background update check (does not auto-download).
    for (const row of rows) {
      checkLocalAiRuntimeUpdate(row.runtimeId)
        .then((offer) => {
          if (offer) {
            row.status = { ...row.status, state: "update_available", availableVersion: offer.availableVersion };
          }
        })
        .catch(() => undefined);
    }
  } catch (error) {
    lastError.value = errorMessageFor(error);
  } finally {
    refreshing.value = false;
  }
}

function askConfirm(message: string, actionLabel: string): Promise<boolean> {
  confirmMessage.value = message;
  confirmActionLabel.value = actionLabel;
  confirmDialog.value = true;
  return new Promise<boolean>((resolve) => {
    confirmResolver = resolve;
  });
}

function dismissConfirm(ok: boolean): void {
  confirmDialog.value = false;
  if (confirmResolver) {
    confirmResolver(ok);
    confirmResolver = null;
  }
}

async function onInstall(row: RuntimeRow): Promise<void> {
  lastError.value = "";
  try {
    const offer: LocalAiRuntimeInstallOffer = await prepareLocalAiRuntimeInstall(row.runtimeId);
    const confirm = await askConfirm(
      `${t("localAiRuntime.install_confirm")} (${formatBytes(offer.archiveSizeBytes)})`,
      t("localAiRuntime.install") as string,
    );
    if (!confirm) return;
    row.busy = true;
    await installLocalAiRuntime({
      operationId: offer.operationId,
      runtimeId: offer.runtimeId,
      expectedRuntimeVersion: offer.runtimeVersion,
      consentToken: offer.consentToken,
    });
    await refresh();
  } catch (error) {
    lastError.value = errorMessageFor(error);
  } finally {
    row.busy = false;
  }
}

async function onRepair(row: RuntimeRow): Promise<void> {
  lastError.value = "";
  row.busy = true;
  try {
    await repairLocalAiRuntime(row.runtimeId);
    await refresh();
  } catch (error) {
    lastError.value = errorMessageFor(error);
  } finally {
    row.busy = false;
  }
}

async function onRemove(row: RuntimeRow): Promise<void> {
  lastError.value = "";
  const confirm = await askConfirm(t("localAiRuntime.remove_confirm") as string, t("localAiRuntime.remove") as string);
  if (!confirm) return;
  row.busy = true;
  try {
    await removeLocalAiRuntime(row.runtimeId, false);
    await refresh();
  } catch (error) {
    lastError.value = errorMessageFor(error);
  } finally {
    row.busy = false;
  }
}

function onCancel(row: RuntimeRow): void {
  if (row.progress) {
    cancelLocalAiRuntimeInstall(row.progress.operationId).catch((error: unknown) => {
      lastError.value = errorMessageFor(error);
    });
  }
}

onMounted(() => {
  refresh();
  unsubscribeProgress = onLocalAiRuntimeProgress((progress) => {
    setRow(progress.runtimeId, { progress });
    if (progress.phase === "done" || progress.phase === "error" || progress.phase === "cancelled") {
      if (progress.phase === "error") {
        lastError.value = errorMessageFor(progress.errorMessage ?? "download failed");
      }
      // Refresh status when the operation settles.
      refresh();
    }
  });
});

onBeforeUnmount(() => {
  if (unsubscribeProgress) {
    unsubscribeProgress();
    unsubscribeProgress = null;
  }
});
</script>

<style scoped>
.ga-1 {
  gap: 4px;
}
</style>
