<template>
  <v-card class="diagnostics-section" variant="outlined">
    <v-card-title>{{ t('diagnostics.title') || 'Diagnostics' }}</v-card-title>
    <v-card-text>
      <div class="mb-3">
        {{ t('diagnostics.storageUsage') || 'Storage used:' }}
        {{ formatBytes(status?.storageBytes ?? 0) }} / {{ formatBytes(status?.budgetBytes ?? 0) }}
        <v-btn size="small" variant="text" @click="refresh">
          {{ t('diagnostics.refresh') || 'Refresh' }}
        </v-btn>
      </div>

      <v-switch
        v-model="debugEnabled"
        :label="t('diagnostics.enableDebug') || 'Enable debug logging (auto-disables in 24h)'"
        color="primary"
        hide-details
        @update:model-value="onToggleDebug"
      />
      <div v-if="status?.debugExpiresAt" class="caption">
        {{ t('diagnostics.debugExpiresAt') || 'Expires at:' }} {{ status.debugExpiresAt }}
      </div>

      <v-switch
        v-model="consentUpload"
        :label="t('diagnostics.allowUpload') || 'Allow crash report uploads (manual send only)'"
        color="primary"
        hide-details
        @update:model-value="onToggleConsent"
      />

      <div class="mt-3 d-flex flex-wrap gap-2">
        <v-btn variant="outlined" @click="openFolder">
          {{ t('diagnostics.openFolder') || 'Open diagnostics folder' }}
        </v-btn>
        <v-btn variant="outlined" @click="exportReport">
          {{ t('diagnostics.exportReport') || 'Export diagnostic report' }}
        </v-btn>
        <v-btn variant="outlined" :disabled="!consentUpload" @click="openSendDialog">
          {{ t('diagnostics.sendReport') || 'Send crash report' }}
        </v-btn>
        <v-btn variant="text" color="error" @click="clearLocal">
          {{ t('diagnostics.clearLocal') || 'Clear local diagnostics' }}
        </v-btn>
      </div>
    </v-card-text>

    <v-dialog v-model="sendDialog" max-width="560">
      <v-card>
        <v-card-title>{{ t('diagnostics.selectCrash') || 'Select a crash to send' }}</v-card-title>
        <v-list>
          <v-list-item
            v-for="c in crashes"
            :key="c.crashId"
            :title="`${c.crashType} — ${c.message.slice(0, 80)}`"
            :subtitle="c.timestamp"
            @click="sendSelected(c.crashId)"
          />
        </v-list>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="sendDialog = false">{{ t('common.cancel') || 'Cancel' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  diagnosticsApi,
  type DiagnosticStatus,
  type DiagnosticCrashEntry,
} from '@/views/api/diagnostics';

const { t } = useI18n();

const status = ref<DiagnosticStatus | null>(null);
const debugEnabled = ref(false);
const consentUpload = ref(false);
const sendDialog = ref(false);
const crashes = ref<DiagnosticCrashEntry[]>([]);

async function refresh(): Promise<void> {
  status.value = await diagnosticsApi.getStatus();
  debugEnabled.value = !!status.value?.debugEnabled;
}

async function onToggleDebug(v: boolean | null): Promise<void> {
  await diagnosticsApi.setDebug(!!v);
  await refresh();
}

function onToggleConsent(v: boolean | null): void {
  consentUpload.value = !!v;
}

async function openFolder(): Promise<void> {
  await diagnosticsApi.openFolder();
}

async function exportReport(): Promise<void> {
  const r = await diagnosticsApi.exportReport();
  if (!r.path) {
    alert(t('diagnostics.exportFailed') || 'Export failed or cancelled.');
  }
}

async function openSendDialog(): Promise<void> {
  crashes.value = await diagnosticsApi.listCrashes();
  sendDialog.value = true;
}

async function sendSelected(crashId: string): Promise<void> {
  sendDialog.value = false;
  const r = await diagnosticsApi.uploadReport(crashId);
  if (r.reportId) {
    alert(t('diagnostics.sendSuccess') || 'Report sent. Thank you!');
  } else {
    alert((t('diagnostics.sendFailed') || 'Send failed:') + ' ' + (r.error ?? ''));
  }
}

async function clearLocal(): Promise<void> {
  if (!confirm(t('diagnostics.clearConfirm') || 'Clear all local diagnostics?')) return;
  await diagnosticsApi.clearLocal();
  await refresh();
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

onMounted(() => {
  void refresh();
});
</script>

<style scoped>
.diagnostics-section {
  margin: 16px 0;
}
.gap-2 {
  gap: 8px;
}
.caption {
  font-size: 12px;
  opacity: 0.7;
  margin-top: -8px;
  margin-bottom: 12px;
}
</style>
