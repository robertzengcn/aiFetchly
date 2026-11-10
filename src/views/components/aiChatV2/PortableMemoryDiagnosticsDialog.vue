<template>
  <v-dialog
    :model-value="open"
    max-width="640"
    scrollable
    @update:model-value="
      (v: boolean) => {
        if (!v) emit('cancel');
      }
    "
  >
    <v-card>
      <v-card-title class="pmd__title">{{ titleText }}</v-card-title>

      <v-card-text v-if="loading" class="pmd__loading">{{ loadingText }}</v-card-text>

      <v-card-text v-else-if="diagnostics.length === 0" class="pmd__empty">
        {{ emptyText }}
      </v-card-text>

      <v-card-text v-else>
        <div
          v-for="d in diagnostics"
          :key="`${d.code}:${d.relativePath}`"
          class="pmd__row"
        >
          <v-chip
            size="x-small"
            :color="severityColor(d.code)"
            variant="tonal"
            class="mr-2"
          >
            {{ codeLabel(d.code) }}
          </v-chip>
          <code class="pmd__path">{{ d.relativePath }}</code>
          <div class="pmd__message">{{ d.message }}</div>
          <v-chip
            v-if="!d.recoverable"
            size="x-small"
            color="error"
            variant="outlined"
            class="ml-2"
          >
            {{ notRecoverableText }}
          </v-chip>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('cancel')">{{ closeText }}</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="rescanning"
          @click="onRescan"
        >
          {{ rescanText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { portableWorkspaceMemoryApi } from "@/views/api/portableWorkspaceMemory";
import type { PortableMemoryDiagnosticView } from "@/entityTypes/portableWorkspaceMemoryTypes";

const props = defineProps<{
  open: boolean;
  conversationId: string;
}>();

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "rescanned"): void;
}>();

const { t } = useI18n();

function tr(key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

const loading = ref(false);
const rescanning = ref(false);
const diagnostics = ref<PortableMemoryDiagnosticView[]>([]);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    loading.value = true;
    diagnostics.value = [];
    try {
      const resp = await portableWorkspaceMemoryApi.diagnostics(
        props.conversationId
      );
      if (resp.status && resp.data) {
        diagnostics.value = resp.data;
      }
    } catch {
      // advisory only
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);

async function onRescan(): Promise<void> {
  rescanning.value = true;
  try {
    await portableWorkspaceMemoryApi.rescan(props.conversationId);
    const resp = await portableWorkspaceMemoryApi.diagnostics(
      props.conversationId
    );
    if (resp.status && resp.data) diagnostics.value = resp.data;
    emit("rescanned");
  } finally {
    rescanning.value = false;
  }
}

function severityColor(code: PortableMemoryDiagnosticView["code"]): string {
  if (code === "memory-secret-rejected" || code === "memory-symlink-rejected")
    return "error";
  if (code === "memory-conflict") return "deep-orange";
  if (code === "workspace-identity-invalid") return "error";
  return "warning";
}

function codeLabel(code: PortableMemoryDiagnosticView["code"]): string {
  return tr(`portableMemory.diag.${code}`, code);
}

const titleText = computed(() =>
  tr("portableMemory.diagnosticsTitle", "Portable memory diagnostics")
);
const loadingText = computed(() =>
  tr("portableMemory.loadingDiagnostics", "Loading diagnostics…")
);
const emptyText = computed(() =>
  tr("portableMemory.noDiagnostics", "No diagnostics. All portable memory files are valid.")
);
const closeText = computed(() => tr("common.close", "Close"));
const rescanText = computed(() => tr("portableMemory.rescan", "Rescan"));
const notRecoverableText = computed(() =>
  tr("portableMemory.notRecoverable", "not recoverable")
);
</script>

<style scoped>
.pmd__title {
  font-weight: 600;
}
.pmd__row {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 8px 0;
}
.pmd__path {
  font-size: 11px;
  word-break: break-all;
}
.pmd__message {
  font-size: 13px;
  margin-top: 4px;
}
</style>
