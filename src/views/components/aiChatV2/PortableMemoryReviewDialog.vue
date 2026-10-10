<template>
  <v-dialog
    :model-value="open"
    max-width="720"
    scrollable
    @update:model-value="
      (v: boolean) => {
        if (!v) emit('cancel');
      }
    "
  >
    <v-card>
      <v-card-title class="pmr__title">{{ titleText }}</v-card-title>

      <v-card-text v-if="loading" class="pmr__loading">{{ loadingText }}</v-card-text>

      <v-card-text v-else-if="isEmpty" class="pmr__empty">
        {{ emptyText }}
      </v-card-text>

      <v-card-text v-else>
        <!-- New records -->
        <div v-if="review.newRecords.length > 0" class="pmr__section">
          <div class="pmr__section-title">
            {{ newRecordsText }} ({{ review.newRecords.length }})
          </div>
          <div
            v-for="entry in review.newRecords"
            :key="`new-${entry.memoryId}`"
            class="pmr__row"
          >
            <code class="pmr__path">{{ entry.relativePath }}</code>
            <pre v-if="entry.preview" class="pmr__preview">{{ entry.preview }}</pre>
            <div class="pmr__actions">
              <v-btn size="x-small" color="primary" variant="flat" :loading="acting" @click="onApprove(entry)">{{ approveText }}</v-btn>
              <v-btn size="x-small" variant="text" :loading="acting" @click="onReject(entry)">{{ rejectText }}</v-btn>
            </div>
          </div>
        </div>

        <!-- Edits -->
        <div v-if="review.edits.length > 0" class="pmr__section">
          <div class="pmr__section-title">
            {{ editsText }} ({{ review.edits.length }})
          </div>
          <div
            v-for="entry in review.edits"
            :key="`edit-${entry.memoryId}`"
            class="pmr__row"
          >
            <code class="pmr__path">{{ entry.relativePath }}</code>
            <span v-if="entry.title" class="pmr__title-text">{{ entry.title }}</span>
            <pre v-if="entry.preview" class="pmr__preview">{{ entry.preview }}</pre>
            <div class="pmr__actions">
              <v-btn size="x-small" color="primary" variant="flat" :loading="acting" @click="onApprove(entry)">{{ approveText }}</v-btn>
              <v-btn size="x-small" variant="text" :loading="acting" @click="onReject(entry)">{{ rejectText }}</v-btn>
            </div>
          </div>
        </div>

        <!-- Deletions -->
        <div v-if="review.deletions.length > 0" class="pmr__section">
          <div class="pmr__section-title">
            {{ deletionsText }} ({{ review.deletions.length }})
          </div>
          <div
            v-for="entry in review.deletions"
            :key="`del-${entry.memoryId}`"
            class="pmr__row"
          >
            <code class="pmr__path">{{ entry.relativePath }}</code>
            <span class="pmr__message">{{ entry.message }}</span>
            <div class="pmr__actions">
              <v-btn size="x-small" color="error" variant="flat" :loading="acting" @click="onApproveDeletion(entry)">{{ approveDeletionText }}</v-btn>
              <v-btn size="x-small" variant="text" :loading="acting" @click="onRejectDeletion(entry)">{{ rejectDeletionText }}</v-btn>
            </div>
          </div>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('cancel')">{{ closeText }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { portableWorkspaceMemoryApi } from "@/views/api/portableWorkspaceMemory";
import type { PortableMemoryReviewEntry } from "@/entityTypes/portableWorkspaceMemoryTypes";

const props = defineProps<{
  open: boolean;
  conversationId: string;
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

interface ReviewData {
  newRecords: PortableMemoryReviewEntry[];
  edits: PortableMemoryReviewEntry[];
  deletions: PortableMemoryReviewEntry[];
}

const loading = ref(false);
const acting = ref(false);
const review = ref<ReviewData>({ newRecords: [], edits: [], deletions: [] });

const isEmpty = computed(
  () =>
    review.value.newRecords.length === 0 &&
    review.value.edits.length === 0 &&
    review.value.deletions.length === 0
);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    loading.value = true;
    review.value = { newRecords: [], edits: [], deletions: [] };
    try {
      const resp = await portableWorkspaceMemoryApi.listPendingReview(
        props.conversationId
      );
      if (resp.status && resp.data) {
        review.value = resp.data;
      }
    } catch {
      // advisory
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);

async function refresh(): Promise<void> {
  try {
    const resp = await portableWorkspaceMemoryApi.listPendingReview(
      props.conversationId
    );
    if (resp.status && resp.data) {
      review.value = resp.data;
    }
  } catch {
    // advisory
  }
}

async function onApprove(entry: PortableMemoryReviewEntry): Promise<void> {
  acting.value = true;
  try {
    await portableWorkspaceMemoryApi.approveReview({
      conversationId: props.conversationId,
      memoryId: entry.memoryId,
    });
    await refresh();
    emit("resolved");
  } finally {
    acting.value = false;
  }
}

async function onReject(entry: PortableMemoryReviewEntry): Promise<void> {
  acting.value = true;
  try {
    await portableWorkspaceMemoryApi.rejectReview({
      conversationId: props.conversationId,
      memoryId: entry.memoryId,
    });
    await refresh();
    emit("resolved");
  } finally {
    acting.value = false;
  }
}

async function onApproveDeletion(
  entry: PortableMemoryReviewEntry
): Promise<void> {
  acting.value = true;
  try {
    await portableWorkspaceMemoryApi.approveDeletion({
      conversationId: props.conversationId,
      memoryId: entry.memoryId,
    });
    await refresh();
    emit("resolved");
  } finally {
    acting.value = false;
  }
}

async function onRejectDeletion(
  entry: PortableMemoryReviewEntry
): Promise<void> {
  acting.value = true;
  try {
    await portableWorkspaceMemoryApi.rejectDeletion({
      conversationId: props.conversationId,
      memoryId: entry.memoryId,
    });
    await refresh();
    emit("resolved");
  } finally {
    acting.value = false;
  }
}

const titleText = computed(() =>
  tr("portableMemory.reviewTitle", "Review external changes")
);
const loadingText = computed(() =>
  tr("portableMemory.loadingReview", "Loading pending changes…")
);
const emptyText = computed(() =>
  tr("portableMemory.noPending", "No pending changes.")
);
const newRecordsText = computed(() =>
  tr("portableMemory.reviewNew", "New records")
);
const editsText = computed(() =>
  tr("portableMemory.reviewEdits", "Edits to known records")
);
const deletionsText = computed(() =>
  tr("portableMemory.reviewDeletions", "Deleted files")
);
const approveText = computed(() => tr("portableMemory.approve", "Approve"));
const rejectText = computed(() => tr("portableMemory.reject", "Reject"));
const approveDeletionText = computed(() =>
  tr("portableMemory.approveDeletion", "Confirm deletion")
);
const rejectDeletionText = computed(() =>
  tr("portableMemory.rejectDeletion", "Keep record")
);
const closeText = computed(() => tr("common.close", "Close"));
</script>

<style scoped>
.pmr__section {
  margin-bottom: 16px;
}
.pmr__section-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.pmr__row {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 8px;
}
.pmr__path {
  font-size: 11px;
  word-break: break-all;
}
.pmr__title-text {
  font-weight: 500;
  margin-left: 8px;
}
.pmr__preview {
  font-size: 11px;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 4px 0;
  max-height: 120px;
  overflow: auto;
}
.pmr__message {
  font-size: 12px;
  opacity: 0.8;
}
.pmr__actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
