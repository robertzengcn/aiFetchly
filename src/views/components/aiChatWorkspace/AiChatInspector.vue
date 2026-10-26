<template>
  <aside
    class="workspace-inspector"
    :class="{ overlay: overlay === true, docked: overlay !== true }"
    :style="overlay === true ? undefined : { width: `${width}px` }"
    :aria-label="t('workspaceChat.inspector.region') || 'Inspector'"
    data-testid="workspace-inspector"
    @keydown.escape="emit('close')"
  >
    <div class="inspector-header">
      <v-tabs
        :model-value="activeTab"
        density="compact"
        role="tablist"
        @update:model-value="onTabChange"
      >
        <v-tab
          value="artifacts"
          role="tab"
          data-testid="workspace-inspector-tab-artifacts"
        >
          {{ t('workspaceChat.inspector.artifacts') || 'Artifacts' }}
        </v-tab>
        <v-tab
          value="activity"
          role="tab"
          data-testid="workspace-inspector-tab-activity"
        >
          {{ t('workspaceChat.inspector.activity') || 'Activity' }}
        </v-tab>
        <v-tab
          value="context"
          role="tab"
          data-testid="workspace-inspector-tab-context"
        >
          {{ t('workspaceChat.inspector.context') || 'Context' }}
        </v-tab>
      </v-tabs>
      <button
        type="button"
        class="inspector-close"
        :aria-label="t('workspaceChat.inspector.close') || 'Close inspector'"
        data-testid="workspace-inspector-close"
        @click="emit('close')"
      >
        <v-icon icon="mdi-close" size="18" aria-hidden="true" />
      </button>
    </div>

    <!-- Pointer + keyboard resizable divider (FR-005, design §22.1). -->
    <div
      v-if="resizable"
      class="inspector-resizer"
      role="separator"
      tabindex="0"
      :aria-label="t('workspaceChat.inspector.resize') || 'Resize inspector'"
      aria-orientation="vertical"
      data-testid="workspace-inspector-resizer"
      @keydown="onResizerKeydown"
      @pointerdown="onResizerPointerDown"
    />

    <div class="inspector-body">
      <AiChatArtifactsPanel
        v-if="activeTab === 'artifacts' && specializedResultsEnabled"
        :conversation-id="conversationId"
      />
      <div
        v-else-if="activeTab === 'artifacts'"
        class="inspector-artifacts-fallback"
        data-testid="workspace-inspector-artifacts-fallback"
      >
        {{ t("workspaceChat.inspector.artifactsDisabled") || "Artifact results are unavailable while the specialized-results rollout adapter is rolled back." }}
      </div>
      <AiChatActivityPanel
        v-if="activeTab === 'activity'"
        :conversation-id="conversationId"
        :messages="messages"
      />
      <AiChatContextPanel
        v-if="activeTab === 'context'"
        :conversation-id="conversationId"
        :messages="messages"
        :show-memory="voiceMemoryEnabled"
        @compact="emit('compact')"
        @open-memory="emit('open-memory')"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatArtifactsPanel from "./AiChatArtifactsPanel.vue";
import AiChatActivityPanel from "./AiChatActivityPanel.vue";
import AiChatContextPanel from "./AiChatContextPanel.vue";
import {
  useWorkspaceRolloutAdapters,
} from "@/views/composables/aiChatWorkspace/useWorkspaceRolloutAdapters";

const props = defineProps<{
  activeTab: "artifacts" | "activity" | "context";
  width: number;
  conversationId: string | null;
  messages: readonly ChatV2MessageView[];
  /** Overlay mode (medium/narrow) derives width from the viewport instead. */
  overlay?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:tab", tab: "artifacts" | "activity" | "context"): void;
  (e: "update:width", width: number): void;
  (e: "compact"): void;
  (e: "open-memory"): void;
  (e: "close"): void;
}>();

const { t } = useI18n();

/** A02 (§23.1): artifacts degrade to a placeholder when the adapter is off. */
const rolloutAdapters = useWorkspaceRolloutAdapters();
const specializedResultsEnabled = rolloutAdapters.specializedResults;
/** A02 (§23.1): the memory entry gate mirrors the badge (adapter answer). */
const voiceMemoryEnabled = rolloutAdapters.voiceMemory;

/** Resizing applies on wide screens only (design §15.8). */
const resizable = computed(() => props.overlay !== true);

function onResizerPointerDown(event: PointerEvent): void {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = props.width;
  const onMove = (move: PointerEvent): void => {
    // Dragging left grows the panel (resizer sits on the left edge).
    emit("update:width", startWidth + (startX - move.clientX));
  };
  const onUp = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function onTabChange(value: unknown): void {
  if (value === "artifacts" || value === "activity" || value === "context") {
    emit("update:tab", value);
  }
}

function onResizerKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 48 : 16;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    emit("update:width", props.width - step);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    emit("update:width", props.width + step);
  }
}
</script>

<style scoped>
.workspace-inspector {
  position: relative;
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.12);
  background: rgb(var(--v-theme-surface));
  flex-shrink: 0;
}

.inspector-resizer {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 2;
}

.inspector-resizer:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -1px;
}

.inspector-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 4px;
  flex-shrink: 0;
}

.inspector-header .v-tabs {
  flex: 1;
  min-width: 0;
}

.inspector-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  flex-shrink: 0;
}

.inspector-close:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.inspector-close:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.workspace-inspector.overlay {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(92vw, 520px);
  z-index: 30;
  box-shadow: -6px 0 24px rgba(0, 0, 0, 0.18);
}

/*
 * Docked (wide-mode) variant: the inspector host renders INLINE inside the
 * shell's flex row (dock-column change 2026-10-26) — the panel is the row's
 * third column: real layout space, not a floating panel. The inline width
 * style still applies and the resizer works; height follows the shell row.
 */
.workspace-inspector.docked {
  position: relative;
  height: 100%;
}

.inspector-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.inspector-artifacts-fallback {
  flex: 1;
  padding: 16px;
  font-size: 13px;
  color: rgba(var(--v-theme-on-surface), 0.64);
}
</style>
