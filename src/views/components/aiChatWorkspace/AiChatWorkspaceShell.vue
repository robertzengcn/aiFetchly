<template>
  <div
    class="workspace-shell"
    :data-viewport="viewport"
    data-testid="workspace-shell"
  >
    <!-- Narrow (FR-006): the sidebar is a separate overlay surface with a
         backdrop; selection or Back returns to the conversation. -->
    <div
      v-if="viewport === 'narrow' && sidebarOpen"
      class="sidebar-backdrop"
      data-testid="workspace-sidebar-backdrop"
      @click="sidebarOpen = false"
    />
    <AiChatWorkspaceSidebar
      v-if="viewport !== 'narrow' || sidebarOpen"
      :redesign-default="redesignDefault"
      @select="
        (id) => {
          sidebarOpen = false;
          void onSelectConversation(id);
        }
      "
      @new-chat="
        () => {
          sidebarOpen = false;
          void onNewChat();
        }
      "
      @retry="workspaceStore.bootstrap()"
      @toggle-mode="onToggleMode"
    />

    <main class="workspace-center">
      <button
        v-if="viewport === 'narrow'"
        type="button"
        class="sidebar-toggle"
        :aria-label="t('workspaceChat.sidebar.region') || 'Chat workspaces'"
        data-testid="workspace-sidebar-toggle"
        @click="sidebarOpen = !sidebarOpen"
      >
        <v-icon icon="mdi-menu" size="20" aria-hidden="true" />
      </button>
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

      <AiChatRunStrip
        :runtime-status="selectedStore.runtimeStatus"
        :recovering="recovering"
        :goal-objective="activeGoalObjective"
        :loop-status="activeLoopStatus"
        @stop="onStopFromStrip"
        @open-details="workspaceStore.openInspector('activity')"
      />

      <div class="workspace-messages">
        <!-- Loading / empty / error states (PRD §23). -->
        <p v-if="selectedStore.loading" class="center-state">
          {{ t('common.loading') || 'Loading…' }}
        </p>
        <p
          v-else-if="selectedStore.loadError"
          class="center-state error"
          role="alert"
        >
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
              t('workspaceChat.empty.title') ||
              'Ask anything, or pick a conversation on the left.'
            }}
          </p>
          <v-btn color="primary" data-testid="workspace-empty-new-chat" @click="onNewChat">
            {{ t('workspaceChat.newChat') || 'New chat' }}
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
          @request-plan-changes="onLegacyPlanAction('request-plan-changes', $event)"
          @submit-plan-answers="onPlanAnswers"
          @discard="onLegacyPlanAction('reject-plan')"
          @open-activity="workspaceStore.openInspector('activity')"
        />
        <button
          v-if="selectedStore.hasOlder && conversationId"
          type="button"
          class="load-older"
          :disabled="selectedStore.loadingOlder"
          data-testid="workspace-load-older"
          @click="selectedStore.loadOlder()"
        >
          {{ t('workspaceChat.loadOlder') || 'Load older messages' }}
        </button>
      </div>

      <!-- Composer-scoped controls (PRD §13.1, FR-012): everything that
           affects the NEXT message lives at the composer; the context
           indicator opens the Context inspector (PRD §13.2). -->
      <div class="composer-controls" data-testid="workspace-composer-controls">
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
      </div>

      <!-- FR-062: plan decision surfaces are owned exclusively by the
           transcript (AiChatWorkspaceTranscript). The dock no longer
           duplicates plan-question/decision/receipt surfaces. The run
           strip carries plan status; Activity carries the full document. -->
      />

      <AiChatV2Composer
        :is-streaming="selectedStore.isBusy"
        :conversation-id="conversationId"
        @send="onComposerSend"
        @stop="selectedStore.stopActiveRun()"
        @install-voice-model="openVoiceSettings"
        @install-voice-runtime="openVoiceSettings"
        @voice-recording-start="onStopSpeaking"
        @stop-speaking="onStopSpeaking"
        @open-voice-settings="openVoiceSettings"
      />
    </main>

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
            {{ t('common.cancel') || 'Cancel' }}
          </v-btn>
          <v-btn
            color="primary"
            data-testid="app-prompt-confirm"
            @click="settlePrompt(promptInput)"
          >
            {{ t('common.ok') || 'OK' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <AiChatInspector
      v-if="workspaceStore.inspectorOpen"
      :active-tab="workspaceStore.inspectorTab"
      :width="workspaceStore.inspectorWidth"
      :overlay="viewport !== 'wide'"
      :conversation-id="conversationId"
      :messages="[...selectedStore.messages]"
      @update:tab="workspaceStore.setInspectorTab"
      @update:width="workspaceStore.setInspectorWidth"
      @compact="onCompact"
      @close="workspaceStore.toggleInspector()"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import AiChatWorkspaceTranscript from "@/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import AiChatV2ModeSelector from "@/views/components/aiChatV2/AiChatV2ModeSelector.vue";
import AiChatV2ModelSelector from "@/views/components/aiChatV2/AiChatV2ModelSelector.vue";
import AiChatV2ToolApprovalModeSelector from "@/views/components/aiChatV2/AiChatV2ToolApprovalModeSelector.vue";
import AiChatV2ContextBadge from "@/views/components/aiChatV2/AiChatV2ContextBadge.vue";
import {
  computeContextPercent,
  DEFAULT_CONTEXT_WINDOW,
} from "@/views/components/aiChatV2/contextUsageUtil";
import type { OpenAIModel } from "@/api/aiChatApi";
import {
  getOpenAIChatModels,
  getChatV2ToolApprovalMode,
  setChatV2ToolApprovalMode,
} from "@/views/api/aiChatV2";
import { stopGoalLoop } from "@/views/api/aiChatGoal";
import { cancelVoiceJob } from "@/views/api/aiChatV2Voice";
import { controlScheduledLoop } from "@/views/api/aiChatScheduledLoop";
import type {
  ChatV2Mode,
  ChatToolApprovalMode,
} from "@/entityTypes/aiChatV2Types";
import {
  approveChatV2Plan,
  rejectChatV2Plan,
  requestChatV2PlanChanges,
  answerChatV2Question,
  clearChatV2Conversation,
  compactChatV2Conversation,
} from "@/views/api/aiChatV2";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import {
  createWorkspaceConversationId,
  renameConversation,
  deleteConversation,
  duplicateConversation,
  exportConversation,
  isWorkspaceRedesignEnabled,
  setWorkspaceRedesignEnabled,
} from "@/views/api/aiChatWorkspace";
import { useRoute, useRouter } from "vue-router";
import { MessageType } from "@/entityTypes/commonType";
import type { AskUserQuestionAnswer } from "@/entityTypes/aiChatPlanTypes";
import AiChatWorkspaceSidebar from "./AiChatWorkspaceSidebar.vue";
import AiChatConversationHeader from "./AiChatConversationHeader.vue";
import AiChatRunStrip from "./AiChatRunStrip.vue";
import AiChatInspector from "./AiChatInspector.vue";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const workspaceStore = useChatWorkspaceStore();
const selectedStore = useSelectedConversationStore();

/** Rollout flag state (PRD §33) — drives the footer mode toggle. */
const redesignDefault = ref(false);

/** Narrow/medium/wide layout mode from measured width (design §15.8). */
const viewport = ref<"wide" | "medium" | "narrow">("wide");
const sidebarOpen = ref(false);

function updateViewport(): void {
  const width = window.innerWidth;
  viewport.value = width < 900 ? "narrow" : width < 1280 ? "medium" : "wide";
}

const conversationId = computed(() => workspaceStore.selectedConversationId);

const headerTitle = computed(() => {
  const summary = workspaceStore.selectedConversation;
  return summary?.title || selectedStore.selectedTitle;
});

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

/** Seven-layer recovery is live when recovery_status events arrive. */
const recovering = computed(() => selectedStore.recovery !== null);

/** FR-059: plan-question submission error surfaced to the transcript flow. */
const planSubmitError = ref<string | null>(null);

/** Goal objective while a goal loop is active (PRD §13.3). */
const activeGoalObjective = computed(() => {
  const goal = selectedStore.goal;
  if (!goal) return null;
  const activeStatuses = ["running", "active", "pending"];
  return activeStatuses.includes(goal.status) ? goal.objective || goal.goalId : null;
});

/** Scheduled-loop status for the strip (message metadata authority). */
const activeLoopStatus = computed(() => {
  const loop = selectedStore.scheduledLoop;
  return loop?.status ?? null;
});

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

/** Newest plan state carried by message metadata (durable authority). */
const latestPlanState = computed(() => {
  for (let i = selectedStore.messages.length - 1; i >= 0; i -= 1) {
    const state = selectedStore.messages[i].metadata?.planStateView;
    if (state) return state;
  }
  return null;
});

// ---------------------------------------------------------------------------
// Composer-scoped controls (PRD §13.1): mode, model, tool approval, context.
// ---------------------------------------------------------------------------
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

async function loadApprovalMode(conversationId: string): Promise<void> {
  try {
    const saved = await getChatV2ToolApprovalMode(conversationId);
    if (saved) toolApprovalMode.value = saved;
  } catch {
    // Default stays ask_for_approval.
  }
}

async function onToolApprovalModeChange(
  next: ChatToolApprovalMode
): Promise<void> {
  if (!conversationId.value) return;
  try {
    await setChatV2ToolApprovalMode(conversationId.value, next);
  } catch {
    // Preference persists on the next change.
  }
}

/** Newest server-reported token total for the selected conversation. */
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

async function onSelectConversation(id: string): Promise<void> {
  await selectedStore.loadSelection(id);
  void loadApprovalMode(id);
}

async function onNewChat(): Promise<void> {
  const id = createWorkspaceConversationId();
  workspaceStore.upsertLocalConversation({
    conversationId: id,
    workspaceKey: null,
    title: "",
    preview: "",
    lastActivityAt: new Date().toISOString(),
    unread: false,
    attention: "none",
    runtimeStatus: "idle",
    activeRunId: null,
  });
  await selectedStore.loadSelection(id);
}

/** Encode a renderer File into the IPC attachment contract. */
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
  files: File[]
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
  await selectedStore.sendMessage(text, {
    model: selectedModel.value,
    mode: mode.value,
    toolApprovalMode: toolApprovalMode.value,
    attachments: uploadedFiles,
  });
}

/** Submitted answers persist through the existing durable contract. */
function onPlanAnswers(answers: unknown[]): void {
  void onAnswerQuestion(answers as AskUserQuestionAnswer[]);
}

async function onAnswerQuestion(
  answers: AskUserQuestionAnswer[]
): Promise<void> {
  // FR-059: propagate failure to the flow so it shows a retry state.
  // The transcript owns the plan-question surface; answers arrive via
  // the @submit-plan-answers event from AiChatWorkspaceTranscript.
  if (!conversationId.value) return;
  // Extract the questionId from the latest plan in message history.
  const questionId = (() => {
    for (let i = selectedStore.messages.length - 1; i >= 0; i -= 1) {
      const q = selectedStore.messages[i].metadata?.questionView;
      if (q?.status === "pending") return (q as { questionId: string }).questionId;
    }
    return null;
  })();
  if (!questionId) return;
  try {
    const result = await answerChatV2Question(
      conversationId.value,
      questionId,
      answers
    );
    if (!result.ok) {
      // FR-059: surface the error to the flow via a ref the transcript reads.
      planSubmitError.value = result.error || "Submission failed";
      console.warn("[ai-chat-workspace] answer submission failed:", result.error);
    } else {
      planSubmitError.value = null;
    }
  } catch {
    // Retain answers for retry (design §31).
  }
}

/**
 * Minimal in-app prompt dialog — Electron does not implement window.prompt,
 * so rename/plan-feedback capture needs a real surface.
 */
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

/**
 * Voice settings (installs, consent-gated downloads, spoken-response
 * defaults) live on the AI provider settings page (PRD §15.7 matrix).
 */
function openVoiceSettings(): void {
  void router.push({ name: "system_setting_ai_provider" });
}

/** Stop-speaking: halt any running TTS synthesis job for this renderer. */
async function onStopSpeaking(): Promise<void> {
  try {
    await cancelVoiceJob();
  } catch {
    // No active job — nothing to stop.
  }
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

/** Export downloads the full transcript as JSON (PRD §11.5). */
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

/** Duplicate copies durable content into a fresh conversation. */
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

/** Confirmed destructive deletion cascades messages, artifacts, and the row. */
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
    t("workspaceChat.header.clearConfirm") ||
      "Clear all messages in this conversation?"
  );
  if (!confirmed) return;
  try {
    await clearChatV2Conversation(conversationId.value);
    await workspaceStore.bootstrap();
    await selectedStore.loadSelection(conversationId.value);
  } catch {
    // Non-fatal — deletion can be retried.
  }
}

/** Plan decisions flow through the existing durable plan APIs. */
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
      await rejectChatV2Plan(
        conversationId.value,
        plan.planId,
        version,
        feedback
      );
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



/** Rollback path: switching to classic re-shows the dock after navigation. */
async function onToggleMode(): Promise<void> {
  const next = !redesignDefault.value;
  try {
    await setWorkspaceRedesignEnabled(next);
    redesignDefault.value = next;
  } catch {
    // Flag write failed — mode stays unchanged.
  }
  if (!next) {
    void router.push("/dashboard/home");
  }
}

onMounted(() => {
  updateViewport();
  window.addEventListener("resize", updateViewport);
  void workspaceStore.bootstrap();
  void loadModels();
  void isWorkspaceRedesignEnabled()
    .then((enabled) => {
      redesignDefault.value = enabled;
    })
    .catch(() => {
      redesignDefault.value = false;
    });
  // Dashboard "ask AI" entry (layout passes ?prompt=): open a fresh chat.
  // The prompt text itself is handled by the composer focus flow; carrying
  // arbitrary text into an auto-send is avoided pending a seeded-composer
  // contract (see review finding: prompt seeding).
  void route.query.prompt;
});

onUnmounted(() => {
  window.removeEventListener("resize", updateViewport);
  selectedStore.teardown();
  workspaceStore.teardown();
});
</script>

<style scoped>
.workspace-shell {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  background: rgb(var(--v-theme-background));
  color: rgba(var(--v-theme-on-surface), 0.9);
}

/* FR-006: narrow — sidebar + inspector are separate overlay surfaces. */
.workspace-shell[data-viewport="narrow"] .workspace-sidebar {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  max-width: 86vw;
  z-index: 40;
  box-shadow: 6px 0 24px rgba(0, 0, 0, 0.2);
}

.sidebar-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: 35;
}

.sidebar-toggle {
  position: absolute;
  top: 7px;
  left: 8px;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: pointer;
}

.sidebar-toggle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
}

/* Medium: the shell positions the inspector overlay relative to the shell. */
.workspace-shell {
  position: relative;
}

.workspace-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.workspace-messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 6px;
}

.workspace-shell[data-viewport="narrow"] .conversation-header {
  padding-left: 48px;
}

.composer-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 0;
  flex-wrap: wrap;
  flex-shrink: 0;
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
</style>
