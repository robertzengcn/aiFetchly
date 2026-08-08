<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t('aiMemory.title') }}</span>
        <v-btn icon size="small" variant="text" @click="goBack">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />

      <v-card-text>
        <p class="text-body-2 text-grey mb-4">{{ t('aiMemory.description') }}</p>

        <!-- Toolbar -->
        <div class="d-flex flex-wrap align-center ga-3 mb-4">
          <v-btn color="primary" variant="flat" @click="openCreate">
            <v-icon left>mdi-plus</v-icon>
            {{ t('aiMemory.button_create') }}
          </v-btn>
          <v-text-field
            v-model="filters.query"
            :placeholder="t('aiMemory.search_placeholder')"
            density="compact"
            hide-details
            prepend-inner-icon="mdi-magnify"
            style="max-width: 320px;"
          />
          <v-select
            v-model="filters.type"
            :items="typeOptions"
            :label="t('aiMemory.filter_type')"
            item-title="label"
            item-value="value"
            density="compact"
            hide-details
            style="max-width: 160px;"
            @update:model-value="reloadFromFirst"
          />
          <v-select
            v-model="filters.status"
            :items="statusOptions"
            :label="t('aiMemory.filter_status')"
            item-title="label"
            item-value="value"
            density="compact"
            hide-details
            style="max-width: 160px;"
            @update:model-value="reloadFromFirst"
          />
          <v-select
            v-model="filters.sourceKind"
            :items="sourceOptions"
            :label="t('aiMemory.filter_source')"
            item-title="label"
            item-value="value"
            density="compact"
            hide-details
            style="max-width: 180px;"
            @update:model-value="reloadFromFirst"
          />
          <v-btn variant="text" @click="loadMemories">
            <v-icon left>mdi-refresh</v-icon>
            {{ t('aiMemory.button_refresh') }}
          </v-btn>
        </div>

        <!-- Loading -->
        <div v-if="isLoading" class="text-center pa-4">
          <v-progress-circular indeterminate color="primary" />
          <p class="mt-2">{{ t('aiMemory.loading') }}</p>
        </div>

        <!-- Error -->
        <v-alert v-else-if="errorMsg" type="error" class="mb-4">
          {{ errorMsg }}
        </v-alert>

        <!-- Empty -->
        <div v-else-if="memories.length === 0" class="text-center pa-4">
          <v-icon size="64" color="grey-lighten-2">mdi-brain</v-icon>
          <p class="mt-4 text-grey">{{ t('aiMemory.empty_title') }}</p>
          <p class="text-grey">{{ t('aiMemory.empty_description') }}</p>
        </div>

        <!-- Table -->
        <div v-else>
          <v-table density="compact">
            <thead>
              <tr>
                <th>{{ t('aiMemory.col_title') }}</th>
                <th>{{ t('aiMemory.col_type') }}</th>
                <th>{{ t('aiMemory.col_content') }}</th>
                <th>{{ t('aiMemory.col_status') }}</th>
                <th>{{ t('aiMemory.col_source') }}</th>
                <th>{{ t('aiMemory.col_updated') }}</th>
                <th>{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in pagedMemories" :key="m.memoryId">
                <td>{{ m.title }}</td>
                <td>
                  <v-chip size="x-small" :color="typeColor(m.type)">
                    {{ t(`aiMemory.type_${m.type}`) }}
                  </v-chip>
                </td>
                <td class="content-cell">{{ truncate(m.content, 80) }}</td>
                <td>
                  <v-chip size="x-small" :color="statusColor(m.status)">
                    {{ t(`aiMemory.status_${m.status}`) }}
                  </v-chip>
                </td>
                <td>{{ m.sourceKind ? t(`aiMemory.source_${m.sourceKind}`) : '' }}</td>
                <td>{{ m.updatedAt }}</td>
                <td class="d-flex ga-1">
                  <v-btn icon size="x-small" variant="text" :title="t('aiMemory.action_edit')" @click="openEdit(m)">
                    <v-icon>mdi-pencil</v-icon>
                  </v-btn>
                  <v-btn icon size="x-small" variant="text" :title="t('aiMemory.action_archive')" @click="requestArchive(m)">
                    <v-icon>mdi-archive</v-icon>
                  </v-btn>
                  <v-btn icon size="x-small" variant="text" color="error" :title="t('aiMemory.action_delete')" @click="requestDelete(m)">
                    <v-icon>mdi-delete</v-icon>
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>

          <div class="d-flex align-center justify-end mt-2">
            <v-btn variant="text" size="small" :disabled="page <= 1" @click="prevPage">
              <v-icon>mdi-chevron-left</v-icon>
            </v-btn>
            <span class="mx-2 text-body-2">
              {{ t('aiMemory.page_of', { page: page, total: pageCount }) }}
            </span>
            <v-btn variant="text" size="small" :disabled="page >= pageCount" @click="nextPage">
              <v-icon>mdi-chevron-right</v-icon>
            </v-btn>
          </div>
        </div>
      </v-card-text>
    </v-card>

    <AiMemoryFormDialog
      v-model="dialogVisible"
      :mode="dialogMode"
      :memory="dialogMemory"
      @saved="onSaved"
    />

    <v-dialog :model-value="confirmState !== null" max-width="480" @update:model-value="closeConfirm">
      <v-card v-if="confirmState">
        <v-card-title>
          {{ confirmState.kind === 'archive' ? t('aiMemory.confirm_archive_title') : t('aiMemory.confirm_delete_title') }}
        </v-card-title>
        <v-card-text>
          {{ confirmState.kind === 'archive' ? t('aiMemory.confirm_archive_text') : t('aiMemory.confirm_delete_text') }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeConfirm">{{ t('aiMemory.button_cancel') }}</v-btn>
          <v-btn
            :color="confirmState.kind === 'delete' ? 'error' : 'primary'"
            @click="runConfirmed"
          >
            {{ confirmState.kind === 'archive' ? t('aiMemory.button_archive') : t('aiMemory.button_delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snack" :timeout="2500">{{ snackMsg }}</v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { aiUserMemoryApi } from "@/views/api/aiUserMemory";
import AiMemoryFormDialog from "./components/AiMemoryFormDialog.vue";
import {
  AI_USER_MEMORY_TYPES,
  AI_USER_MEMORY_STATUSES,
  AI_USER_MEMORY_SOURCE_KINDS,
  type AIUserMemoryView,
  type AIUserMemorySearchInput,
  type AIUserMemoryType,
  type AIUserMemoryStatus,
  type AIUserMemorySourceKind,
} from "@/entityTypes/aiUserMemoryTypes";

const { t } = useI18n();
const router = useRouter();

const dialogVisible = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const dialogMemory = ref<AIUserMemoryView | null>(null);
const confirmState = ref<{ kind: "archive" | "delete"; memory: AIUserMemoryView } | null>(null);
const snack = ref(false);
const snackMsg = ref("");

function showToast(msg: string): void {
  snackMsg.value = msg;
  snack.value = true;
}

function openCreate(): void {
  dialogMode.value = "create";
  dialogMemory.value = null;
  dialogVisible.value = true;
}
function openEdit(m: AIUserMemoryView): void {
  dialogMode.value = "edit";
  dialogMemory.value = m;
  dialogVisible.value = true;
}
function onSaved(): void {
  const wasCreate = dialogMode.value === "create";
  dialogVisible.value = false;
  showToast(wasCreate ? t("aiMemory.toast_created") : t("aiMemory.toast_updated"));
  loadMemories();
}

function requestArchive(m: AIUserMemoryView): void {
  confirmState.value = { kind: "archive", memory: m };
}
function requestDelete(m: AIUserMemoryView): void {
  confirmState.value = { kind: "delete", memory: m };
}
function closeConfirm(): void {
  confirmState.value = null;
}

async function runConfirmed(): Promise<void> {
  const state = confirmState.value;
  if (!state) return;
  if (state.kind === "archive") {
    await handleArchive(state.memory);
  } else {
    await handleDelete(state.memory);
  }
  closeConfirm();
}

async function handleArchive(m: AIUserMemoryView): Promise<void> {
  try {
    const res = await aiUserMemoryApi.archive(m.memoryId);
    if (res.status) {
      showToast(t("aiMemory.toast_archived"));
      await loadMemories();
    } else {
      showToast(res.msg || t("aiMemory.toast_error"));
    }
  } catch {
    showToast(t("aiMemory.toast_error"));
  }
}

async function handleDelete(m: AIUserMemoryView): Promise<void> {
  try {
    const res = await aiUserMemoryApi.delete(m.memoryId);
    if (res.status) {
      showToast(t("aiMemory.toast_deleted"));
      await loadMemories();
    } else {
      showToast(res.msg || t("aiMemory.toast_error"));
    }
  } catch {
    showToast(t("aiMemory.toast_error"));
  }
}

const memories = ref<AIUserMemoryView[]>([]);
const isLoading = ref(false);
const errorMsg = ref("");

const filters = reactive<{
  query: string;
  type: AIUserMemoryType | "";
  status: AIUserMemoryStatus | "";
  sourceKind: AIUserMemorySourceKind | "";
}>({
  query: "",
  type: "",
  status: "active",
  sourceKind: "",
});

const page = ref(1);
const perPage = 20;

const typeOptions = computed(() => [
  { value: "", label: t("aiMemory.filter_all") },
  ...AI_USER_MEMORY_TYPES.map((v) => ({ value: v, label: t(`aiMemory.type_${v}`) })),
]);
const statusOptions = computed(() => [
  { value: "", label: t("aiMemory.filter_all") },
  ...AI_USER_MEMORY_STATUSES.map((v) => ({ value: v, label: t(`aiMemory.status_${v}`) })),
]);
const sourceOptions = computed(() => [
  { value: "", label: t("aiMemory.filter_all") },
  ...AI_USER_MEMORY_SOURCE_KINDS.map((v) => ({ value: v, label: t(`aiMemory.source_${v}`) })),
]);

const pagedMemories = computed(() =>
  memories.value.slice((page.value - 1) * perPage, page.value * perPage)
);
const pageCount = computed(() => Math.max(1, Math.ceil(memories.value.length / perPage)));

function buildInput(): AIUserMemorySearchInput {
  const input: AIUserMemorySearchInput = { limit: 200, offset: 0 };
  if (filters.status) input.status = filters.status;
  if (filters.type) input.type = filters.type;
  if (filters.sourceKind) input.sourceKind = filters.sourceKind;
  const q = filters.query.trim();
  if (q) input.query = q;
  return input;
}

async function loadMemories(): Promise<void> {
  isLoading.value = true;
  errorMsg.value = "";
  try {
    const res = await aiUserMemoryApi.list(buildInput());
    if (res.status && res.data) {
      memories.value = res.data;
    } else {
      memories.value = [];
      errorMsg.value = res.msg || t("aiMemory.error_load");
    }
  } catch {
    memories.value = [];
    errorMsg.value = t("aiMemory.error_load");
  } finally {
    isLoading.value = false;
  }
}

function reloadFromFirst(): void {
  page.value = 1;
  loadMemories();
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => filters.query,
  () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => reloadFromFirst(), 300);
  }
);

function nextPage(): void {
  if (page.value < pageCount.value) page.value += 1;
}
function prevPage(): void {
  if (page.value > 1) page.value -= 1;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function typeColor(ty: AIUserMemoryType): string {
  const map: Record<AIUserMemoryType, string> = {
    preference: "primary",
    fact: "info",
    decision: "success",
    reference: "secondary",
    workflow: "purple",
  };
  return map[ty];
}
function statusColor(st: AIUserMemoryStatus): string {
  const map: Record<AIUserMemoryStatus, string> = {
    active: "success",
    archived: "grey",
    contradicted: "warning",
  };
  return map[st];
}

function goBack(): void {
  router.push({ name: "system_setting_index" });
}

onMounted(() => {
  loadMemories();
});

defineExpose({
  memories,
  loadMemories,
  openCreate,
  openEdit,
  handleArchive,
  handleDelete,
  dialogVisible,
  dialogMode,
});
</script>

<style scoped>
.content-cell {
  max-width: 360px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
