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

    <AiChatRunStrip
      :runtime-status="selectedStore.runtimeStatus"
      :recovering="recovering"
      :goal-objective="activeGoalObjective"
      :loop-status="activeLoopStatus"
      @stop="onStopFromStrip"
      @open-details="workspaceStore.openInspector('activity')"
    />

    <!-- Retry/recovery detail (FR-REC-001..003): the run strip keeps the
         high-level state; this line exposes attempt/max, bounded delay, and
         the current recovery layer + reason when they are live. -->
    <div
      v-if="retryDetailText !== null || recoveryDetailText !== null"
      class="chat-center__recovery-detail"
      role="status"
      aria-live="polite"
      data-testid="workspace-recovery-detail"
    >
      <v-icon size="x-small" class="mr-1">mdi-progress-clock</v-icon>
      <span>{{ retryDetailText ?? recoveryDetailText }}</span>
    </div>

    <!-- Managed-browser region (capability parity FR-BRW-001..005): the
         shared start panel + live session card compose directly in the
         center column — handoff, takeover, verify-login, resume/extend/stop
         stay reachable with the inspector CLOSED, never only in Activity.
         The panels own their subscriptions and session identity; unmounting
         this route removes renderer listeners only — the existing Stop
         action terminates a session. -->
    <div
      v-if="conversationId"
      class="chat-center__browser-region"
      data-testid="workspace-browser-region"
    >
      <ManagedBrowserStartPanel />
      <ManagedBrowserSessionCard />
    </div>

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
        :show-reasoning="showReasoning"
        :plan-submit-error="planSubmitError"
        :plan-decision-in-flight="planDecisionInFlight"
        :plan-decision-error="planDecisionError"
        :reported-message-ids="reportedMessageIds"
        @report="onSingleReportRequest"
        @save-generated-image="onSaveGeneratedImage"
        @stop-batch="onStopBatch"
        @retry-generated-image-batch="onRetryGeneratedImageBatch"
        @approve-plan="onLegacyPlanAction('approve-plan')"
        @request-plan-changes="onRequestPlanChangesWithFeedback"
        @submit-plan-answers="onPlanAnswers"
        @discard="onLegacyPlanAction('reject-plan')"
        @open-activity="workspaceStore.openInspector('activity')"
        @reopen-artifact="workspaceStore.requestArtifactPreview($event)"
        @grant-permission="onGrantPermission"
        @deny-permission="onDenyPermission"
        :pending-messages="pendingRows"
        @use-generated-image="onUseGeneratedImage"
        @edit-generated-image="onEditGeneratedImage"
        @steer-pending="onSteerPending"
        @cancel-pending="onCancelPending"
        @resume-pending="onResumePending"
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

    <!-- Conversation workspace chooser (design §9.2): directly above the
         composer input, below the transcript, inside the center — the
         workspace applies to the message being composed. -->
    <div class="chat-center__workspace-strip" data-testid="chat-workspace-strip">
      <!-- The workspace badge is always visible above the composer: with no
           conversation selected it renders its unset state (Choose action),
           which creates a chat on demand via onRequestWorkspaceSetup. -->
      <WorkspaceBadge
        :workspace="conversationWorkspace.workspace.value"
        :memory-count="conversationWorkspace.memoryCount.value"
        :loading="conversationWorkspace.loading.value"
        :busy="workspaceChangesBlocked"
        @request-set-workspace="onRequestWorkspaceSetup"
        @request-open-memory="openWorkspaceMemory"
      />
      <template v-if="conversationId">
        <AIConversationReportButton
          :enabled="conversationReportEnabled"
          :loading="reportCapabilitiesLoading"
          :disabled-reason="conversationReportDisabledReason"
          compact
          @open="onOpenConversationReport"
        />
        <!-- FR-HIS-001/005 (history rollout flag): archive search entry and
             compaction progress/retry/cancel, reachable while the inspector
             is closed. -->
        <button
          type="button"
          class="chat-center__history-toggle"
          data-testid="toggle-reasoning"
          :title="
            showReasoning
              ? t('aiChatV2.hide_reasoning') || 'Hide reasoning'
              : t('aiChatV2.show_reasoning') || 'Show reasoning'
          "
          :aria-label="
            showReasoning
              ? t('aiChatV2.hide_reasoning') || 'Hide reasoning'
              : t('aiChatV2.show_reasoning') || 'Show reasoning'
          "
          :aria-pressed="showReasoning"
          @click="toggleReasoningVisible"
        >
          <v-icon size="small" :color="showReasoning ? 'primary' : undefined">
            mdi-brain
          </v-icon>
        </button>
        <button
          v-if="historyUiEnabled"
          type="button"
          class="chat-center__history-toggle"
          data-testid="workspace-history-toggle"
          :title="t('aiChatHistory.drawer_title') || 'Conversation History'"
          :aria-label="t('aiChatHistory.drawer_title') || 'Conversation History'"
          @click="showHistoryDrawer = true"
        >
          <v-icon size="small">mdi-book-search-outline</v-icon>
        </button>
        <AiChatCompactionStatus
          v-if="historyUiEnabled"
          :status="compactionStatus"
          :busy="compactionBusyGuard"
          @retry="onCompact"
          @cancel="onCompactionCancel"
          @open-history="showHistoryDrawer = true"
        />
        <!-- Refresh failure: sanitized localized message + retry (FR-WS-002
             error state). The raw exception never reaches the DOM. -->
        <p
          v-if="conversationWorkspace.errorMessage.value"
          class="chat-center__workspace-error"
          role="alert"
          data-testid="workspace-load-error"
        >
          <v-icon size="x-small" color="warning" class="mr-1">
            mdi-alert-circle-outline
          </v-icon>
          {{ t("workspace.loadFailed") || "Couldn't load the workspace." }}
          <button
            type="button"
            class="chat-center__workspace-retry"
            data-testid="workspace-retry"
            @click="conversationWorkspace.refresh()"
          >
            {{ t("workspace.retry") || "Retry" }}
          </button>
        </p>
        <!-- Approved workspace whose root could not be resolved (deleted /
             inaccessible) — recoverable via retry (FR-WS-002). -->
        <p
          v-if="conversationWorkspace.pathUnavailable.value"
          class="chat-center__workspace-error"
          role="status"
          data-testid="workspace-path-unavailable"
        >
          <v-icon size="x-small" color="warning" class="mr-1">
            mdi-folder-remove-outline
          </v-icon>
          {{
            t("workspace.pathUnavailable") ||
            "Workspace folder is not accessible right now."
          }}
          <button
            type="button"
            class="chat-center__workspace-retry"
            data-testid="workspace-path-retry"
            @click="conversationWorkspace.refresh()"
          >
            {{ t("workspace.retry") || "Retry" }}
          </button>
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

    <!-- Selected archive-context chips (FR-HIS-002, rollout flag): removable
         per conversation; sending carries opaque ids only. -->
    <AiChatSelectedContext
      v-if="historyUiEnabled"
      :selections="selectedContextItems"
      @remove="removeSelectedContext"
      @clear="clearSelectedContext"
    />

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
      :voice-settings-unavailable="voice.settingsUnavailable.value"
      :draft-key="composerDraftKey"
      :selected-generated-images="selectedGeneratedImageViews"
      :generated-image-reference-limit="GENERATED_IMAGE_REFERENCE_LIMIT"
      :generated-image-focus-signal="composerFocusSignal"
      @send="onComposerSend"
      @stop="selectedStore.stopActiveRun()"
      @request-workspace="onRequestWorkspaceSetup"
      @remove-generated-image="onRemoveGeneratedImage"
      @clear-generated-images="onClearGeneratedImages"
      @reorder-generated-images="onReorderGeneratedImages"
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
          :loading="!modelsLoaded"
          :no-models="modelsLoaded && availableModels.length === 0"
          @open-settings="openProviderSettings"
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

    <!-- Command routing error (FR-CMD-004): safe localized explanation with
         the draft retained for retry; dismissed on the next send. -->
    <div
      v-if="commandErrorNotice !== null"
      class="chat-center__genimg-notice"
      role="alert"
      data-testid="workspace-command-error"
    >
      <v-icon size="x-small" color="warning" class="mr-1">
        mdi-alert-circle-outline
      </v-icon>
      <span class="chat-center__genimg-notice-text">
        {{ commandErrorNotice }}
      </span>
      <v-btn
        size="x-small"
        variant="text"
        class="ml-1"
        :aria-label="t('common.close') || 'Close'"
        data-testid="workspace-command-error-dismiss"
        @click="commandErrorNotice = null"
      >
        {{ t("common.close") || "Close" }}
      </v-btn>
    </div>

    <!-- Generated-image reference notice (over-limit preflight abort). -->
    <div
      v-if="generatedImageNotice !== null"
      class="chat-center__genimg-notice"
      role="alert"
      data-testid="workspace-genimg-notice"
    >
      <v-icon size="x-small" color="warning" class="mr-1">
        mdi-image-alert-outline
      </v-icon>
      <span class="chat-center__genimg-notice-text">
        {{ generatedImageNotice }}
      </span>
      <v-btn
        size="x-small"
        variant="text"
        class="ml-1"
        :aria-label="t('common.close') || 'Close'"
        data-testid="workspace-genimg-notice-dismiss"
        @click="generatedImageNotice = null"
      >
        {{ t("common.close") || "Close" }}
      </v-btn>
    </div>

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

    <!-- Spoken-response preference save failure (FR-VOICE-004): recoverable,
         localized, with a retry — the raw IPC error never renders. -->
    <div
      v-if="voice.settingsSaveFailed.value"
      class="chat-center__tts-notice"
      role="alert"
      data-testid="voice-save-error"
    >
      <v-icon size="x-small" color="warning" class="mr-1">
        mdi-volume-off
      </v-icon>
      <span class="chat-center__tts-notice-text">
        {{
          t("aiChatV2.voice.settings_save_failed") ||
          "Couldn't save the spoken-response preference."
        }}
      </span>
      <v-btn
        size="x-small"
        color="primary"
        variant="tonal"
        class="ml-2"
        data-testid="voice-save-retry"
        :disabled="voice.settingsSaving.value"
        @click="voice.toggleSpokenResponse"
      >
        {{ t("aiChatV2.voice.retry") || "Retry" }}
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

    <!-- Multi-select conversation report dialog (non-AI-gated). -->
    <AIConversationReportDialog
      v-if="conversationReportDialogOpen && conversationReportSnapshot"
      v-model="conversationReportDialogOpen"
      :snapshot="conversationReportSnapshot"
      @submitted="onConversationReportSubmitted"
    />

    <!-- Single-output report dialog (FR-RPT-002, design §12.5). -->
    <AIContentReportDialog
      v-if="singleReportDialogOpen && activeSingleDescriptor"
      v-model="singleReportDialogOpen"
      :descriptor="activeSingleDescriptor"
      @submitted="onSingleReportSubmitted"
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

    <!-- Agent-task status/cancellation (FR-INT-004, shared dialog). -->
    <AgentTaskListDialog @cancel-task="handleAgentTaskCancel" />

    <!-- Recoverable-history drawer (FR-HIS-001, rollout flag): archive
         search/browse + passage selection; no drawer when the stage is off. -->
    <AiChatHistoryDrawer
      v-if="conversationId && historyUiEnabled"
      v-model="showHistoryDrawer"
      :conversation-id="conversationId"
      @select="handleHistorySelect"
      @navigate="handleHistoryNavigate"
    />

    <!-- Generated-image ambiguity chooser + batch confirmation
         (FR-IMG-006/008, shared components with Chat V2). -->
    <GeneratedImageChooserDialog
      v-model="showGeneratedImageChooser"
      :candidates="ambiguityCandidates"
      @select="chooseAmbiguityCandidate"
      @cancel="cancelAmbiguityChooser"
    />
    <GeneratedImageBatchConfirmDialog
      v-model="showBatchConfirmDialog"
      :count="pendingGeneratedImageBatchCount"
      @confirm="confirmGeneratedImageBatch"
      @decline="declineGeneratedImageBatch"
    />

    <!-- Scheduled-loop tool-policy approval (FR-CMD-007): approval happens
         once, up front — unattended execution cannot prompt at run time. -->
    <ScheduledLoopToolApprovalDialog
      v-if="pendingScheduledLoop"
      v-model="showScheduledLoopApproval"
      :raw-command="pendingScheduledLoop.rawCommand"
      :prompt="pendingScheduledLoop.action.prompt"
      @confirm="onScheduledLoopApprovalConfirm"
      @cancel="onScheduledLoopApprovalCancel"
    />

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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
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
  exportGeneratedImage,
  isHistoryUiEnabled,
  getCompactionStatus,
  cancelCompaction,
  subscribeCompactionProgress,
  unsubscribeCompactionProgress as unsubscribeAllCompactionProgress,
} from "@/views/api/aiChatV2";
import {
  stopGoalLoop,
  createGoal,
  startGoalLoop,
  getActiveGoal,
} from "@/views/api/aiChatGoal";
import {
  controlScheduledLoop,
  createScheduledLoop,
  getScheduledLoopStatus,
} from "@/views/api/aiChatScheduledLoop";
import { invokePromptSkill } from "@/views/api/skillInstallation";
import { dispatchSlashCommand } from "@/views/api/slashCommands";
import ScheduledLoopToolApprovalDialog from "@/views/components/aiChatV2/ScheduledLoopToolApprovalDialog.vue";
import ManagedBrowserStartPanel from "@/views/components/aiChatV2/ManagedBrowserStartPanel.vue";
import ManagedBrowserSessionCard from "@/views/components/aiChatV2/ManagedBrowserSessionCard.vue";
import AiChatHistoryDrawer from "@/views/components/aiChatV2/AiChatHistoryDrawer.vue";
import AiChatSelectedContext from "@/views/components/aiChatV2/AiChatSelectedContext.vue";
import AiChatCompactionStatus from "@/views/components/aiChatV2/AiChatCompactionStatus.vue";
import GeneratedImageChooserDialog from "@/views/components/aiChatV2/GeneratedImageChooserDialog.vue";
import GeneratedImageBatchConfirmDialog from "@/views/components/aiChatV2/GeneratedImageBatchConfirmDialog.vue";
import {
  inferGeneratedImageReferences,
  isFusionWording,
} from "@/views/components/aiChatV2/generatedImageReferenceInference";
import type { SelectedContextItem } from "@/views/components/aiChatV2/AiChatSelectedContext.vue";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";
import type { ChatV2CompactionProgressEvent } from "@/entityTypes/aiChatV2Types";
import type { CompactionStatusSnapshot } from "@/service/AIChatCompactionCoordinator";
import { handleAiNavigationToolResult } from "@/views/utils/aiNavigationResultHandler";
import {
  planContinuationRequestId,
  type PlanContinuationDecision,
} from "@/views/utils/planContinuationIdentity";
import {
  readAiChatReasoningVisible,
  writeAiChatReasoningVisible,
  AI_CHAT_REASONING_VISIBILITY_CHANGED_EVENT,
  type AiChatReasoningVisibilityChangedDetail,
} from "@/views/utils/aiChatReasoningPreference";
import AgentTaskListDialog from "@/views/components/aiChatV2/AgentTaskListDialog.vue";
import { cancelAgentTask } from "@/views/api/agentRuntime";
import {
  useChatCommandRouting,
  type ChatCommandDisposition,
  type ScheduledLoopApprovalPayload,
  type StagedScheduledLoop,
} from "@/views/composables/aiChatWorkspace/useChatCommandRouting";
import type {
  ChatV2GeneratedImageReference,
  ChatV2MessageView,
  ChatV2Mode,
  ChatToolApprovalMode,
} from "@/entityTypes/aiChatV2Types";
import type { GeneratedImageReferenceView } from "@/views/components/aiChatV2/generatedImageReferenceView";
import { MessageType } from "@/entityTypes/commonType";
import type { AskUserQuestionAnswer } from "@/entityTypes/aiChatPlanTypes";
import {
  renameConversation,
  deleteConversation,
  duplicateConversation,
  exportConversation,
} from "@/views/api/aiChatWorkspace";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import {
  composerDraftKeyFor,
  useComposerDraftStore,
} from "@/views/store/composerDrafts";
import { usePendingMessagesStore } from "@/views/store/pendingMessages";
import AIConversationReportButton from "@/views/components/aiContentReport/AIConversationReportButton.vue";
import AIConversationReportDialog from "@/views/components/aiContentReport/AIConversationReportDialog.vue";
import AIContentReportDialog from "@/views/components/aiContentReport/AIContentReportDialog.vue";
import type { ReportableOutputDescriptor } from "@/views/components/aiContentReport/reportableOutput";
import {
  buildChatV2ConversationSnapshot,
  hasEligibleChatV2Candidate,
  type ConversationReportSnapshot,
} from "@/views/components/aiContentReport/conversationReportSnapshot";
import { useReportCapabilities } from "@/views/utils/reportCapabilities";
import {
  cancelChatV2PendingMessage,
  resumeChatV2PendingQueue,
  steerChatV2PendingMessage,
  subscribeChatV2PendingEvents,
} from "@/views/api/aiChatV2";
import {
  useSelectedConversationStore,
  type PermissionActionTexts,
} from "@/views/store/selectedConversation";
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

/**
 * FR-WS-007: while a workspace-backed tool may be running, changing the
 * workspace is unsafe (approvals and watches are bound to the current root).
 * Entry points are disabled with a visible localized reason instead.
 */
const workspaceChangesBlocked = computed(() => selectedStore.isBusy);

/** Workspace setup needs a conversation id first (classic-chat parity). */
function onRequestWorkspaceSetup(): void {
  if (workspaceChangesBlocked.value) return; // FR-WS-007 safety gate
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

/**
 * Authoritative scheduled-loop state from the control/status APIs (review
 * C6): message-metadata projection only updates when new rows persist, so
 * `/loop status|pause|resume|stop` responses land here instead.
 */
const authoritativeLoopStatus = ref<string | null>(null);

/**
 * FR-CMD-006 (review C4): hydrate the persisted active goal from the backend
 * — live goal_state events alone miss goals from previous sessions, so
 * `/loop N` would wrongly report "no active goal" after a reload.
 */
async function hydrateActiveGoal(targetConversationId: string): Promise<void> {
  try {
    const goal = await getActiveGoal(targetConversationId);
    // Ignore stale responses when the user switched conversations mid-flight.
    if (conversationId.value !== targetConversationId) return;
    selectedStore.seedGoal(
      goal
        ? {
            goalId: goal.goalId,
            objective: goal.objective,
            status: goal.status,
            iterationCount: goal.iterationCount ?? 0,
          }
        : null
    );
  } catch {
    // Non-fatal — goal_state stream events reconcile.
  }
}

const activeLoopStatus = computed(
  () => authoritativeLoopStatus.value ?? selectedStore.scheduledLoop?.status ?? null
);

/** FR-REC-002: transport retry — attempt, maximum, bounded delay. */
const retryDetailText = computed<string | null>(() => {
  const info = selectedStore.retry;
  if (!info) return null;
  return (
    t("workspaceChat.recovery.retry", {
      attempt: info.attempt,
      max: info.maxAttempts,
      seconds: Math.max(1, Math.round(info.delayMs / 1000)),
    }) ||
    `Reconnecting… attempt ${info.attempt} of ${info.maxAttempts} (waiting ~${Math.max(
      1,
      Math.round(info.delayMs / 1000)
    )}s)`
  );
});

/** FR-REC-003: recovery — current layer, reason, attempt, safe message. */
const recoveryDetailText = computed<string | null>(() => {
  const info = selectedStore.recovery;
  if (!info) return null;
  return (
    t("workspaceChat.recovery.recovering", {
      layer: info.layer,
      reason: info.reason,
    }) ||
    `Recovering via ${info.layer}: ${info.reason}`
  );
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

// --- Tool permission card (design §15.5) --------------------------------------
// The store stays i18n-free, so localized strings are passed in from here.
const permissionTexts = computed<PermissionActionTexts>(() => ({
  deniedText:
    t("aiChatV2.permission_denied") ||
    "Permission denied. The tool will not be executed.",
  resumeFailedText:
    t("aiChatV2.permission_resume_failed") ||
    "Could not continue the tool after permission was granted.",
  noToolIdText:
    t("aiChatV2.permission_resume_no_tool_id") ||
    "Missing tool call information; cannot continue execution.",
}));

function onGrantPermission(
  message: ChatV2MessageView,
  payload: { persistent: boolean }
): void {
  // FR-PER-003/005 (capability parity, design §12.2 trace): the shared
  // SkillApprovalCard has ALREADY persisted the grant choice through the
  // `skill:grant-permission` IPC before emitting `grant` — `persistent` is
  // informational here. The surface's single job is resuming the parked
  // tool exactly once; a failed resume keeps the row actionable (store
  // contract) rather than assuming the grant took effect.
  selectedStore
    .grantToolPermission(message, permissionTexts.value)
    .catch(() => undefined);
}

function onDenyPermission(message: ChatV2MessageView): void {
  selectedStore.denyToolPermission(message, permissionTexts.value);
}

// --- Durable per-conversation drafts (FR-COMP-011, legacy parity) -----------
// Draft ownership lives in the app-scoped composerDrafts store so unsent
// state — typed text, attachments, pasted blocks, and the generated-image
// reference tray — survives center-route round trips (this surface unmounts)
// and conversation switches. The tray clears only when its turn completes.
/** Max references forwarded in a single request (composer contract). */
const GENERATED_IMAGE_REFERENCE_LIMIT = 3;
/**
 * Reference-only sends (no typed text) still need a message for the model —
 * the legacy surface forwards the same deterministic fallback prompt.
 */
const GENERATED_IMAGE_FALLBACK_PROMPT = "Describe the selected image.";

const composerDrafts = useComposerDraftStore();
const pendingMessages = usePendingMessagesStore();

// --- Queued (pending) message actions (message-queue PRD §7) ----------------
async function onSteerPending(pendingMessageId: string): Promise<void> {
  if (!conversationId.value) return;
  try {
    const view = await steerChatV2PendingMessage(
      conversationId.value,
      pendingMessageId
    );
    if (view) {
      pendingMessages.upsert(view);
    }
  } catch {
    // Non-fatal: the lifecycle event / next load refreshes the row.
  }
}

async function onCancelPending(pendingMessageId: string): Promise<void> {
  if (!conversationId.value) return;
  try {
    await cancelChatV2PendingMessage(conversationId.value, pendingMessageId);
  } catch {
    // Non-fatal: the cancelled event removes the row.
  }
}

async function onResumePending(targetConversationId: string): Promise<void> {
  try {
    await resumeChatV2PendingQueue(targetConversationId);
  } catch {
    // Non-fatal: the queue retries the drain.
  }
}

/**
 * Delivered-row swap (message-queue §7): a delegated send's pending bubble is
 * removed at delivery, and the live transcript only learns the persisted user
 * row from a history reload — so append it here (durable id → the later
 * reload dedupes). Steering-applied rows promote the same way.
 */
let deliveredRowsUnsubscribe: (() => void) | null = null;
function ensureDeliveredRowsSubscription(): void {
  if (deliveredRowsUnsubscribe) return;
  deliveredRowsUnsubscribe = subscribeChatV2PendingEvents((event) => {
    if (event.status !== "sent" && event.status !== "applied") return;
    const view = event.pendingMessage;
    if (!view || view.conversationId !== conversationId.value) return;
    if (!view.sentMessageId) return;
    selectedStore.appendDeliveredUserRow({
      id: view.sentMessageId,
      content: view.content,
      timestamp: view.updatedAt,
    });
  });
}
/** Store key for the selected conversation (pending sentinel when null). */
const composerDraftKey = computed(() => composerDraftKeyFor(conversationId.value));

const composerFocusSignal = ref(0);
/** Draft key whose selection is cleared once its turn completes (see below). */
const pendingDraftClearKey = ref<string | null>(null);
const generatedImageNotice = ref<string | null>(null);

const sameGeneratedImageRef = (
  a: ChatV2GeneratedImageReference,
  b: ChatV2GeneratedImageReference
): boolean => a.messageId === b.messageId && a.imageIndex === b.imageIndex;

const pendingRows = computed(() =>
  pendingMessages.rowsFor(conversationId.value)
);

// --- Conversation reporting (capability-gated, non-AI-gated) ----------------
const hasReportableConversationOutput = computed(() =>
  hasEligibleChatV2Candidate({
    conversationId: conversationId.value ?? "",
    messages: [...selectedStore.messages],
    activeAssistantMessageId: selectedStore.activeAssistantMessageId,
    streamStatus:
      selectedStore.streamStatus === "streaming" ? "streaming" : "idle",
  })
);
// Retry-capable capability fetch; the rearm key restarts the chain on every
// conversation switch (see useReportCapabilities docstring for bug history).
const {
  capabilities: reportCapabilities,
  loading: reportCapabilitiesLoading,
} = useReportCapabilities({
  hasEligibleOutput: () => hasReportableConversationOutput.value,
  rearmKey: () => conversationId.value,
});
const conversationReportEnabled = computed(
  () =>
    reportCapabilities.value?.conversationReporting.enabled === true &&
    hasReportableConversationOutput.value
);
const conversationReportDisabledReason = computed(() => {
  if (reportCapabilities.value?.conversationReporting.enabled !== true) {
    return (
      t("aiConversationReport.unavailable") ||
      "Conversation reporting is currently unavailable."
    );
  }
  if (!hasReportableConversationOutput.value) {
    return (
      t("aiConversationReport.noEligibleOutputs") ||
      "There are no reportable AI outputs in this conversation yet."
    );
  }
  return "";
});

const conversationReportDialogOpen = ref(false);
const conversationReportSnapshot = ref<ConversationReportSnapshot | null>(
  null
);

/** Freeze the current visible messages into the report snapshot at open. */
function onOpenConversationReport(): void {
  conversationReportSnapshot.value = buildChatV2ConversationSnapshot({
    conversationId: conversationId.value ?? "",
    messages: [...selectedStore.messages],
    activeAssistantMessageId: selectedStore.activeAssistantMessageId,
    streamStatus:
      selectedStore.streamStatus === "streaming" ? "streaming" : "idle",
  });
  conversationReportDialogOpen.value = true;
}

function onConversationReportSubmitted(payload: {
  reportId: string;
  selectedMessageIds: string[];
}): void {
  // Keep the dialog OPEN so the user can copy the report reference; the
  // dialog itself owns closing on dismiss (FR-5.5 / Journey 11.1 step 8).
  void payload;
}

// An open dialog must never describe a conversation the user navigated away
// from — close without submitting so a later open rebuilds a fresh snapshot.
// FR-RPT-008: the single-output report dialog rebinds the same way.
watch(conversationId, () => {
  if (conversationReportDialogOpen.value) {
    conversationReportDialogOpen.value = false;
    conversationReportSnapshot.value = null;
  }
  if (singleReportDialogOpen.value) {
    singleReportDialogOpen.value = false;
    activeSingleDescriptor.value = null;
  }
});

watch(
  conversationId,
  (id) => {
    void pendingMessages.loadConversation(id);
  },
  { immediate: true }
);

/** References attached to the composer tray for the SELECTED conversation. */
const activeGeneratedImageRefs = computed(() => [
  ...(composerDrafts.getDraft(composerDraftKey.value)
    ?.generatedImageReferences ?? []),
]);

/** Resolve tray chips against the mounted message window (thumb + name). */
function resolveGeneratedImageViewModel(
  reference: ChatV2GeneratedImageReference
): GeneratedImageReferenceView {
  const message = selectedStore.messages.find(
    (m) => m.id === reference.messageId
  );
  const image = message?.metadata?.generatedImages?.[reference.imageIndex];
  return {
    reference,
    fileName:
      typeof image?.file_name === "string" ? image.file_name : undefined,
    thumbUrl: typeof image?.url === "string" ? image.url : undefined,
  };
}

const selectedGeneratedImageViews = computed(() =>
  activeGeneratedImageRefs.value.map(resolveGeneratedImageViewModel)
);

/** "Use as reference" tile action: toggle the image in the tray. */
function onUseGeneratedImage(reference: ChatV2GeneratedImageReference): void {
  generatedImageNotice.value = null;
  const key = composerDraftKey.value;
  const current = activeGeneratedImageRefs.value;
  if (current.some((r) => sameGeneratedImageRef(r, reference))) {
    composerDrafts.setGeneratedImageReferences(
      key,
      current.filter((r) => !sameGeneratedImageRef(r, reference))
    );
    return;
  }
  composerDrafts.setGeneratedImageReferences(key, [...current, reference]);
}

/**
 * A send parked behind the ambiguity chooser or the batch-confirmation
 * dialog (FR-IMG-006/008): captured verbatim and replayed on the user's
 * choice — decline/cancel discards it and keeps nothing staged.
 */
interface PendingGeneratedImageSend {
  readonly conversationKey: string;
  readonly text: string;
  readonly files: File[];
  readonly options?: {
    fromVoice?: boolean;
    pastedContents?: Record<string, string>;
    onAccepted?: () => void;
    modeOverride?: "chat" | "plan";
  };
  readonly confirmedReferences?: ChatV2GeneratedImageReference[];
}

const pendingGeneratedImageSend = ref<PendingGeneratedImageSend | null>(null);
const ambiguityCandidates = ref<GeneratedImageReferenceView[]>([]);
const showGeneratedImageChooser = ref(false);
const showBatchConfirmDialog = ref(false);
const pendingGeneratedImageBatchCount = computed(
  () => pendingGeneratedImageSend.value?.confirmedReferences?.length ?? 0
);

/**
 * FR-IMG-005..008 preflight (Chat V2 parity): resolve which images this
 * turn references. Returns the effective reference list (empty = plain text
 * send) or null when the send must abort because a dialog now waits on the
 * user (ambiguity chooser / batch confirmation) or a guard tripped.
 */
function runGeneratedImagePreflight(
  text: string,
  files: File[],
  options?: {
    confirmedBatchReferences?: readonly ChatV2GeneratedImageReference[];
    fromVoice?: boolean;
    pastedContents?: Record<string, string>;
    onAccepted?: () => void;
    modeOverride?: "chat" | "plan";
  }
): ChatV2GeneratedImageReference[] | null {
  // Trusted resend: the user just approved this exact set — skip every
  // guard so the confirm path cannot loop.
  if (options?.confirmedBatchReferences?.length) {
    return [];
  }
  let effective: ChatV2GeneratedImageReference[] = [];
  const explicit = activeGeneratedImageRefs.value;
  if (explicit.length > 0) {
    effective = [...explicit];
  } else {
    const result = inferGeneratedImageReferences({
      text,
      messages: [...selectedStore.messages],
      explicitSelection: [],
    });
    if (result.kind === "ambiguous") {
      // Snapshot the FULL submission options (review C2/A5): pasted bodies,
      // voice origin, mode override, and the acceptance callback must
      // survive the dialog so the replayed send behaves like the original.
      pendingGeneratedImageSend.value = {
        conversationKey: composerDraftKey.value,
        text,
        files,
        options: options
          ? {
              fromVoice: options.fromVoice,
              pastedContents: options.pastedContents,
              onAccepted: options.onAccepted,
              modeOverride: options.modeOverride,
            }
          : undefined,
      };
      ambiguityCandidates.value = result.candidates.map((candidate) => ({
        reference: candidate.reference,
        fileName: candidate.fileName,
        thumbUrl:
          resolveGeneratedImageViewModel(candidate.reference).thumbUrl ??
          candidate.thumbUrl,
      }));
      showGeneratedImageChooser.value = true;
      return null;
    }
    if (
      (result.kind === "resolved" || result.kind === "batch_confirmation") &&
      result.references.length > GENERATED_IMAGE_REFERENCE_LIMIT &&
      isFusionWording(text)
    ) {
      generatedImageNotice.value =
        t("aiChatV2.generatedImageRefs.errors.generated_image_fusion_limit") ||
        "Combining images is limited to 3 at a time.";
      return null;
    }
    if (result.kind === "batch_confirmation") {
      pendingGeneratedImageSend.value = {
        conversationKey: composerDraftKey.value,
        text,
        files,
        options: options
          ? {
              fromVoice: options.fromVoice,
              pastedContents: options.pastedContents,
              onAccepted: options.onAccepted,
              modeOverride: options.modeOverride,
            }
          : undefined,
        confirmedReferences: [...result.references],
      };
      showBatchConfirmDialog.value = true;
      return null;
    }
    if (result.kind === "resolved") {
      effective = [...result.references];
    }
  }
  if (effective.length > GENERATED_IMAGE_REFERENCE_LIMIT) {
    if (isFusionWording(text)) {
      generatedImageNotice.value =
        t("aiChatV2.generatedImageRefs.errors.generated_image_fusion_limit") ||
        "Combining images is limited to 3 at a time.";
      return null;
    }
    // Explicit multi-selections above three are paid work: ask for batch
    // confirmation instead of hard-blocking (FR-IMG-008).
    pendingGeneratedImageSend.value = {
      conversationKey: composerDraftKey.value,
      text,
      files,
      options: options
        ? {
            fromVoice: options.fromVoice,
            pastedContents: options.pastedContents,
            onAccepted: options.onAccepted,
            modeOverride: options.modeOverride,
          }
        : undefined,
      confirmedReferences: [...effective],
    };
    showBatchConfirmDialog.value = true;
    return null;
  }
  return effective;
}

/** FR-IMG-006: the picked candidate becomes the sole tray reference. */
function chooseAmbiguityCandidate(view: GeneratedImageReferenceView): void {
  const pending = pendingGeneratedImageSend.value;
  pendingGeneratedImageSend.value = null;
  ambiguityCandidates.value = [];
  showGeneratedImageChooser.value = false;
  if (!pending || pending.conversationKey !== composerDraftKey.value) {
    // Stale chooser state (conversation switched) — discard, never replay
    // into another conversation.
    return;
  }
  composerDrafts.setGeneratedImageReferences(pending.conversationKey, [
    view.reference,
  ]);
  void performOrdinarySend(pending.text, pending.files, pending.options);
}

function cancelAmbiguityChooser(): void {
  pendingGeneratedImageSend.value = null;
  ambiguityCandidates.value = [];
  showGeneratedImageChooser.value = false;
}

/**
 * FR-IMG-008/009: confirm resends the original text with the EXACT
 * user-confirmed reference set through the trusted staging channel,
 * preserving the selected order.
 */
function confirmGeneratedImageBatch(): void {
  const pending = pendingGeneratedImageSend.value;
  const confirmed = pending?.confirmedReferences;
  pendingGeneratedImageSend.value = null;
  showBatchConfirmDialog.value = false;
  if (!pending || !confirmed || confirmed.length === 0) return;
  void performOrdinarySend(pending.text, pending.files, {
    ...pending.options,
    confirmedBatchReferences: [...confirmed],
  });
}

function declineGeneratedImageBatch(): void {
  pendingGeneratedImageSend.value = null;
  showBatchConfirmDialog.value = false;
}

/** "Edit" tile action: exactly this image becomes the tray selection. */
function onEditGeneratedImage(reference: ChatV2GeneratedImageReference): void {
  generatedImageNotice.value = null;
  composerDrafts.setGeneratedImageReferences(composerDraftKey.value, [
    reference,
  ]);
  composerFocusSignal.value += 1;
}

/**
 * Focus transfer (PRD §16.3/§19.1): selecting a conversation or creating a
 * new chat moves focus into the composer — the typing context the user just
 * navigated to. Deep-link mounts keep the app's default focus.
 */
watch(conversationId, (next, previous) => {
  if (!next || next === previous) return;
  composerFocusSignal.value += 1;
});

function onRemoveGeneratedImage(
  reference: ChatV2GeneratedImageReference
): void {
  composerDrafts.setGeneratedImageReferences(
    composerDraftKey.value,
    activeGeneratedImageRefs.value.filter(
      (r) => !sameGeneratedImageRef(r, reference)
    )
  );
}

function onClearGeneratedImages(): void {
  composerDrafts.setGeneratedImageReferences(composerDraftKey.value, []);
}

function onReorderGeneratedImages(
  references: ChatV2GeneratedImageReference[]
): void {
  composerDrafts.setGeneratedImageReferences(composerDraftKey.value, references);
}

/**
 * Clear the sent draft only when its turn is ACCEPTED end-to-end: the
 * presenter maps the terminal `complete` detail event to streamStatus
 * "idle". Error/cancel paths intentionally keep the selection so the user
 * can retry without re-picking (legacy parity).
 */
watch(
  () => selectedStore.streamStatus,
  (status, previous) => {
    if (previous !== "streaming") return;
    const key = pendingDraftClearKey.value;
    if (!key) return;
    pendingDraftClearKey.value = null;
    if (status === "idle") {
      composerDrafts.setGeneratedImageReferences(key, []);
    }
  }
);

// --- Per-output reporting + generated-image batch actions (FR-RPT/FR-IMG) ---
/** FR-RPT-009: session-only reported ids (never persisted). */
const reportedMessageIds = ref(new Set<string>());
const activeSingleDescriptor = ref<ReportableOutputDescriptor | null>(null);
const singleReportDialogOpen = ref(false);

/** FR-RPT-002: a reportable tile's action opens the real single-output dialog. */
function onSingleReportRequest(descriptor: ReportableOutputDescriptor): void {
  activeSingleDescriptor.value = descriptor;
  singleReportDialogOpen.value = true;
}

function onSingleReportSubmitted(): void {
  const id = activeSingleDescriptor.value?.context.messageId;
  if (id) {
    reportedMessageIds.value = new Set([...reportedMessageIds.value, id]);
  }
}

/** Exports queued while no approved workspace existed (FR-IMG-013/FR-INT-002). */
const pendingImageExports = ref<Map<string, ChatV2GeneratedImageReference[]>>(
  new Map()
);

function enqueuePendingImageExport(
  conversation: string,
  reference: ChatV2GeneratedImageReference
): void {
  const current = pendingImageExports.value.get(conversation) ?? [];
  if (current.some((r) => sameGeneratedImageRef(r, reference))) return;
  pendingImageExports.value = new Map(pendingImageExports.value).set(
    conversation,
    [...current, reference]
  );
}

async function attemptGeneratedImageExport(
  conversation: string,
  reference: ChatV2GeneratedImageReference
): Promise<void> {
  try {
    const result = await exportGeneratedImage(conversation, reference);
    if (result.status === "workspace_required") {
      // Keep the export queued; the SAME request-workspace flow runs and the
      // queued export retries automatically once a workspace is approved.
      enqueuePendingImageExport(conversation, reference);
      onRequestWorkspaceSetup();
      generatedImageNotice.value =
        t("aiChatV2.imageTool.errors.workspaceRequired") ||
        "An approved workspace is required first.";
      return;
    }
    generatedImageNotice.value =
      t("aiChatV2.artifactExport.savedToWorkspace", {
        fileName: result.fileName ?? "",
      }) || `Saved ${result.fileName ?? ""} to your workspace.`;
  } catch (err) {
    generatedImageNotice.value =
      err instanceof Error && err.message
        ? `${t("aiChatV2.artifactExport.saveFailed") || "Could not save to workspace."} (${err.message})`
        : t("aiChatV2.artifactExport.saveFailed") ||
          "Could not save to workspace.";
  }
}

// Drain queued exports once the conversation gains an approved workspace.
watch(
  () => conversationWorkspace.workspace.value?.approvalState,
  (state, previous) => {
    if (state !== "approved" || state === previous) return;
    const conversation = conversationId.value;
    if (!conversation) return;
    const queued = pendingImageExports.value.get(conversation) ?? [];
    if (queued.length === 0) return;
    pendingImageExports.value = new Map(pendingImageExports.value).set(
      conversation,
      []
    );
    for (const reference of queued) {
      void attemptGeneratedImageExport(conversation, reference);
    }
  }
);

/** FR-IMG-013: save one generated image into the trusted workspace. */
async function onSaveGeneratedImage(
  reference: ChatV2GeneratedImageReference
): Promise<void> {
  const conversation = conversationId.value;
  if (!conversation) return;
  await attemptGeneratedImageExport(conversation, reference);
}

/** FR-IMG-012: stop preserves completed outputs; the run cancel owns the rest. */
function onStopBatch(): void {
  void selectedStore.stopActiveRun();
}

/**
 * FR-IMG-011: retry ONLY the eligible failed references with the original
 * shared instruction, through the trusted confirmed-batch channel.
 */
function onRetryGeneratedImageBatch(payload: {
  references: ChatV2GeneratedImageReference[];
  instruction: string;
}): void {
  if (payload.references.length === 0) return;
  void performOrdinarySend(payload.instruction, [], {
    confirmedBatchReferences: [...payload.references],
  });
}

// --- Next-message settings (owned here, rendered below the textarea) --------
const LAST_MODEL_STORAGE_KEY = "ai-chat-v2-last-model";
const mode = ref<ChatV2Mode>("chat");
const selectedModel = ref<string | undefined>(undefined);
const availableModels = ref<OpenAIModel[]>([]);
const defaultModelId = ref<string | undefined>(undefined);
const modelContextWindows = ref<Map<string, number>>(new Map());
const toolApprovalMode = ref<ChatToolApprovalMode>("ask_for_approval");
/**
 * PRD §13.4: bounded loading — loading ends when the catalog request
 * settles (success OR failure); a settled empty list is the actionable
 * no-model state, never an indefinite spinner.
 */
const modelsLoaded = ref(false);

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
  } finally {
    modelsLoaded.value = true;
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
    // Review C4: /loop's goal precondition must survive selection reloads.
    void hydrateActiveGoal(id);
  }
  // Review C6: control/status responses are per-conversation.
  authoritativeLoopStatus.value = null;
});

// --- Spoken-response feed (deltas from the bounded store projection) --------
let fedMessageId: string | null = null;
let fedLength = 0;

watch(
  [() => selectedStore.activeAssistantMessageId, () => selectedStore.messages],
  () => {
    const id = selectedStore.activeAssistantMessageId;
    if (!id) {
      // Terminal flush (review fix): completion can clear the active id in
      // the SAME batched update as the final text — the loop above would
      // return and short replies would stay silent. Feed the completed
      // message's remainder through the tracked id before forgetting it.
      if (fedMessageId !== null) {
        const message = selectedStore.messages.find(
          (m) => m.id === fedMessageId
        );
        const content = message?.content ?? "";
        if (content.length > fedLength) {
          voice.pushAssistantDelta(content.slice(fedLength));
          fedLength = content.length;
        }
        voice.completeAssistantResponse();
        fedMessageId = null;
      }
      return;
    }
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
  options?: {
    fromVoice?: boolean;
    pastedContents?: Record<string, string>;
    onAccepted?: () => void;
  }
): Promise<void> {
  // FR-CMD-001: inputs beginning with '/' pass through the shared command
  // router BEFORE ordinary AI submission — the raw command text never
  // reaches the model.
  commandErrorNotice.value = null;
  // T7/D3 + Codex P1: capture the conversation the user pressed Send in
  // BEFORE the first await (command routing / file encoding both suspend).
  // A later selection change can never attach this submission to chat B.
  const commandConversationId = conversationId.value;
  const disposition = await commandRouter.routeCommand(text, {
    pastedContents: options?.pastedContents,
    hasFiles: files.length > 0,
    onAccepted: options?.onAccepted,
  });
  await applyCommandDisposition(
    disposition,
    text,
    files,
    options,
    { commandConversationId }
  );
}

async function applyCommandDisposition(
  disposition: ChatCommandDisposition,
  text: string,
  files: File[],
  options?: {
    fromVoice?: boolean;
    pastedContents?: Record<string, string>;
    onAccepted?: () => void;
  },
  context?: { commandConversationId?: string | null }
): Promise<void> {
  if (disposition.kind === "not_command") {
      await performOrdinarySend(text, files, options, {
      targetConversationId: context?.commandConversationId,
    });
    return;
  }
  if (disposition.kind === "submit_prompt") {
    if (
      context?.commandConversationId !== undefined &&
      context.commandConversationId !== null &&
      conversationId.value !== context.commandConversationId
    ) {
      // The goal/skill IPC awaited — the user switched chats. Abort the
      // prompt send entirely (the goal/skill state lives in chat A).
      commandErrorNotice.value =
        t("workspaceChat.command.staleAborted") ||
        "Selection changed — the command was not run.";
      return;
    }
    // The command's side effects are done (goal created / skill invoked);
    // submit the resulting prompt through the ordinary path ONCE with the
    // command-selected mode (FR-CMD-003: never re-dispatched as a command).
    // onAccepted rides INSIDE the send options so an image-dialog park
    // keeps the draft and the replayed send clears it exactly once
    // (Codex P2; no double-fire with the branch-level acceptance).
    await performOrdinarySend(
      disposition.prompt,
      [],
      {
        fromVoice: options?.fromVoice,
        pastedContents: options?.pastedContents,
        modeOverride: disposition.mode,
        onAccepted: options?.onAccepted,
      },
      { targetConversationId: context?.commandConversationId }
    );
    return;
  }
  if (disposition.kind === "needs_scheduled_approval") {
    // Staged (not persisted): the approval dialog owns the continuation
    // (FR-CMD-007). The command text is consumed — mirrors the Chat V2
    // reference, which clears the draft when the staging dialog opens.
    pendingScheduledLoop.value = disposition;
    showScheduledLoopApproval.value = true;
    options?.onAccepted?.();
    return;
  }
  if (disposition.kind === "rejected") {
    // FR-CMD-004: draft retained; safe localized error above the composer.
    if (disposition.message) {
      commandErrorNotice.value = disposition.message;
    }
    return;
  }
  // completed: local exchange rendered / loop started / clear ran. When the
  // command expanded into a prompt send, clear the draft ONLY if that send
  // was accepted (FR-SUB-002: a rejected/parked expanded send keeps it).
  if (disposition.acceptedSend !== false) {
    options?.onAccepted?.();
  }
}

/**
 * Ordinary submission path — no command interception (an expanded prompt or
 * routed turn must never be re-parsed as a command).
 */
async function performOrdinarySend(
  text: string,
  files: File[],
  options?: {
    fromVoice?: boolean;
    pastedContents?: Record<string, string>;
    onAccepted?: () => void;
    modeOverride?: "chat" | "plan";
    /** Trusted channel: the user-confirmed batch reference set (FR-IMG-004). */
    confirmedBatchReferences?: readonly ChatV2GeneratedImageReference[];
    /** T2: deterministic request identity (plan continuations). */
    clientRequestId?: string;
  },
  /**
   * T7/D3: the conversation this send was issued in (captured before the
   * first await by the caller). When provided, a selection change during
   * any later await aborts the send instead of retargeting it.
   */
  sendTarget?: { readonly targetConversationId?: string | null }
): Promise<boolean> {
  // FR-SUB-004 (capability parity): paste bodies travel as their own bounded
  // map so the engine expands the same content the Chat V2 stream edge
  // receives — the composer's visible text carries only the placeholders.
  const pastedContents = options?.pastedContents;
  // Trusted resend channel (FR-IMG-011): a confirmed batch rides outside the
  // explicit tray so re-confirming the same set cannot loop.
  const confirmedBatch = options?.confirmedBatchReferences;
  // Generated-image preflight (FR-IMG-005..008): explicit tray selections
  // win; otherwise deterministic inference runs over the visible window —
  // an ambiguous match opens the chooser, and selections above the direct
  // maximum open batch confirmation instead of silently truncating.
  const generatedImageReferences = runGeneratedImagePreflight(
    text,
    files,
    options
  );
  if (generatedImageReferences === null) {
    return false; // a dialog now waits on the user; the draft is preserved
  }
  // Empty-state send (no conversation selected): create + select a chat
  // first (legacy-dock parity via ensureWorkspaceConversationId) so the
  // typed pending draft has a conversation to send into. Without this the
  // store's sendMessage silently returns false and both Send + Enter die
  // with no feedback. After the over-limit guard so a rejected send never
  // mints an empty chat; refs were captured above under the pending key.
  if (!conversationId.value) {
    await onNewChat();
    if (!conversationId.value) return false;
  }
  // T7/D3 (audit): the conversation this send belongs to is fixed BEFORE
  // any await below (file encoding can take seconds). A selection change
  // during encoding must abort — never attach the message to chat B.
  const sendConversationId =
    sendTarget?.targetConversationId ?? conversationId.value;
  // Reference-only sends still need a message for the model (legacy parity)
  // — including a user-confirmed batch whose instruction text is empty
  // (Codex P2: without this the confirmed dialog closes and sends nothing).
  const messageText =
    (generatedImageReferences.length > 0 ||
      (confirmedBatch && confirmedBatch.length > 0)) &&
    text.trim().length === 0
      ? GENERATED_IMAGE_FALLBACK_PROMPT
      : text;
  const uploadedFiles =
    files.length > 0
      ? (await Promise.all(files.map(encodeFile))).filter(
          (item): item is NonNullable<Awaited<ReturnType<typeof encodeFile>>> =>
            item !== null
        )
      : undefined;
  if (conversationId.value !== sendConversationId) {
    // Selection changed while attachments encoded (audit T7/D3): keep the
    // draft, keep the message out of the newly selected chat, explain.
    commandErrorNotice.value =
      t("workspaceChat.command.staleAborted") ||
      "Selection changed — the command was not run.";
    return false;
  }
  if (selectedModel.value) {
    try {
      localStorage.setItem(LAST_MODEL_STORAGE_KEY, selectedModel.value);
    } catch {
      // Storage unavailable — session-only preference.
    }
  }
  voice.beginAssistantResponse(options?.fromVoice === true);
  if (generatedImageReferences.length > 0) {
    pendingDraftClearKey.value = composerDraftKey.value;
  }
  // FR-HIS-002/004: drafted history selections submit as OPAQUE archive
  // references with a retry-stable submission identity; the chips clear only
  // on the engine's start acknowledgement (accepted ids only).
  const historySelectionIds =
    historyUiEnabled.value && selectedContextItems.value.length > 0
      ? selectedContextItems.value.map((item) => item.sourceId)
      : undefined;
  if (historySelectionIds && !pendingHistorySubmissionId) {
    pendingHistorySubmissionId = crypto.randomUUID();
  }
  const accepted = await selectedStore.sendMessage(messageText, {
    clientRequestId: options?.clientRequestId,
    model: selectedModel.value,
    // A command-derived turn (goal plan prompt) overrides the surface mode.
    mode: options?.modeOverride ?? mode.value,
    toolApprovalMode: toolApprovalMode.value,
    attachments: uploadedFiles,
    generatedImageReferences:
      generatedImageReferences.length > 0 ? generatedImageReferences : undefined,
    pastedContents:
      pastedContents && Object.keys(pastedContents).length > 0
        ? pastedContents
        : undefined,
    confirmedBatchReferences: confirmedBatch,
    historySelectionIds,
    submissionId: historySelectionIds
      ? (pendingHistorySubmissionId ?? undefined)
      : undefined,
  });
  // Accepted-send rule (composer contract): the draft (text/files/pasted)
  // clears only when THIS send was accepted — keying on shared run state
  // would clear the draft of a rejected send whenever the previous run's id
  // was still live (queue limit, gate, transport failure).
  if (accepted) {
    options?.onAccepted?.();
  }
  return accepted;
}

// --- Shared command routing (capability parity FR-CMD / FR-SKL-005) --------
/** Safe localized command error shown above the composer (FR-CMD-004). */
const commandErrorNotice = ref<string | null>(null);
/** Staged scheduled loop awaiting the up-front tool-policy approval. */
const pendingScheduledLoop = ref<{
  action: StagedScheduledLoop;
  rawCommand: string;
} | null>(null);
const showScheduledLoopApproval = ref(false);

const commandRouter = useChatCommandRouting({
  isBusy: () => selectedStore.isBusy,
  ensureConversationId: async () => {
    if (conversationId.value) return conversationId.value;
    await onNewChat();
    return conversationId.value ?? null;
  },
  activeGoal: () => {
    const goal = selectedStore.goal;
    return goal ? { goalId: goal.goalId } : null;
  },
  appendLocalExchange: (userText, assistantText) => {
    // Codex P2: on the empty state the store drops local exchanges
    // silently — create the chat first so command receipts always render.
    if (!conversationId.value) {
      void onNewChat().then(() => {
        selectedStore.appendLocalCommandExchange(userText, assistantText);
      });
      return;
    }
    selectedStore.appendLocalCommandExchange(userText, assistantText);
  },
  setError: (message) => {
    commandErrorNotice.value = message;
  },
  translate: (key, fallback, vars) =>
    vars ? t(key, vars) || fallback : t(key) || fallback,
  createGoal: async (input) => {
    const created = await createGoal(input);
    // Codex P2: seed the created goal immediately so a following /loop N
    // finds it without waiting for a reselection.
    if (created) {
      void hydrateActiveGoal(input.conversationId);
    }
    return created;
  },
  startGoalLoop: async (input) => (await startGoalLoop(input)) !== null,
  invokePromptSkill: async (input) => (await invokePromptSkill(input)) !== null,
  createScheduledLoop: (input) => createScheduledLoop(input),
  controlScheduledLoop: async (id, operation) => {
    const loop = await controlScheduledLoop(id, operation);
    // Codex P2: the control response is authoritative — apply it to the run
    // strip when the conversation still owns the command.
    if (
      loop &&
      typeof loop === "object" &&
      "status" in loop &&
      conversationId.value === id
    ) {
      authoritativeLoopStatus.value = String(
        (loop as { status: unknown }).status
      );
    }
    return loop;
  },
  getScheduledLoopStatus: async (id) => {
    const loop = await getScheduledLoopStatus(id);
    if (
      loop &&
      typeof loop === "object" &&
      "status" in loop &&
      conversationId.value === id
    ) {
      authoritativeLoopStatus.value = String(
        (loop as { status: unknown }).status
      );
    }
    return loop;
  },
  dispatchSlashCommand: (input) => dispatchSlashCommand(input),
  onSlashPromptExpand: async (
    prompt,
    pastedContents,
    targetConversationId,
    onAccepted
  ): Promise<boolean> => {
    if (targetConversationId && conversationId.value !== targetConversationId) {
      // Codex High (cross-conversation command): a selection change during
      // registry dispatch aborts the expanded send — never into chat B.
      commandErrorNotice.value =
        t("workspaceChat.command.staleAborted") ||
        "Selection changed — the command was not run.";
      return false;
    }
    return performOrdinarySend(prompt, [], { pastedContents, onAccepted });
  },
  onClearConversation: async (targetConversationId): Promise<void> => {
    // Codex High (cross-conversation /clear): only clear when the command
    // still owns the CURRENT selection — a switch mid-dispatch aborts
    // rather than erasing the newly selected conversation.
    if (!targetConversationId || conversationId.value !== targetConversationId) {
      commandErrorNotice.value =
        t("workspaceChat.command.staleAborted") ||
        "Selection changed — the command was not run.";
      return;
    }
    try {
      await clearChatV2Conversation(targetConversationId);
      await workspaceStore.bootstrap();
      await selectedStore.loadSelection(targetConversationId);
    } catch {
      // Non-fatal — clearing can be retried.
    }
  },
});

/** Confirm tool approval and persist the staged scheduled loop (FR-CMD-007). */
async function onScheduledLoopApprovalConfirm(
  approval: ScheduledLoopApprovalPayload
): Promise<void> {
  const staged = pendingScheduledLoop.value;
  if (!staged) {
    showScheduledLoopApproval.value = false;
    return;
  }
  pendingScheduledLoop.value = null;
  showScheduledLoopApproval.value = false;
  await commandRouter.confirmScheduledLoop(approval);
  // The backend persisted the command + confirmation rows — reload history
  // and sidebar so they render immediately (Chat V2 parity).
  if (conversationId.value) {
    await selectedStore.loadSelection(conversationId.value);
    await workspaceStore.bootstrap();
  }
}

/** Cancel staged scheduled-loop creation (user closed the approval dialog). */
function onScheduledLoopApprovalCancel(): void {
  pendingScheduledLoop.value = null;
  commandRouter.cancelScheduledLoop();
  showScheduledLoopApproval.value = false;
}

// Conversation-scoped staging never leaks across selections (FR-CMD-008).
watch(conversationId, () => {
  commandRouter.resetConversationState();
  pendingScheduledLoop.value = null;
  showScheduledLoopApproval.value = false;
});

// --- Reasoning visibility preference + agent tasks (FR-INT-004/005) ---------
/**
 * FR-INT-005: user-controlled reasoning display (shared preference with
 * Chat V2 — persisted + cross-surface change event). The selected-
 * conversation preference changes presentation only; main-process
 * authorization and execution are untouched.
 */
const showReasoning = ref<boolean>(readAiChatReasoningVisible());

function onReasoningVisibilityChanged(
  event: Event
): void {
  const detail = (
    event as CustomEvent<AiChatReasoningVisibilityChangedDetail>
  ).detail;
  if (typeof detail?.visible === "boolean") {
    showReasoning.value = detail.visible;
  }
}

function toggleReasoningVisible(): void {
  writeAiChatReasoningVisible(!showReasoning.value);
}

/**
 * T5 (audit FR-INT-004): cancel EXACTLY the emitted agent task through the
 * agent-runtime API — never the conversation run, never a sibling task. A
 * live task aborts its own loop; a stale non-terminal row flips to
 * cancelled. Failures are non-fatal (the dialog refresh reconciles).
 */
function handleAgentTaskCancel(agentTaskId: string): void {
  void cancelAgentTask(agentTaskId).catch(() => undefined);
}

// --- Recoverable history + compaction (FR-HIS-001..005) ----------------------
/**
 * History-UI rollout flag (fail-closed: false until the main-process flag
 * read resolves true). When false the drawer toggle, selected-context chips,
 * and compaction controls stay hidden so no passage can be selected that
 * backend resolution would no-op.
 */
const historyUiEnabled = ref(false);
const showHistoryDrawer = ref(false);
const selectedContextItems = ref<SelectedContextItem[]>([]);
/** Per-conversation selection drafts (§13.3): switching preserves each chat's chips. */
const selectedContextDrafts = new Map<string, SelectedContextItem[]>();
/**
 * Stable submission identity (§13.3): reused across transport retries so the
 * backend reuses the same user-turn metadata; resolved on the start ack.
 */
let pendingHistorySubmissionId: string | null = null;
const compactionStatus = ref<CompactionStatusSnapshot | null>(null);
let unsubscribeCompactionProgress: (() => void) | null = null;
let unsubscribeStartAck: (() => void) | null = null;
let unsubscribeLiveToolResult: (() => void) | null = null;

function syncActiveHistoryDraft(): void {
  const id = conversationId.value;
  if (id) {
    selectedContextDrafts.set(id, [...selectedContextItems.value]);
  }
}

/**
 * Build a chip from a resolved excerpt (§13.3): the preview text is
 * display-only — the backend re-resolves the opaque sourceId on submit.
 */
function handleHistorySelect(excerpt: HistoryExcerpt): void {
  // Fail-closed when the history-UI stage is off: ignore drawer selections.
  if (!historyUiEnabled.value) return;
  if (selectedContextItems.value.some((i) => i.sourceId === excerpt.sourceId)) {
    return; // dedup: a passage can be selected only once
  }
  // Review F7: the IPC schema caps historySelectionIds at 20 — selecting a
  // 21st would make EVERY subsequent send fail validation until chips are
  // removed manually. Stop at the boundary with a visible reason.
  if (selectedContextItems.value.length >= 20) {
    commandErrorNotice.value =
      t("workspaceChat.history.selectionLimit") ||
      "Up to 20 passages can be attached to one message.";
    return;
  }
  const preview =
    excerpt.text.length > 80 ? excerpt.text.slice(0, 77) + "…" : excerpt.text;
  selectedContextItems.value = [
    ...selectedContextItems.value,
    {
      sourceId: excerpt.sourceId,
      preview,
      estimatedTokens: Math.ceil(excerpt.text.length / 4),
    },
  ];
  syncActiveHistoryDraft();
}

function removeSelectedContext(sourceId: string): void {
  selectedContextItems.value = selectedContextItems.value.filter(
    (i) => i.sourceId !== sourceId
  );
  syncActiveHistoryDraft();
}

function clearSelectedContext(): void {
  selectedContextItems.value = [];
  syncActiveHistoryDraft();
}

/**
 * Source navigation from the drawer (§13.2): close and scroll to the message
 * — viewing never mutates the next model request.
 */
function handleHistoryNavigate(excerpt?: HistoryExcerpt): void {
  showHistoryDrawer.value = false;
  if (!excerpt) return;
  void nextTick(() => {
    const el = document.querySelector(
      `[data-message-id="${CSS.escape(excerpt.messageId)}"]`
    );
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const previous = el.style.outline;
    el.style.outline = "2px solid var(--v-primary-base, #1976d2)";
    window.setTimeout(() => {
      el.style.outline = previous;
    }, 1_600);
  });
}

// Conversation switch: swap each chat's chip draft (never leak across chats).
// A pending generated-image send never replays into the newly selected chat,
// and an unresolved submission identity never crosses conversations (Codex
// adversarial #9: a leaked id would fail the engine's CONVERSATION_MISMATCH
// dedupe on the next send).
watch(conversationId, () => {
  pendingHistorySubmissionId = null;
  pendingGeneratedImageSend.value = null;
  ambiguityCandidates.value = [];
  showGeneratedImageChooser.value = false;
  showBatchConfirmDialog.value = false;
});

watch(conversationId, (next, previous) => {
  if (previous) {
    selectedContextDrafts.set(previous, [...selectedContextItems.value]);
  }
  selectedContextItems.value = next
    ? [...(selectedContextDrafts.get(next) ?? [])]
    : [];
  showHistoryDrawer.value = false;
  compactionStatus.value = null;
  void refreshCompactionStatus();
  // Review F8: exports queued while viewing another conversation (its
  // workspace_required path) drain when the user returns and the target
  // workspace is already approved — the approval-change watcher alone
  // never fires for an already-approved state.
  if (next && conversationWorkspace.workspace.value?.approvalState === "approved") {
    const queued = pendingImageExports.value.get(next) ?? [];
    if (queued.length > 0) {
      pendingImageExports.value = new Map(pendingImageExports.value).set(next, []);
      for (const reference of queued) {
        void attemptGeneratedImageExport(next, reference);
      }
    }
  }
});

/**
 * FR-HIS-003: the engine start acknowledgement reports which opaque
 * references were accepted, changed, or rejected. Only ACCEPTED chips clear;
 * changed survivors flag for explicit re-confirmation and rejected stay
 * visible so the user is not silently charged for context they did not get.
 */
function onEngineStartAck(chunk: Record<string, unknown>): void {
  const hasSelectionAcks =
    Array.isArray(chunk.historySelectionAcceptedIds) ||
    Array.isArray(chunk.historySelectionChangedIds) ||
    Array.isArray(chunk.historySelectionRejectedIds);
  if (hasSelectionAcks && selectedContextItems.value.length > 0) {
    const toIdSet = (value: unknown): Set<string> => {
      if (!Array.isArray(value)) return new Set<string>();
      const ids: string[] = [];
      for (const entry of value) {
        if (typeof entry === "string") ids.push(entry);
      }
      return new Set<string>(ids);
    };
    const accepted = toIdSet(chunk.historySelectionAcceptedIds);
    const changed = toIdSet(chunk.historySelectionChangedIds);
    const rejected = toIdSet(chunk.historySelectionRejectedIds);
    selectedContextItems.value = selectedContextItems.value
      .filter((item) => !accepted.has(item.sourceId))
      .map((item) =>
        changed.has(item.sourceId)
          ? { ...item, refreshed: true }
          : rejected.has(item.sourceId)
            ? { ...item, rejected: true }
            : item
      );
    syncActiveHistoryDraft();
  }
  // Acceptance resolves the stable submission identity (§13.3).
  pendingHistorySubmissionId = null;
}

/** FR-HIS-005: compaction progress/retry/cancel, independent of run recovery. */
function handleCompactionProgressEvent(
  event: ChatV2CompactionProgressEvent
): void {
  if (event.conversationId !== conversationId.value) return;
  compactionStatus.value = {
    state: event.state,
    runId: event.runId,
    generationId: event.generationId,
    sectionsPacked: event.sectionsPacked,
  };
}

/** FR-HIS-005: compaction controls respect the current busy restrictions. */
const compactionBusyGuard = computed(() => selectedStore.isBusy);

async function refreshCompactionStatus(): Promise<void> {
  const id = conversationId.value;
  if (!id) {
    compactionStatus.value = null;
    return;
  }
  try {
    const status = await getCompactionStatus(id);
    // Ignore stale responses when the user switched conversations mid-flight.
    if (conversationId.value === id) {
      compactionStatus.value = status;
    }
  } catch {
    // Non-fatal — the progress subscription reconciles on the next event.
  }
}

async function onCompactionCancel(): Promise<void> {
  if (!conversationId.value) return;
  try {
    await cancelCompaction(conversationId.value);
    await refreshCompactionStatus();
  } catch {
    // Non-fatal — the progress subscription reconciles.
  }
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

/** PRD §13.4: the no-model action routes to the AI provider settings. */
function openProviderSettings(): void {
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

/**
 * FR-PLN-003..008: plan decisions are validated before any continuation.
 * A null/stale/failed decision keeps the card actionable (safe retry error)
 * and never tells the model the user approved; a persisted decision starts
 * exactly ONE continuation turn — through the ordinary send path, which the
 * durable queue owns when a turn is already active (FR-PLN-008).
 */
const planDecisionInFlight = ref(false);
const planDecisionError = ref<string | null>(null);

async function onLegacyPlanAction(
  action: "approve-plan" | "reject-plan" | "request-plan-changes",
  feedback = ""
): Promise<void> {
  if (!conversationId.value) return;
  // FR-PLN-003: a second click while the decision request is in flight is a
  // no-op — exactly one IPC per decision.
  if (planDecisionInFlight.value) return;
  const plan = latestPlanState.value;
  const version = plan?.latestVersion?.version ?? plan?.currentVersion;
  if (!plan?.planId || version === undefined) return;
  // Codex P1 (cross-conversation continuation): bind the decision AND its
  // continuation to the conversation the user decided in. A selection change
  // during the awaited IPC must never deliver "begin executing" to a
  // different chat.
  const targetConversationId = conversationId.value;
  planDecisionInFlight.value = true;
  planDecisionError.value = null;
  try {
    let updated: Awaited<ReturnType<typeof approveChatV2Plan>> = null;
    if (action === "approve-plan") {
      updated = await approveChatV2Plan(targetConversationId, plan.planId, version);
    } else if (action === "reject-plan") {
      updated = await rejectChatV2Plan(targetConversationId, plan.planId, version, feedback);
    } else {
      updated = await requestChatV2PlanChanges(
        targetConversationId,
        plan.planId,
        version,
        feedback
      );
    }
    if (!updated) {
      // FR-PLN-005: approval did not take effect — do NOT send the
      // "begin executing" message; the model would execute an unapproved
      // plan. The card stays actionable for a retry.
      const errorKeys: Record<typeof action, string> = {
        "approve-plan": "aiChatV2Plan.approve_failed",
        "reject-plan": "aiChatV2Plan.reject_failed",
        "request-plan-changes": "aiChatV2Plan.changes_request_failed",
      };
      const fallbacks: Record<typeof action, string> = {
        "approve-plan": "Plan approval did not complete. Please try again.",
        "reject-plan": "Plan rejection did not complete. Please try again.",
        "request-plan-changes":
          "Requesting plan changes did not complete. Please try again.",
      };
      planDecisionError.value = t(errorKeys[action]) || fallbacks[action];
      return;
    }
    if (conversationId.value !== targetConversationId) {
      // Codex P1: the user switched chats mid-decision. The decision itself
      // persisted in its originating conversation, but the continuation must
      // NOT fire into the newly selected one — and loadSelection(target)
      // would hijack the selection BACK, so abort before any reload. The
      // receipt renders the next time that conversation is opened.
      planDecisionError.value =
        t("workspaceChat.plan.continuationAborted") ||
        "Selection changed — the plan decision was saved, but its follow-up message was not sent. Reopen the conversation to continue.";
      return;
    }
    // Still on the deciding conversation: refresh so the
    // receipt/planStateView reflects the persisted decision.
    await selectedStore.loadSelection(targetConversationId);
    // Codex P1 (round 2): the reload AWAITS — a selection change during it
    // must abort here too, or the continuation fires into chat B.
    if (conversationId.value !== targetConversationId) {
      planDecisionError.value =
        t("workspaceChat.plan.continuationAborted") ||
        "Selection changed — the plan decision was saved, but its follow-up message was not sent. Reopen the conversation to continue.";
      return;
    }
    // FR-PLN-006/007: start the correct continuation exactly once. The
    // continuation message keys are shared with Chat V2 (already localized).
    // T2/D6 (AD-007): the continuation's clientRequestId derives from the
    // persisted transition — reloads, replays, and double-clicks resubmit the
    // SAME identity, so the coordinator cache (idle) / pending unique index
    // (busy) collapse them into the one accepted continuation.
    const continuationRequestId = await planContinuationRequestId(
      plan.planId,
      version,
      action as PlanContinuationDecision
    );
    if (action === "approve-plan") {
      await performOrdinarySend(
        t("aiChatV2Plan.approved_continue_message") ||
          "Plan approved. Please begin executing the plan now.",
        [],
        { modeOverride: "chat", clientRequestId: continuationRequestId }
      );
    } else if (action === "reject-plan") {
      const prefix =
        t("aiChatV2Plan.rejected_continue_message") ||
        "Plan rejected. Please revise the plan based on the following feedback and resubmit for approval.";
      await performOrdinarySend(
        feedback ? `${prefix}\n\nFeedback: ${feedback}` : prefix,
        [],
        { modeOverride: "chat", clientRequestId: continuationRequestId }
      );
    } else {
      const prefix =
        t("aiChatV2Plan.changes_requested_continue_message") ||
        "Plan changes requested. Please update the plan based on the following feedback and resubmit for approval.";
      await performOrdinarySend(
        feedback ? `${prefix}\n\nFeedback: ${feedback}` : prefix,
        [],
        { modeOverride: "chat", clientRequestId: continuationRequestId }
      );
    }
  } catch (err) {
    // FR-PLN-005: persistence/transport failure keeps the card actionable.
    planDecisionError.value =
      err instanceof Error ? err.message : String(err);
  } finally {
    planDecisionInFlight.value = false;
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
  ensureDeliveredRowsSubscription();
  // FR-HIS-001: fail-closed rollout flag + start-ack routing + compaction
  // progress subscription (one per owning surface).
  isHistoryUiEnabled()
    .then((enabled) => {
      historyUiEnabled.value = enabled;
    })
    .catch(() => undefined);
  window.addEventListener(
    AI_CHAT_REASONING_VISIBILITY_CHANGED_EVENT,
    onReasoningVisibilityChanged
  );
  unsubscribeStartAck = selectedStore.onStartAck(onEngineStartAck);
  unsubscribeLiveToolResult = selectedStore.onLiveToolResult((chunk) => {
    // FR-INT-003: trusted navigation for the SELECTED conversation's live
    // results, exactly once; history seeding and background conversations
    // never reach this sink.
    void handleAiNavigationToolResult(router, chunk.toolResult);
  });
  subscribeCompactionProgress(handleCompactionProgressEvent);
  // The shared-channel contract removes ALL compaction listeners at once
  // (same call Chat V2 makes in its unmount path).
  unsubscribeCompactionProgress = () => {
    unsubscribeAllCompactionProgress();
  };
  void refreshCompactionStatus();
  if (conversationId.value) {
    void loadApprovalMode(conversationId.value);
    void hydrateActiveGoal(conversationId.value);
    // Focus transfer (PRD §19.1): mounting with a conversation already
    // selected (New chat from an inner route, reload restore, deep link)
    // lands focus in the composer — the mount never observed the id
    // transition the conversation watcher keys on.
    composerFocusSignal.value += 1;
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
  deliveredRowsUnsubscribe?.();
  deliveredRowsUnsubscribe = null;
  window.removeEventListener(
    AI_CHAT_REASONING_VISIBILITY_CHANGED_EVENT,
    onReasoningVisibilityChanged
  );
  unsubscribeStartAck?.();
  unsubscribeStartAck = null;
  unsubscribeLiveToolResult?.();
  unsubscribeLiveToolResult = null;
  unsubscribeCompactionProgress?.();
  unsubscribeCompactionProgress = null;
  pendingMessages.teardown();
  voice.dispose();
  // Release the conversation's filesystem-watch claim (review fix): this
  // surface owns the composable instance; without disposal an inner-page
  // route change leaked the main-process watcher until the next selection.
  conversationWorkspace.dispose().catch(() => undefined);
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
  padding: 0 12px 6px;
  flex-shrink: 0;
}

.chat-center__workspace-error {
  margin: 0;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  color: rgb(var(--v-theme-error));
}

.chat-center__workspace-retry {
  margin-left: 6px;
  min-height: 24px;
  padding: 2px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.3);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font-size: 12px;
  cursor: pointer;
}

.chat-center__workspace-retry:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.chat-center__messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 6px;
}

.chat-center__history-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
}

.chat-center__history-toggle:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.chat-center__history-toggle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.chat-center__recovery-detail {
  display: flex;
  align-items: center;
  padding: 2px 12px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.75);
  flex-shrink: 0;
}

.chat-center__browser-region {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 4px;
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

.chat-center__genimg-notice {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 4px 12px 8px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.chat-center__genimg-notice-text {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
