<template>
  <div class="artifacts-panel" data-testid="workspace-artifacts-panel">
    <!-- Full-height preview of the selected artifact (single sandboxed
         iframe — design §18.1). -->
    <div v-if="previewArtifact" class="artifact-preview">
      <AiArtifactWorkspace
        :artifact="previewArtifact"
        :error="previewError ?? undefined"
        @close="closePreview"
        @copy-html="onCopyHtml"
      />
    </div>

    <template v-else>
      <div class="panel-toolbar">
        <span class="panel-title">
          {{ t('workspaceChat.inspector.artifacts') || 'Artifacts' }}
        </span>
        <button
          type="button"
          class="inline-action"
          data-testid="workspace-artifacts-refresh"
          @click="loadArtifacts"
        >
          {{ t('common.refresh') || 'Refresh' }}
        </button>
      </div>

      <p v-if="!conversationId" class="panel-empty">
        {{ t('workspaceChat.artifacts.selectConversation') || 'Select a conversation to see its generated outputs.' }}
      </p>
      <p v-else-if="loading" class="panel-empty">
        {{ t('common.loading') || 'Loading…' }}
      </p>
      <p v-else-if="artifacts.length === 0" class="panel-empty">
        {{
          t('workspaceChat.artifacts.empty') ||
          'Generated reports and pages appear here. Ask for an HTML report to create one.'
        }}
      </p>

      <ul v-else class="artifact-list">
        <li v-for="artifact in artifacts" :key="artifact.id">
          <button
            type="button"
            class="artifact-row"
            :data-testid="`workspace-artifact-${artifact.id}`"
            @click="openPreview(artifact.id)"
          >
            <v-icon icon="mdi-language-html5" size="18" aria-hidden="true" />
            <span class="artifact-main">
              <span class="artifact-title">{{ artifact.title }}</span>
              <span class="artifact-meta">
                v{{ artifact.version }} · {{ formatTime(artifact.updatedAt) }}
              </span>
            </span>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  getAIArtifact,
  listAIArtifacts,
} from "@/views/api/aiArtifacts";
import type {
  AIArtifactRecord,
  AIArtifactSummary,
} from "@/entityTypes/aiArtifactTypes";
import AiArtifactWorkspace from "@/views/components/aiArtifacts/AiArtifactWorkspace.vue";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";

const props = defineProps<{
  conversationId: string | null;
}>();

const { t } = useI18n();
const workspaceStore = useChatWorkspaceStore();

const artifacts = ref<readonly AIArtifactSummary[]>([]);
const loading = ref(false);
const previewArtifact = ref<AIArtifactRecord | null>(null);
const previewError = ref<string | null>(null);

async function loadArtifacts(): Promise<void> {
  if (!props.conversationId) {
    artifacts.value = [];
    return;
  }
  loading.value = true;
  try {
    artifacts.value = await listAIArtifacts(props.conversationId);
  } catch {
    artifacts.value = [];
  } finally {
    loading.value = false;
  }
}

/** The preview fetches full content by ID after validation (design §21.2). */
async function openPreview(artifactId: string): Promise<void> {
  previewError.value = null;
  try {
    previewArtifact.value = await getAIArtifact(artifactId);
  } catch (err) {
    previewArtifact.value = null;
    previewError.value =
      err instanceof Error ? err.message : "Failed to load artifact";
  }
}

function closePreview(): void {
  // Closing the preview preserves the artifact record (PRD §14.2).
  previewArtifact.value = null;
}

async function onCopyHtml(): Promise<void> {
  if (!previewArtifact.value) return;
  try {
    await navigator.clipboard.writeText(previewArtifact.value.content);
  } catch {
    // Clipboard permission may be denied — non-fatal.
  }
}

function formatTime(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toLocaleString();
}

onMounted(() => {
  void loadArtifacts();
});

// FR-026/FR-030: auto-open a requested artifact (openImmediately or an
// artifact card click) and consume the request once handled.
watch(
  () => workspaceStore.requestedArtifactId,
  (artifactId) => {
    if (!artifactId) return;
    workspaceStore.requestedArtifactId = null;
    void openPreview(artifactId);
  },
  { immediate: true }
);

watch(
  () => props.conversationId,
  () => {
    // Switching or closing conversations clears content from reactive
    // state (design §14.4).
    previewArtifact.value = null;
    void loadArtifacts();
  }
);
</script>

<style scoped>
.artifacts-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.artifact-preview {
  flex: 1;
  min-height: 0;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.inline-action {
  border: none;
  background: none;
  color: rgb(var(--v-theme-primary));
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}

.panel-empty {
  padding: 16px 14px;
  font-size: 12.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.artifact-list {
  list-style: none;
  margin: 0;
  padding: 0 6px;
  overflow-y: auto;
}

.artifact-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.artifact-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.artifact-row:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.artifact-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.artifact-title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
</style>
