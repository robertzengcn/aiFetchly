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
      <!-- Portable storage status banner (PRD §16.1/§16.2) -->
      <div class="wm-portable">
        <template v-if="portableStatus?.enabled">
          <v-chip size="x-small" color="teal" variant="tonal" class="mr-2">
            <v-icon size="12" start>mdi-file-document-multiple-outline</v-icon>
            {{ portableText }}
          </v-chip>
          <span class="wm-portable__meta">
            {{ portableCountText }} · {{ gitStateText }}:
            {{ portableStatus.gitTrackingState }}
          </span>
          <v-chip
            v-if="portableStatus.pendingReviewCount > 0"
            size="x-small"
            color="warning"
            variant="tonal"
            class="mx-1"
          >
            {{ pendingReviewText }}: {{ portableStatus.pendingReviewCount }}
          </v-chip>
          <v-chip
            v-if="portableStatus.rejectedCount > 0"
            size="x-small"
            color="error"
            variant="tonal"
            class="mx-1"
          >
            {{ rejectedText }}: {{ portableStatus.rejectedCount }}
          </v-chip>
          <v-chip
            v-if="portableStatus.conflictCount > 0"
            size="x-small"
            color="deep-orange"
            variant="tonal"
            class="mx-1"
          >
            {{ conflictedText }}: {{ portableStatus.conflictCount }}
          </v-chip>
          <v-spacer />
          <v-btn
            v-if="portableStatus.conflictCount > 0"
            size="x-small"
            color="deep-orange"
            variant="tonal"
            @click="onOpenConflictResolver"
          >
            {{ resolveConflictsText }}
          </v-btn>
          <v-btn
            v-if="
              portableStatus.rejectedCount > 0 ||
              portableStatus.conflictCount > 0 ||
              portableStatus.pendingReviewCount > 0
            "
            size="x-small"
            variant="text"
            @click="diagnosticsOpen = true"
          >
            {{ diagnosticsText }}
          </v-btn>
          <v-btn
            v-if="portableStatus?.enabled && portableStatus.portableWorkspaceId"
            size="x-small"
            variant="text"
            color="warning"
            @click="regenerateIdentityOpen = true"
          >
            {{ regenerateIdentityText }}
          </v-btn>
          <v-btn size="x-small" variant="text" @click="onRescan">{{
            rescanText
          }}</v-btn>
        </template>
        <template v-else>
          <span class="wm-portable__meta">{{ portableDisabledHint }}</span>
          <v-spacer />
          <v-btn size="x-small" variant="tonal" @click="enableOpen = true">
            <v-icon size="12" start>mdi-file-document-plus-outline</v-icon>
            {{ enablePortableText }}
          </v-btn>
        </template>
      </div>

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
              <!-- Per-memory portable storage/sync badges (FR-061) -->
              <v-chip
                v-if="portableStatus?.enabled && portableRowMap.get(m.memoryId)"
                size="x-small"
                :color="storageBadgeColor(portableRowMap.get(m.memoryId)!)"
                variant="tonal"
              >
                {{ storageBadgeLabel(portableRowMap.get(m.memoryId)!) }}
              </v-chip>
              <v-chip
                v-if="portableStatus?.enabled && portableRowMap.get(m.memoryId)?.syncState"
                size="x-small"
                :color="syncBadgeColor(portableRowMap.get(m.memoryId)!.syncState!)"
                variant="outlined"
              >
                {{ syncBadgeLabel(portableRowMap.get(m.memoryId)!.syncState!) }}
              </v-chip>
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

    <PortableMemoryEnableDialog
      :open="enableOpen"
      :conversation-id="conversationId"
      @cancel="enableOpen = false"
      @enabled="onPortableEnabled"
    />

    <PortableMemoryConflictDialog
      :open="conflictOpen"
      :conversation-id="conversationId"
      :memory-id="conflictMemoryId"
      @cancel="conflictOpen = false"
      @resolved="onConflictResolved"
    />

    <PortableMemoryDiagnosticsDialog
      :open="diagnosticsOpen"
      :conversation-id="conversationId"
      @cancel="diagnosticsOpen = false"
      @rescanned="onDiagnosticsRescanned"
    />

    <v-dialog v-model="regenerateIdentityOpen" max-width="480">
      <v-card>
        <v-card-title>{{ regenerateIdentityText }}</v-card-title>
        <v-card-text>
          {{ regenerateIdentityWarningText }}
        </v-card-text>
        <v-alert
          v-if="portableStatus?.gitTrackingState === 'tracked'"
          type="warning"
          variant="tonal"
          density="compact"
          class="mx-4"
        >
          {{ regenerateGitWarningText }}
        </v-alert>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="regenerateIdentityOpen = false">{{
            cancelText
          }}</v-btn>
          <v-btn
            color="warning"
            variant="flat"
            :loading="regenerating"
            @click="onRegenerateIdentity"
          >
            {{ regenerateConfirmText }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <WorkspaceMemoryEditorDialog
      v-model="editorOpen"
      :memory="editing"
      :default-type="createType"
      :allow-storage-choice="portableStatus?.enabled === true"
      :expected-hash="editingExpectedHash"
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
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { WorkspaceSummary } from "@/entityTypes/workspaceTypes";
import type {
  AIWorkspaceMemoryView,
  AIWorkspaceMemoryType,
  AIWorkspaceMemoryStatus,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import { workspaceMemoryApi } from "@/views/api/aiWorkspaceMemory";
import { portableWorkspaceMemoryApi } from "@/views/api/portableWorkspaceMemory";
import type { PortableWorkspaceStatusView } from "@/entityTypes/portableWorkspaceMemoryTypes";
import WorkspaceMemoryEditorDialog from "./WorkspaceMemoryEditorDialog.vue";
import WorkspaceMemoryStatusBadge from "./WorkspaceMemoryStatusBadge.vue";
import PortableMemoryEnableDialog from "./PortableMemoryEnableDialog.vue";
import PortableMemoryConflictDialog from "./PortableMemoryConflictDialog.vue";
import PortableMemoryDiagnosticsDialog from "./PortableMemoryDiagnosticsDialog.vue";

const props = defineProps<{
  conversationId: string;
  workspace: WorkspaceSummary | null;
}>();

const emit = defineEmits<{
  (e: "change"): void;
}>();

const { t } = useI18n();

/** t() with a working fallback: vue-i18n returns the raw key when missing. */
function tr(key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

const memories = ref<AIWorkspaceMemoryView[]>([]);
/** Per-memory portable badges (FR-061): keyed by memoryId. */
const portableRowMap = ref<
  Map<
    string,
    {
      storageMode: string;
      syncState?: string;
      visibility?: string;
      relativePath?: string;
      portableUpdatedAt?: string;
    }
  >
>(new Map());
const loading = ref(false);
const search = ref("");
const showArchived = ref(false);

const editorOpen = ref(false);
const editing = ref<AIWorkspaceMemoryView | null>(null);
/** Portable concurrency token (FR-038) for the record being edited. */
const editingExpectedHash = ref<string | null>(null);
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

// Portable storage status (drives the portable banner + enable dialog).
const portableStatus = ref<PortableWorkspaceStatusView | null>(null);
const enableOpen = ref(false);
const conflictOpen = ref(false);
const conflictMemoryId = ref<string | null>(null);
const diagnosticsOpen = ref(false);
const regenerateIdentityOpen = ref(false);
const regenerating = ref(false);
let unsubscribePortable: (() => void) | null = null;

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
    portableRowMap.value = new Map();
    return;
  }
  loading.value = true;
  try {
    const resp = await workspaceMemoryApi.list({
      conversationId: props.conversationId,
      status: showArchived.value ? "all" : "active",
      limit: 200,
    });
    if (resp.status) {
      memories.value = resp.data ?? [];
    } else {
      memories.value = [];
      notify(t("workspaceMemory.loadError") || "Failed to load.", "error");
    }
    // Fetch per-memory portable badges (FR-061) when portable is enabled.
    if (portableStatus.value?.enabled) {
      try {
        const portableResp = await portableWorkspaceMemoryApi.list(
          props.conversationId
        );
        if (portableResp.status && portableResp.data) {
          const map = new Map();
          for (const row of portableResp.data) {
            map.set(row.memoryId, {
              storageMode: row.storageMode,
              syncState: row.syncState,
              visibility: row.visibility,
              relativePath: row.relativePath,
              portableUpdatedAt: row.portableUpdatedAt,
            });
          }
          portableRowMap.value = map;
        } else {
          portableRowMap.value = new Map();
        }
      } catch {
        portableRowMap.value = new Map();
      }
    } else {
      portableRowMap.value = new Map();
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

async function refreshPortableStatus(): Promise<void> {
  if (!hasWorkspace.value || !props.conversationId) {
    portableStatus.value = null;
    return;
  }
  try {
    const resp = await portableWorkspaceMemoryApi.status(props.conversationId);
    portableStatus.value = resp.status ? (resp.data ?? null) : null;
  } catch {
    portableStatus.value = null; // advisory only
  }
}

async function onRescan(): Promise<void> {
  if (!props.conversationId) return;
  try {
    await portableWorkspaceMemoryApi.rescan(props.conversationId);
  } catch {
    // rescan is best-effort; watcher events refresh the UI
  }
}

function onOpenConflictResolver(): void {
  // Open the resolver on the first conflicted record (the dialog fetches the
  // full list itself and lets the user step through them).
  conflictMemoryId.value = null;
  conflictOpen.value = true;
}

async function onConflictResolved(): Promise<void> {
  conflictOpen.value = false;
  conflictMemoryId.value = null;
  void refreshPortableStatus();
  await refresh();
  emit("change");
}

async function onDiagnosticsRescanned(): Promise<void> {
  void refreshPortableStatus();
  await refresh();
  emit("change");
}

async function onRegenerateIdentity(): Promise<void> {
  if (!props.conversationId) return;
  regenerating.value = true;
  try {
    const resp = await portableWorkspaceMemoryApi.regenerateIdentity(
      props.conversationId
    );
    if (resp.status) {
      regenerateIdentityOpen.value = false;
      void refreshPortableStatus();
      await refresh();
      emit("change");
    } else {
      notify(resp.msg || "Error", "error");
    }
  } catch (err) {
    notify(err instanceof Error ? err.message : "Error", "error");
  } finally {
    regenerating.value = false;
  }
}

function onPortableEnabled(): void {
  enableOpen.value = false;
  void refreshPortableStatus();
  emit("change");
}

const portableText = computed(
  () => tr("portableMemory.banner", "Portable memory")
);
const portableCountText = computed(() => {
  const s = portableStatus.value;
  if (!s) return "";
  return `${s.portableCount} / ${s.portableCount + s.privateCount}`;
});
const gitStateText = computed(
  () => tr("portableMemory.gitState", "Git")
);
const pendingReviewText = computed(
  () => tr("portableMemory.pendingReview", "Pending review")
);
const rejectedText = computed(
  () => tr("portableMemory.rejected", "Rejected")
);
const conflictedText = computed(
  () => tr("portableMemory.conflicted", "Conflicted")
);
const rescanText = computed(() => tr("portableMemory.rescan", "Rescan"));
const resolveConflictsText = computed(() =>
  tr("portableMemory.resolve", "Resolve")
);
const diagnosticsText = computed(() =>
  tr("portableMemory.diagnosticsTitle", "Diagnostics")
);
const regenerateIdentityText = computed(() =>
  tr("portableMemory.regenerateIdentity", "Regenerate identity")
);
const regenerateIdentityWarningText = computed(() =>
  tr(
    "portableMemory.regenerateIdentityWarning",
    "Regenerating the workspace identity creates a new portable UUID for an intentional fork. Record IDs are retained under scoped uniqueness. The original and fork will coexist without shared mutation."
  )
);
const regenerateGitWarningText = computed(() =>
  tr(
    "portableMemory.regenerateGitWarning",
    "The current identity is tracked by Git. Regenerating changes the committed identity for all clones; coordinate with your team."
  )
);
const regenerateConfirmText = computed(() =>
  tr("portableMemory.regenerateConfirm", "Regenerate")
);
const portableDisabledHint = computed(
  () =>
    tr("portableMemory.disabledHint", "Memories are stored privately in AiFetchly. Enable portable memory to share project context with other agents.")
);
const enablePortableText = computed(
  () => tr("portableMemory.enable", "Enable portable memory")
);

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
  async () => {
    // Refresh portable status FIRST so refresh() knows whether to fetch the
    // per-memory portable badges (FR-061).
    await refreshPortableStatus();
    void refresh();
    void refreshAutoDreamStatus();
  },
  { immediate: true }
);

// Live sync summaries (design §21.5): debounced refresh; event data is never
// treated as the record list.
let portableRefreshTimer: ReturnType<typeof setTimeout> | null = null;
onMounted(() => {
  unsubscribePortable = portableWorkspaceMemoryApi.onChanged(() => {
    if (portableRefreshTimer) clearTimeout(portableRefreshTimer);
    portableRefreshTimer = setTimeout(() => {
      void refreshPortableStatus();
      void refresh();
    }, 250);
  });
});
onUnmounted(() => {
  unsubscribePortable?.();
  unsubscribePortable = null;
  if (portableRefreshTimer) clearTimeout(portableRefreshTimer);
});

function openCreate(): void {
  editing.value = null;
  editorOpen.value = true;
}

async function openEdit(m: AIWorkspaceMemoryView): Promise<void> {
  editing.value = m;
  editingExpectedHash.value = null;
  // Fetch the portable concurrency token (FR-038) so the editor can guard
  // against concurrent external edits on save.
  if (portableStatus.value?.enabled && props.conversationId) {
    try {
      const resp = await portableWorkspaceMemoryApi.getPortableState({
        conversationId: props.conversationId,
        memoryId: m.memoryId,
      });
      if (resp.status && resp.data?.portable) {
        editingExpectedHash.value = resp.data.lastValidHash ?? null;
      }
    } catch {
      // advisory; the editor still opens (unguarded)
    }
  }
  editorOpen.value = true;
}

async function onEditorSave(value: {
  type: AIWorkspaceMemoryType;
  title: string;
  content: string;
  confidence: number;
  status?: AIWorkspaceMemoryStatus;
  expectedHash?: string;
  visibility?: "local" | "team";
  storageMode?: "private" | "portable-local" | "portable-team";
}): Promise<void> {
  if (!props.conversationId) return;
  // Route by storage mode (FR-037/FR-039): portable writes go file-first
  // through the portable service; private writes stay on the SQLite path.
  const isPortableCreate =
    !editing.value &&
    portableStatus.value?.enabled &&
    (value.storageMode === "portable-local" ||
      value.storageMode === "portable-team");
  const isPortableEdit =
    editing.value &&
    portableStatus.value?.enabled &&
    portableRowMap.value.get(editing.value.memoryId) !== undefined;
  try {
    if (editing.value && isPortableEdit) {
      const resp = await portableWorkspaceMemoryApi.updatePortable({
        conversationId: props.conversationId,
        memoryId: editing.value.memoryId,
        type: value.type,
        title: value.title,
        content: value.content,
        confidence: value.confidence,
        status: value.status ?? "active",
        visibility: value.visibility ?? "local",
        expectedHash: value.expectedHash,
      });
      if (!resp.status) {
        notify(resp.msg || (t("workspaceMemory.createError") || "Error"), "error");
        return;
      }
    } else if (editing.value) {
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
    } else if (isPortableCreate) {
      const resp = await portableWorkspaceMemoryApi.createPortable({
        conversationId: props.conversationId,
        type: value.type,
        title: value.title,
        content: value.content,
        confidence: value.confidence,
        visibility: value.visibility ?? "local",
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    notify(msg, "error");
  }
}

async function onArchive(m: AIWorkspaceMemoryView): Promise<void> {
  if (!props.conversationId) return;
  // Portable records: archive through the file-first portable service.
  if (
    portableStatus.value?.enabled &&
    portableRowMap.value.get(m.memoryId) !== undefined
  ) {
    try {
      const resp = await portableWorkspaceMemoryApi.archivePortable({
        conversationId: props.conversationId,
        memoryId: m.memoryId,
      });
      if (resp.status) {
        await refresh();
        emit("change");
      } else {
        notify(resp.msg || "Error", "error");
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Error", "error");
    }
    return;
  }
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
  const m = pendingDelete.value;
  // Portable records: delete the file first through the portable service.
  if (
    portableStatus.value?.enabled &&
    portableRowMap.value.get(m.memoryId) !== undefined
  ) {
    try {
      const resp = await portableWorkspaceMemoryApi.deletePortable({
        conversationId: props.conversationId,
        memoryId: m.memoryId,
      });
      confirmOpen.value = false;
      pendingDelete.value = null;
      if (resp.status) {
        await refresh();
        emit("change");
      } else {
        notify(resp.msg || "Error", "error");
      }
    } catch (err) {
      confirmOpen.value = false;
      pendingDelete.value = null;
      notify(err instanceof Error ? err.message : "Error", "error");
    }
    return;
  }
  const resp = await workspaceMemoryApi.delete({
    conversationId: props.conversationId,
    memoryId: m.memoryId,
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

/** Per-row portable storage badge (FR-061). */
function storageBadgeLabel(row: {
  storageMode: string;
  visibility?: string;
}): string {
  if (row.storageMode === "private") return tr("portableMemory.storagePrivate", "Private");
  if (row.storageMode === "portable-team")
    return tr("portableMemory.visibilityTeam", "Team");
  return tr("portableMemory.visibilityLocal", "Local");
}

function storageBadgeColor(row: { storageMode: string }): string {
  if (row.storageMode === "private") return "default";
  if (row.storageMode === "portable-team") return "teal";
  return "cyan";
}

function syncBadgeLabel(syncState: string): string {
  const fallbacks: Record<string, string> = {
    synced: "Synced",
    "pending-review": "Pending review",
    rejected: "Rejected",
    conflicted: "Conflicted",
    missing: "Missing",
    detached: "Detached",
    private: "Private",
  };
  return tr(
    `portableMemory.sync.${syncState}`,
    fallbacks[syncState] ?? syncState
  );
}

function syncBadgeColor(syncState: string): string {
  switch (syncState) {
    case "synced":
      return "success";
    case "pending-review":
      return "warning";
    case "rejected":
      return "error";
    case "conflicted":
      return "deep-orange";
    case "missing":
      return "error";
    case "detached":
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
.wm-portable {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 12px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgba(var(--v-theme-surface-variant), 0.15);
  min-height: 32px;
}
.wm-portable__meta {
  font-size: 12px;
  opacity: 0.8;
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
