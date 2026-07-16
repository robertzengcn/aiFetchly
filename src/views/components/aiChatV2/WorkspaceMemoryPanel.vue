<template>
  <v-card class="wm-panel" flat>
    <div class="wm-panel__header">
      <span class="wm-panel__title">{{ panelTitle }}</span>
      <WorkspaceMemoryStatusBadge
        v-if="hasWorkspace"
        :count="activeCount"
        :running="autoDreamRunning"
        :failed="autoDreamFailed"
        class="ml-2"
      />
      <span v-if="autoDreamLastRunText" class="wm-panel__lastrun">{{
        autoDreamLastRunText
      }}</span>
      <v-spacer />
      <v-btn
        v-if="hasWorkspace"
        size="small"
        variant="tonal"
        :loading="autoDreamRunning"
        :disabled="autoDreamRunning"
        @click="onRunAutoDream"
      >
        {{ runAutoDreamText }}
      </v-btn>
      <v-btn
        v-if="hasWorkspace"
        size="small"
        color="primary"
        variant="flat"
        @click="openCreate"
      >
        {{ createText }}
      </v-btn>
    </div>

    <div v-if="!hasWorkspace" class="wm-panel__empty">
      <v-icon size="small" start>mdi-folder-off</v-icon>
      <span>{{ noWorkspaceText }}</span>
    </div>

    <template v-else>
      <div class="wm-panel__toolbar">
        <v-text-field
          v-model="search"
          :placeholder="searchPlaceholder"
          density="compact"
          hide-details
          prepend-inner-icon="mdi-magnify"
          clearable
          class="wm-panel__search"
        />
        <v-switch
          v-model="showArchived"
          :label="showArchivedText"
          density="compact"
          hide-details
          inset
          color="primary"
          class="wm-panel__archived-toggle"
        />
      </div>

      <div v-if="loading" class="wm-panel__empty">{{ loadingText }}</div>
      <div v-else-if="visibleMemories.length === 0" class="wm-panel__empty">
        <div>{{ emptyText }}</div>
        <div class="wm-panel__hint">{{ emptyHint }}</div>
      </div>

      <v-list v-else density="compact" class="wm-panel__list">
        <v-list-item
          v-for="m in visibleMemories"
          :key="m.memoryId"
          class="wm-panel__item"
        >
          <div class="wm-item">
            <div class="wm-item__head">
              <v-chip size="x-small" :color="typeColor(m.type)">{{
                typeLabel(m.type)
              }}</v-chip>
              <span class="wm-item__title">{{ m.title }}</span>
              <v-chip
                v-if="m.status !== 'active'"
                size="x-small"
                variant="outlined"
                >{{ statusLabel(m.status) }}</v-chip
              >
              <v-spacer />
              <span class="wm-item__meta">{{ formatSource(m) }}</span>
            </div>
            <div class="wm-item__content">{{ m.content }}</div>
            <div class="wm-item__foot">
              <span class="wm-item__date"
                >{{ updatedAtText }}: {{ formatDate(m.updatedAt) }}</span
              >
              <span v-if="m.lastUsedAt" class="wm-item__date"
                >· {{ lastUsedText }}: {{ formatDate(m.lastUsedAt) }}</span
              >
              <span class="wm-item__conf"
                >· {{ confidenceText }}: {{ m.confidence }}</span
              >
              <v-spacer />
              <v-btn size="x-small" variant="text" @click="openEdit(m)">{{
                editText
              }}</v-btn>
              <v-btn size="x-small" variant="text" @click="onArchive(m)">{{
                archiveText
              }}</v-btn>
              <v-btn
                size="x-small"
                variant="text"
                color="error"
                @click="onDelete(m)"
                >{{ deleteText }}</v-btn
              >
            </div>
          </div>
        </v-list-item>
      </v-list>
    </template>

    <WorkspaceMemoryEditorDialog
      v-model="editorOpen"
      :memory="editing"
      :default-type="createType"
      @save="onEditorSave"
      @cancel="editorOpen = false"
    />

    <v-dialog v-model="confirmOpen" max-width="420">
      <v-card>
        <v-card-text>{{ deleteConfirmText }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmOpen = false">{{
            cancelText
          }}</v-btn>
          <v-btn color="error" variant="flat" @click="confirmDelete">{{
            deleteText
          }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" location="bottom">
      {{ snackbarText }}
    </v-snackbar>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { WorkspaceSummary } from "@/entityTypes/workspaceTypes";
import type {
  AIWorkspaceMemoryView,
  AIWorkspaceMemoryType,
  AIWorkspaceMemoryStatus,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import { workspaceMemoryApi } from "@/views/api/aiWorkspaceMemory";
import WorkspaceMemoryEditorDialog from "./WorkspaceMemoryEditorDialog.vue";
import WorkspaceMemoryStatusBadge from "./WorkspaceMemoryStatusBadge.vue";

const props = defineProps<{
  conversationId: string;
  workspace: WorkspaceSummary | null;
}>();

const emit = defineEmits<{
  (e: "change"): void;
}>();

const { t } = useI18n();

const memories = ref<AIWorkspaceMemoryView[]>([]);
const loading = ref(false);
const search = ref("");
const showArchived = ref(false);

const editorOpen = ref(false);
const editing = ref<AIWorkspaceMemoryView | null>(null);
const createType = ref<AIWorkspaceMemoryType>("decision");

const confirmOpen = ref(false);
const pendingDelete = ref<AIWorkspaceMemoryView | null>(null);

const snackbar = ref(false);
const snackbarText = ref("");
const snackbarColor = ref<"success" | "error">("success");

// Auto-dream status for the active workspace (drives the status badge + run-now button).
const autoDreamRunning = ref(false);
const autoDreamFailed = ref(false);
const autoDreamLastRun = ref<string | undefined>(undefined);

const hasWorkspace = computed(
  () => !!props.workspace && props.workspace.approvalState === "approved"
);

const visibleMemories = computed(() => {
  const q = (search.value ?? "").trim().toLowerCase();
  return memories.value.filter((m) => {
    if (!showArchived.value && m.status !== "active") return false;
    if (!q) return true;
    return (
      m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q)
    );
  });
});

const activeCount = computed(
  () => memories.value.filter((m) => m.status === "active").length
);

function notify(text: string, color: "success" | "error" = "success"): void {
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
}

async function refresh(): Promise<void> {
  if (!hasWorkspace.value || !props.conversationId) {
    memories.value = [];
    return;
  }
  loading.value = true;
  try {
    const resp = await workspaceMemoryApi.list({
      conversationId: props.conversationId,
      status: showArchived.value ? undefined : "active",
      limit: 200,
    });
    if (resp.status) {
      memories.value = resp.data ?? [];
    } else {
      memories.value = [];
      notify(t("workspaceMemory.loadError") || "Failed to load.", "error");
    }
  } catch {
    memories.value = [];
    notify(t("workspaceMemory.loadError") || "Failed to load.", "error");
  } finally {
    loading.value = false;
  }
}

async function refreshAutoDreamStatus(): Promise<void> {
  if (!hasWorkspace.value) {
    autoDreamRunning.value = false;
    autoDreamFailed.value = false;
    autoDreamLastRun.value = undefined;
    return;
  }
  try {
    const resp = await workspaceMemoryApi.autoDreamStatus();
    if (resp.status && resp.data) {
      autoDreamRunning.value = !!resp.data.runningRun;
      const last = resp.data.latestRun;
      autoDreamFailed.value = !!last && last.status === "failed";
      autoDreamLastRun.value = last?.finishedAt;
    }
  } catch {
    // non-fatal — status is advisory
  }
}

async function onRunAutoDream(): Promise<void> {
  if (!props.conversationId || autoDreamRunning.value) return;
  autoDreamRunning.value = true;
  try {
    const resp = await workspaceMemoryApi.runAutoDream({
      conversationId: props.conversationId,
      force: true,
    });
    if (resp.status) {
      // Success feedback is the refreshed list + status badge; no snackbar.
      await refresh();
      emit("change");
    } else {
      notify(resp.msg || "Error", "error");
    }
  } catch (err) {
    notify(
      err instanceof Error
        ? err.message
        : t("workspaceMemory.autoDreamFailed") || "Error",
      "error"
    );
  } finally {
    // refreshAutoDreamStatus sets autoDreamRunning from the live run record.
    await refreshAutoDreamStatus();
  }
}

watch(
  () => [props.conversationId, hasWorkspace.value, showArchived.value] as const,
  () => {
    void refresh();
    void refreshAutoDreamStatus();
  },
  { immediate: true }
);

function openCreate(): void {
  editing.value = null;
  editorOpen.value = true;
}

function openEdit(m: AIWorkspaceMemoryView): void {
  editing.value = m;
  editorOpen.value = true;
}

async function onEditorSave(value: {
  type: AIWorkspaceMemoryType;
  title: string;
  content: string;
  confidence: number;
  status?: AIWorkspaceMemoryStatus;
}): Promise<void> {
  if (!props.conversationId) return;
  try {
    if (editing.value) {
      const resp = await workspaceMemoryApi.update({
        conversationId: props.conversationId,
        memoryId: editing.value.memoryId,
        type: value.type,
        title: value.title,
        content: value.content,
        confidence: value.confidence,
        status: value.status,
      });
      if (!resp.status) {
        notify(resp.msg || (t("workspaceMemory.createError") || "Error"), "error");
        return;
      }
    } else {
      const resp = await workspaceMemoryApi.create({
        conversationId: props.conversationId,
        type: value.type,
        title: value.title,
        content: value.content,
        confidence: value.confidence,
      });
      if (!resp.status) {
        notify(resp.msg || (t("workspaceMemory.createError") || "Error"), "error");
        return;
      }
    }
    editorOpen.value = false;
    editing.value = null;
    await refresh();
    emit("change");
  } catch {
    notify(t("workspaceMemory.createError") || "Error", "error");
  }
}

async function onArchive(m: AIWorkspaceMemoryView): Promise<void> {
  if (!props.conversationId) return;
  const resp = await workspaceMemoryApi.archive({
    conversationId: props.conversationId,
    memoryId: m.memoryId,
  });
  if (resp.status) {
    await refresh();
    emit("change");
  } else {
    notify(resp.msg || "Error", "error");
  }
}

function onDelete(m: AIWorkspaceMemoryView): void {
  pendingDelete.value = m;
  confirmOpen.value = true;
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value || !props.conversationId) return;
  const resp = await workspaceMemoryApi.delete({
    conversationId: props.conversationId,
    memoryId: pendingDelete.value.memoryId,
  });
  confirmOpen.value = false;
  pendingDelete.value = null;
  if (resp.status) {
    notify(t("workspaceMemory.deleteSuccess") || "Deleted");
    await refresh();
    emit("change");
  } else {
    notify(resp.msg || "Error", "error");
  }
}

function typeLabel(type: AIWorkspaceMemoryType): string {
  const map: Record<AIWorkspaceMemoryType, string> = {
    project: t("workspaceMemory.typeProject") || "Project",
    decision: t("workspaceMemory.typeDecision") || "Decision",
    workflow: t("workspaceMemory.typeWorkflow") || "Workflow",
    convention: t("workspaceMemory.typeConvention") || "Convention",
    reference: t("workspaceMemory.typeReference") || "Reference",
    warning: t("workspaceMemory.typeWarning") || "Warning",
  };
  return map[type] ?? type;
}

function typeColor(type: AIWorkspaceMemoryType): string {
  switch (type) {
    case "warning":
      return "error";
    case "decision":
      return "primary";
    case "workflow":
      return "success";
    case "convention":
      return "info";
    case "reference":
      return "secondary";
    default:
      return "default";
  }
}

function statusLabel(status: AIWorkspaceMemoryStatus): string {
  const map: Record<AIWorkspaceMemoryStatus, string> = {
    active: t("workspaceMemory.statusActive") || "Active",
    archived: t("workspaceMemory.statusArchived") || "Archived",
    contradicted: t("workspaceMemory.statusContradicted") || "Contradicted",
  };
  return map[status] ?? status;
}

function formatSource(m: AIWorkspaceMemoryView): string {
  const kind = m.sourceKind;
  if (!kind) return "";
  const map: Record<string, string> = {
    manual: t("workspaceMemory.sourceManual") || "Manual",
    chat_v2: t("workspaceMemory.sourceChatV2") || "Chat",
    agent_task: t("workspaceMemory.sourceAgentTask") || "Agent task",
    auto_dream: t("workspaceMemory.sourceAutoDream") || "Auto-dream",
  };
  return map[kind] ?? kind;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
}

// i18n-bound labels
const panelTitle = computed(() => t("workspaceMemory.panelTitle") || "Workspace memory");
const createText = computed(() => t("workspaceMemory.create") || "Create memory");
const noWorkspaceText = computed(
  () => t("workspaceMemory.noWorkspace") || "Choose a workspace first."
);
const emptyText = computed(() => t("workspaceMemory.empty") || "No memories yet.");
const emptyHint = computed(
  () =>
    t("workspaceMemory.emptyHint") || "Memories here apply only to this workspace."
);
const searchPlaceholder = computed(
  () => t("workspaceMemory.searchPlaceholder") || "Search..."
);
const showArchivedText = computed(
  () => t("workspaceMemory.showArchived") || "Show archived"
);
const loadingText = computed(() => t("common.loading") || "Loading...");
const runAutoDreamText = computed(
  () => t("workspaceMemory.runAutoSummary") || "RUN AUTO SUMMARY"
);
const autoDreamLastRunText = computed(() => {
  if (!autoDreamLastRun.value) return "";
  const d = new Date(autoDreamLastRun.value);
  if (!Number.isFinite(d.getTime())) return "";
  const tpl = t("workspaceMemory.autoDreamLastRun") || "Last run: {time}";
  return tpl.replace("{time}", d.toLocaleString());
});
const editText = computed(() => t("workspaceMemory.edit") || "Edit");
const archiveText = computed(() => t("workspaceMemory.archive") || "Archive");
const deleteText = computed(() => t("workspaceMemory.delete") || "Delete");
const deleteConfirmText = computed(
  () => t("workspaceMemory.deleteConfirm") || "Delete permanently?"
);
const cancelText = computed(() => t("workspaceMemory.cancel") || "Cancel");
const updatedAtText = computed(() => t("workspaceMemory.updatedAt") || "Updated");
const lastUsedText = computed(() => t("workspaceMemory.lastUsedAt") || "Last used");
const confidenceText = computed(() => t("workspaceMemory.confidence") || "Confidence");
</script>

<style scoped>
.wm-panel {
  width: 100%;
  padding: 8px;
}
.wm-panel__header {
  display: flex;
  align-items: center;
  padding: 4px 4px 8px;
}
.wm-panel__title {
  font-weight: 600;
  font-size: 14px;
}
.wm-panel__lastrun {
  font-size: 11px;
  opacity: 0.6;
  align-self: center;
}
.wm-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}
.wm-panel__search {
  flex: 1;
}
.wm-panel__archived-toggle {
  flex: 0 0 auto;
}
.wm-panel__empty {
  padding: 16px 8px;
  font-size: 13px;
  opacity: 0.8;
  text-align: center;
}
.wm-panel__hint {
  opacity: 0.6;
  font-size: 12px;
  margin-top: 4px;
}
.wm-panel__list {
  max-height: 360px;
  overflow-y: auto;
}
.wm-item {
  width: 100%;
}
.wm-item__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wm-item__title {
  font-weight: 600;
  font-size: 13px;
}
.wm-item__meta {
  font-size: 11px;
  opacity: 0.6;
}
.wm-item__content {
  font-size: 12px;
  margin: 2px 0;
  white-space: pre-wrap;
}
.wm-item__foot {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  opacity: 0.7;
  flex-wrap: wrap;
}
</style>
