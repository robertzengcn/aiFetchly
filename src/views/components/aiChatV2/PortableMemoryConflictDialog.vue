<template>
  <v-dialog
    :model-value="open"
    max-width="780"
    scrollable
    @update:model-value="
      (v: boolean) => {
        if (!v) emit('cancel');
      }
    "
  >
    <v-card>
      <v-card-title class="pmc__title">
        {{ titleText }}
        <span class="pmc__subtitle">{{ memory?.relativePath }}</span>
      </v-card-title>

      <v-card-text v-if="loading" class="pmc__loading">{{ loadingText }}</v-card-text>

      <v-card-text v-else-if="!conflict" class="pmc__empty">
        {{ noConflictText }}
      </v-card-text>

      <template v-else>
        <v-alert type="warning" variant="tonal" density="compact" class="mb-3">
          {{ warningText }}
        </v-alert>

        <!-- Two-pane comparison: last valid projection vs current file -->
        <div class="pmc__panes">
          <div class="pmc__pane">
            <div class="pmc__pane-title">{{ aiFetchlyVersionText }}</div>
            <pre class="pmc__pane-body">{{ aiFetchlyProjectionText }}</pre>
          </div>
          <div class="pmc__pane">
            <div class="pmc__pane-title">{{ fileVersionText }}</div>
            <pre class="pmc__pane-body">{{
              conflict.currentFileContent || fileAbsentText
            }}</pre>
          </div>
        </div>

        <!-- Merge editor (only shown for merge action) -->
        <div v-if="action === 'merge'" class="pmc__merge">
          <div class="pmc__section-title">{{ mergeTitleText }}</div>
          <v-text-field
            v-model="mergeTitle"
            :label="mergeTitleLabel"
            density="compact"
            hide-details
          />
          <v-textarea
            v-model="mergeContent"
            :label="mergeContentLabel"
            density="compact"
            rows="4"
            hide-details
            class="mt-2"
          />
          <v-select
            v-model="mergeType"
            :items="typeItems"
            :label="typeLabel"
            density="compact"
            hide-details
            class="mt-2"
          />
          <v-select
            v-model="mergeStatus"
            :items="statusItems"
            :label="statusLabel"
            density="compact"
            hide-details
            class="mt-2"
          />
          <v-select
            v-model="mergeVisibility"
            :items="visibilityItems"
            :label="visibilityLabel"
            density="compact"
            hide-details
            class="mt-2"
          />
          <v-text-field
            v-model.number="mergeConfidence"
            type="number"
            :label="confidenceLabel"
            density="compact"
            hide-details
            class="mt-2"
          />
        </div>

        <v-radio-group v-model="action" density="compact" hide-details class="mt-3">
          <v-radio :value="'use-file'" :label="useFileText" />
          <v-radio :value="'use-app'" :label="useAiFetchlyText" />
          <v-radio :value="'merge'" :label="mergeText" />
        </v-radio-group>
      </template>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="resolving" @click="emit('cancel')">{{
          cancelText
        }}</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="resolving"
          :disabled="loading || !conflict || (action === 'merge' && !mergeValid)"
          @click="onResolve"
        >
          {{ resolveText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { portableWorkspaceMemoryApi } from "@/views/api/portableWorkspaceMemory";
import type { PortableMemoryConflictView } from "@/views/api/portableWorkspaceMemory";

const props = defineProps<{
  open: boolean;
  conversationId: string;
  memoryId: string | null;
}>();

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "resolved"): void;
}>();

const { t } = useI18n();

function tr(key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

const loading = ref(false);
const resolving = ref(false);
const conflict = ref<PortableMemoryConflictView | null>(null);

const action = ref<"use-file" | "use-app" | "merge">("use-file");
const mergeTitle = ref("");
const mergeContent = ref("");
const mergeType = ref<"project" | "decision" | "workflow" | "convention" | "reference" | "warning">("decision");
const mergeStatus = ref<"active" | "archived" | "contradicted">("active");
const mergeVisibility = ref<"local" | "team">("local");
const mergeConfidence = ref<number>(90);

const memory = computed(() => conflict.value);

const typeItems = computed(() => [
  { title: tr("portableMemory.typeProject", "Project"), value: "project" },
  { title: tr("portableMemory.typeDecision", "Decision"), value: "decision" },
  { title: tr("portableMemory.typeWorkflow", "Workflow"), value: "workflow" },
  { title: tr("portableMemory.typeConvention", "Convention"), value: "convention" },
  { title: tr("portableMemory.typeReference", "Reference"), value: "reference" },
  { title: tr("portableMemory.typeWarning", "Warning"), value: "warning" },
]);
const statusItems = computed(() => [
  { title: tr("portableMemory.statusActive", "Active"), value: "active" },
  { title: tr("portableMemory.statusArchived", "Archived"), value: "archived" },
  { title: tr("portableMemory.statusContradicted", "Contradicted"), value: "contradicted" },
]);
const visibilityItems = computed(() => [
  { title: tr("portableMemory.visibilityLocal", "Local only"), value: "local" },
  { title: tr("portableMemory.visibilityTeam", "Team shareable"), value: "team" },
]);

const mergeValid = computed(() => {
  return (
    mergeTitle.value.trim().length >= 1 &&
    mergeTitle.value.trim().length <= 200 &&
    mergeContent.value.trim().length >= 1 &&
    mergeContent.value.trim().length <= 8000
  );
});

// Load the conflict on open.
watch(
  () => [props.open, props.memoryId] as const,
  async ([open, id]) => {
    if (!open || !id) return;
    loading.value = true;
    conflict.value = null;
    try {
      const resp = await portableWorkspaceMemoryApi.conflictsList(
        props.conversationId
      );
      if (resp.status && resp.data) {
        conflict.value =
          resp.data.find((c) => c.memoryId === id) ?? null;
        // Seed the merge editor with the current file content if parseable.
        if (conflict.value?.currentFileContent) {
          seedMergeFromContent(conflict.value.currentFileContent);
        }
      }
    } catch {
      // non-fatal; the empty state surfaces
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);

function seedMergeFromContent(content: string): void {
  // Best-effort extraction: first H1 as title, rest as content.
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const h1Idx = lines.findIndex((l) => /^#\s+/.test(l));
  if (h1Idx >= 0) {
    mergeTitle.value = lines[h1Idx].replace(/^#\s+/, "").trim();
    const rest = lines.slice(h1Idx + 1);
    const bodyStart = rest.findIndex((l) => l.trim() !== "");
    mergeContent.value = rest.slice(bodyStart >= 0 ? bodyStart : 0).join("\n").trim();
  } else {
    mergeContent.value = content.trim();
  }
}

async function onResolve(): Promise<void> {
  if (!conflict.value) return;
  resolving.value = true;
  try {
    const resp = await portableWorkspaceMemoryApi.resolveConflict({
      conversationId: props.conversationId,
      memoryId: conflict.value.memoryId,
      action: action.value,
      ...(action.value === "use-app" || action.value === "merge"
        ? {
            mergedDocument: {
              title: mergeTitle.value,
              content: mergeContent.value,
              type: mergeType.value,
              status: mergeStatus.value,
              confidence: mergeConfidence.value,
              visibility: mergeVisibility.value,
            },
          }
        : {}),
    });
    if (resp.status) {
      emit("resolved");
    }
  } finally {
    resolving.value = false;
  }
}

// i18n strings (fallback-enabled).
const titleText = computed(() => tr("portableMemory.conflictTitle", "Resolve conflict"));
const loadingText = computed(() => tr("portableMemory.loadingConflict", "Loading conflict…"));
const noConflictText = computed(() => tr("portableMemory.noConflict", "No conflict found."));
const warningText = computed(() =>
  tr(
    "portableMemory.conflictWarning",
    "The memory file was edited externally between your read and save. Choose a version to keep."
  )
);
const aiFetchlyVersionText = computed(() => tr("portableMemory.aiFetchlyVersion", "AiFetchly projection"));
const fileVersionText = computed(() => tr("portableMemory.fileVersion", "Current file"));
const aiFetchlyProjectionText = computed(() =>
  conflict.value?.message ?? ""
);
const fileAbsentText = computed(() => tr("portableMemory.fileAbsent", "(file absent)"));
const mergeTitleText = computed(() => tr("portableMemory.mergeEditor", "Merge editor"));
const mergeTitleLabel = computed(() => tr("portableMemory.title", "Title"));
const mergeContentLabel = computed(() => tr("portableMemory.content", "Content"));
const typeLabel = computed(() => tr("portableMemory.type", "Type"));
const statusLabel = computed(() => tr("portableMemory.status", "Status"));
const visibilityLabel = computed(() => tr("portableMemory.visibility", "Visibility"));
const confidenceLabel = computed(() => tr("portableMemory.confidence", "Confidence"));
const useFileText = computed(() => tr("portableMemory.actionUseFile", "Use file version"));
const useAiFetchlyText = computed(() => tr("portableMemory.actionUseAiFetchly", "Use AiFetchly version"));
const mergeText = computed(() => tr("portableMemory.actionMerge", "Merge manually"));
const cancelText = computed(() => tr("common.cancel", "Cancel"));
const resolveText = computed(() => tr("portableMemory.resolve", "Resolve"));
</script>

<style scoped>
.pmc__title {
  display: flex;
  flex-direction: column;
}
.pmc__subtitle {
  font-size: 12px;
  opacity: 0.7;
  font-weight: 400;
}
.pmc__panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}
.pmc__pane {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  padding: 8px;
  max-height: 220px;
  overflow: auto;
}
.pmc__pane-title {
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 4px;
}
.pmc__pane-body {
  font-family: monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.pmc__section-title {
  font-weight: 600;
  margin: 8px 0 4px;
}
</style>
