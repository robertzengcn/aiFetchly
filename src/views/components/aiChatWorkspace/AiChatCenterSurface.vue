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

    <!-- B08: recoverable plan-continuation banner. A committed decision whose
         follow-up was never sent (selection change, rejected enqueue,
         reload recovery) offers Continue — same decision identity, exactly
         one continuation — or Dismiss to abandon it. -->
    <div
      v-if="pendingPlanContinuation !== null"
      class="chat-center__genimg-notice"
      role="alert"
      data-testid="workspace-plan-continuation-banner"
    >
      <v-icon size="x-small" color="warning" class="mr-1">
        mdi-alert-circle-outline
      </v-icon>
      <span class="chat-center__genimg-notice-text">
        {{
          t("workspaceChat.plan.continuationPending") ||
          "The plan decision was saved, but its follow-up message was not sent. Use Continue to retry."
        }}
      </span>
      <v-btn
        size="x-small"
        variant="text"
        class="ml-1"
        :disabled="planDecisionInFlight"
        data-testid="workspace-plan-continuation-retry"
        @click="onRetryPlanContinuation"
      >
        {{ t("workspaceChat.plan.continue") || "Continue" }}
      </v-btn>
      <v-btn
        size="x-small"
        variant="text"
        class="ml-1"
        :aria-label="t('common.dismiss') || 'Dismiss'"
        data-testid="workspace-plan-continuation-dismiss"
        @click="onDismissPlanContinuation"
      >
        {{ t("common.dismiss") || "Dismiss" }}
      </v-btn>
    </div>

    <!-- Generated-image reference notice (over-limit preflight abort). -->
    <div
      v-if="shownImageNotice !== null"
      class="chat-center__genimg-notice"
      role="alert"
      data-testid="workspace-genimg-notice"
    >
      <v-icon size="x-small" color="warning" class="mr-1">
        mdi-image-alert-outline
      </v-icon>
      <span class="chat-center__genimg-notice-text">
        {{ shownImageNotice }}
      </span>
      <v-btn
        size="x-small"
        variant="text"
        class="ml-1"
        :aria-label="t('common.close') || 'Close'"
        data-testid="workspace-genimg-notice-dismiss"
        @click="clearImageNotice()"
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
import { buildUploadedAttachments } from "@/views/components/aiChatV2/aiChatV2Attachment";
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
  recoverChatV2PlanContinuationIntent,
  answerChatV2Question,
  clearChatV2Conversation,
  startCompaction,
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
import type { SelectedContextItem } from "@/views/components/aiChatV2/selectedContextTypes";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";
import type { ChatV2CompactionProgressEvent } from "@/entityTypes/aiChatV2Types";
import type { CompactionStatusSnapshot } from "@/service/AIChatCompactionCoordinator";
import { handleAiNavigationToolResult } from "@/views/utils/aiNavigationResultHandler";
import { navigateToHistorySource } from "@/views/utils/historyNavigate";
import { useConversationScopedOverlays } from "@/views/composables/aiChatWorkspace/useConversationScopedOverlays";
import { localizeWorkspaceError } from "@/views/utils/workspaceErrorLocalization";
import {
  planContinuationRequestId,
  type PlanContinuationDecision,
} from "@/views/utils/planContinuationIdentity";
import {
  savePlanContinuationIntent,
  loadPlanContinuationIntent,
  clearPlanContinuationIntent,
  isPlanContinuationDismissed,
  markPlanContinuationDismissed,
  clearPlanContinuationDismissal,
  type PlanContinuationAction,
  type PlanContinuationIntent,
} from "@/views/utils/planContinuationStore";
import type { AIChatPlanContinuationRecoveryView } from "@/entityTypes/aiChatPlanTypes";
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
import type { ChatRunTerminalRecord } from "@/entityTypes/aiChatWorkspaceTypes";
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
import { useHistorySelectionStore } from "@/views/store/historySelection";
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

// G01 (AD-008): conversation-bound overlay ownership. Report, staging and
// generated-image dialogs always describe the current chat — their closers
// are registered here instead of scattered one-watch-per-dialog resets, so
// a selection change can never leave a dialog describing (or submitting
// into) a conversation the user navigated away from.
const scopedOverlays = useConversationScopedOverlays(
  () => conversationId.value
);

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
  // R07 (FR-VOI-008): stopping the turn must also stop its spoken output —
  // queued/playing utterances must not outlive the text run the user just
  // cancelled. Applies to every branch below (goal / loop / run).
  resetSpeechFeed();
  void voice.stopSpeaking();
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
  void selectedStore
    .denyToolPermission(message, permissionTexts.value)
    .catch(() => undefined);
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
const historySelStore = useHistorySelectionStore();

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
// G01: owned by the shared overlay host (AD-008), not a local watcher.
scopedOverlays.registerSelectionBoundOverlay("report-dialogs", () => {
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
  clearImageNotice();
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
  clearImageNotice();
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
  // Re-read the history rollout flag on selection change (mount-time read
  // races late flag writers — E2E seeding, operator store toggles).
  refreshHistoryUiFlag();
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
 * Accepted image submissions awaiting their turn's completion (audit R05 /
 * FR-SUB-002): per conversation, the EXACT reference snapshots submitted by
 * accepted sends, each tagged with that send's per-conversation accepted-run
 * ordinal (the store's acceptance registry). Arming happens only AFTER the
 * store accepts the submission (see performOrdinarySend) — a rejected send
 * (queue limit, gate, transport failure) never arms, so no later transition
 * can clear its retained draft. Registered entries are consumed ONLY by
 * genuine terminal records (see the watcher below); identity verification
 * keeps an unrelated completion (unarmed plain-text turn, coalesced or
 * dropped terminal) from consuming — or misaligning — another run's entry.
 * A plain Map is deliberate: the registry only changes alongside explicit
 * store transitions, never through UI reactivity.
 */
interface PendingImageReferenceClear {
  readonly runOrdinal: number;
  readonly references: ChatV2GeneratedImageReference[];
}

const pendingDraftClears = new Map<string, PendingImageReferenceClear[]>();

/**
 * Consume one accepted submission's snapshot when ITS run's terminal event
 * is reported by the store (audit R05). The trigger is `lastTerminalRun` —
 * `complete`/`error`/`cancelled` events the store actually consumed for a
 * conversation — never a view-state shape: after an A→B→A re-selection the
 * handshake leaves the view idle while the run streams on, and a resumed
 * mid-run chunk (which re-arms the presenter's liveness instead of
 * clearing) must never be mistaken for a completion (FR-LIF-002). The
 * entry matching the terminal's accepted-run ordinal is consumed exactly
 * once; on `complete` its snapshot is removed from the CURRENT draft, so
 * references added after the submission survive (legacy retry parity:
 * `error`/`cancelled` dequeue but keep the tray).
 */
watch(
  () => selectedStore.lastTerminalRun,
  (terminal: ChatRunTerminalRecord | null) => {
    if (!terminal) return;
    const draftKey = composerDraftKeyFor(terminal.conversationId);
    const queue = pendingDraftClears.get(draftKey);
    const matched = queue
      ? queue.findIndex((entry) => entry.runOrdinal === terminal.ordinal)
      : -1;
    if (!queue || matched < 0) return;
    const submitted = queue.splice(matched, 1)[0];
    if (queue.length === 0) pendingDraftClears.delete(draftKey);
    if (!submitted || terminal.kind !== "complete") return;
    const current =
      composerDrafts.getDraft(draftKey)?.generatedImageReferences ?? [];
    if (current.length === 0) return;
    composerDrafts.setGeneratedImageReferences(
      draftKey,
      current.filter(
        (reference) =>
          !submitted.references.some((sent) =>
            sameGeneratedImageRef(reference, sent)
          )
      )
    );
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

/**
 * R08: late export outcomes belong to the CAPTURED conversation, never to
 * the currently selected chat. After the awaited IPC the surface may show
 * chat B, so outcome notices queue per conversation id (a plain ref Map,
 * replaced immutably) and the banner resolves them for the CURRENT
 * selection — chat B can never display chat A's save result, and returning
 * to A surfaces the queued outcome exactly where it was earned
 * (FR-IMG-013/015, FR-SUB-007, FR-LIF-002).
 */
const deferredImageNotices = ref<Map<string, string>>(new Map());

function queueDeferredImageNotice(
  conversation: string,
  message: string
): void {
  deferredImageNotices.value = new Map(deferredImageNotices.value).set(
    conversation,
    message
  );
}

/**
 * What the banner shows for the CURRENT selection: this conversation's
 * deferred export outcome first, else the synchronous session notice
 * (composer preflight errors unaffected by R08).
 */
const shownImageNotice = computed<string | null>(() => {
  const id = conversationId.value;
  if (!id) return generatedImageNotice.value;
  return deferredImageNotices.value.get(id) ?? generatedImageNotice.value;
});

/** Clear what the current conversation displays (tray action or dismiss). */
function clearImageNotice(): void {
  generatedImageNotice.value = null;
  const id = conversationId.value;
  if (!id) return;
  const next = new Map(deferredImageNotices.value);
  next.delete(id);
  deferredImageNotices.value = next;
}

/**
 * R08: conversations whose queued export returned `workspace_required`
 * while ANOTHER chat was selected. The setup card opens when the owner is
 * re-selected (consumed exactly once), never for the chat the response
 * happened to land in (FR-INT-002).
 */
const deferredImageExportSetupIds = ref(new Set<string>());

/**
 * Finish a deferred setup request for the re-selected owner. R04-style
 * capture-and-recheck: the decision is made only after a FRESH workspace
 * read of THAT conversation (the switch watcher may still hold the previous
 * chat's summary) and is reverified against the selection after the await,
 * so a second switch can never open the card in a third chat.
 */
async function flushDeferredImageExportSetup(
  conversation: string
): Promise<void> {
  if (conversationId.value !== conversation) return;
  await conversationWorkspace.refresh();
  if (conversationId.value !== conversation) return;
  if (conversationWorkspace.workspace.value?.approvalState === "approved") {
    // Approved since the response landed: the queued export drains through
    // the approval watcher below — no setup card needed.
    return;
  }
  onRequestWorkspaceSetup();
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
      queueDeferredImageNotice(
        conversation,
        t("aiChatV2.imageTool.errors.workspaceRequired") ||
          "An approved workspace is required first."
      );
      // R08: the setup card belongs to the export OWNER. Surface it
      // immediately only when that conversation is selected right now;
      // otherwise defer it until the owner is re-selected (the switch
      // watcher consumes the deferred request below).
      if (conversationId.value === conversation) {
        onRequestWorkspaceSetup();
      } else {
        deferredImageExportSetupIds.value = new Set([
          ...deferredImageExportSetupIds.value,
          conversation,
        ]);
      }
      return;
    }
    queueDeferredImageNotice(
      conversation,
      t("aiChatV2.artifactExport.savedToWorkspace", {
        fileName: result.fileName ?? "",
      }) || `Saved ${result.fileName ?? ""} to your workspace.`
    );
  } catch (err) {
    queueDeferredImageNotice(
      conversation,
      err instanceof Error && err.message
        ? `${t("aiChatV2.artifactExport.saveFailed") || "Could not save to workspace."} (${err.message})`
        : t("aiChatV2.artifactExport.saveFailed") ||
            "Could not save to workspace."
    );
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
 * FR-SUB-007 / FR-PER-004 (audit R04): the approval policy is per
 * conversation. Every load binds to a selection generation observed at
 * start; replies from superseded generations — including A→B→A, where the
 * conversation id matches again, and the mount-time hydration — are
 * ignored (same owner-guard shape as hydrateActiveGoal, extended with a
 * monotonic generation so a same-id stale reply cannot win). A manual user
 * change also starts a new generation so the user's explicit choice
 * outranks an in-flight persisted read.
 */
let toolApprovalModeGeneration = 0;

async function loadApprovalMode(id: string): Promise<void> {
  const generation = ++toolApprovalModeGeneration;
  // Conservative pending state: the previous conversation's policy must
  // never linger (or reach a request) while this conversation's loads.
  toolApprovalMode.value = "ask_for_approval";
  try {
    const saved = await getChatV2ToolApprovalMode(id);
    if (generation !== toolApprovalModeGeneration) return; // superseded load
    if (saved) toolApprovalMode.value = saved;
  } catch {
    // A failed read keeps the conservative default; it is not a policy change.
  }
}

async function onToolApprovalModeChange(next: ChatToolApprovalMode): Promise<void> {
  const conversation = conversationId.value;
  if (!conversation) return;
  // The user's explicit choice outranks any in-flight persisted read.
  toolApprovalModeGeneration += 1;
  try {
    await setChatV2ToolApprovalMode(conversation, next);
  } catch {
    // Preference persists on the next change.
  }
}
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
  if (id !== previous) {
    // R07 (FR-VOI-009): the previous conversation's spoken output must not
    // follow the selection — cancel playback AND invalidate the feed
    // identity so a late terminal projection of the old chat cannot flush
    // text into the newly selected one. Text execution itself continues in
    // the background; only the audio feed is conversation-bound.
    resetSpeechFeed();
    void voice.stopSpeaking();
  }
  if (id && id !== previous) {
    void loadApprovalMode(id);
    // Review C4: /loop's goal precondition must survive selection reloads.
    void hydrateActiveGoal(id);
  }
  if (!id) {
    // FR-PER-004: nothing is selected — the last viewed chat's policy must
    // not linger (an empty-state send would otherwise inherit it) and any
    // in-flight read must not repopulate the deselected surface.
    toolApprovalModeGeneration += 1;
    toolApprovalMode.value = "ask_for_approval";
  }
  // Review C6: control/status responses are per-conversation.
  authoritativeLoopStatus.value = null;
});

// --- Spoken-response feed (deltas from the bounded store projection) --------
let fedMessageId: string | null = null;
let fedLength = 0;

/**
 * R07: forget the tracked speech feed. Called when the feed's owning turn is
 * cancelled (Stop) or its conversation is deselected, so stale deltas or a
 * terminal projection from the OLD conversation can neither resume speech
 * nor be flushed as a completion for the new one.
 */
function resetSpeechFeed(): void {
  fedMessageId = null;
  fedLength = 0;
}

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
    files,
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
    // B11: /goal and /skill preserve attached files through expansion —
    // an accepted command never silently loses its attachment (validated
    // downstream by the shared builder; failures retain the draft).
    await performOrdinarySend(
      disposition.prompt,
      files,
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
    // (FR-CMD-007). R09-1 (one behavior, multiple presentations): staging is
    // NOT acceptance — the composer keeps the command draft while the dialog
    // is open, the stashed acceptance fires exactly once after the loop is
    // durably created, and cancel/failed-create retain the retryable draft.
    pendingScheduledLoop.value = disposition;
    stagedScheduledLoopAccept.value = options?.onAccepted ?? null;
    showScheduledLoopApproval.value = true;
    return;
  }
  if (disposition.kind === "rejected") {
    // FR-CMD-004: draft retained; safe localized error above the composer.
    // B07: only when the selection still owns the command — a stale
    // rejection must not set B's composer error.
    if (
      context?.commandConversationId !== undefined &&
      context.commandConversationId !== null &&
      conversationId.value !== context.commandConversationId
    ) {
      return;
    }
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
  // B10: attachment preparation reuses the shared validated V2 builder
  // (extension classification, MIME inference, size limits, image
  // downscaling) so both surfaces produce equivalent accepted payloads. A
  // preparation/validation failure aborts with the draft retained and a
  // visible explanation — rejected items never disappear silently from an
  // accepted send.
  let uploadedFiles: Awaited<ReturnType<typeof buildUploadedAttachments>> | undefined;
  if (files.length > 0) {
    try {
      uploadedFiles = await buildUploadedAttachments(files);
    } catch (err) {
      commandErrorNotice.value =
        err instanceof Error ? err.message : String(err);
      return false;
    }
  }
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
  // FR-HIS-002/004: drafted history selections submit as OPAQUE archive
  // references with a retry-stable submission identity; the chips clear only
  // on the engine's start acknowledgement (accepted ids only).
  // B14: the submission identity is per-conversation in the store — minted
  // once per logical draft, stable across transport retries, switches and
  // remounts, resolved only by the start ack (never by switching).
  const historySelectionIds =
    historyUiEnabled.value && selectedContextItems.value.length > 0
      ? selectedContextItems.value.map((item) => item.sourceId)
      : undefined;
  const historySubmissionId =
    historySelectionIds && sendConversationId
      ? historySelStore.ensureSubmissionId(sendConversationId)
      : undefined;
  const accepted = await selectedStore.sendMessage(messageText, {
    clientRequestId: options?.clientRequestId,
    // B15: typed queue denials (e.g. full queue) surface localized
    // actionable copy; the draft stays for retry either way.
    localizeError: (raw) => localizeWorkspaceError(raw, (key) => t(key)).text,
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
    submissionId: historySubmissionId,
  });
  // Accepted-send rule (composer contract): the draft (text/files/pasted)
  // clears only when THIS send was accepted — keying on shared run state
  // would clear the draft of a rejected send whenever the previous run's id
  // was still live (queue limit, gate, transport failure).
  if (accepted) {
    // Audit R05: arm the reference clear ONLY on authoritative acceptance,
    // with the EXACT snapshot this submission sent (pre-acceptance arming
    // let an unrelated transition sweep a newer or rejected draft). The
    // confirmed batch rides its own trusted channel — the explicit tray
    // resolves empty for it — so whichever channel carried references is
    // the one cleared. References added after acceptance are outside the
    // snapshot and survive the turn's completion.
    const submittedRefs =
      confirmedBatch && confirmedBatch.length > 0
        ? [...confirmedBatch]
        : generatedImageReferences;
    if (submittedRefs.length > 0) {
      // Identity note (review of audit R05): the entry carries the send's
      // per-conversation accepted-run ordinal — popped only by the matching
      // terminal record, so an unrelated completion (or a resumed mid-run
      // chunk off an idle view) cannot consume another run's snapshot.
      const runOrdinal =
        selectedStore.acceptedRunOrdinalFor(sendConversationId);
      const clearKey = composerDraftKeyFor(sendConversationId);
      pendingDraftClears.set(clearKey, [
        ...(pendingDraftClears.get(clearKey) ?? []),
        { runOrdinal: runOrdinal ?? -1, references: submittedRefs },
      ]);
    }
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
/**
 * R09-1: the composer's acceptance callback captured when a scheduled loop
 * was staged. Staging is NOT acceptance — the callback fires exactly once
 * (onScheduledLoopApprovalConfirm) after the staged loop is DURABLY created;
 * cancel/failed-create retain the draft for retry instead of consuming it.
 */
const stagedScheduledLoopAccept = ref<(() => void) | null>(null);

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
  appendLocalExchange: (userText, assistantText, originConversationId) => {
    // B07: a delayed command outcome for A must never render into B.
    if (
      originConversationId !== undefined &&
      conversationId.value !== originConversationId
    ) {
      return;
    }
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
  setError: (message, originConversationId) => {
    // B07: a stale command must not set B's composer error.
    if (
      originConversationId !== undefined &&
      conversationId.value !== originConversationId
    ) {
      return;
    }
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
    onAccepted,
    files
  ): Promise<boolean> => {
    if (targetConversationId && conversationId.value !== targetConversationId) {
      // Codex High (cross-conversation command): a selection change during
      // registry dispatch aborts the expanded send — never into chat B.
      commandErrorNotice.value =
        t("workspaceChat.command.staleAborted") ||
        "Selection changed — the command was not run.";
      return false;
    }
    // B11: files attached to the command ride through expansion (validated
    // by the shared builder downstream); never silently dropped.
    return performOrdinarySend(
      prompt,
      files ? [...files] : [],
      { pastedContents, onAccepted }
    );
  },
  onClearConversation: async (targetConversationId): Promise<boolean> => {
    // Codex High (cross-conversation /clear): only clear when the command
    // still owns the CURRENT selection — a switch mid-dispatch aborts
    // rather than erasing the newly selected conversation.
    if (!targetConversationId || conversationId.value !== targetConversationId) {
      commandErrorNotice.value =
        t("workspaceChat.command.staleAborted") ||
        "Selection changed — the command was not run.";
      return false;
    }
    try {
      const cleared = await clearChatV2Conversation(targetConversationId);
      if (cleared === null) {
        // R10: the clear was not executed (denied/empty envelope) — retryable
        // feedback instead of a silent no-op that still consumed the draft.
        commandErrorNotice.value =
          t("workspaceChat.command.clearFailed") ||
          "Could not clear this chat. Try again.";
        return false;
      }
      await workspaceStore.bootstrap();
      // R10: the awaits may have spanned a selection switch — a late clear
      // must not reload the OLD conversation into the newly selected
      // surface. The clear itself ran; only the reload is selection-bound.
      if (conversationId.value !== targetConversationId) {
        return true;
      }
      await selectedStore.loadSelection(targetConversationId);
      return true;
    } catch {
      // R10: surfaced as retryable feedback — the draft must be retained.
      commandErrorNotice.value =
        t("workspaceChat.command.clearFailed") ||
        "Could not clear this chat. Try again.";
      return false;
    }
  },
});

/**
 * Confirm tool approval and persist the staged scheduled loop (FR-CMD-007).
 * R09-1: acceptance follows DURABLE creation only — a failed create already
 * surfaced its error through the port and MUST keep the composer draft so
 * the user can retry the /loop command.
 */
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
  // Consume the stashed acceptance BEFORE the durable-create await: a loop
  // re-staged mid-confirm can never inherit this callback (exactly once).
  const accept = stagedScheduledLoopAccept.value;
  stagedScheduledLoopAccept.value = null;
  const created = await commandRouter.confirmScheduledLoop(approval);
  if (!created) {
    // Nothing persisted — the draft is still in the composer.
    return;
  }
  // The staged loop is durable — the composer draft may finally be cleared.
  accept?.();
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
  stagedScheduledLoopAccept.value = null;
  showScheduledLoopApproval.value = false;
}

// Conversation-scoped staging never leaks across selections (FR-CMD-008).
// G01: owned by the shared overlay host (AD-008).
scopedOverlays.registerSelectionBoundOverlay("scheduled-loop-staging", () => {
  commandRouter.resetConversationState();
  pendingScheduledLoop.value = null;
  stagedScheduledLoopAccept.value = null;
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

/**
 * The main-process Token flag is readable at runtime ("a runtime toggle
 * takes effect without restart") — but a single mount-time read races any
 * late writer (E2E state seeding, an operator toggling the store while
 * the app boots). Re-check on every selection change so the drawer
 * surfaces as soon as the flag is on; still fail-closed per read.
 */
function refreshHistoryUiFlag(): void {
  isHistoryUiEnabled()
    .then((enabled) => {
      historyUiEnabled.value = enabled;
    })
    .catch(() => undefined);
}
const showHistoryDrawer = ref(false);
const selectedContextItems = ref<SelectedContextItem[]>([]);
/**
 * B14: per-conversation selection drafts + stable submission identities live
 * in the history-selection pinia store (survives switches AND route
 * remounts). The working copy below always mirrors the selected
 * conversation; syncActiveHistoryDraft persists it back.
 * R06: restoration must also run at SETUP — a route return mounts the
 * center with the conversation already selected, so no id transition is
 * ever observed (the same mount-never-observes-a-transition gap
 * onMounted's composer-focus transfer covers). Owner-safe: the working
 * copy binds to the conversation observed at call time; the read is
 * synchronous against the conversation-keyed store draft, so a stale
 * restoration can never leak across conversations (same owner-guard shape
 * as loadApprovalMode — no in-flight reply can supersede the active id).
 */
const compactionStatus = ref<CompactionStatusSnapshot | null>(null);
let unsubscribeCompactionProgress: (() => void) | null = null;
let unsubscribeStartAck: (() => void) | null = null;
let unsubscribeLiveToolResult: (() => void) | null = null;

function syncActiveHistoryDraft(): void {
  const id = conversationId.value;
  if (id) {
    historySelStore.setItems(id, selectedContextItems.value);
  }
}

/** R06: re-derive the working copy from the selected conversation's draft. */
function restoreActiveHistoryDraft(): void {
  const id = conversationId.value;
  selectedContextItems.value = id ? historySelStore.getItems(id) : [];
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
 * B13: delegates to the bounded navigation helper — sources outside the
 * mounted window load through the history API (200-message cap retained),
 * unavailable sources and mid-retrieval selection changes resolve safely.
 */
async function handleHistoryNavigate(excerpt?: HistoryExcerpt): Promise<void> {
  showHistoryDrawer.value = false;
  if (!excerpt) return;
  // Bind to the conversation Navigate was issued in — a selection change
  // during retrieval aborts rather than scrolling the new chat.
  const targetConversationId = conversationId.value;
  const targetMessageId = excerpt.messageId;
  await navigateToHistorySource(targetMessageId, targetConversationId, {
    getSelectionId: () => conversationId.value,
    hasOlder: () => selectedStore.hasOlder,
    isLoadingOlder: () => selectedStore.loadingOlder,
    loadOlder: () => selectedStore.loadOlder(),
    nextFrame: () => nextTick(),
    queryMessageElement: (messageId) => {
      const el = document.querySelector(
        `[data-message-id="${CSS.escape(messageId)}"]`
      );
      return el instanceof HTMLElement ? el : null;
    },
    scrollToElement: (el) => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const previous = el.style.outline;
      el.style.outline = "2px solid var(--v-primary-base, #1976d2)";
      window.setTimeout(() => {
        el.style.outline = previous;
      }, 1_600);
    },
    showUnavailable: () => {
      commandErrorNotice.value =
        t("workspaceChat.history.navigateUnavailable") ||
        "That message is no longer available in this conversation.";
    },
  });
}

// Conversation switch: image-dialog state never replays into the newly
// selected chat. G01: owned by the shared overlay host (AD-008).
scopedOverlays.registerSelectionBoundOverlay("generated-image-dialogs", () => {
  pendingGeneratedImageSend.value = null;
  ambiguityCandidates.value = [];
  showGeneratedImageChooser.value = false;
  showBatchConfirmDialog.value = false;
});

watch(
  conversationId,
  (next) => {
    // B14 + R06: restore this conversation's chips (and keep its submission
    // identity) from the store — survives switches AND route remounts.
    // Immediate: the mount never observes the id transition, so an
    // already-selected conversation must restore at setup.
    restoreActiveHistoryDraft();
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
    // R08: a late `workspace_required` may have deferred ITS setup request
    // while this conversation was away. Returning here consumes that request
    // exactly once — the flush re-reads THIS chat's workspace freshly before
    // opening the card, so the stale summary read above cannot decide it.
    if (next && deferredImageExportSetupIds.value.has(next)) {
      deferredImageExportSetupIds.value = new Set(
        [...deferredImageExportSetupIds.value].filter((id) => id !== next)
      );
      void flushDeferredImageExportSetup(next);
    }
  },
  { immediate: true }
);

/**
 * FR-HIS-003: the engine start acknowledgement reports which opaque
 * references were accepted, changed, or rejected. Only ACCEPTED chips clear;
 * changed survivors flag for explicit re-confirmation and rejected stay
 * visible so the user is not silently charged for context they did not get.
 */
function onEngineStartAck(chunk: Record<string, unknown>): void {
  const ackConversationId =
    typeof chunk.conversationId === "string" ? chunk.conversationId : null;
  const hasSelectionAcks =
    Array.isArray(chunk.historySelectionAcceptedIds) ||
    Array.isArray(chunk.historySelectionChangedIds) ||
    Array.isArray(chunk.historySelectionRejectedIds);
  // B14: acceptance resolves the stable submission identity for the ACKED
  // conversation (accepted AND mixed acknowledgements) — never by switching.
  if (ackConversationId) {
    historySelStore.resolveSubmission(ackConversationId);
  } else if (conversationId.value) {
    historySelStore.resolveSubmission(conversationId.value);
  }
  if (!hasSelectionAcks) {
    return;
  }
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
  // R13: reconcile the ACKING conversation's STORED chips at application
  // lifetime — a background acknowledgement for A updates A's stored draft
  // even while B is selected, so returning to A restores only the
  // remaining/flagged chips instead of resurfacing consumed selections.
  const storeConversationId = ackConversationId ?? conversationId.value;
  if (storeConversationId) {
    historySelStore.applyAcknowledgement(storeConversationId, {
      accepted,
      changed,
      rejected,
    });
  }
  // The center's LIVE working copy mutates only when the ack owns the
  // current selection, so a background ack for A never clears B's chips.
  if (
    selectedContextItems.value.length === 0 ||
    (ackConversationId !== null && ackConversationId !== conversationId.value)
  ) {
    return;
  }
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
    // B05/G02 repair: the legacy ai-chat-v2:compact-conversation channel
    // had NO main handler and NO preload allowlist entry — the header
    // Compact action silently no-oped. The bounded incremental coordinator
    // path (§13.1) is compaction-start; the center already subscribes to
    // its progress events.
    await startCompaction(conversationId.value);
  } catch {
    // Non-fatal — compaction runs in the main process; progress events
    // broadcast on ai-chat-v2:compaction-progress.
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
  if (selectedStore.isBusy) {
    // B03: deleting under an active/queued/parked run would let the engine
    // or queued follow-ups re-persist content after the wipe (potentially
    // resurrecting the conversation). Main-process IPC denies it; block the
    // click here too (matches onClear's busy guard).
    return;
  }
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
// B08: recoverable continuation intent for the SELECTED conversation. Set
// when a committed decision's follow-up could not be sent (selection
// change, rejected enqueue, reload recovery); cleared on acceptance or
// explicit dismiss. The banner below offers the working retry control the
// receipt card lacks.
const pendingPlanContinuation = ref<PlanContinuationIntent | null>(null);

/**
 * R12: reconcile the visible continuation banner from durable sources.
 * The renderer-saved intent (localStorage) is authoritative when present;
 * otherwise an in-memory MAIN-recovered intent for the CURRENT conversation
 * survives the refresh (e.g. after a failed retry that did not clear it).
 */
function refreshPendingPlanContinuation(): void {
  const id = conversationId.value;
  const persisted = id ? loadPlanContinuationIntent(id) : null;
  if (persisted) {
    pendingPlanContinuation.value = persisted;
    return;
  }
  const current = pendingPlanContinuation.value;
  if (id && current && current.conversationId === id) return;
  pendingPlanContinuation.value = null;
}

/**
 * R12 (FR-PLN-005..008): close the commit-to-response crash gap from the
 * renderer side. With NO renderer-saved intent, ask main to reconcile the
 * persisted decision transitions against their deterministic pending
 * continuation ids — a decision that committed durably in main but whose
 * follow-up was never accepted still recovers here, after reload, restart
 * or any later selection.
 *
 * Fire-and-forget: adoption must never block or break selection.
 */
async function adoptRecoveredPlanContinuation(
  id: string,
  persisted: PlanContinuationIntent | null
): Promise<void> {
  if (persisted) {
    // The renderer wrote its own intent before the crash — that is the most
    // specific recovery record and always wins over main's reconstruction.
    pendingPlanContinuation.value = persisted;
    return;
  }
  let recovered: AIChatPlanContinuationRecoveryView | null = null;
  try {
    recovered = await recoverChatV2PlanContinuationIntent(id);
  } catch {
    // Denied/unavailable main handler — treat as "nothing to recover".
    recovered = null;
  }
  if (conversationId.value !== id) {
    // Selection moved on during the awaited reconcile; never publish into
    // a different chat. The reopened selection runs its own adoption.
    return;
  }
  if (!recovered) {
    // Main says the continuation was already accepted (pending row exists —
    // any status) or nothing can be recovered: stop resurfacing anything.
    pendingPlanContinuation.value = null;
    return;
  }
  const candidate: PlanContinuationIntent = {
    conversationId: recovered.conversationId,
    planId: recovered.planId,
    version: recovered.version,
    action: recovered.action as PlanContinuationAction,
    feedback: recovered.feedback,
    savedAt: recovered.decidedAt,
  };
  if (isPlanContinuationDismissed(candidate)) {
    // The user explicitly dismissed this exact continuation identity —
    // recovering is stateless in main, so only the renderer tombstone can
    // keep a dismissed banner dismissed.
    pendingPlanContinuation.value = null;
    return;
  }
  pendingPlanContinuation.value = candidate;
}

// B08: surface a saved continuation intent whenever its conversation is
// selected (covers reload/crash recovery: the decision committed in main,
// the follow-up never sent, the intent survived in localStorage). Placed
// after the ref declaration — an immediate watcher above would read the ref
// before initialization. R12: when nothing is renderer-saved, main's plan-
// continuation reconcile reconstructs the intent from the persisted
// decision (commit-to-response crash gap).
watch(
  conversationId,
  (id) => {
    const persisted = id ? loadPlanContinuationIntent(id) : null;
    if (!id) {
      pendingPlanContinuation.value = null;
      return;
    }
    void adoptRecoveredPlanContinuation(id, persisted);
  },
  { immediate: true }
);

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
      // plan. The card stays actionable for a retry. B08: null decision
      // saves no intent and starts nothing.
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
    // B08: the decision COMMITTED — persist the recoverable continuation
    // intent BEFORE any further await (reload, hash, send). Whatever happens
    // next (selection change, crash, rejected enqueue), reopening this
    // conversation offers the retry that sends exactly one continuation.
    const intent: PlanContinuationIntent = {
      conversationId: targetConversationId,
      planId: plan.planId,
      version,
      action: action as PlanContinuationAction,
      feedback,
      savedAt: new Date().toISOString(),
    };
    savePlanContinuationIntent(intent);
    if (conversationId.value !== targetConversationId) {
      // Codex P1: the user switched chats mid-decision. The decision itself
      // persisted in its originating conversation and the intent above keeps
      // its continuation recoverable — but the follow-up must NOT fire into
      // the newly selected one, and loadSelection(target) would hijack the
      // selection BACK, so abort before any reload. The retry banner renders
      // the next time that conversation is opened.
      planDecisionError.value =
        t("workspaceChat.plan.continuationAborted") ||
        "Selection changed — the plan decision was saved, but its follow-up message was not sent. Reopen the conversation to continue.";
      return;
    }
    // Still on the deciding conversation: refresh so the
    // receipt/planStateView reflects the persisted decision.
    await selectedStore.loadSelection(targetConversationId);
    // Codex P1 (round 2): the reload AWAITS — a selection change during it
    // must abort here too, or the continuation fires into chat B. The saved
    // intent keeps the continuation recoverable via the retry banner.
    if (conversationId.value !== targetConversationId) {
      planDecisionError.value =
        t("workspaceChat.plan.continuationAborted") ||
        "Selection changed — the plan decision was saved, but its follow-up message was not sent. Reopen the conversation to continue.";
      refreshPendingPlanContinuation();
      return;
    }
    // FR-PLN-006/007: start the correct continuation exactly once. The
    // continuation message keys are shared with Chat V2 (already localized).
    // T2/D6 (AD-007): the continuation's clientRequestId derives from the
    // persisted transition — reloads, replays, and double-clicks resubmit the
    // SAME identity, so the coordinator cache (idle) / pending unique index
    // (busy) collapse them into the one accepted continuation.
    // B09: the hash AWAITS — revalidate the captured target after it and
    // pass the target through every follow-up so a deferred hash can never
    // submit A's approved-plan continuation to B.
    const continuationRequestId = await planContinuationRequestId(
      plan.planId,
      version,
      action as PlanContinuationDecision
    );
    if (conversationId.value !== targetConversationId) {
      planDecisionError.value =
        t("workspaceChat.plan.continuationAborted") ||
        "Selection changed — the plan decision was saved, but its follow-up message was not sent. Reopen the conversation to continue.";
      refreshPendingPlanContinuation();
      return;
    }
    const sendTarget = { targetConversationId };
    const sendOptions = {
      modeOverride: "chat" as const,
      clientRequestId: continuationRequestId,
    };
    let continued = false;
    if (action === "approve-plan") {
      continued = await performOrdinarySend(
        t("aiChatV2Plan.approved_continue_message") ||
          "Plan approved. Please begin executing the plan now.",
        [],
        sendOptions,
        sendTarget
      );
    } else if (action === "reject-plan") {
      const prefix =
        t("aiChatV2Plan.rejected_continue_message") ||
        "Plan rejected. Please revise the plan based on the following feedback and resubmit for approval.";
      continued = await performOrdinarySend(
        feedback ? `${prefix}\n\nFeedback: ${feedback}` : prefix,
        [],
        sendOptions,
        sendTarget
      );
    } else {
      const prefix =
        t("aiChatV2Plan.changes_requested_continue_message") ||
        "Plan changes requested. Please update the plan based on the following feedback and resubmit for approval.";
      continued = await performOrdinarySend(
        feedback ? `${prefix}\n\nFeedback: ${feedback}` : prefix,
        [],
        sendOptions,
        sendTarget
      );
    }
    // B08: acceptance clears the intent (exactly one continuation exists);
    // rejection (queue-full/transport) or a mid-send selection change keeps
    // it and surfaces the retry banner — the decision is never lost without
    // a working retry control. performOrdinarySend's own target guard
    // returns false after a switch, so `continued` is authoritative here
    // (the old code ignored it).
    if (continued && conversationId.value === targetConversationId) {
      clearPlanContinuationIntent(targetConversationId);
      // R12: the continuation was accepted — a stale dismissal tombstone
      // must not suppress a future decision for this conversation.
      clearPlanContinuationDismissal(targetConversationId);
      pendingPlanContinuation.value = null;
    } else {
      refreshPendingPlanContinuation();
      if (!planDecisionError.value) {
        planDecisionError.value =
          t("workspaceChat.plan.continuationPending") ||
          "The plan decision was saved, but its follow-up message was not sent. Use Continue to retry.";
      }
    }
  } catch (err) {
    // FR-PLN-005: persistence/transport failure keeps the card actionable.
    // B08: a committed decision's intent was already saved above, so the
    // retry banner (refreshed here) still offers recovery.
    planDecisionError.value =
      err instanceof Error ? err.message : String(err);
    refreshPendingPlanContinuation();
  } finally {
    planDecisionInFlight.value = false;
  }
}

/**
 * B08: retry a saved continuation with its ORIGINAL decision identity.
 * The deterministic request id makes this idempotent — a replayed retry
 * collapses into the one accepted continuation (exactly one row/execution).
 */
async function onRetryPlanContinuation(): Promise<void> {
  const intent = pendingPlanContinuation.value;
  if (!intent || planDecisionInFlight.value) return;
  if (
    !conversationId.value ||
    conversationId.value !== intent.conversationId
  ) {
    return;
  }
  planDecisionInFlight.value = true;
  planDecisionError.value = null;
  try {
    const continuationRequestId = await planContinuationRequestId(
      intent.planId,
      intent.version,
      intent.action as PlanContinuationDecision
    );
    if (conversationId.value !== intent.conversationId) return;
    const prefixByAction: Record<PlanContinuationAction, string> = {
      "approve-plan":
        t("aiChatV2Plan.approved_continue_message") ||
        "Plan approved. Please begin executing the plan now.",
      "reject-plan":
        t("aiChatV2Plan.rejected_continue_message") ||
        "Plan rejected. Please revise the plan based on the following feedback and resubmit for approval.",
      "request-plan-changes":
        t("aiChatV2Plan.changes_requested_continue_message") ||
        "Plan changes requested. Please update the plan based on the following feedback and resubmit for approval.",
    };
    const base = prefixByAction[intent.action];
    const text =
      intent.action === "approve-plan" || !intent.feedback
        ? base
        : `${base}\n\nFeedback: ${intent.feedback}`;
    const continued = await performOrdinarySend(
      text,
      [],
      { modeOverride: "chat", clientRequestId: continuationRequestId },
      { targetConversationId: intent.conversationId }
    );
    if (continued && conversationId.value === intent.conversationId) {
      clearPlanContinuationIntent(intent.conversationId);
      // R12: an accepted continuation is durably settled in main (pending
      // row). Forget any dismissal tombstone for the conversation — a
      // future NEW decision must resurface without a stale suppression.
      clearPlanContinuationDismissal(intent.conversationId);
      pendingPlanContinuation.value = null;
    } else {
      refreshPendingPlanContinuation();
    }
  } catch (err) {
    planDecisionError.value =
      err instanceof Error ? err.message : String(err);
  } finally {
    planDecisionInFlight.value = false;
  }
}

function onDismissPlanContinuation(): void {
  const intent = pendingPlanContinuation.value;
  if (intent) {
    // Renderer-saved intents are removeable from disk; main-recovered ones
    // are merely held in memory (recovery re-derives them from the
    // persisted decision). Clear both that and — for an exact identity —
    // tombstone the dismissal so the banner does not resurrect on
    // reselection (R12).
    clearPlanContinuationIntent(intent.conversationId);
    markPlanContinuationDismissed({
      conversationId: intent.conversationId,
      planId: intent.planId,
      version: intent.version,
      action: intent.action,
    });
  }
  pendingPlanContinuation.value = null;
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
  refreshHistoryUiFlag();
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
