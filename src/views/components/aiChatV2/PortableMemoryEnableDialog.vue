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
      <v-card-title class="pm-enable__title">
        {{ titleText }}
      </v-card-title>

      <v-card-text v-if="loading" class="pm-enable__loading">
        {{ loadingText }}
      </v-card-text>

      <v-card-text v-else-if="loadError" class="pm-enable__error">
        {{ loadError }}
      </v-card-text>

      <template v-else>
        <!-- What will be created -->
        <div class="pm-enable__section">
          <div class="pm-enable__section-title">{{ plannedFilesText }}</div>
          <ul class="pm-enable__files">
            <li v-for="f in plannedFiles" :key="f">
              <code>{{ f }}</code>
            </li>
          </ul>
        </div>

        <!-- Existing state -->
        <v-alert
          v-if="existingRecords > 0"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ existingRecordsText }}: {{ existingRecords }}
        </v-alert>
        <v-alert
          v-if="identityState === 'invalid'"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ identityInvalidText }}
        </v-alert>

        <!-- Sharing mode -->
        <div class="pm-enable__section">
          <div class="pm-enable__section-title">{{ visibilityText }}</div>
          <v-radio-group v-model="visibility" density="compact" hide-details>
            <v-radio value="local">
              <template #label>
                <div>
                  <div>{{ visibilityLocalText }}</div>
                  <div class="pm-enable__hint">{{ visibilityLocalHint }}</div>
                </div>
              </template>
            </v-radio>
            <v-radio value="team">
              <template #label>
                <div>
                  <div>{{ visibilityTeamText }}</div>
                  <div class="pm-enable__hint">{{ visibilityTeamHint }}</div>
                </div>
              </template>
            </v-radio>
          </v-radio-group>
          <v-alert
            v-if="visibility === 'team'"
            type="warning"
            variant="tonal"
            density="compact"
          >
            {{ teamWarningText }}
          </v-alert>
        </div>

        <!-- Import policy -->
        <div class="pm-enable__section">
          <div class="pm-enable__section-title">{{ importPolicyText }}</div>
          <v-select
            v-model="importPolicy"
            :items="importPolicyItems"
            density="compact"
            hide-details
          />
        </div>

        <!-- Export existing memories -->
        <div class="pm-enable__section">
          <div class="pm-enable__section-title">{{ exportText }}</div>
          <v-radio-group v-model="exportScope" density="compact" hide-details>
            <v-radio :value="'none'" :label="exportNoneText" />
            <v-radio :value="'active'" :label="exportActiveText" />
            <v-radio :value="'all'" :label="exportAllText" />
          </v-radio-group>
        </div>

        <!-- Instruction bridges -->
        <div class="pm-enable__section">
          <div class="pm-enable__section-title">{{ bridgesText }}</div>
          <v-checkbox
            v-for="b in bridgeOptions"
            :key="b.target"
            v-model="b.selected"
            density="compact"
            hide-details
            :label="bridgeLabel(b.target)"
          />
          <div class="pm-enable__hint">{{ bridgesHint }}</div>
        </div>

        <!-- Git state -->
        <v-alert
          v-if="gitTrackingState && gitTrackingState !== 'unknown'"
          type="info"
          variant="tonal"
          density="compact"
        >
          {{ gitStateText }}: {{ gitTrackingState }}
        </v-alert>
      </template>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="applying" @click="emit('cancel')">{{
          cancelText
        }}</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="applying"
          :disabled="loading || !!loadError || identityState === 'invalid'"
          @click="onConfirm"
        >
          {{ enableText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { portableWorkspaceMemoryApi } from "@/views/api/portableWorkspaceMemory";
import type { PortableMemoryEnablePreviewView } from "@/views/api/portableWorkspaceMemory";

const props = defineProps<{
  open: boolean;
  conversationId: string;
}>();

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "enabled"): void;
}>();

const { t } = useI18n();

/** t() with a working fallback: vue-i18n returns the raw key when missing. */
function tr(key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

const loading = ref(false);
const loadError = ref("");
const applying = ref(false);
const preview = ref<PortableMemoryEnablePreviewView | null>(null);

const visibility = ref<"local" | "team">("local");
const importPolicy = ref<"automatic" | "review-new" | "review-all">(
  "review-new"
);
const exportScope = ref<"none" | "active" | "all">("active");
const bridgeOptions = ref<
  { target: "AGENTS.md" | "CLAUDE.md"; selected: boolean }[]
>([
  { target: "AGENTS.md", selected: false },
  { target: "CLAUDE.md", selected: false },
]);

const plannedFiles = computed(() => preview.value?.plannedFiles ?? []);
const existingRecords = computed(
  () => preview.value?.existingRecordCount ?? 0
);
const identityState = computed(
  () => preview.value?.identityState ?? "missing"
);
const gitTrackingState = computed(
  () => preview.value?.gitTrackingState ?? ""
);

const importPolicyItems = computed(() => [
  {
    title: tr("portableMemory.policyReviewNew", "Review new records"),
    value: "review-new",
  },
  {
    title: tr("portableMemory.policyAutomatic", "Import automatically"),
    value: "automatic",
  },
  {
    title: tr("portableMemory.policyReviewAll", "Review everything"),
    value: "review-all",
  },
]);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    loading.value = true;
    loadError.value = "";
    preview.value = null;
    try {
      const resp = await portableWorkspaceMemoryApi.enablePreview(
        props.conversationId
      );
      if (resp.status && resp.data) {
        preview.value = resp.data;
      } else {
        loadError.value = resp.msg || "Preview failed.";
      }
    } catch (err) {
      loadError.value = err instanceof Error ? err.message : "Preview failed.";
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);

async function onConfirm(): Promise<void> {
  applying.value = true;
  try {
    const resp = await portableWorkspaceMemoryApi.enable({
      conversationId: props.conversationId,
      defaultStorageMode:
        visibility.value === "team" ? "portable-team" : "portable-local",
      importPolicy: importPolicy.value,
      exportScope: exportScope.value,
      visibility: visibility.value,
      installBridges: bridgeOptions.value
        .filter((b) => b.selected)
        .map((b) => b.target),
    });
    if (resp.status) {
      emit("enabled");
    } else {
      loadError.value = resp.msg || "Enable failed.";
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : "Enable failed.";
  } finally {
    applying.value = false;
  }
}

const titleText = computed(
  () => tr("portableMemory.enableTitle", "Enable portable memory")
);
const loadingText = computed(
  () => tr("portableMemory.loadingPreview", "Loading preview…")
);
const plannedFilesText = computed(
  () => tr("portableMemory.plannedFiles", "Files that will be created")
);
const existingRecordsText = computed(
  () =>
    tr("portableMemory.existingRecords", "Existing memory files detected")
);
const identityInvalidText = computed(
  () =>
    tr("portableMemory.identityInvalid", "The workspace identity file is invalid. Fix or remove .aifetchly/workspace.json first.")
);
const visibilityText = computed(
  () => tr("portableMemory.visibility", "Sharing mode")
);
const visibilityLocalText = computed(
  () => tr("portableMemory.visibilityLocal", "Local only")
);
const visibilityLocalHint = computed(
  () =>
    tr("portableMemory.visibilityLocalHint", "Files stay on this machine; usually ignored in Git.")
);
const visibilityTeamText = computed(
  () => tr("portableMemory.visibilityTeam", "Team shareable")
);
const visibilityTeamHint = computed(
  () =>
    tr("portableMemory.visibilityTeamHint", "Files may be committed to Git for teammates and other agents.")
);
const teamWarningText = computed(
  () =>
    tr("portableMemory.teamWarning", "Committed memory stays in Git history even after later deletion. Review diffs before committing. The secret filter reduces risk but cannot catch every sensitive value.")
);
const importPolicyText = computed(
  () => tr("portableMemory.importPolicy", "External change review")
);
const exportText = computed(
  () => tr("portableMemory.exportExisting", "Export existing memories")
);
const exportNoneText = computed(
  () => tr("portableMemory.exportNone", "Do not export")
);
const exportActiveText = computed(
  () => tr("portableMemory.exportActive", "Export active memories")
);
const exportAllText = computed(
  () => tr("portableMemory.exportAll", "Export active and archived")
);
const bridgesText = computed(
  () => tr("portableMemory.bridges", "Agent instruction bridges")
);
const bridgesHint = computed(
  () =>
    tr("portableMemory.bridgesHint", "Optional managed blocks that tell agents like Claude Code and Codex to read the memory index.")
);
const gitStateText = computed(
  () => tr("portableMemory.gitState", "Git state")
);
const cancelText = computed(() => tr("common.cancel", "Cancel"));
const enableText = computed(
  () => tr("portableMemory.enableConfirm", "Enable")
);

function bridgeLabel(target: string): string {
  const bridge = preview.value?.bridges.find((b) => b.target === target);
  const action = bridge?.preview.action;
  const actionKey = `portableMemory.bridgeAction.${action ?? "create"}`;
  const translated = t(actionKey);
  const actionText =
    translated !== actionKey ? translated : (action ?? "create");
  return `${target} (${actionText})`;
}
</script>

<style scoped>
.pm-enable__section {
  margin-bottom: 12px;
}
.pm-enable__section-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.pm-enable__files {
  margin: 4px 0 0 16px;
  padding: 0;
}
.pm-enable__files code {
  font-size: 12px;
}
.pm-enable__hint {
  font-size: 12px;
  opacity: 0.75;
}
.pm-enable__error {
  color: rgb(var(--v-theme-error));
}
</style>
