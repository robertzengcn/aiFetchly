<template>
  <div class="chat-center" data-testid="chat-center-surface">
    <AiChatConversationHeader
      :title="headerTitle"
      :runtime-status="selectedStore.runtimeStatus"
      :recovering="recovering"
      :active-tool-count="activeToolCount"
      :inspector-open="workspaceStore.inspectorOpen"
      :has-conversation="Boolean(conversationId)"
      @toggle-inspector="workspaceStore.toggleInspector()"
      @open-status="workspaceStore.openInspector('activity')"
      @rename="onRename"
      @compact="onCompact"
      @export="onExport"
      @duplicate="onDuplicate"
      @clear="onClear"
      @delete="onDelete"
    />

    <!-- Conversation workspace chooser (design §9.2): directly below the
         header, above the run strip and transcript, inside the center. -->
    <div class="chat-center__workspace-strip" data-testid="chat-workspace-strip">
      <template v-if="conversationId">
        <WorkspaceBadge
          :workspace="conversationWorkspace.workspace.value"
          :memory-count="conversationWorkspace.memoryCount.value"
          @request-set-workspace="onRequestWorkspaceSetup"
          @request-open-memory="openWorkspaceMemory"
        />
        <p
          v-if="conversationWorkspace.errorMessage.value"
          class="chat-center__workspace-error"
          role="status"
        >
          {{ conversationWorkspace.errorMessage.value }}
        </p>
        <WorkspaceRequiredCard
          v-if="conversationWorkspace.setupOpen.value && conversationId"
          :conversation-id="conversationId"
          @approved="onWorkspaceApproved"
          @cancel="conversationWorkspace.closeSetup()"
        />
        <WorkspaceTrustCard
          v-if="
            conversationWorkspace.trustCardVisible.value &&
            conversationWorkspace.watchId.value &&
            conversationId
          "
          :workspace-id="conversationWorkspace.watchId.value"
          :conversation-id="conversationId"
          @trusted="conversationWorkspace.trustAccepted()"
          @dismissed="conversationWorkspace.trustDismissed()"
        />
      </template>
    </div>

    <AiChatRunStrip
      :runtime-status="selectedStore.runtimeStatus"
      :recovering="recovering"
      :goal-objective="activeGoalObjective"
      :loop-status="activeLoopStatus"
      @stop="onStopFromStrip"
      @open-details="workspaceStore.openInspector('activity')"
    />

    <div class="chat-center__messages">
      <p v-if="selectedStore.loading" class="center-state">
        {{ t("common.loading") || "Loading…" }}
      </p>
      <p v-else-if="selectedStore.loadError" class="center-state error" role="alert">
        {{ selectedStore.loadError }}
      </p>
      <div
        v-else-if="!conversationId"
        class="center-state empty"
        data-testid="workspace-empty-state"
      >
        <v-icon icon="mdi-chat-outline" size="40" aria-hidden="true" />
        <p>
          {{
            t("workspaceChat.empty.title") ||
            "Ask anything, or pick a conversation on the left."
          }}
        </p>
        <v-btn color="primary" data-testid="workspace-empty-new-chat" @click="onNewChat">
          {{ t("workspaceChat.newChat") || "New chat" }}
        </v-btn>
      </div>
      <AiChatWorkspaceTranscript
        v-else
        :messages="[...selectedStore.messages]"
        :active-assistant-message-id="selectedStore.activeAssistantMessageId"
        :stream-status="streamStatusForMessages"
        :error-message="selectedStore.errorMessage ?? undefined"
        :show-reasoning="true"
        :plan-submit-error="planSubmitError"
        @approve-plan="onLegacyPlanAction('approve-plan')"
        @request-plan-changes="onRequestPlanChangesWithFeedback"
        @submit-plan-answers="onPlanAnswers"
        @discard="onLegacyPlanAction('reject-plan')"
        @open-activity="workspaceStore.openInspector('activity')"
        @reopen-artifact="workspaceStore.requestArtifactPreview($event)"
      />
      <button
        v-if="selectedStore.hasOlder && conversationId"
        type="button"
        class="load-older"
        :disabled="selectedStore.loadingOlder"
        data-testid="workspace-load-older"
        @click="selectedStore.loadOlder()"
      >
        {{ t("workspaceChat.loadOlder") || "Load older messages" }}
      </button>
    </div>

    <!-- Composer with next-message controls BELOW the textarea (design §10):
         mode/model/tool approval/context live in the lower `controls` slot,
         the spoken-response toggle in `toolbar-actions`. -->
    <AiChatV2Composer
      :is-streaming="selectedStore.isBusy"
      :conversation-id="conversationId"
      :voice-enabled="voice.inputEnabled.value"
      :voice-auto-send="voice.autoSend.value"
      :voice-max-recording-ms="voice.maxRecordingMs.value"
      :voice-model-missing="voice.missingInputModel.value"
      :voice-runtime-unavailable="voice.runtimeUnavailable.value"
      :voice-model-installing="voice.modelInstalling.value"
      :voice-model-install-error="voice.modelInstallError.value"
      :voice-playback-error="voice.playbackError.value"
      :voice-speaking="voice.speaking.value"
      :voice-chat-ready="voice.chatReady.value"
      @send="onComposerSend"
      @stop="selectedStore.stopActiveRun()"
      @install-voice-model="voice.installRequiredModel"
      @install-voice-runtime="voice.installRequiredRuntime"
      @voice-recording-start="voice.onRecordingStart"
      @stop-speaking="voice.stopSpeaking"
      @open-voice-settings="openVoiceSettings"
    >
      <template #controls>
        <AiChatV2ModeSelector v-model="mode" :disabled="selectedStore.isBusy" />
        <AiChatV2ModelSelector
          v-model="selectedModel"
          :items="availableModels"
          :default-model="defaultModelId"
          :disabled="selectedStore.isBusy"
          :loading="availableModels.length === 0"
        />
        <AiChatV2ToolApprovalModeSelector
          v-model="toolApprovalMode"
          :disabled="selectedStore.isBusy"
          @update:model-value="onToolApprovalModeChange"
        />
        <button
          type="button"
          class="context-indicator"
          data-testid="workspace-context-indicator"
          :aria-label="t('workspaceChat.inspector.context') || 'Context'"
          @click="workspaceStore.openInspector('context')"
        >
          <AiChatV2ContextBadge
            :percent="contextPercent"
            :used-tokens="contextUsedTokens"
          />
        </button>
      </template>
      <template #toolbar-actions>
        <AiChatVoiceOutputToggle
          :enabled="voice.spokenResponseEnabled.value"
          :saving="voice.settingsSaving.value"
          :unavailable="voice.runtimeUnavailable.value"
          @toggle="voice.toggleSpokenResponse"
          @open-settings="openVoiceSettings"
        />
      </template>
    </AiChatV2Composer>

    <!-- TTS prerequisite notice (shared voice states, design §11.4). -->
    <div
      v-if="voice.ttsInstallPrompt.value"
      class="chat-center__tts-notice"
      role="status"
      aria-live="polite"
    >
      <v-icon size="x-small" color="warning" class="mr-1">mdi-volume-off</v-icon>
      <span class="chat-center__tts-notice-text">
        {{
          t("aiChatV2.voice.tts_model_missing") ||
          "Spoken responses need a speech model. Install it to enable."
        }}
      </span>
      <v-btn
        size="x-small"
        color="primary"
        variant="tonal"
        class="ml-2"
        data-testid="install-tts-model"
        :loading="voice.modelInstalling.value"
        :disabled="voice.modelInstalling.value"
        @click="voice.installTtsModel"
      >
        {{
          voice.modelInstalling.value
            ? t("aiChatV2.voice.installing_model") || "Installing..."
            : t("aiChatV2.voice.install_tts_model") || "Install speech model"
        }}
      </v-btn>
      <v-btn
        size="x-small"
        variant="text"
        class="ml-1"
        :aria-label="t('aiChatV2.voice.open_model_settings') || 'Open settings'"
        @click="openVoiceSettings"
      >
        {{ t("aiChatV2.voice.open_model_settings") || "Open settings" }}
      </v-btn>
    </div>

    <AiChatVoiceRuntimeInstallDialog
      v-model="voiceRuntimeInstallDialog"
      :installing="voice.runtimeInstalling.value"
      :error="voice.runtimeInstallError.value"
      :size-text="voice.runtimeInstallSizeText.value"
      :progress-text="voice.runtimeInstallProgressText.value"
      :percent="voice.runtimeInstallPercent.value"
      @confirm="voice.confirmRuntimeInstall"
    />

    <!-- Workspace memory dialog (existing surface, fed by the composable). -->
    <v-dialog v-model="showWorkspaceMemory" max-width="760">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-brain</v-icon>
          <span>{{ t("workspaceMemory.panelTitle") || "Workspace memory" }}</span>
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            @click="showWorkspaceMemory = false"
          />
        </v-card-title>
        <v-divider />
        <WorkspaceMemoryPanel
          v-if="conversationId"
          :conversation-id="conversationId"
          :workspace="conversationWorkspace.workspace.value"
          @change="conversationWorkspace.refreshMemoryCount"
        />
      </v-card>
    </v-dialog>

    <!-- In-app prompt surface (Electron has no window.prompt). -->
    <v-dialog
      :model-value="promptDialog !== null"
      max-width="420"
      @update:model-value="(v: boolean) => !v && settlePrompt(null)"
    >
      <v-card v-if="promptDialog" data-testid="app-prompt-dialog">
        <v-card-title>{{ promptDialog.title }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="promptInput"
            variant="outlined"
            density="compact"
            autofocus
            data-testid="app-prompt-input"
            @keydown.enter="settlePrompt(promptInput)"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="app-prompt-cancel" @click="settlePrompt(null)">
            {{ t("common.cancel") || "Cancel" }}
          </v-btn>
          <v-btn
            color="primary"
            data-testid="app-prompt-confirm"
            @click="settlePrompt(promptInput)"
          >
            {{ t("common.ok") || "OK" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import AiChatWorkspaceTranscript from "@/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue";
import AiChatConversationHeader from "@/views/components/aiChatWorkspace/AiChatConversationHeader.vue";
import AiChatRunStrip from "@/views/components/aiChatWorkspace/AiChatRunStrip.vue";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import AiChatV2ModeSelector from "@/views/components/aiChatV2/AiChatV2ModeSelector.vue";
import AiChatV2ModelSelector from "@/views/components/aiChatV2/AiChatV2ModelSelector.vue";
import AiChatV2ToolApprovalModeSelector from "@/views/components/aiChatV2/AiChatV2ToolApprovalModeSelector.vue";
import AiChatV2ContextBadge from "@/views/components/aiChatV2/AiChatV2ContextBadge.vue";
import AiChatVoiceOutputToggle from "@/views/components/aiChatV2/AiChatVoiceOutputToggle.vue";
import AiChatVoiceRuntimeInstallDialog from "@/views/components/aiChatV2/AiChatVoiceRuntimeInstallDialog.vue";
import WorkspaceBadge from "@/views/components/aiChatV2/WorkspaceBadge.vue";
import WorkspaceRequiredCard from "@/views/components/aiChatV2/WorkspaceRequiredCard.vue";
import WorkspaceTrustCard from "@/views/components/aiChatV2/WorkspaceTrustCard.vue";
import WorkspaceMemoryPanel from "@/views/components/aiChatV2/WorkspaceMemoryPanel.vue";
import {
  computeContextPercent,
  DEFAULT_CONTEXT_WINDOW,
} from "@/views/components/aiChatV2/contextUsageUtil";
import type { OpenAIModel } from "@/api/aiChatApi";
import {
  getOpenAIChatModels,
  getChatV2ToolApprovalMode,
  setChatV2ToolApprovalMode,
  approveChatV2Plan,
  rejectChatV2Plan,
  requestChatV2PlanChanges,
  answerChatV2Question,
  clearChatV2Conversation,
  compactChatV2Conversation,
} from "@/views/api/aiChatV2";
import { stopGoalLoop } from "@/views/api/aiChatGoal";
import { controlScheduledLoop } from "@/views/api/aiChatScheduledLoop";
import type {
  ChatV2Mode,
  ChatToolApprovalMode,
} from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";
import type { AskUserQuestionAnswer } from "@/entityTypes/aiChatPlanTypes";
import {
  renameConversation,
  deleteConversation,
  duplicateConversation,
  exportConversation,
} from "@/views/api/aiChatWorkspace";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { useAppInspectorStore } from "@/views/store/appInspector";
import { useConversationWorkspace } from "@/views/composables/useConversationWorkspace";
import { useAiChatVoice } from "@/views/composables/useAiChatVoice";
import {
  createAndSelectWorkspaceChat,
  useChatWorkspaceSelection,
} from "@/views/composables/chatWorkspaceSelection";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const workspaceStore = useChatWorkspaceStore();
const selectedStore = useSelectedConversationStore();
const inspector = useAppInspectorStore();

/**
 * Center-surface chat route (design §8): conversation presentation only —
 * no sidebar, no second responsive observer, no direct inspector mount.
 */
const selectionApi = useChatWorkspaceSelection();

const conversationId = computed(() => workspaceStore.selectedConversationId);

// --- Shared conversation workspace + voice state ---------------------------
const conversationWorkspace = useConversationWorkspace(conversationId);
const voice = useAiChatVoice({
  chatReady: () => availableModels.value.length > 0,
});
const voiceRuntimeInstallDialog = computed({
  get: () => voice.runtimeInstallDialog.value,
  set: (value: boolean) => {
    voice.runtimeInstallDialog.value = value;
  },
});
const showWorkspaceMemory = ref(false);

function openWorkspaceMemory(): void {
  const workspace = conversationWorkspace.workspace.value;
  if (!workspace || workspace.approvalState !== "approved") {
    showWorkspaceMemory.value = false;
    return;
  }
  showWorkspaceMemory.value = true;
}

/** Workspace setup needs a conversation id first (classic-chat parity). */
function onRequestWorkspaceSetup(): void {
  if (!conversationId.value) {
    void onNewChat();
  }
  conversationWorkspace.requestSetup();
}

/** The required-card flow created + approved a workspace in the main process. */
function onWorkspaceApproved(workspaceId: number, rootPath: string): void {
  conversationWorkspace.applyApprovedWorkspace(workspaceId, rootPath);
}

// --- Header + run strip projection ------------------------------------------
const headerTitle = computed(() => {
  const summary = workspaceStore.selectedConversation;
  return summary?.title || selectedStore.selectedTitle;
});

const recovering = computed(() => selectedStore.recovery !== null);

const streamStatusForMessages = computed<
  "idle" | "streaming" | "cancelled" | "error"
>(() => {
  if (selectedStore.streamStatus === "streaming") return "streaming";
  if (selectedStore.streamStatus === "error") return "error";
  if (selectedStore.streamStatus === "cancelled") return "cancelled";
  if (selectedStore.runtimeStatus === "running") return "streaming";
  return "idle";
});

const activeToolCount = computed(() => {
  let count = 0;
  for (let i = selectedStore.messages.length - 1; i >= 0; i -= 1) {
    const message = selectedStore.messages[i];
    if (message.role === "user") break;
    if (
      message.messageType === MessageType.TOOL_CALL ||
      message.messageType === MessageType.TOOL_RESULT
    ) {
      count += 1;
    }
  }
  return count;
});

const activeGoalObjective = computed(() => {
  const goal = selectedStore.goal;
  if (!goal) return null;
  const activeStatuses = ["running", "active", "pending"];
  return activeStatuses.includes(goal.status) ? goal.objective || goal.goalId : null;
});

const activeLoopStatus = computed(() => selectedStore.scheduledLoop?.status ?? null);

/** One primary stop action (PRD §13.3): goal → loop → active run. */
async function onStopFromStrip(): Promise<void> {
  if (!conversationId.value) return;
  if (activeGoalObjective.value) {
    try {
      await stopGoalLoop(conversationId.value);
      return;
    } catch {
      // fall through to the run stop
    }
  }
  if (activeLoopStatus.value === "running") {
    try {
      await controlScheduledLoop(conversationId.value, "stop");
      return;
    } catch {
      // fall through to the run stop
    }
  }
  await selectedStore.stopActiveRun();
}

// --- Next-message settings (owned here, rendered below the textarea) --------
const LAST_MODEL_STORAGE_KEY = "ai-chat-v2-last-model";
const mode = ref<ChatV2Mode>("chat");
const selectedModel = ref<string | undefined>(undefined);
const availableModels = ref<OpenAIModel[]>([]);
const defaultModelId = ref<string | undefined>(undefined);
const modelContextWindows = ref<Map<string, number>>(new Map());
const toolApprovalMode = ref<ChatToolApprovalMode>("ask_for_approval");

async function loadModels(): Promise<void> {
  try {
    const resp = await getOpenAIChatModels();
    const data = resp?.data;
    if (!Array.isArray(data)) return;
    const validModels = data.filter(
      (m) => m && typeof m.id === "string" && m.id.length > 0
    );
    availableModels.value = validModels;
    defaultModelId.value = resp?.default_model;
    const map = new Map<string, number>();
    for (const model of validModels) {
      const window =
        model.context_size ??
        model.context_window ??
        model.context_length ??
        DEFAULT_CONTEXT_WINDOW;
      if (typeof window === "number" && window > 0) {
        map.set(model.id, window);
      }
    }
    modelContextWindows.value = map;
    const saved = localStorage.getItem(LAST_MODEL_STORAGE_KEY) ?? undefined;
    const usable =
      saved && validModels.some((m) => m.id === saved)
        ? saved
        : defaultModelId.value ?? validModels[0]?.id;
    selectedModel.value = usable;
  } catch {
    // Model list unavailable — "Auto" fallback; sending still works.
  }
}

async function loadApprovalMode(id: string): Promise<void> {
  try {
    const saved = await getChatV2ToolApprovalMode(id);
    if (saved) toolApprovalMode.value = saved;
  } catch {
    // Default stays ask_for_approval.
  }
}

async function onToolApprovalModeChange(next: ChatToolApprovalMode): Promise<void> {
  if (!conversationId.value) return;
  try {
    await setChatV2ToolApprovalMode(conversationId.value, next);
  } catch {
    // Preference persists on the next change.
  }
}

const contextUsedTokens = computed(() => {
  for (let i = selectedStore.messages.length - 1; i >= 0; i -= 1) {
    const tokens = selectedStore.messages[i].tokensUsed;
    if (typeof tokens === "number" && tokens > 0) return tokens;
  }
  return undefined;
});

const contextPercent = computed(() =>
  computeContextPercent({
    modelContextWindows: modelContextWindows.value,
    lastTotalTokens: contextUsedTokens.value,
    streamingEstimatedTokens: 0,
    model: selectedModel.value ?? defaultModelId.value,
  })
);

// --- Selection (layout-provided, local fallback) ----------------------------
async function onNewChat(): Promise<void> {
  if (selectionApi) {
    await selectionApi.createChat();
    return;
  }
  await createAndSelectWorkspaceChat();
}

watch(conversationId, (id, previous) => {
  if (id && id !== previous) {
    void loadApprovalMode(id);
  }
});

// --- Spoken-response feed (deltas from the bounded store projection) --------
let fedMessageId: string | null = null;
let fedLength = 0;

watch(
  [() => selectedStore.activeAssistantMessageId, () => selectedStore.messages],
  () => {
    const id = selectedStore.activeAssistantMessageId;
    if (!id) return;
    if (id !== fedMessageId) {
      fedMessageId = id;
      fedLength = 0;
    }
    const message = selectedStore.messages.find((m) => m.id === id);
    const content = message?.content ?? "";
    if (content.length > fedLength) {
      voice.pushAssistantDelta(content.slice(fedLength));
      fedLength = content.length;
    }
  }
);

watch(
  () => selectedStore.streamStatus,
  (status) => {
    if (status !== "streaming") {
      voice.completeAssistantResponse();
    }
  }
);

// --- Composer send -----------------------------------------------------------
async function encodeFile(file: File): Promise<{
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  kind: "document" | "image";
} | null> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    contentBase64: btoa(binary),
    kind: file.type.startsWith("image/") ? "image" : "document",
  };
}

async function onComposerSend(
  text: string,
  files: File[],
  options?: { fromVoice?: boolean }
): Promise<void> {
  const uploadedFiles =
    files.length > 0
      ? (await Promise.all(files.map(encodeFile))).filter(
          (item): item is NonNullable<Awaited<ReturnType<typeof encodeFile>>> =>
            item !== null
        )
      : undefined;
  if (selectedModel.value) {
    try {
      localStorage.setItem(LAST_MODEL_STORAGE_KEY, selectedModel.value);
    } catch {
      // Storage unavailable — session-only preference.
    }
  }
  voice.beginAssistantResponse(options?.fromVoice === true);
  await selectedStore.sendMessage(text, {
    model: selectedModel.value,
    mode: mode.value,
    toolApprovalMode: toolApprovalMode.value,
    attachments: uploadedFiles,
  });
}

// --- Conversation actions ----------------------------------------------------
const planSubmitError = ref<string | null>(null);

const latestPlanState = computed(() => {
  for (let i = selectedStore.messages.length - 1; i >= 0; i -= 1) {
    const state = selectedStore.messages[i].metadata?.planStateView;
    if (state) return state;
  }
  return null;
});

function onPlanAnswers(answers: unknown[]): void {
  void onAnswerQuestion(answers as AskUserQuestionAnswer[]);
}

async function onAnswerQuestion(answers: AskUserQuestionAnswer[]): Promise<void> {
  if (!conversationId.value) return;
  const questionId = (() => {
    for (let i = selectedStore.messages.length - 1; i >= 0; i -= 1) {
      const q = selectedStore.messages[i].metadata?.questionView;
      if (q?.status === "pending") return (q as { questionId: string }).questionId;
    }
    return null;
  })();
  if (!questionId) return;
  try {
    const result = await answerChatV2Question(conversationId.value, questionId, answers);
    planSubmitError.value = result.ok ? null : result.error || "Submission failed";
    if (!result.ok) {
      console.warn("[ai-chat-center] answer submission failed:", result.error);
    }
  } catch {
    // Retain answers for retry (design §31).
  }
}

const promptDialog = ref<{
  title: string;
  initial: string;
  resolve: (value: string | null) => void;
} | null>(null);
const promptInput = ref("");

function appPrompt(title: string, initial = ""): Promise<string | null> {
  promptInput.value = initial;
  return new Promise((resolve) => {
    promptDialog.value = { title, initial, resolve };
  });
}

function settlePrompt(value: string | null): void {
  const dialog = promptDialog.value;
  promptDialog.value = null;
  dialog?.resolve(value);
}

function openVoiceSettings(): void {
  void router.push({ name: "system_setting_ai_provider" });
}

async function onRename(): Promise<void> {
  if (!conversationId.value) return;
  const next = await appPrompt(
    t("workspaceChat.header.renamePrompt") || "Rename chat",
    headerTitle.value ?? ""
  );
  if (!next || !next.trim()) return;
  try {
    await renameConversation({
      conversationId: conversationId.value,
      title: next.trim(),
    });
    await workspaceStore.bootstrap();
  } catch {
    // Non-fatal — the title stays unchanged.
  }
}

async function onCompact(): Promise<void> {
  if (!conversationId.value) return;
  try {
    await compactChatV2Conversation(conversationId.value);
  } catch {
    // Non-fatal — the run strip still shows progress.
  }
}

async function onExport(): Promise<void> {
  if (!conversationId.value) return;
  try {
    const transcript = await exportConversation(conversationId.value);
    const blob = new Blob([JSON.stringify(transcript, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `conversation-${conversationId.value}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    // Non-fatal — export can be retried.
  }
}

async function onDuplicate(): Promise<void> {
  if (!conversationId.value) return;
  try {
    const result = await duplicateConversation(conversationId.value);
    await workspaceStore.bootstrap();
    await selectedStore.loadSelection(result.conversationId);
  } catch {
    // Non-fatal — duplication can be retried.
  }
}

async function onDelete(): Promise<void> {
  if (!conversationId.value) return;
  const confirmed = window.confirm(
    t("workspaceChat.header.deleteConfirm") ||
      "Delete this conversation? All messages and generated artifacts will be removed. This cannot be undone."
  );
  if (!confirmed) return;
  try {
    await deleteConversation(conversationId.value);
    await workspaceStore.bootstrap();
    await selectedStore.loadSelection(null);
  } catch {
    // Non-fatal — deletion can be retried.
  }
}

async function onClear(): Promise<void> {
  if (!conversationId.value) return;
  if (selectedStore.isBusy) {
    // Clearing under an active run would let the engine re-persist its
    // result after the wipe — stop the run first.
    return;
  }
  const confirmed = window.confirm(
    t("workspaceChat.header.clearConfirm") || "Clear all messages in this conversation?"
  );
  if (!confirmed) return;
  try {
    await clearChatV2Conversation(conversationId.value);
    await workspaceStore.bootstrap();
    await selectedStore.loadSelection(conversationId.value);
  } catch {
    // Non-fatal — clearing can be retried.
  }
}

async function onRequestPlanChangesWithFeedback(): Promise<void> {
  const feedback = await appPrompt(
    t("workspaceChat.plan.changeFeedbackPrompt") ||
      "What should change in this plan?"
  );
  if (feedback === null || !feedback.trim()) return;
  await onLegacyPlanAction("request-plan-changes", feedback.trim());
}

async function onLegacyPlanAction(
  action: "approve-plan" | "reject-plan" | "request-plan-changes",
  feedback = ""
): Promise<void> {
  if (!conversationId.value) return;
  const plan = latestPlanState.value;
  const version = plan?.latestVersion?.version ?? plan?.currentVersion;
  if (!plan?.planId || version === undefined) return;
  try {
    if (action === "approve-plan") {
      await approveChatV2Plan(conversationId.value, plan.planId, version);
    } else if (action === "reject-plan") {
      await rejectChatV2Plan(conversationId.value, plan.planId, version, feedback);
    } else {
      await requestChatV2PlanChanges(
        conversationId.value,
        plan.planId,
        version,
        feedback
      );
    }
  } catch {
    // Decision cards remain actionable on failure.
  }
}

// --- Inspector bridge (design §12.3) -----------------------------------------
// chatWorkspace keeps the persisted open/tab/width preferences; the typed
// appInspector store owns target identity and route lifetime.
watch(
  [() => workspaceStore.inspectorOpen, conversationId],
  ([open]) => {
    if (open) {
      const target = inspector.target;
      const stale =
        !target ||
        target.kind !== "chat" ||
        target.conversationId !== conversationId.value;
      if (stale) {
        inspector.open({
          kind: "chat",
          ownerRoute: "/aiworkspace",
          conversationId: conversationId.value,
          tab: workspaceStore.inspectorTab,
        });
      }
    } else if (inspector.target?.kind === "chat") {
      inspector.close();
    }
  },
  { immediate: true }
);

watch(
  () => inspector.target,
  (target) => {
    if (!target && workspaceStore.inspectorOpen) {
      workspaceStore.setInspectorOpen(false);
    }
  }
);

// --- Lifecycle ----------------------------------------------------------------
onMounted(async () => {
  void loadModels();
  void voice.loadSettings();
  if (conversationId.value) {
    void loadApprovalMode(conversationId.value);
  }
  conversationWorkspace.refresh().catch(() => undefined);
  // Dashboard "ask AI" entry (?prompt=): open a fresh chat ready for the
  // prompt. (The composer has no seed prop — parity with the old shell,
  // whose initial-text binding was never consumed.)
  const prompt = route.query.prompt;
  if (typeof prompt === "string" && prompt.trim()) {
    await onNewChat();
  }
});

/**
 * Leaving the chat center (design §8.3) must NOT cancel runs, clear the
 * selected conversation, or drop the workspace summary subscription — those
 * outlive the center surface. Only voice playback state is disposed with the
 * surface itself (the composable's onScopeDispose handles it).
 */
onUnmounted(() => {
  voice.dispose();
});
</script>

<style scoped>
.chat-center {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-center__workspace-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 0;
  flex-shrink: 0;
}

.chat-center__workspace-error {
  margin: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-error));
}

.chat-center__messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 6px;
}

.center-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin: 0;
}

.center-state.error {
  color: rgb(var(--v-theme-error));
}

.center-state.empty {
  flex-direction: column;
  gap: 12px;
}

.load-older {
  align-self: center;
  margin: 4px 0 8px;
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.2);
  border-radius: 999px;
  background: transparent;
  padding: 4px 16px;
  font-size: 12px;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

.load-older:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.load-older:disabled {
  opacity: 0.5;
  cursor: default;
}

.context-indicator {
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  margin-left: auto;
}

.context-indicator:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
  border-radius: 999px;
}

.chat-center__tts-notice {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 4px 12px 8px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.chat-center__tts-notice-text {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
