<template>
  <div class="ai-chat-box">
    <!-- Chat Header -->
    <div class="chat-header">
      <div class="header-left">
        <v-icon class="mr-2">mdi-robot</v-icon>
        <span class="header-title">{{ t('knowledge.ai_assistant') }}</span>
      </div>
      <div class="header-actions">
        <v-btn
          icon
          size="small"
          variant="text"
          @click="useRAGContext = !useRAGContext"
          :color="useRAGContext ? 'primary' : ''"
          :title="useRAGContext ? t('knowledge.rag_context_enabled') : t('knowledge.rag_context_disabled')"
        >
          <v-icon size="small">mdi-book-search</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="showConversationsDialog = true"
          title="Show conversation history"
        >
          <v-icon size="small">mdi-history</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="showMCPToolManager = true"
          title="Manage MCP Tools"
        >
          <v-icon size="small">mdi-toolbox</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="handleNewConversation"
          title="Start new conversation"
        >
          <v-icon size="small">mdi-plus-circle</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="handleRefreshHistory"
          :disabled="isLoadingHistory"
          :loading="isLoadingHistory"
          title="Refresh chat history"
        >
          <v-icon size="small">mdi-refresh</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="handleClearChat"
          :disabled="messages.length === 0"
        >
          <v-icon size="small">mdi-delete-outline</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="$emit('close')"
        >
          <v-icon size="small">mdi-close</v-icon>
        </v-btn>
      </div>
    </div>

    <!-- Chat Messages -->
    <div class="chat-messages" ref="messagesContainer">
      <div v-if="messages.length === 0" class="empty-state">
        <v-icon size="64" color="grey-lighten-2">mdi-chat-outline</v-icon>
        <p class="text-grey mt-4">{{ t('knowledge.start_conversation') }}</p>
      </div>

        <div
          v-for="message in visibleMessages"
          :key="message.id"
          class="message-wrapper"
          :class="[message.role, message.messageType || MESSAGE_TYPE.MESSAGE]"
        >
          <div class="message-content">
            <div class="message-avatar">
              <v-icon v-if="message.role === 'user'" color="primary">mdi-account</v-icon>
              <v-icon v-else-if="message.messageType === MESSAGE_TYPE.TOOL_CALL" color="purple">mdi-toolbox</v-icon>
              <v-icon v-else-if="message.messageType === MESSAGE_TYPE.TOOL_RESULT" color="success">mdi-check-circle</v-icon>
              <v-icon v-else-if="message.messageType === MESSAGE_TYPE.PLAN_CREATED" color="indigo">mdi-clipboard-list</v-icon>
              <v-icon v-else-if="message.messageType === MESSAGE_TYPE.PLAN_STEP_COMPLETE" color="indigo">mdi-check-decagram</v-icon>
              <v-icon v-else-if="message.messageType === MESSAGE_TYPE.PLAN_EXECUTE_PAUSE" color="warning">mdi-pause-circle</v-icon>
              <v-icon v-else-if="message.messageType === MESSAGE_TYPE.PLAN_EXECUTE_RESUME" color="success">mdi-play-circle</v-icon>
              <v-icon v-else color="purple">mdi-robot</v-icon>
            </div>
            <div
class="message-bubble" :class="{
            'assistant-message': message.role === 'assistant' && message.messageType === MESSAGE_TYPE.MESSAGE,
            'tool-call-message': message.messageType === MESSAGE_TYPE.TOOL_CALL,
            'tool-result-message': message.messageType === MESSAGE_TYPE.TOOL_RESULT,
            'plan-created-message': message.messageType === MESSAGE_TYPE.PLAN_CREATED,
            'plan-step-message': message.messageType === MESSAGE_TYPE.PLAN_STEP_COMPLETE,
            'plan-pause-message': message.messageType === MESSAGE_TYPE.PLAN_EXECUTE_PAUSE,
            'plan-resume-message': message.messageType === MESSAGE_TYPE.PLAN_EXECUTE_RESUME
          }">
            <!-- Tool Call Message -->
            <template v-if="message.messageType === MESSAGE_TYPE.TOOL_CALL">
              <div class="tool-call-header">
                <v-icon size="small" color="purple" class="mr-1">mdi-toolbox</v-icon>
                <span><strong>Tool Call</strong></span>
                <v-progress-circular
                  v-if="isToolCallPending(message.metadata?.toolId as string | undefined)"
                  indeterminate
                  size="16"
                  width="2"
                  color="purple"
                  class="ml-2 tool-loading-spinner"
                />
                <v-icon
                  v-else
                  size="small"
                  color="success"
                  class="ml-1"
                >mdi-check-circle</v-icon>
              </div>
              <div class="tool-call-content">
                <div v-if="message.metadata?.toolName" class="tool-name">
                  <strong>Tool:</strong> {{ message.metadata.toolName }}
                </div>
                <div v-if="message.metadata?.toolId" class="tool-id">
                  <strong>ID:</strong> {{ message.metadata.toolId }}
                </div>
                <details v-if="message.metadata?.toolParams" class="tool-params-details">
                  <summary>Parameters</summary>
                  <pre>{{ JSON.stringify(message.metadata.toolParams, null, 2) }}</pre>
                </details>
                <details v-if="message.content" class="tool-content-details">
                  <summary>Raw Content</summary>
                  <pre>{{ message.content }}</pre>
                </details>
              </div>
              <div class="message-timestamp" :title="formatFullTimestamp(message.timestamp)">
                <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                {{ formatTimestamp(message.timestamp) }}
              </div>
            </template>

            <!-- Tool Result Message -->
            <template v-else-if="message.messageType === MESSAGE_TYPE.TOOL_RESULT">
              <!-- Skill Permission Approval Card -->
              <SkillApprovalCard
                v-if="(message.metadata?.toolResult as Record<string, unknown>)?.needsPermissionPrompt"
                :tool-name="String(message.metadata?.toolName || '')"
                :permission-category="String((message.metadata?.toolResult as Record<string, unknown>)?.permissionCategory || '')"
                :shell-preview="((message.metadata?.toolResult as Record<string, unknown>)?.shellPreview ?? undefined) as any"
                @grant="(payload) => handleSkillPermissionGrant(message, payload.persistent)"
                @deny="handleSkillPermissionDeny(message)"
              />
              <template v-else>
              <div class="tool-result-header">
                <v-icon size="small" :color="message.metadata?.success === false ? 'error' : 'success'" class="mr-1">
                  {{ message.metadata?.success === false ? 'mdi-alert-circle' : 'mdi-check-circle' }}
                </v-icon>
                <span><strong>Tool Result</strong></span>
                <v-chip v-if="message.metadata?.executionTimeMs" size="x-small" variant="outlined" class="ml-2">
                  {{ Math.round((message.metadata.executionTimeMs as number) / 1000) }}s
                </v-chip>
              </div>
              <div class="tool-result-content">
                <div v-if="message.metadata?.toolName" class="tool-name">
                  <strong>Tool:</strong> {{ message.metadata.toolName }}
                </div>
                <div v-if="message.metadata?.success === false && message.metadata?.error" class="tool-error">
                  <strong>Error:</strong> {{ message.metadata.error }}
                </div>
                <!-- Show formatted summary for search results -->
                <div v-if="message.metadata?.summary" class="tool-summary">
                  <div class="summary-header">
                    <v-icon size="small" class="mr-1">mdi-format-list-bulleted</v-icon>
                    <strong>Search Results Summary</strong>
                  </div>
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <div class="summary-content" v-html="formatMessage(message.metadata.summary as string)"></div>
                </div>
                <details class="tool-result-details">
                  <summary>{{ message.metadata?.summary ? 'View Full JSON Data' : 'View Result' }}</summary>
                  <pre>{{ message.content }}</pre>
                </details>
              </div>
              <div class="message-timestamp" :title="formatFullTimestamp(message.timestamp)">
                <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                {{ formatTimestamp(message.timestamp) }}
              </div>
              </template>
            </template>

            <!-- Plan Created Message -->
            <template v-else-if="message.messageType === MESSAGE_TYPE.PLAN_CREATED">
              <div class="plan-message-header">
                <v-icon size="small" color="indigo" class="mr-1">mdi-clipboard-list</v-icon>
                <span><strong>Plan Created</strong></span>
              </div>
              <div class="plan-message-content">
                <div class="plan-title">
                  <strong>{{ (message.metadata?.plan as Plan)?.title || 'Execution Plan' }}</strong>
                </div>
                <div v-if="(message.metadata?.plan as Plan)?.description" class="plan-reasoning-section">
                  <div class="plan-reasoning-label">
                    <v-icon size="x-small" class="mr-1">mdi-lightbulb-on</v-icon>
                    <strong>Reasoning:</strong>
                  </div>
                  <div class="plan-reasoning-text">
                    {{ (message.metadata?.plan as Plan)?.description }}
                  </div>
                </div>
                <div class="plan-steps-summary">
                  <v-icon size="x-small" class="mr-1">mdi-format-list-numbered</v-icon>
                  {{ (message.metadata?.plan as Plan)?.steps?.length || 0 }} steps planned
                </div>
                <details class="plan-steps-details">
                  <summary>View Steps</summary>
                  <div class="steps-list">
                    <div 
                      v-for="(step, index) in (message.metadata?.plan as Plan)?.steps || []" 
                      :key="step.stepId" 
                      class="step-item"
                    >
                      <span class="step-number">{{ index + 1 }}.</span>
                      <span class="step-title">{{ step.title }}</span>
                    </div>
                  </div>
                </details>
              </div>
              <div class="message-timestamp" :title="formatFullTimestamp(message.timestamp)">
                <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                {{ formatTimestamp(message.timestamp) }}
              </div>
            </template>

            <!-- Plan Step Complete Message -->
            <template v-else-if="message.messageType === MESSAGE_TYPE.PLAN_STEP_COMPLETE">
              <div class="plan-step-header">
                <v-icon 
                  size="small" 
                  :color="(message.metadata?.planStep as PlanStep)?.status === 'completed' ? 'success' : 'error'" 
                  class="mr-1"
                >
                  {{ (message.metadata?.planStep as PlanStep)?.status === 'completed' ? 'mdi-check-decagram' : 'mdi-alert-decagram' }}
                </v-icon>
                <span>
                  <strong>Step {{ (message.metadata?.planStep as PlanStep)?.stepNumber || '' }} {{ (message.metadata?.planStep as PlanStep)?.status === 'completed' ? 'Completed' : 'Failed' }}</strong>
                </span>
              </div>
              <div class="plan-step-content">
                <div class="step-title-display">
                  {{ (message.metadata?.planStep as PlanStep)?.title }}
                </div>
                <div v-if="(message.metadata?.planStep as PlanStep)?.result" class="step-result-display">
                  <v-icon size="x-small" color="success" class="mr-1">mdi-check</v-icon>
                  {{ (message.metadata?.planStep as PlanStep)?.result }}
                </div>
                <div v-if="(message.metadata?.planStep as PlanStep)?.error" class="step-error-display">
                  <v-icon size="x-small" color="error" class="mr-1">mdi-alert</v-icon>
                  {{ (message.metadata?.planStep as PlanStep)?.error }}
                </div>
              </div>
              <div class="message-timestamp" :title="formatFullTimestamp(message.timestamp)">
                <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                {{ formatTimestamp(message.timestamp) }}
              </div>
            </template>

            <!-- Plan Execute Pause Message -->
            <!-- <template v-else-if="message.messageType === MESSAGE_TYPE.PLAN_EXECUTE_PAUSE">
              <div class="plan-pause-header">
                <v-icon size="small" color="warning" class="mr-1">mdi-pause-circle</v-icon>
                <span><strong>Plan Paused</strong></span>
              </div>
              <div class="plan-pause-content">
                {{ message.content || 'Plan execution has been paused' }}
              </div>
              <div class="message-timestamp" :title="formatFullTimestamp(message.timestamp)">
                <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                {{ formatTimestamp(message.timestamp) }}
              </div>
            </template> -->

            <!-- Plan Execute Resume Message -->
            <template v-else-if="message.messageType === MESSAGE_TYPE.PLAN_EXECUTE_RESUME">
              <div class="plan-resume-header">
                <v-icon size="small" color="success" class="mr-1">mdi-play-circle</v-icon>
                <span><strong>Plan Resumed</strong></span>
              </div>
              <div class="plan-resume-content">
                {{ message.content || 'Plan execution has resumed' }}
              </div>
              <div class="message-timestamp" :title="formatFullTimestamp(message.timestamp)">
                <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                {{ formatTimestamp(message.timestamp) }}
              </div>
            </template>

            <!-- Regular Message -->
            <template v-else>
              <div 
                class="message-header" 
                v-if="message.role === 'assistant' && message.content && message.content.trim()"
                :class="{ 'copied': copiedMessageId === message.id }"
              >
                <v-btn
                  icon
                  size="x-small"
                  variant="text"
                  class="copy-button"
                  @click="handleCopyMessage(message.content, message.id)"
                  :title="copiedMessageId === message.id ? 'Copied!' : 'Copy message'"
                >
                  <v-icon size="small">{{ copiedMessageId === message.id ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
                </v-btn>
              </div>
              <div
                class="message-header"
                v-else-if="canResendMessage(message)"
              >
                <v-btn
                  icon
                  size="x-small"
                  variant="text"
                  class="copy-button"
                  :disabled="isLoading"
                  :loading="isResendingMessage && resendingMessageId === message.id"
                  @click="handleResendMessage(message)"
                  :title="t('knowledge.resend_message') || 'Resend message'"
                >
                  <v-icon v-if="!isResendingMessage || resendingMessageId !== message.id" size="small">mdi-refresh</v-icon>
                </v-btn>
              </div>
              <div
                v-if="message.role === 'user' && (message.metadata?.attachments as any[])?.length"
                class="attachment-preview"
              >
                <div class="attachment-preview-header">
                  <v-icon size="x-small" class="mr-1">mdi-file-document</v-icon>
                  <strong>{{ t('knowledge.documents') }}</strong>
                </div>
                <div class="attachment-preview-files">
                  <div
                    v-for="(att, idx) in (message.metadata?.attachments as any[])"
                    :key="`${att.fileName}-${idx}`"
                    class="attachment-preview-file"
                  >
                    {{ att.fileName }}
                  </div>
                </div>
              </div>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div class="message-text" v-html="formatMessage(message.content)"></div>
              <div class="message-timestamp" :title="formatFullTimestamp(message.timestamp)">
                <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                {{ formatTimestamp(message.timestamp) }}
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Tool Execution Indicator -->
      <div v-if="isExecutingTool" class="message-wrapper assistant">
        <div class="message-content">
          <div class="message-avatar">
            <v-icon color="purple">mdi-robot</v-icon>
          </div>
          <div class="message-bubble tool-execution">
            <div class="tool-indicator">
              <v-progress-circular
                indeterminate
                size="20"
                width="2"
                color="purple"
                class="mr-2"
              ></v-progress-circular>
              <span class="tool-text">
                <strong>Executing tool:</strong> {{ currentToolName }}
              </span>
            </div>
            <div v-if="Object.keys(currentToolParams).length > 0" class="tool-params">
              <details>
                <summary>Tool Parameters</summary>
                <pre>{{ JSON.stringify(currentToolParams, null, 2) }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>

      <!-- Plan Execution Display -->
      <div v-if="currentPlan && isPlanExecuting" class="message-wrapper assistant plan-execution">
        <div class="message-content">
          <div class="message-avatar">
            <v-icon color="indigo">mdi-clipboard-list</v-icon>
          </div>
          <div class="message-bubble plan-bubble">
            <div class="plan-header">
              <v-icon size="small" color="indigo" class="mr-1">mdi-clipboard-list</v-icon>
              <span><strong>{{ currentPlan.title }}</strong></span>
              <v-chip 
                v-if="currentPlan.status !== 'paused'"
                size="x-small" 
                color="primary" 
                variant="outlined" 
                class="ml-2"
              >
                {{ currentPlan.status }}
              </v-chip>
            </div>
            <div v-if="currentPlan.description" class="plan-reasoning-section">
              <div class="plan-reasoning-label">
                <v-icon size="x-small" class="mr-1">mdi-lightbulb-on</v-icon>
                <strong>Reasoning:</strong>
              </div>
              <div class="plan-reasoning-text">
                {{ currentPlan.description }}
              </div>
            </div>
            <div class="plan-steps">
              <div 
                v-for="step in currentPlan.steps" 
                :key="step.stepId" 
                class="plan-step"
                :class="{ 
                  'step-active': step.status === 'in_progress',
                  'step-completed': step.status === 'completed',
                  'step-failed': step.status === 'failed'
                }"
              >
                <div class="step-indicator">
                  <v-icon 
                    size="small" 
                    :color="getStepStatusColor(step.status)"
                    :class="{ 'mdi-spin': step.status === 'in_progress' }"
                  >
                    {{ getStepStatusIcon(step.status) }}
                  </v-icon>
                </div>
                <div class="step-content">
                  <div class="step-title">
                    <strong>Step {{ step.stepNumber }}:</strong> {{ step.title }}
                  </div>
                  <div v-if="step.description" class="step-description">
                    {{ step.description }}
                  </div>
                  <div v-if="step.result && step.status === 'completed'" class="step-result">
                    <v-icon size="x-small" color="success" class="mr-1">mdi-check</v-icon>
                    {{ step.result }}
                  </div>
                  <div v-if="step.error && step.status === 'failed'" class="step-error">
                    <v-icon size="x-small" color="error" class="mr-1">mdi-alert</v-icon>
                    {{ step.error }}
                  </div>
                </div>
              </div>
            </div>
            <div class="plan-progress">
              <v-progress-linear
                :model-value="planProgress"
                color="indigo"
                height="6"
                rounded
              ></v-progress-linear>
              <div class="progress-text">
                {{ completedStepsCount }} / {{ totalStepsCount }} steps completed
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Typing Indicator -->
      <div v-if="isTyping && !isExecutingTool" class="message-wrapper assistant">
        <div class="message-content">
          <div class="message-avatar">
            <v-icon color="purple">mdi-robot</v-icon>
          </div>
          <div class="message-bubble">
            <div class="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Error Display -->
      <div v-if="streamError" class="message-wrapper assistant error-message">
        <div class="message-content">
          <div class="message-avatar">
            <v-icon color="error">mdi-alert-circle</v-icon>
          </div>
          <div class="message-bubble error-bubble">
            <div class="error-header">
              <v-icon size="small" color="error" class="mr-1">mdi-alert</v-icon>
              <strong>Error</strong>
            </div>
            <div class="error-text">{{ streamError }}</div>
            <v-btn
              size="small"
              variant="text"
              color="primary"
              class="mt-2"
              @click="streamError = null"
            >
              Dismiss
            </v-btn>
          </div>
        </div>
      </div>
    </div>

    <!-- Scroll to Bottom Button -->
    <v-btn
      v-if="showScrollButton"
      class="scroll-to-bottom"
      icon
      size="small"
      color="primary"
      @click="scrollToBottom"
    >
      <v-icon>mdi-chevron-down</v-icon>
    </v-btn>

    <!-- File Operations Summary Panel -->
    <div v-if="currentFileOps.length > 0" class="file-ops-panel">
      <div class="file-ops-header" @click="showFileOpsPanel = !showFileOpsPanel">
        <v-icon size="small" class="mr-1" color="primary">mdi-file-document-edit-outline</v-icon>
        <span class="file-ops-summary">
          {{ currentFileOps.length }} {{ currentFileOps.length === 1 ? 'file change' : 'file changes' }}
        </span>
        <span class="file-ops-counts">
          <v-chip v-if="currentFileOps.filter(r => r.type === 'create').length" size="x-small" variant="tonal" color="success" class="ml-1">
            +{{ currentFileOps.filter(r => r.type === 'create').length }}
          </v-chip>
          <v-chip v-if="currentFileOps.filter(r => r.type === 'edit').length" size="x-small" variant="tonal" color="info" class="ml-1">
            ~{{ currentFileOps.filter(r => r.type === 'edit').length }}
          </v-chip>
          <v-chip v-if="currentFileOps.filter(r => r.type === 'overwrite').length" size="x-small" variant="tonal" color="warning" class="ml-1">
            ~{{ currentFileOps.filter(r => r.type === 'overwrite').length }}
          </v-chip>
        </span>
        <v-spacer />
        <v-icon size="small">{{ showFileOpsPanel ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
      </div>
      <div v-if="showFileOpsPanel" class="file-ops-body">
        <FileOperationBadge :records="currentFileOps" />
      </div>
    </div>

    <!-- Message Queue Panel -->
    <div v-if="messageQueue.length > 0" class="message-queue-panel">
      <div class="queue-panel-header">
        <v-icon size="small" class="mr-1" color="primary">mdi-message-text-clock</v-icon>
        <span class="queue-panel-title">
          {{ t('knowledge.queue_title') || 'Queued messages' }}
          <v-chip size="x-small" variant="tonal" color="primary" class="ml-1">
            {{ messageQueue.length }}
          </v-chip>
        </span>
        <v-spacer />
        <v-btn
          icon
          size="x-small"
          variant="text"
          color="error"
          @click="handleClearQueue()"
          :title="t('knowledge.queue_clear_all') || 'Clear all'"
        >
          <v-icon size="small">mdi-delete-sweep</v-icon>
        </v-btn>
      </div>
      <div class="queue-panel-hint">
        {{ t('knowledge.queue_auto_dispatch') || 'Messages will be sent automatically after the current response completes.' }}
      </div>
      <div class="queue-panel-items">
        <div
          v-for="(item, idx) in messageQueue"
          :key="item.id"
          class="queue-item"
        >
          <span class="queue-item-index">{{ idx + 1 }}.</span>
          <span class="queue-item-preview">{{ truncateMessage(item.content, 60) }}</span>
          <span v-if="item.uploadedFiles.length > 0" class="queue-item-attachment">
            <v-icon size="x-small">mdi-paperclip</v-icon>
            {{ item.uploadedFiles.length }}
          </span>
          <v-btn
            icon
            size="x-small"
            variant="text"
            density="compact"
            @click="removeQueuedMessage(item.id)"
            :title="t('knowledge.queue_remove') || 'Remove'"
          >
            <v-icon size="x-small">mdi-close</v-icon>
          </v-btn>
        </div>
      </div>
    </div>

    <!-- Chat Input -->
    <div class="chat-input">
      <v-textarea
        ref="inputField"
        v-model="inputMessage"
        :placeholder="isLoading ? t('knowledge.type_message_placeholder') : t('knowledge.type_message_placeholder')"
        rows="1"
        auto-grow
        max-rows="4"
        variant="outlined"
        density="compact"
        hide-details
        @keydown.enter="handleEnterKey"
        @keydown.shift.enter.prevent="inputMessage += '\n'"
        @keydown.down="handleSlashArrowDown"
        @keydown.up="handleSlashArrowUp"
        @keydown.esc="handleSlashEscape"
        @keydown.tab="handleSlashTab"
      >
        <template v-slot:append-inner>
          <v-btn
            icon
            size="small"
            variant="text"
            color="primary"
            :disabled="isUploadingFiles || selectedUploadFiles.length >= MAX_UPLOAD_FILES"
            :loading="isUploadingFiles"
            @click="triggerFilePicker"
            :title="t('knowledge.select_files')"
          >
            <v-icon size="small">mdi-paperclip</v-icon>
          </v-btn>
          <v-btn
            v-if="isLoading"
            icon
            size="small"
            color="error"
            @click="handleStopStream()"
            :title="t('knowledge.stop_generating') || 'Stop generating'"
          >
            <v-icon>mdi-stop</v-icon>
          </v-btn>
          <v-btn
            icon
            size="small"
            color="primary"
            :disabled="(!inputMessage.trim() && selectedUploadFiles.length === 0) || isUploadingFiles"
            @click="handleSendMessage()"
            :title="isLoading ? (t('knowledge.queue_send') || 'Queue message') : (t('knowledge.send_message') || 'Send')"
          >
            <v-icon>mdi-send</v-icon>
          </v-btn>
        </template>
      </v-textarea>

      <div
        v-if="showSlashMenu"
        class="slash-command-menu"
      >
        <div v-if="filteredSlashCommands.length > 0">
          <div
            v-for="(cmd, index) in filteredSlashCommands"
            :key="cmd.name"
            class="slash-command-item"
            :class="{ 'is-selected': index === selectedSlashIndex }"
            @mousedown.prevent="inputMessage = cmd.usage; showSlashMenu = false"
          >
            <div class="slash-command-name">{{ cmd.name }}</div>
            <div class="slash-command-description">{{ cmd.description }}</div>
          </div>
        </div>
        <div v-else class="slash-command-empty">No commands found</div>
      </div>

      <input
        ref="fileInputRef"
        type="file"
        multiple
        hidden
        :accept="fileAccept"
        @change="handleFileSelection"
      />
    </div>

    <div
      v-if="selectedUploadFiles.length > 0"
      class="attached-files-preview"
    >
      <div class="attached-files-header">
        <v-icon size="x-small" class="mr-1">mdi-paperclip</v-icon>
        <strong>{{ t('knowledge.documents') }}</strong>
      </div>
      <div class="attached-files-list">
        <div
          v-for="(f, index) in selectedUploadFiles"
          :key="`${f.name}-${index}`"
          class="attached-file-item"
        >
          <span class="attached-file-name">{{ f.name }}</span>
          <span class="attached-file-size">({formatBytes(f.size)})</span>
          <v-btn
            icon
            size="x-small"
            variant="text"
            color="primary"
            :disabled="isLoading || isUploadingFiles"
            @click="removeSelectedFile(index)"
            :title="t('common.comfirm_delete') || 'Remove'"
          >
            <v-icon size="x-small">mdi-close</v-icon>
          </v-btn>
        </div>
      </div>
    </div>

    <!-- MCP Tool Manager Dialog -->
    <MCPToolManager v-model="showMCPToolManager" />

    <!-- Conversations Dialog -->
    <v-dialog v-model="showConversationsDialog" max-width="600" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between">
          <span>Conversation History</span>
          <v-btn
            icon
            size="small"
            variant="text"
            @click="showConversationsDialog = false"
          >
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text style="padding: 0;">
          <div v-if="isLoadingConversations" class="pa-4 text-center">
            <v-progress-circular indeterminate color="primary"></v-progress-circular>
            <p class="mt-2">Loading conversations...</p>
          </div>
          <div v-else-if="conversations.length === 0" class="pa-4 text-center">
            <v-icon size="48" color="grey-lighten-2">mdi-chat-outline</v-icon>
            <p class="mt-4 text-grey">No conversations found</p>
          </div>
          <v-list v-else density="comfortable">
            <v-list-item
              v-for="conv in conversations"
              :key="conv.conversationId"
              :class="{ 'bg-primary-lighten-5': conv.conversationId === conversationId }"
              @click="handleSelectConversation(conv.conversationId)"
              class="conversation-item"
            >
              <template v-slot:prepend>
                <v-icon color="primary">mdi-chat</v-icon>
              </template>
              <v-list-item-title class="conversation-title">
                {{ truncateMessage(conv.lastMessage, 60) || 'New conversation' }}
              </v-list-item-title>
              <v-list-item-subtitle>
                <div class="d-flex align-center mt-1">
                  <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
                  <span>{{ formatTimestamp(conv.lastMessageTimestamp) }}</span>
                  <v-spacer></v-spacer>
                  <v-chip size="x-small" variant="outlined" color="primary">
                    {{ conv.messageCount }} {{ conv.messageCount === 1 ? 'message' : 'messages' }}
                  </v-chip>
                </div>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-divider></v-divider>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            variant="text"
            color="primary"
            @click="showConversationsDialog = false"
          >
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { streamChatMessage, stopStreamingChat, getChatHistory, clearChatHistory, getConversations, ConversationMetadata, subscribeToFileOperations, unsubscribeFromFileOperations } from '@/views/api/aiChat';
import { ChatMessage, ChatStreamChunk, Plan, PlanStep, PlanStepStatus, MessageType, UploadedFilePayload, LLMImageAttachmentPayload, CommonMessage } from '@/entityTypes/commonType';
import { AI_CHAT_RESUME_TOOL_AFTER_PERMISSION } from '@/config/channellist';
import MCPToolManager from './MCPToolManager.vue';
import SkillApprovalCard from './SkillApprovalCard.vue';
import FileOperationBadge from './FileOperationBadge.vue';
import type { FileOperationRecord } from '@/entityTypes/fileOperationTypes';

// Stream state enum for type safety
// This ensures type safety for stream state management
enum StreamState {
  INACTIVE = 'inactive',
  PENDING = 'pending',
  ACTIVE = 'active',
  ERROR = 'error'
}

// Message type constants for template use
const MESSAGE_TYPE = {
    MESSAGE: MessageType.MESSAGE,
    TOOL_CALL: MessageType.TOOL_CALL,
    TOOL_RESULT: MessageType.TOOL_RESULT,
    PLAN_CREATED: MessageType.PLAN_CREATED,
    PLAN_STEP_START: MessageType.PLAN_STEP_START,
    PLAN_STEP_COMPLETE: MessageType.PLAN_STEP_COMPLETE,
    PLAN_EXECUTE_PAUSE: MessageType.PLAN_EXECUTE_PAUSE,
    PLAN_EXECUTE_RESUME: MessageType.PLAN_EXECUTE_RESUME
} as const;

// Queued message for the FIFO message queue
interface QueuedChatMessage {
  id: string;
  content: string;
  uploadedFiles: UploadedFilePayload[];
  attachments: LLMImageAttachmentPayload[];
  enqueuedAt: number;
}

type SlashCommandDefinition = {
  name: '/skills';
  description: string;
  usage: string;
  examples: readonly string[];
};

const AI_CHAT_SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  {
    name: '/skills',
    description: 'List currently available AI skills/tools in this system.',
    usage: '/skills',
    examples: ['/skills'],
  },
] as const;

// i18n setup
const { t } = useI18n();

// Props
interface Props {
  visible?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false
});

// Emits
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const emit = defineEmits<{
  close: [];
}>();

// Reactive state
const messages = ref<ChatMessage[]>([]);
const inputMessage = ref('');
const isLoading = ref(false);
const isUploadingFiles = ref(false);
const isLoadingHistory = ref(false);
const isTyping = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const showScrollButton = ref(false);
const conversationId = ref<string | undefined>(undefined);
const inputField = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedUploadFiles = ref<File[]>([]);
const useRAGContext = ref(false);
const isExecutingTool = ref(false);
const currentToolName = ref('');
const currentToolParams = ref<Record<string, unknown>>({});

// Track which tool calls are still pending (no result received yet)
const pendingToolIds = computed<Set<string>>(() => {
  const resultToolIds = new Set<string>();
  const callToolIds = new Set<string>();
  for (const msg of messages.value) {
    if (msg.messageType === MessageType.TOOL_RESULT && msg.metadata?.toolId) {
      resultToolIds.add(msg.metadata.toolId as string);
    }
    if (msg.messageType === MessageType.TOOL_CALL && msg.metadata?.toolId) {
      callToolIds.add(msg.metadata.toolId as string);
    }
  }
  const pending = new Set<string>();
  for (const id of callToolIds) {
    if (!resultToolIds.has(id)) {
      pending.add(id);
    }
  }
  return pending;
});

function isToolCallPending(toolId: string | undefined): boolean {
  if (!toolId) return isExecutingTool.value;
  return pendingToolIds.value.has(toolId);
}
const toolResult = ref<Record<string, unknown> | null>(null);
const showToolResult = ref(false);
const streamError = ref<string | null>(null);
const showConversationsDialog = ref(false);
const conversations = ref<ConversationMetadata[]>([]);
const isLoadingConversations = ref(false);
const copiedMessageId = ref<string | null>(null);
const showMCPToolManager = ref(false);
const activeStreamConversationId = ref<string | undefined>(undefined);
const showSlashMenu = ref(false);
const selectedSlashIndex = ref(0);

// FIFO message queue for follow-up messages during streaming
const messageQueue = ref<QueuedChatMessage[]>([]);

// File operation badge state: conversationId → records
const fileOps = ref<Map<string, readonly FileOperationRecord[]>>(new Map());

// Computed: all file operations for the current conversation
const currentFileOps = computed<readonly FileOperationRecord[]>(() => {
  if (!conversationId.value) return [];
  return fileOps.value.get(conversationId.value) ?? [];
});

// Toggle for the file operations panel above input
const showFileOpsPanel = ref(true);

const MAX_UPLOAD_FILES = 3;
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_TOTAL_MESSAGE_CHARS = 95000; // must stay below aifetchserver AskStreamData.message max_length (100000)

// Allow images plus supported document files for chat uploads.
const fileAccept = 'image/*,.png,.jpg,.jpeg,.webp,.gif,.csv,.pdf,.docx,.xlsx,.xls';

// Resend message state
const isResendingMessage = ref(false);
const resendingMessageId = ref<string | null>(null);

// Plan execute agent state
const currentPlan = ref<Plan | null>(null);
const isPlanExecuting = ref(false);
const isPlanPaused = ref(false);
const currentPlanStep = ref<PlanStep | null>(null);

// Performance optimization: throttle scroll to bottom
let scrollTimeout: number | null = null;

// Helper function to create assistant messages
function createAssistantMessage(content = ''): ChatMessage {
  return {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content,
    timestamp: new Date(),
    conversationId: conversationId.value || StreamState.PENDING
  };
}

function isStreamableAssistantMessage(message: ChatMessage | undefined): boolean {
  return Boolean(
    message &&
    message.role === 'assistant' &&
    (!message.messageType || message.messageType === MESSAGE_TYPE.MESSAGE)
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const precision = i === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[i]}`;
}


function isSupportedAttachmentFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const nameLower = file.name.toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (
    mime === 'text/csv' ||
    mime === 'application/csv' ||
    mime === 'application/pdf' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel'
  ) {
    return true;
  }
  return (
    nameLower.endsWith('.png') ||
    nameLower.endsWith('.jpg') ||
    nameLower.endsWith('.jpeg') ||
    nameLower.endsWith('.webp') ||
    nameLower.endsWith('.gif') ||
    nameLower.endsWith('.csv') ||
    nameLower.endsWith('.pdf') ||
    nameLower.endsWith('.docx') ||
    nameLower.endsWith('.xlsx') ||
    nameLower.endsWith('.xls')
  );
}

function resolveAttachmentMimeType(file: File): string {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return mime;
  if (
    mime === 'text/csv' ||
    mime === 'application/csv' ||
    mime === 'application/pdf' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel'
  ) {
    return mime;
  }
  const nameLower = file.name.toLowerCase();
  if (nameLower.endsWith('.png')) return 'image/png';
  if (nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg')) return 'image/jpeg';
  if (nameLower.endsWith('.webp')) return 'image/webp';
  if (nameLower.endsWith('.gif')) return 'image/gif';
  if (nameLower.endsWith('.csv')) return 'text/csv';
  if (nameLower.endsWith('.pdf')) return 'application/pdf';
  if (nameLower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (nameLower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (nameLower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // Convert ArrayBuffer -> base64 string (browser-safe).
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192; // keep low to avoid engine argument limits
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

function triggerFilePicker(): void {
  fileInputRef.value?.click();
}

function removeSelectedFile(index: number): void {
  selectedUploadFiles.value = selectedUploadFiles.value.filter((_, i) => i !== index);
}

async function handleFileSelection(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const fileList = target.files;
  if (!fileList || fileList.length === 0) return;

  if (selectedUploadFiles.value.length >= MAX_UPLOAD_FILES) {
    streamError.value = t('knowledge.upload_failed_max_files', { max: MAX_UPLOAD_FILES }) || `Maximum ${MAX_UPLOAD_FILES} files allowed. Remove existing files first.`;
    target.value = '';
    return;
  }

  const files = Array.from(fileList);
  const remainingSlots = MAX_UPLOAD_FILES - selectedUploadFiles.value.length;
  const toConsider = files.slice(0, remainingSlots);

  const newFiles: File[] = [];
  const invalidReasons: string[] = [];
  for (const file of toConsider) {
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      invalidReasons.push(
        t('knowledge.upload_failed_file_too_large', { name: file.name, maxSize: formatBytes(MAX_UPLOAD_FILE_BYTES) })
        || `File "${file.name}" exceeds the ${formatBytes(MAX_UPLOAD_FILE_BYTES)} size limit.`
      );
      continue;
    }
    if (!isSupportedAttachmentFile(file)) {
      invalidReasons.push(
        t('knowledge.upload_failed_unsupported_type', { name: file.name })
        || `File "${file.name}" type is not supported.`
      );
      continue;
    }
    newFiles.push(file);
  }

  selectedUploadFiles.value = [...selectedUploadFiles.value, ...newFiles];

  if (invalidReasons.length > 0) {
    streamError.value = invalidReasons.join('\n');
  }

  // Allow selecting the same file again
  target.value = '';
}

// Filter out messages with empty content (unless they have a messageType like tool calls, plans, etc.)
const visibleMessages = computed(() => {
  return messages.value.filter(message =>
    message.content?.trim() || message.messageType
  );
});

// Computed properties for plan state optimization
const planProgress = computed(() => {
  if (!currentPlan.value || currentPlan.value.steps.length === 0) {
    return 0;
  }
  const completedSteps = currentPlan.value.steps.filter(s => s.status === PlanStepStatus.COMPLETED).length;
  return Math.round((completedSteps / currentPlan.value.steps.length) * 100);
});

const completedStepsCount = computed(() => {
  if (!currentPlan.value) return 0;
  return currentPlan.value.steps.filter(s => s.status === PlanStepStatus.COMPLETED).length;
});

const totalStepsCount = computed(() => {
  return currentPlan.value?.steps.length || 0;
});

const allStepsCompleted = computed(() => {
  if (!currentPlan.value) return false;
  return currentPlan.value.steps.every(
    s => s.status === PlanStepStatus.COMPLETED ||
         s.status === PlanStepStatus.FAILED ||
         s.status === PlanStepStatus.SKIPPED
  );
});

const slashQuery = computed(() => {
  const trimmed = inputMessage.value.trimStart();
  if (!trimmed.startsWith('/')) return '';
  return trimmed.slice(1).trim().toLowerCase();
});

const filteredSlashCommands = computed<SlashCommandDefinition[]>(() => {
  const query = slashQuery.value;
  if (!query) {
    return [...AI_CHAT_SLASH_COMMANDS];
  }
  return AI_CHAT_SLASH_COMMANDS.filter((cmd) => {
    const normalizedName = cmd.name.slice(1).toLowerCase();
    return normalizedName.includes(query);
  });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const activeStepIndex = computed(() => {
  if (!currentPlan.value) return -1;
  return currentPlan.value.steps.findIndex(s => s.status === PlanStepStatus.IN_PROGRESS);
});

/**
 * Check if a user message can be resent
 */
function canResendMessage(message: ChatMessage): boolean {
  return (
    message.role === 'user' &&
    (!message.messageType || message.messageType === MESSAGE_TYPE.MESSAGE) &&
    Boolean(message.content) &&
    Boolean(message.content.trim())
  );
}

/**
 * Validate if a stream chunk belongs to the active conversation
 */
function isValidStreamChunk(chunk: ChatStreamChunk, activeId: string | undefined): boolean {
  // Always allow conversation_start events - they establish the conversation ID
  if (chunk.eventType === 'conversation_start') {
    return true;
  }

  const chunkId = chunk.conversationId;

  // If we have an active stream ID, validate against it
  if (activeId) {
    // If chunk has no conversationId, only accept if we're in pending state
    if (!chunkId) return activeId === StreamState.PENDING;

    // Accept exact matches or pending->actual ID transitions
    return chunkId === activeId || (chunkId === StreamState.PENDING && activeId !== StreamState.PENDING);
  }

  // Fallback: if no active stream tracking but chunk matches our current conversationId,
  // accept it. This handles the race where complete callback fires before all chunks are processed.
  if (chunkId && conversationId.value && chunkId === conversationId.value) {
    return true;
  }

  // Also accept if we're in a loading state (stream active) and chunk has a conversationId
  if (isLoading.value && chunkId) {
    return true;
  }

  return false;
}

/**
 * Load chat history when component mounts
 */
onMounted(async () => {
  await loadChatHistory();
  scrollToBottom();

  // Subscribe to file operation events
  subscribeToFileOperations((record: FileOperationRecord) => {
    const convId = record.conversationId;
    const current = fileOps.value.get(convId) ?? [];
    const next = new Map(fileOps.value);
    next.set(convId, [...current, record]);
    fileOps.value = next;
  });
});

// Clean up file operation subscription
onUnmounted(() => {
  unsubscribeFromFileOperations();
});

/**
 * Watch for visibility changes to reload history and focus input
 */
watch(() => props.visible, (newVal) => {
  if (newVal) {
    loadChatHistory();
    nextTick(() => {
      scrollToBottom();
      // Auto-focus input field when chat opens
      if (inputField.value && inputField.value.focus) {
        inputField.value.focus();
      }
    });
  }
});

/**
 * Watch for conversationId changes to reload history
 * Skip during active streaming to avoid overwriting in-flight messages
 */
watch(conversationId, (newId, oldId) => {
  if (newId && newId !== oldId && newId !== StreamState.PENDING && !isLoading.value) {
    loadChatHistory();
  }
});

/**
 * Watch for dialog open to load conversations
 */
watch(showConversationsDialog, (isOpen) => {
  if (isOpen) {
    loadConversations();
  }
});

watch(inputMessage, (newValue) => {
  const trimmed = newValue.trimStart();
  const inSlashMode = trimmed.startsWith('/');
  showSlashMenu.value = inSlashMode;
  if (!inSlashMode) {
    selectedSlashIndex.value = 0;
    return;
  }
  const maxIndex = Math.max(filteredSlashCommands.value.length - 1, 0);
  if (selectedSlashIndex.value > maxIndex) {
    selectedSlashIndex.value = 0;
  }
});

/**
 * Load chat history from backend
 */
async function loadChatHistory() {
  if (isLoadingHistory.value) return; // Prevent concurrent loads
  
  isLoadingHistory.value = true;
  try {
    if(!conversationId.value) return;
    const response = await getChatHistory(conversationId.value);
    if (response && response.data) {
      // Transform messages to normalize plan_created message structure
      const transformedMessages = response.data.messages.map((message: ChatMessage) => {
        // Handle plan_created messages that might be in old format or have content as JSON
        if (message.messageType === MessageType.PLAN_CREATED) {
          let normalizedMetadata = message.metadata || {};
          
          // If content is a JSON string, try to parse it
          if (message.content && typeof message.content === 'string' && message.content.trim().startsWith('{')) {
            try {
              const parsedContent = JSON.parse(message.content);
              // If parsed content has plan fields, merge with metadata
              if (parsedContent.title || parsedContent.planId || parsedContent.steps) {
                normalizedMetadata = { ...normalizedMetadata, ...parsedContent };
              }
            } catch (e) {
              // Content is not valid JSON, ignore
            }
          }
          
          // Transform old format (plan data at metadata root) to new format (metadata.plan)
          // Old format: metadata = { title, description, steps, planId, ... }
          // New format: metadata = { plan: { title, description, steps }, planId }
          if (!normalizedMetadata.plan && (normalizedMetadata.title || normalizedMetadata.steps)) {
            normalizedMetadata = {
              plan: {
                title: normalizedMetadata.title || 'Execution Plan',
                description: normalizedMetadata.description || normalizedMetadata.reasoning,
                steps: normalizedMetadata.steps || []
              },
              planId: normalizedMetadata.planId,
              threadId: normalizedMetadata.threadId
            };
          }
          
          return {
            ...message,
            metadata: normalizedMetadata
          };
        }
        
        return message;
      });
      
      messages.value = transformedMessages;
      
      // Update conversationId if it was returned and we didn't have one
      if (response.data.conversationId && !conversationId.value) {
        conversationId.value = response.data.conversationId;
      }
      toolResult.value=null
      streamError.value = null
      await nextTick();
      scrollToBottom();
    }
  } catch (error) {
    console.error('Error loading chat history:', error);
    streamError.value = error instanceof Error ? error.message : 'Failed to load chat history';
  } finally {
    isLoadingHistory.value = false;
  }
}

/**
 * Manually refresh chat history
 */
async function handleRefreshHistory() {
  await loadChatHistory();
}

/**
 * Load conversations list
 */
async function loadConversations() {
  isLoadingConversations.value = true;
  try {
    const response = await getConversations();
    if (response.success && response.data) {
      conversations.value = response.data;
    }
  } catch (error) {
    console.error('Error loading conversations:', error);
  } finally {
    isLoadingConversations.value = false;
  }
}

/**
 * Handle conversation selection
 */
async function handleSelectConversation(selectedConversationId: string) {
  // Confirm if there are queued messages
  if (messageQueue.value.length > 0) {
    if (!confirm(t('knowledge.queue_confirm_switch') || 'There are queued messages. Discard them and switch conversation?')) {
      return;
    }
    clearMessageQueue();
  }

  // Clear active stream tracking when switching conversations
  activeStreamConversationId.value = undefined;

  conversationId.value = selectedConversationId;
  showConversationsDialog.value = false;
  await loadChatHistory();
}

/**
 * Truncate message text for display
 */
function truncateMessage(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Copy message content to clipboard
 */
async function handleCopyMessage(content: string, messageId: string) {
  try {
    // Copy plain text content (strip HTML tags if any)
    const textToCopy = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    
    await navigator.clipboard.writeText(textToCopy);
    
    // Show visual feedback
    copiedMessageId.value = messageId;
    
    // Reset after 2 seconds
    setTimeout(() => {
      copiedMessageId.value = null;
    }, 2000);
  } catch (error) {
    console.error('Failed to copy message:', error);
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      copiedMessageId.value = messageId;
      setTimeout(() => {
        copiedMessageId.value = null;
      }, 2000);
    } catch (err) {
      console.error('Fallback copy also failed:', err);
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

/**
 * Core send logic shared by new messages and resend
 */
async function sendMessage(
  userMessageContent: string,
  uploadedFiles?: UploadedFilePayload[],
  attachments?: LLMImageAttachmentPayload[]
): Promise<void> {
  if (!userMessageContent.trim() || isLoading.value) return;

  isLoading.value = true;
  isTyping.value = true;
  streamError.value = null;

  // Track the conversation ID for this stream
  // IMPORTANT: This value must stay in sync with `activeStreamConversationId`.
  // The backend assigns the real conversationId via a `conversation_start` chunk.
  // If we keep a stale `PENDING` id here, the `complete` error handler (and its catch)
  // can skip UI updates.
  let streamConversationId = conversationId.value || StreamState.PENDING;
  activeStreamConversationId.value = streamConversationId;

  // Reset tool-related states
  isExecutingTool.value = false;
  currentToolName.value = '';
  currentToolParams.value = {};
  toolResult.value = null;
  showToolResult.value = false;

  // Add user message to UI immediately
  // Note: conversationId will be set by backend on first message
  const userMessage: ChatMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: userMessageContent,
    timestamp: new Date(),
    conversationId: conversationId.value || StreamState.PENDING,
    metadata: uploadedFiles?.length
      ? {
          attachments: uploadedFiles.map((f) => ({
            fileName: f.fileName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
          })),
        }
      : undefined,
  };
  messages.value.push(userMessage);
  
  await nextTick();
  scrollToBottom();

  try {
    // Use streaming for better UX
    let assistantContent = '';
    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      conversationId: conversationId.value || StreamState.PENDING
    };

    // Add placeholder message
    messages.value.push(assistantMessage);

    // Use unified streaming function with RAG flag
    await streamChatMessage(
      userMessageContent,
      (chunk: ChatStreamChunk) => {
        // Validate that this chunk belongs to the current active conversation
        // Ignore chunks from old conversations that are still streaming
        if (!isValidStreamChunk(chunk, activeStreamConversationId.value)) {
          if (activeStreamConversationId.value) {
            console.log('Ignoring chunk from different conversation:', {
              chunkConvId: chunk.conversationId,
              activeConvId: activeStreamConversationId.value,
              eventType: chunk.eventType
            });
          } else {
            console.log('Ignoring chunk: no active stream expected');
          }
          return;
        }

        // Handle different event types
        const eventType = chunk.eventType;
        switch (eventType) {
          case 'token': {
            // Hide typing indicator once content starts arriving
            // isTyping.value = false;

            // Check if we need a new assistant message before accumulating the token.
            // This must happen BEFORE appending to assistantContent so we can reset it
            // and avoid duplicating content from before tool calls.
            let lastIndex = messages.value.length - 1;
            const lastMessage = messages.value[lastIndex];

            // Stream tokens only into plain assistant text messages.
            // Tool/plan/system assistant messages should never receive conversational tokens.
            if (!isStreamableAssistantMessage(lastMessage)) {
              // Starting a new content segment after tool/plan messages.
              // Reset accumulator to avoid duplicating content from before the tool call.
              assistantContent = '';
              messages.value.push(createAssistantMessage());
              lastIndex = messages.value.length - 1;
            }

            // Append token content and display immediately
            if (chunk.content.startsWith('**') && assistantContent.length > 0) {
              assistantContent += '\n' + chunk.content;
            } else {
              assistantContent += chunk.content;
            }

            // Update the assistant message's content so Vue can reactively show tokens as they stream in
            // At this point, lastIndex is guaranteed to point to an assistant message
            messages.value[lastIndex] = {
              ...messages.value[lastIndex],
              content: assistantContent // Replace the content with the accumulated streamed content
            };
            
            nextTick(() => {
              scrollToBottom();
            });
            break;
          }

          case 'tool_call': {
            console.log('tool_call', chunk);
            // Show tool execution indicator
            isExecutingTool.value = true;
            currentToolName.value = chunk.toolName || 'Unknown Tool';
            currentToolParams.value = chunk.toolParams || {};
            isTyping.value = false; // Pause typing indicator during tool execution

            // Add tool call message to chat history
            const toolCallMessage: ChatMessage = {
              id: `tool-call-${chunk.toolId || Date.now()}-${Date.now()}`,
              role: 'assistant',
              content: chunk.content || `Executing tool: ${chunk.toolName || 'Unknown Tool'}`,
              timestamp: new Date(),
              conversationId: chunk.conversationId || conversationId.value,
              messageType: MessageType.TOOL_CALL,
              metadata: {
                toolName: chunk.toolName,
                toolId: chunk.toolId,
                toolParams: chunk.toolParams
              }
            };
            messages.value.push(toolCallMessage);
            throttledScrollToBottom();
            break;
          }

          case 'tool_result': {
            console.log('tool_result', chunk);
            // Hide tool execution indicator and show result
            isExecutingTool.value = false;
            const hasContentPayload =
              typeof chunk.content === 'string' && chunk.content.trim().length > 0;

            if (chunk.replacesPermissionPromptForToolId) {
              const rid = chunk.replacesPermissionPromptForToolId;
              const existingIdx = messages.value.findIndex(
                (m) =>
                  m.messageType === MessageType.TOOL_RESULT &&
                  m.metadata?.toolId === rid
              );
              if (existingIdx !== -1 && (chunk.toolResult || hasContentPayload)) {
                const tr = (chunk.toolResult || {}) as Record<string, unknown>;
                toolResult.value = tr;
                showToolResult.value = false;
                messages.value[existingIdx] = {
                  ...messages.value[existingIdx],
                  content:
                    typeof chunk.content === 'string' && chunk.content.trim().length > 0
                      ? chunk.content
                      : JSON.stringify(chunk.toolResult ?? {}, null, 2),
                  metadata: {
                    ...messages.value[existingIdx].metadata,
                    toolName: chunk.toolName ?? messages.value[existingIdx].metadata?.toolName,
                    toolId: rid,
                    toolResult: chunk.toolResult,
                    success: tr.success !== false && !tr.error,
                    executionTimeMs: tr.executionTimeMs as number | undefined,
                    summary: tr.summary as string | undefined,
                    error: tr.error as string | undefined,
                  },
                };
                throttledScrollToBottom();
              }
              isTyping.value = true;
              break;
            }

            if (chunk.toolResult || hasContentPayload) {
              // Deduplicate: skip if a TOOL_RESULT for this toolId already exists
              const alreadyExists = chunk.toolId
                ? messages.value.some(
                    (m) =>
                      m.messageType === MessageType.TOOL_RESULT &&
                      m.metadata?.toolId === chunk.toolId
                  )
                : false;

              if (!alreadyExists) {
                // Add tool result message to chat history
                const toolResultMessage: ChatMessage = {
                  id: `tool-result-${chunk.toolId || Date.now()}-${Date.now()}`,
                  role: 'assistant',
                  content:
                    typeof chunk.content === 'string' && chunk.content.trim().length > 0
                      ? chunk.content
                      : JSON.stringify(chunk.toolResult ?? {}, null, 2),
                  timestamp: new Date(),
                  conversationId: chunk.conversationId || conversationId.value,
                  messageType: MessageType.TOOL_RESULT,
                  metadata: {
                    toolName: chunk.toolName,
                    toolId: chunk.toolId,
                    toolResult: chunk.toolResult,
                    success: (chunk.toolResult as { success?: boolean })?.success !== false,
                    executionTimeMs: (chunk.toolResult as { executionTimeMs?: number })?.executionTimeMs,
                    summary: (chunk.toolResult as { summary?: string })?.summary,
                    error: (chunk.toolResult as { error?: string })?.error
                  }
                };
                messages.value.push(toolResultMessage);
                throttledScrollToBottom();
              }
            }
            isTyping.value = true; // Resume typing indicator
            break;
          }

          case 'conversation_start':
            console.log('conversation_start', chunk);
            // Update conversation ID if provided and update all pending messages
            if (chunk.conversationId) {
              conversationId.value = chunk.conversationId;
              
              // Update active stream conversation ID if it was 'pending'
              if (activeStreamConversationId.value === StreamState.PENDING) {
                activeStreamConversationId.value = chunk.conversationId;
                streamConversationId = chunk.conversationId;
                console.log('activeStreamConversationId.value', activeStreamConversationId.value);
              }

              // Update conversationId for all messages with 'pending' conversationId
              messages.value.forEach(msg => {
                if (msg.conversationId === StreamState.PENDING) {
                  msg.conversationId = chunk.conversationId || '';
                }
              });
            // Push an empty assistant message as the last message at conversation start
            // messages.value.push({
            //   id: 'assistant_' + Date.now(),
            //   role: 'assistant',
            //   content: '',
            //   timestamp: new Date(),
            //   conversationId: chunk.conversationId || StreamState.PENDING
            // });
            }
            break;

          case 'conversation_end':
            console.log('conversation_end', chunk);
            // Conversation ended — reset typing indicator
            isTyping.value = false;
            // Check if last assistant message is empty and remove it if so
            {
              const lastIndex = messages.value.length - 1;
              if (lastIndex >= 0 && 
                  messages.value[lastIndex].role === 'assistant' && 
                  (!messages.value[lastIndex].content || messages.value[lastIndex].content.trim() === '') &&
                  (!chunk.messageId || messages.value[lastIndex].id === chunk.messageId)) {
                messages.value.splice(lastIndex, 1);
              }
            }
            break;

          case 'pong':
            // Keep-alive, no action needed
            break;

          case 'plan_created':
            console.log('plan_created', chunk);
            handlePlanCreated(chunk);
            break;

          case 'plan_step_start':
            console.log('plan_step_start', chunk);
            handlePlanStepStart(chunk);
            break;

          case 'plan_step_complete':
            console.log('plan_step_complete', chunk);
            handlePlanStepComplete(chunk);
            break;

          case 'plan_execute_pause':
            console.log('plan_execute_pause', chunk);
            handlePlanExecutePause(chunk);
            break;

          case 'plan_execute_resume':
            console.log('plan_execute_resume', chunk);
            handlePlanExecuteResume(chunk);
            break;

          default:
            // Handle unknown or unspecified event types as tokens
            console.log('default', chunk);
            if (chunk.content) {
              isTyping.value = false;
              
              if (chunk.content.startsWith('**') && assistantContent.length > 0) {
                assistantContent += '\n' + chunk.content;
              } else {
                assistantContent += chunk.content;
              }
              
              // Find and update the assistant message
              const lastIndex = messages.value.length - 1;
              if (lastIndex >= 0 && 
                  messages.value[lastIndex].role === 'assistant' && 
                  messages.value[lastIndex].id === assistantMessageId) {
                // Replace the entire message object to trigger Vue reactivity
                messages.value[lastIndex] = {
                  ...messages.value[lastIndex],
                  content: assistantContent
                };
              }
              
              nextTick(() => {
                scrollToBottom();
              });
            }
            break;
        }
      },
      (completedConversationId) => {
        // Always reset typing/tool indicators when the stream completes —
        // these are display-only states that must never persist after a
        // COMPLETE event regardless of any guard logic above.
        isTyping.value = false;
        isExecutingTool.value = false;

        // Only reset isLoading (which gates new streams) when the
        // conversation ID matches the active stream.
        if (isLoading.value &&
            (activeStreamConversationId.value === streamConversationId ||
             activeStreamConversationId.value === completedConversationId)) {
          isLoading.value = false;
          scrollToBottom();
        }

        // Defer clearing activeStreamConversationId to the next macrotask.
        // This ensures any CHUNK events that were queued before the COMPLETE
        // event are still validated correctly.
        const capturedId = activeStreamConversationId.value;
        setTimeout(() => {
          if (activeStreamConversationId.value === capturedId) {
            activeStreamConversationId.value = undefined;
          }
          // Auto-dispatch next queued message after natural completion
          processNextQueuedMessage();
        }, 0);
      },
      streamConversationId,
      undefined, // model
      useRAGContext.value, // useRAG flag
      5, // ragLimit
      uploadedFiles, // attachments for local persistence
      attachments
    );
  } catch (error) {
    console.error('Error sending message:', error);
    
    // Only show error if this is still the active stream
    if (activeStreamConversationId.value === streamConversationId) {
      streamError.value = error instanceof Error ? error.message : 'Failed to send message';
      isTyping.value = false;
      isLoading.value = false;
      isExecutingTool.value = false;
      
      // If streaming failed before any tokens arrived, we may still have a trailing
      // empty assistant placeholder. Remove it to avoid showing a blank bubble.
      const lastIndex = messages.value.length - 1;
      if (lastIndex >= 0) {
        const lastMessage = messages.value[lastIndex];
        if (
          lastMessage.role === 'assistant' &&
          (!lastMessage.content || lastMessage.content.trim() === '') &&
          lastMessage.conversationId === streamConversationId
        ) {
          messages.value.splice(lastIndex, 1);
        }
      }
      
      // Show error message
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${streamError.value}`,
        timestamp: new Date(),
        conversationId: conversationId.value || StreamState.ERROR
      };
      messages.value.push(errorMessage);
      scrollToBottom();
    }
    
    // Clear active stream tracking
    if (activeStreamConversationId.value === streamConversationId) {
      activeStreamConversationId.value = undefined;
    }
  }
}

/**
 * Build a QueuedChatMessage from current input state (file-to-base64 conversion).
 * Returns null if input is invalid or all files are rejected.
 */
async function buildOutgoingMessage(): Promise<QueuedChatMessage | null> {
  const trimmed = inputMessage.value.trim();
  if (showSlashMenu.value && trimmed.startsWith('/')) return null;
  if (!trimmed && selectedUploadFiles.value.length === 0) return null;

  const uploadedFiles: UploadedFilePayload[] = [];
  const attachments: LLMImageAttachmentPayload[] = [];
  let finalMessage =
    trimmed.length > MAX_TOTAL_MESSAGE_CHARS
      ? trimmed.slice(0, MAX_TOTAL_MESSAGE_CHARS)
      : trimmed;

  for (const file of selectedUploadFiles.value) {
    if (file.size > MAX_UPLOAD_FILE_BYTES) continue;
    if (!isSupportedAttachmentFile(file)) continue;

    const mimeType = resolveAttachmentMimeType(file);

    const buf = await file.arrayBuffer();
    const contentBase64 = arrayBufferToBase64(buf);
    uploadedFiles.push({
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      contentBase64,
    });
    if (mimeType.startsWith('image/')) {
      attachments.push({
        type: 'image',
        mediaType: mimeType,
        dataBase64: contentBase64,
        detail: 'auto',
      });
    }
  }

  if (!finalMessage.trim()) {
    if (attachments.length > 0) {
      finalMessage = 'Please analyze attached file(s).';
    } else {
      streamError.value = t('knowledge.upload_failed_file_too_large', { name: selectedUploadFiles.value.map(f => f.name).join(', '), maxSize: formatBytes(MAX_UPLOAD_FILE_BYTES) })
        || `All selected files exceed the ${formatBytes(MAX_UPLOAD_FILE_BYTES)} size limit or are unsupported.`;
      return null;
    }
  }

  return {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content: finalMessage,
    uploadedFiles,
    attachments,
    enqueuedAt: Date.now(),
  };
}

/**
 * Remove a single item from the message queue by id
 */
function removeQueuedMessage(id: string): void {
  messageQueue.value = messageQueue.value.filter(m => m.id !== id);
}

/**
 * Clear all queued messages
 */
function clearMessageQueue(): void {
  messageQueue.value = [];
}

/**
 * Handle clearing the queue via UI button
 */
function handleClearQueue(): void {
  clearMessageQueue();
}

/**
 * Process the next queued message (called after stream completes successfully)
 */
function processNextQueuedMessage(): void {
  if (messageQueue.value.length === 0) return;
  const next = messageQueue.value[0];
  messageQueue.value = messageQueue.value.slice(1);
  void sendMessage(next.content, next.uploadedFiles, next.attachments);
}

/**
 * Send a message to the AI from the input box.
 * If a stream is active, the message is enqueued for auto-dispatch after completion.
 */
async function handleSendMessage() {
  if (isUploadingFiles.value) return;

  isUploadingFiles.value = true;
  streamError.value = null;

  try {
    const outgoing = await buildOutgoingMessage();
    if (!outgoing) return;

    // Clear inputs after building the payload
    inputMessage.value = '';
    selectedUploadFiles.value = [];

    if (isLoading.value) {
      // Stream is active — enqueue for auto-dispatch
      messageQueue.value = [...messageQueue.value, outgoing];
    } else {
      await sendMessage(outgoing.content, outgoing.uploadedFiles, outgoing.attachments);
    }
  } finally {
    isUploadingFiles.value = false;
  }
}

function handleSlashArrowDown(event: KeyboardEvent): void {
  if (!showSlashMenu.value || filteredSlashCommands.value.length === 0) return;
  event.preventDefault();
  selectedSlashIndex.value =
    (selectedSlashIndex.value + 1) % filteredSlashCommands.value.length;
}

function handleSlashArrowUp(event: KeyboardEvent): void {
  if (!showSlashMenu.value || filteredSlashCommands.value.length === 0) return;
  event.preventDefault();
  selectedSlashIndex.value =
    (selectedSlashIndex.value - 1 + filteredSlashCommands.value.length) %
    filteredSlashCommands.value.length;
}

function handleSlashEscape(event: KeyboardEvent): void {
  if (!showSlashMenu.value) return;
  event.preventDefault();
  showSlashMenu.value = false;
}

function applySelectedSlashCommand(): void {
  if (!showSlashMenu.value || filteredSlashCommands.value.length === 0) return;
  const selected = filteredSlashCommands.value[selectedSlashIndex.value];
  if (!selected) return;
  inputMessage.value = selected.usage;
  showSlashMenu.value = false;
}

function handleSlashTab(event: KeyboardEvent): void {
  if (!showSlashMenu.value || filteredSlashCommands.value.length === 0) return;
  event.preventDefault();
  applySelectedSlashCommand();
}

function handleEnterKey(event: KeyboardEvent): void {
  if (event.shiftKey) return;
  if (!showSlashMenu.value || filteredSlashCommands.value.length === 0) {
    event.preventDefault();
    void handleSendMessage();
    return;
  }
  event.preventDefault();
  applySelectedSlashCommand();
}

/**
 * Stop the active AI chat stream (user clicked stop button)
 */
function handleStopStream(): void {
  stopStreamingChat();
}

/**
 * Resend an existing user message
 */
async function handleResendMessage(message: ChatMessage): Promise<void> {
  if (!message.content || !message.content.trim()) return;

  // Set loading state for visual feedback
  isResendingMessage.value = true;
  resendingMessageId.value = message.id;

  try {
    await sendMessage(message.content);
  } finally {
    // Clear loading state regardless of success or error
    isResendingMessage.value = false;
    resendingMessageId.value = null;
  }
}

/**
 * Start a new conversation
 */
async function handleNewConversation() {
  // Clear active stream tracking when starting new conversation
  activeStreamConversationId.value = undefined;

  // Reset conversation ID to start fresh
  conversationId.value = undefined;

  // Clear all messages
  messages.value = [];

  // Clear message queue
  clearMessageQueue();

  // Reset tool-related states
  isExecutingTool.value = false;
  currentToolName.value = '';
  currentToolParams.value = {};
  toolResult.value = null;
  showToolResult.value = false;
  
  // Reset plan-related states
  currentPlan.value = null;
  isPlanExecuting.value = false;
  isPlanPaused.value = false;
  currentPlanStep.value = null;
  
  // Reset error states
  streamError.value = null;
  isTyping.value = false;
  isLoading.value = false;
  
  // Scroll to top and focus input
  await nextTick();
  scrollToBottom();
  if (inputField.value && inputField.value.focus) {
    inputField.value.focus();
  }
}

/**
 * Resolve OpenAI-style tool_call id for a permission row (metadata or nearest prior tool_call).
 */
function resolveToolIdForPermissionMessage(message: ChatMessage): string | undefined {
  const direct = message.metadata?.toolId;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }
  const toolName = message.metadata?.toolName;
  if (typeof toolName !== 'string' || !toolName) {
    return undefined;
  }
  const idx = messages.value.findIndex((m) => m.id === message.id);
  if (idx <= 0) {
    return undefined;
  }
  for (let i = idx - 1; i >= 0; i--) {
    const m = messages.value[i];
    if (
      m.messageType === MessageType.TOOL_CALL &&
      m.metadata?.toolName === toolName &&
      typeof m.metadata?.toolId === 'string' &&
      m.metadata.toolId.length > 0
    ) {
      return m.metadata.toolId;
    }
  }
  return undefined;
}

/**
 * Handle skill permission grant — user approved; main process re-runs the tool and continues the stream.
 */
async function handleSkillPermissionGrant(
  message: ChatMessage,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _persistent: boolean
): Promise<void> {
  const toolId = resolveToolIdForPermissionMessage(message);
  if (!toolId) {
    const idx = messages.value.findIndex((m) => m.id === message.id);
    if (idx !== -1) {
      messages.value = [
        ...messages.value.slice(0, idx),
        {
          ...messages.value[idx],
          content:
            t('skills.permission_resume_no_tool_id') ||
            'Missing tool call information; cannot continue execution.',
          metadata: {
            ...messages.value[idx].metadata,
            toolResult: undefined,
            success: false,
          },
        },
        ...messages.value.slice(idx + 1),
      ];
    }
    return;
  }

  try {
    const raw: unknown = await window.api.invoke(
      AI_CHAT_RESUME_TOOL_AFTER_PERMISSION,
      JSON.stringify({
        toolId,
        conversationId: message.conversationId || conversationId.value,
      })
    );
    const res = raw as CommonMessage<{ ok: boolean; error?: string } | null>;
    if (!res.status || !res.data?.ok) {
      const errMsg =
        res.data?.error ||
        res.msg ||
        t('skills.permission_resume_failed') ||
        'Could not continue the skill after permission was granted.';
      const errIdx = messages.value.findIndex((m) => m.id === message.id);
      if (errIdx !== -1) {
        messages.value = [
          ...messages.value.slice(0, errIdx),
          {
            ...messages.value[errIdx],
            content: errMsg,
            metadata: {
              ...messages.value[errIdx].metadata,
              toolResult: { error: errMsg, success: false },
              success: false,
              error: errMsg,
            },
          },
          ...messages.value.slice(errIdx + 1),
        ];
      }
    }
  } catch (error) {
    const errMsg =
      error instanceof Error ? error.message : String(error);
    const errIdx = messages.value.findIndex((m) => m.id === message.id);
    if (errIdx !== -1) {
      messages.value = [
        ...messages.value.slice(0, errIdx),
        {
          ...messages.value[errIdx],
          content: errMsg,
          metadata: {
            ...messages.value[errIdx].metadata,
            toolResult: { error: errMsg, success: false },
            success: false,
            error: errMsg,
          },
        },
        ...messages.value.slice(errIdx + 1),
      ];
    }
  }
}

/**
 * Handle skill permission deny — user denied the skill execution.
 */
function handleSkillPermissionDeny(message: ChatMessage): void {
  const idx = messages.value.findIndex((m) => m.id === message.id);
  if (idx !== -1) {
    messages.value = [
      ...messages.value.slice(0, idx),
      {
        ...messages.value[idx],
        content: 'Permission denied. The skill will not be executed.',
        metadata: { ...messages.value[idx].metadata, toolResult: undefined, success: false },
      },
      ...messages.value.slice(idx + 1),
    ];
  }
}

/**
 * Clear chat history
 */
async function handleClearChat() {
  if (messageQueue.value.length > 0) {
    if (!confirm(t('knowledge.queue_confirm_clear') || 'There are queued messages. Clear them?')) {
      return;
    }
    clearMessageQueue();
  }
  if (!confirm(t('knowledge.clear_chat_confirm'))) return;

  try {
    await clearChatHistory(conversationId.value);
    // console.log('response', response);
    // if (response.success) {
      messages.value = [];
    // }
  } catch (error) {
    console.error('Error clearing chat:', error);
  }
}

// ==================== Plan Execute Agent Handlers ====================

/**
 * Handle plan_created event with error boundaries
 */
function handlePlanCreated(chunk: ChatStreamChunk): void {
  try {
    if (!chunk.plan || !chunk.planId) {
      console.warn('Invalid plan data received in handlePlanCreated');
      return;
    }

    // Validate plan structure
    if (!chunk.plan.title || !Array.isArray(chunk.plan.steps)) {
      console.warn('Invalid plan structure received');
      return;
    }

    // currentPlan.value = chunk.plan;
    isPlanExecuting.value = true;
    isPlanPaused.value = false;

    // Add plan created message to chat
    const planMessage: ChatMessage = {
      id: `plan-${chunk.planId}-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      conversationId: chunk.conversationId || conversationId.value,
      messageType: MessageType.PLAN_CREATED,
      metadata: {
        plan: chunk.plan,
        planId: chunk.planId,
        threadId: chunk.threadId
      }
    };
    messages.value.push(planMessage);
    throttledScrollToBottom();
  } catch (error) {
    console.error('Error handling plan created event:', error);
  }
}

/**
 * Handle plan_step_start event
 */
function handlePlanStepStart(chunk: ChatStreamChunk): void {
  try {
    if (!chunk.planStep || !chunk.stepId) {
      console.warn('Invalid plan step data received in handlePlanStepStart');
      return;
    }

    currentPlanStep.value = chunk.planStep;

    // Update step in current plan
    if (currentPlan.value) {
      const stepIndex = currentPlan.value.steps.findIndex(s => s.stepId === chunk.stepId);
      if (stepIndex >= 0) {
        currentPlan.value.steps[stepIndex].status = PlanStepStatus.IN_PROGRESS;
        currentPlan.value.steps[stepIndex].startTime = new Date();
      }
      currentPlan.value.currentStepIndex = (chunk.planStep.stepNumber || 1) - 1;
    }

    throttledScrollToBottom();
  } catch (error) {
    console.error('Error handling plan step start event:', error);
  }
}

/**
 * Handle plan_step_complete event with error boundaries
 */
function handlePlanStepComplete(chunk: ChatStreamChunk): void {
  try {
    if (!chunk.planStep || !chunk.stepId) {
      console.warn('Invalid plan step completion data received');
      return;
    }

    // Update step in current plan
    if (currentPlan.value) {
      const stepIndex = currentPlan.value.steps.findIndex(s => s.stepId === chunk.stepId);
      if (stepIndex >= 0) {
        currentPlan.value.steps[stepIndex].status = chunk.planStep.status;
        currentPlan.value.steps[stepIndex].endTime = new Date();
        currentPlan.value.steps[stepIndex].result = chunk.planStep.result;
        currentPlan.value.steps[stepIndex].error = chunk.planStep.error;
      }

      // Check if all steps are completed using computed property
      if (allStepsCompleted.value) {
        currentPlan.value.status = 'completed';
        isPlanExecuting.value = false;
        currentPlanStep.value = null;
      }
    }

    // Add step completion message
    const stepMessage: ChatMessage = {
      id: `step-${chunk.stepId}-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      conversationId: chunk.conversationId || conversationId.value,
      messageType: MessageType.PLAN_STEP_COMPLETE,
      metadata: {
        planStep: chunk.planStep,
        planId: chunk.planId,
        stepId: chunk.stepId
      }
    };
    messages.value.push(stepMessage);

    throttledScrollToBottom();
  } catch (error) {
    console.error('Error handling plan step complete event:', error);
  }
}

/**
 * Handle plan_execute_pause event
 * Note: This event only updates internal state, no UI display needed
 */
function handlePlanExecutePause(chunk: ChatStreamChunk): void {
  try {
    isPlanPaused.value = true;

    if (currentPlan.value) {
      currentPlan.value.status = 'paused';
    }
    
    // No UI message displayed for pause event - only state update
    console.log('Plan paused:', chunk.pauseReason || 'No reason provided');
  } catch (error) {
    console.error('Error handling plan execute pause event:', error);
  }
}

/**
 * Handle plan_execute_resume event
 */
function handlePlanExecuteResume(chunk: ChatStreamChunk): void {
  try {
    isPlanPaused.value = false;
    isTyping.value = true;

    if (currentPlan.value) {
      currentPlan.value.status = 'in_progress';
    }

    // Add resume message
    const resumeMessage: ChatMessage = {
      id: `resume-${chunk.planId || 'unknown'}-${Date.now()}`,
      role: 'assistant',
      content: chunk.resumeReason || 'Plan execution resumed',
      timestamp: new Date(),
      conversationId: chunk.conversationId || conversationId.value,
      messageType: MessageType.PLAN_EXECUTE_RESUME,
      metadata: {
        planId: chunk.planId,
        resumeReason: chunk.resumeReason
      }
    };
    messages.value.push(resumeMessage);

    throttledScrollToBottom();
  } catch (error) {
    console.error('Error handling plan execute resume event:', error);
  }
}

/**
 * Get step status icon
 */
function getStepStatusIcon(status: PlanStepStatus): string {
  switch (status) {
    case PlanStepStatus.PENDING:
      return 'mdi-clock-outline';
    case PlanStepStatus.IN_PROGRESS:
      return 'mdi-loading mdi-spin';
    case PlanStepStatus.COMPLETED:
      return 'mdi-check-circle';
    case PlanStepStatus.FAILED:
      return 'mdi-alert-circle';
    case PlanStepStatus.SKIPPED:
      return 'mdi-skip-forward';
    default:
      return 'mdi-circle-outline';
  }
}

/**
 * Get step status color
 */
function getStepStatusColor(status: PlanStepStatus): string {
  switch (status) {
    case PlanStepStatus.PENDING:
      return 'grey';
    case PlanStepStatus.IN_PROGRESS:
      return 'blue';
    case PlanStepStatus.COMPLETED:
      return 'success';
    case PlanStepStatus.FAILED:
      return 'error';
    case PlanStepStatus.SKIPPED:
      return 'warning';
    default:
      return 'grey';
  }
}

/**
 * Format message content (convert markdown, line breaks, etc.)
 */
function formatMessage(content: string): string {
  // Basic formatting - can be enhanced with markdown library
  return content
    .replace(/\n/g, '<br>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * Format timestamp for display (relative time)
 */
function formatTimestamp(timestamp: Date): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInMinutes = Math.floor(diffInMs / 60000);

  if (diffInMinutes < 1) return t('knowledge.just_now');
  if (diffInMinutes < 60) return t('knowledge.minutes_ago', { count: diffInMinutes });
  if (diffInMinutes < 1440) return t('knowledge.hours_ago', { count: Math.floor(diffInMinutes / 60) });
  
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format full timestamp for tooltip (exact date and time)
 */
function formatFullTimestamp(timestamp: Date): string {
  const date = new Date(timestamp);
  return date.toLocaleString([], { 
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Scroll to bottom of messages
 */
function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
      showScrollButton.value = false;
    }
  });
}

/**
 * Throttled version of scrollToBottom to improve performance during rapid updates
 */
function throttledScrollToBottom(): void {
  if (scrollTimeout) {
    clearTimeout(scrollTimeout);
  }
  scrollTimeout = window.setTimeout(() => {
    scrollToBottom();
    scrollTimeout = null;
  }, 16); // ~60fps
}

/**
 * Handle scroll event to show/hide scroll-to-bottom button
 */
function handleScroll() {
  if (messagesContainer.value) {
    const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value;
    showScrollButton.value = scrollHeight - scrollTop - clientHeight > 100;
  }
}

// Add scroll event listener
onMounted(() => {
  if (messagesContainer.value) {
    messagesContainer.value.addEventListener('scroll', handleScroll);
  }
});
</script>

<style scoped lang="scss">
.ai-chat-box {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background-color: rgb(var(--v-theme-surface));
}

.header-left {
  display: flex;
  align-items: center;
  font-weight: 600;
  font-size: 16px;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  position: relative;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: rgb(var(--v-theme-on-surface-variant));
}

.message-wrapper {
  margin-bottom: 16px;
  display: flex;

  &.user {
    justify-content: flex-end;

    .message-content {
      flex-direction: row-reverse;
    }

    .message-bubble {
      background-color: #1976d2;
      color: white;
      margin-left: 0;
      margin-right: 8px;
    }

    .message-timestamp {
      text-align: right;
      color: rgba(255, 255, 255, 0.7);
    }
  }

  &.assistant {
    justify-content: flex-start;

    .message-bubble {
      background-color: #f5f5f5;
      color: rgb(var(--v-theme-on-surface));
      margin-right: 0;
      margin-left: 8px;
    }

    .message-timestamp {
      text-align: left;
      color: rgb(var(--v-theme-on-surface-variant));
    }
  }
}

.message-content {
  display: flex;
  align-items: flex-start;
  max-width: 85%;
}

.message-avatar {
  flex-shrink: 0;
}

.message-bubble {
  border-radius: 12px;
  padding: 12px 16px;
  word-wrap: break-word;
  word-break: break-word;
  position: relative;
}

.message-header {
  position: absolute;
  bottom: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.2s ease;
  z-index: 1;
}

.message-wrapper.assistant:hover .message-header,
.message-wrapper.user:hover .message-header,
.message-header.copied {
  opacity: 1;
}

.copy-button {
  min-width: 24px !important;
  width: 24px !important;
  height: 24px !important;
  opacity: 0.6;
  transition: opacity 0.2s ease, transform 0.1s ease;

  &:hover {
    opacity: 1;
    transform: scale(1.1);
  }

  .v-icon {
    font-size: 14px !important;
  }
}

.message-text {
  line-height: 1.5;

  :deep(code) {
    background-color: rgba(var(--v-theme-on-surface), 0.08);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
  }

  :deep(strong) {
    font-weight: 600;
  }

  :deep(em) {
    font-style: italic;
  }
}

.message-timestamp {
  font-size: 11px;
  margin-top: 4px;
  display: flex;
  align-items: center;
  opacity: 0.8;
  cursor: help;
  
  &:hover {
    opacity: 1;
  }
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 8px 0;

  span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: rgb(var(--v-theme-on-surface-variant));
    animation: typing 1.4s infinite;

    &:nth-child(2) {
      animation-delay: 0.2s;
    }

    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.7;
  }
  30% {
    transform: translateY(-10px);
    opacity: 1;
  }
}

.scroll-to-bottom {
  position: absolute;
  bottom: 80px;
  right: 16px;
  z-index: 10;
}

.chat-input {
  padding: 12px 16px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background-color: rgb(var(--v-theme-surface));
}

.slash-command-menu {
  margin-top: 8px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background-color: rgb(var(--v-theme-surface));
  max-height: 180px;
  overflow-y: auto;
}

.slash-command-item {
  padding: 8px 10px;
  cursor: pointer;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);

  &:last-child {
    border-bottom: none;
  }

  &.is-selected {
    background-color: rgba(var(--v-theme-primary), 0.08);
  }
}

.slash-command-name {
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}

.slash-command-description {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  margin-top: 2px;
}

.slash-command-empty {
  padding: 10px;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

/* Scrollbar styling */
.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.chat-messages::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-on-surface), 0.3);
  border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--v-theme-on-surface), 0.5);
}

/* Tool Execution Styles */
.tool-execution {
  background-color: rgba(156, 39, 176, 0.08) !important;
  border: 1px solid rgba(156, 39, 176, 0.3);
}

.tool-indicator {
  display: flex;
  align-items: center;
  padding: 4px 0;
}

.tool-text {
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface));
}

.tool-params {
  margin-top: 8px;
  
  details {
    cursor: pointer;
    
    summary {
      font-size: 12px;
      color: rgba(156, 39, 176, 0.9);
      font-weight: 500;
      user-select: none;
      
      &:hover {
        color: rgb(156, 39, 176);
      }
    }
    
    pre {
      margin-top: 8px;
      padding: 8px;
      background-color: rgba(var(--v-theme-on-surface), 0.05);
      border-radius: 4px;
      font-size: 11px;
      overflow-x: auto;
      max-height: 200px;
    }
  }
}

/* Tool Call Message Styles */
.tool-call-message {
  background-color: rgba(156, 39, 176, 0.08) !important;
  border: 1px solid rgba(156, 39, 176, 0.3);
}

.tool-call-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  color: rgb(156, 39, 176);
  font-weight: 600;

  .tool-loading-spinner {
    animation: tool-spin 1s linear infinite;
  }
}

@keyframes tool-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tool-call-content {
  font-size: 14px;
  line-height: 1.6;
  
  .tool-name, .tool-id {
    margin-bottom: 4px;
    color: rgb(var(--v-theme-on-surface));
  }
  
  .tool-params-details, .tool-content-details {
    margin-top: 8px;
    cursor: pointer;
    
    summary {
      font-size: 12px;
      color: rgba(156, 39, 176, 0.9);
      font-weight: 500;
      user-select: none;
      
      &:hover {
        color: rgb(156, 39, 176);
      }
    }
    
    pre {
      margin-top: 8px;
      padding: 8px;
      background-color: rgba(var(--v-theme-on-surface), 0.05);
      border-radius: 4px;
      font-size: 11px;
      overflow-x: auto;
      max-height: 200px;
    }
  }
}

/* Tool Result Message Styles */
.tool-result-message {
  background-color: rgba(76, 175, 80, 0.08) !important;
  border: 1px solid rgba(76, 175, 80, 0.3);
}

.tool-result-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  color: rgb(76, 175, 80);
  font-weight: 600;
}

.tool-result-content {
  font-size: 14px;
  line-height: 1.6;
  
  .tool-name {
    margin-bottom: 4px;
    color: rgb(var(--v-theme-on-surface));
  }
  
  .tool-error {
    margin-top: 8px;
    padding: 8px;
    background-color: rgba(244, 67, 54, 0.1);
    border-radius: 4px;
    color: rgb(244, 67, 54);
    font-size: 13px;
  }
  
  .tool-summary {
    margin-top: 12px;
    padding: 12px;
    background-color: rgba(76, 175, 80, 0.05);
    border-left: 3px solid rgba(76, 175, 80, 0.5);
    border-radius: 4px;
    
    .summary-header {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      color: rgb(76, 175, 80);
      font-weight: 600;
      font-size: 13px;
    }
    
    .summary-content {
      color: rgb(var(--v-theme-on-surface));
      white-space: pre-wrap;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      
      :deep(code) {
        background-color: rgba(var(--v-theme-on-surface), 0.08);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        font-size: 0.9em;
      }
      
      :deep(strong) {
        font-weight: 600;
        color: rgb(var(--v-theme-on-surface));
      }
    }
  }
  
  .tool-result-details {
    margin-top: 8px;
    cursor: pointer;
    
    summary {
      font-size: 12px;
      color: rgba(76, 175, 80, 0.9);
      font-weight: 500;
      user-select: none;
      
      &:hover {
        color: rgb(76, 175, 80);
      }
    }
    
    pre {
      margin-top: 8px;
      padding: 8px;
      background-color: rgba(var(--v-theme-on-surface), 0.05);
      border-radius: 4px;
      font-size: 11px;
      overflow-x: auto;
      max-height: 200px;
    }
  }
}

/* Legacy Tool Result Styles (for streaming) */
.tool-result {
  background-color: rgba(76, 175, 80, 0.08) !important;
  border: 1px solid rgba(76, 175, 80, 0.3);
}

.tool-result details {
  cursor: pointer;
  margin-top: 4px;
  
  summary {
    font-size: 12px;
    color: rgba(76, 175, 80, 0.9);
    font-weight: 500;
    user-select: none;
    
    &:hover {
      color: rgb(76, 175, 80);
    }
  }
  
  pre {
    margin-top: 8px;
    padding: 8px;
    background-color: rgba(var(--v-theme-on-surface), 0.05);
    border-radius: 4px;
    font-size: 11px;
    overflow-x: auto;
    max-height: 200px;
  }
}

/* Error Message Styles */
.error-message {
  animation: slideInError 0.3s ease-out;
}

@keyframes slideInError {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.error-bubble {
  background-color: rgba(244, 67, 54, 0.08) !important;
  border: 1px solid rgba(244, 67, 54, 0.3);
  color: rgb(var(--v-theme-on-surface));
}

.error-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  color: rgb(244, 67, 54);
  font-weight: 600;
}

.error-text {
  font-size: 14px;
  line-height: 1.5;
  color: rgb(var(--v-theme-on-surface));
}

/* Conversation Dialog Styles */
.conversation-item {
  cursor: pointer;
  transition: background-color 0.2s ease;
  
  &:hover {
    background-color: rgba(var(--v-theme-primary), 0.08) !important;
  }
  
  &.bg-primary-lighten-5 {
    background-color: rgba(var(--v-theme-primary), 0.12) !important;
  }
}

.conversation-title {
  font-weight: 500;
  line-height: 1.4;
  word-break: break-word;
}

/* Plan Execution Styles */
.plan-execution {
  animation: slideInPlan 0.3s ease-out;
}

@keyframes slideInPlan {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.plan-bubble {
  background-color: rgba(63, 81, 181, 0.08) !important;
  border: 1px solid rgba(63, 81, 181, 0.3);
  max-width: 100%;
}

.plan-header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  color: rgb(63, 81, 181);
  font-weight: 600;
}

.plan-description {
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface-variant));
  margin-bottom: 12px;
  line-height: 1.5;
}

.plan-steps {
  margin: 12px 0;
}

.plan-step {
  display: flex;
  align-items: flex-start;
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.1);
  transition: background-color 0.2s ease;
  
  &:last-child {
    border-bottom: none;
  }
  
  &.step-active {
    background-color: rgba(33, 150, 243, 0.08);
    border-radius: 4px;
    padding: 8px;
    margin: 4px -8px;
  }
  
  &.step-completed {
    .step-title {
      color: rgb(76, 175, 80);
    }
  }
  
  &.step-failed {
    .step-title {
      color: rgb(244, 67, 54);
    }
  }
}

.step-indicator {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}

.step-content {
  flex: 1;
  min-width: 0;
}

.step-title {
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface));
  line-height: 1.4;
}

.step-description {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  margin-top: 4px;
}

.step-result {
  font-size: 12px;
  color: rgb(76, 175, 80);
  margin-top: 4px;
  display: flex;
  align-items: center;
}

.step-error {
  font-size: 12px;
  color: rgb(244, 67, 54);
  margin-top: 4px;
  display: flex;
  align-items: center;
}

.plan-progress {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--v-border-color), 0.2);
}

.progress-text {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  margin-top: 6px;
  text-align: center;
}

/* Plan Message Styles */
.plan-created-message {
  background-color: rgba(63, 81, 181, 0.08) !important;
  border: 1px solid rgba(63, 81, 181, 0.3);
}

.plan-step-message {
  background-color: rgba(63, 81, 181, 0.05) !important;
  border: 1px solid rgba(63, 81, 181, 0.2);
}

.plan-pause-message {
  background-color: rgba(255, 152, 0, 0.08) !important;
  border: 1px solid rgba(255, 152, 0, 0.3);
}

.plan-resume-message {
  background-color: rgba(76, 175, 80, 0.08) !important;
  border: 1px solid rgba(76, 175, 80, 0.3);
}

.plan-message-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  color: rgb(63, 81, 181);
  font-weight: 600;
}

.plan-message-content {
  font-size: 14px;
  line-height: 1.6;
  
  .plan-title {
    margin-bottom: 4px;
    color: rgb(var(--v-theme-on-surface));
  }
  
  .plan-description-text {
    color: rgb(var(--v-theme-on-surface-variant));
    margin-bottom: 8px;
  }
  
  .plan-reasoning-section {
    margin: 12px 0;
    padding: 12px;
    background-color: rgba(255, 193, 7, 0.08);
    border-left: 3px solid rgba(255, 193, 7, 0.5);
    border-radius: 4px;
    
    .plan-reasoning-label {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      color: rgb(255, 152, 0);
      font-size: 13px;
      font-weight: 600;
    }
    
    .plan-reasoning-text {
      color: rgb(var(--v-theme-on-surface));
      line-height: 1.6;
      white-space: pre-wrap;
    }
  }
  
  .plan-steps-summary {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: rgb(63, 81, 181);
    margin-bottom: 8px;
  }
}

.plan-steps-details {
  cursor: pointer;
  
  summary {
    font-size: 12px;
    color: rgba(63, 81, 181, 0.9);
    font-weight: 500;
    user-select: none;
    
    &:hover {
      color: rgb(63, 81, 181);
    }
  }
  
  .steps-list {
    margin-top: 8px;
    padding: 8px;
    background-color: rgba(var(--v-theme-on-surface), 0.03);
    border-radius: 4px;
    
    .step-item {
      display: flex;
      align-items: flex-start;
      padding: 4px 0;
      font-size: 13px;
      
      .step-number {
        flex-shrink: 0;
        width: 24px;
        color: rgb(63, 81, 181);
        font-weight: 600;
      }
      
      .step-title {
        color: rgb(var(--v-theme-on-surface));
      }
    }
  }
}

.plan-step-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
}

.plan-step-content {
  font-size: 14px;
  line-height: 1.6;
  
  .step-title-display {
    color: rgb(var(--v-theme-on-surface));
    margin-bottom: 4px;
  }
  
  .step-result-display {
    display: flex;
    align-items: center;
    color: rgb(76, 175, 80);
    font-size: 13px;
    margin-top: 4px;
  }
  
  .step-error-display {
    display: flex;
    align-items: center;
    color: rgb(244, 67, 54);
    font-size: 13px;
    margin-top: 4px;
  }
}

.plan-pause-header, .plan-resume-header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
}

.plan-pause-content, .plan-resume-content {
  font-size: 14px;
  line-height: 1.5;
  color: rgb(var(--v-theme-on-surface));
}

/* Animation for spinning icon */
.mdi-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Attachment preview in message bubbles */
.attachment-preview {
  margin-bottom: 8px;
  padding: 6px 8px;
  background-color: rgba(var(--v-theme-primary), 0.06);
  border-radius: 6px;
  font-size: 12px;
}

.attachment-preview-header {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
  color: rgb(var(--v-theme-primary));
}

.attachment-preview-files {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.attachment-preview-file {
  color: rgb(var(--v-theme-on-surface-variant));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Attached files preview below input area */
.attached-files-preview {
  padding: 8px 16px;
  background-color: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-border-color), 0.1);
}

.attached-files-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  color: rgb(var(--v-theme-primary));
}

.attached-files-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.attached-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background-color: rgba(var(--v-theme-on-surface), 0.04);
  border-radius: 6px;
  font-size: 13px;
}

.attached-file-name {
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attached-file-size {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 11px;
  flex-shrink: 0;
}

/* File Operations Summary Panel */
.file-ops-panel {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background-color: rgb(var(--v-theme-surface));
  padding: 0;
}

.file-ops-header {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }
}

.file-ops-summary {
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
}

.file-ops-counts {
  display: flex;
  align-items: center;
}

.file-ops-body {
  padding: 4px 16px 10px;
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
}

/* Message Queue Panel Styles */
.message-queue-panel {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background-color: rgba(var(--v-theme-primary), 0.04);
  padding: 0;
  max-height: 200px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.queue-panel-header {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  gap: 4px;
}

.queue-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  display: flex;
  align-items: center;
}

.queue-panel-hint {
  font-size: 11px;
  color: rgb(var(--v-theme-on-surface-variant));
  padding: 0 16px 4px;
  opacity: 0.8;
}

.queue-panel-items {
  overflow-y: auto;
  max-height: 140px;
  padding: 0 8px 8px;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background-color: rgb(var(--v-theme-surface));
  border-radius: 6px;
  margin-bottom: 4px;
  font-size: 12px;
  border: 1px solid rgba(var(--v-border-color), 0.12);
}

.queue-item-index {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
  flex-shrink: 0;
  width: 18px;
}

.queue-item-preview {
  flex: 1;
  min-width: 0;
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-item-attachment {
  display: flex;
  align-items: center;
  gap: 2px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 11px;
  flex-shrink: 0;
}
</style>

