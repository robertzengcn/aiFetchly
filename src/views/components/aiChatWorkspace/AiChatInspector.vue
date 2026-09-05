<template>
  <aside
    class="workspace-inspector"
    :class="{ overlay: overlay === true }"
    :style="overlay === true ? undefined : { width: `${width}px` }"
    :aria-label="t('workspaceChat.inspector.region') || 'Inspector'"
    data-testid="workspace-inspector"
  >
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
        v-if="activeTab === 'artifacts'"
        :conversation-id="conversationId"
      />
      <AiChatActivityPanel
        v-if="activeTab === 'activity'"
        :conversation-id="conversationId"
        :messages="messages"
      />
      <AiChatContextPanel
        v-if="activeTab === 'context'"
        :conversation-id="conversationId"
        :messages="messages"
        @compact="emit('compact')"
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
  (e: "close"): void;
}>();

const { t } = useI18n();

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

.workspace-inspector.overlay {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(92vw, 520px);
  z-index: 30;
  box-shadow: -6px 0 24px rgba(0, 0, 0, 0.18);
}

.inspector-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
