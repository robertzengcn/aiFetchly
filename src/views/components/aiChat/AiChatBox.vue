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
        v-for="message in messages"
        :key="message.id"
        class="message-wrapper"
        :class="message.role"
      >
        <div class="message-content">
          <div class="message-avatar">
            <v-icon v-if="message.role === 'user'" color="primary">mdi-account</v-icon>
            <v-icon v-else color="purple">mdi-robot</v-icon>
          </div>
          <div class="message-bubble">
            <div class="message-text" v-html="formatMessage(message.content)"></div>
            <div class="message-timestamp" :title="formatFullTimestamp(message.timestamp)">
              <v-icon size="x-small" class="mr-1">mdi-clock-outline</v-icon>
              {{ formatTimestamp(message.timestamp) }}
            </div>
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

      <!-- Tool Result Display -->
      <div v-if="showToolResult && toolResult" class="message-wrapper assistant">
        <div class="message-content">
          <div class="message-avatar">
            <v-icon color="purple">mdi-robot</v-icon>
          </div>
          <div class="message-bubble tool-result">
            <div class="tool-result-header">
              <v-icon size="small" color="success" class="mr-1">mdi-check-circle</v-icon>
              <span><strong>Tool Result</strong></span>
            </div>
            <details>
              <summary>View Result</summary>
              <pre>{{ JSON.stringify(toolResult, null, 2) }}</pre>
            </details>
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

    <!-- Chat Input -->
    <div class="chat-input">
      <v-textarea
        ref="inputField"
        v-model="inputMessage"
        :placeholder="t('knowledge.type_message_placeholder')"
        rows="1"
        auto-grow
        max-rows="4"
        variant="outlined"
        density="compact"
        hide-details
        @keydown.enter.exact.prevent="handleSendMessage"
        @keydown.shift.enter.prevent="inputMessage += '\n'"
        :disabled="isLoading"
      >
        <template v-slot:append-inner>
          <v-btn
            icon
            size="small"
            color="primary"
            :disabled="!inputMessage.trim() || isLoading"
            :loading="isLoading"
            @click="handleSendMessage"
          >
            <v-icon>mdi-send</v-icon>
          </v-btn>
        </template>
      </v-textarea>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { sendChatMessage, streamChatMessage, getChatHistory, clearChatHistory } from '@/views/api/aiChat';
import { ChatMessage, ChatStreamChunk } from '@/entityTypes/commonType';

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
const emit = defineEmits<{
  close: [];
}>();

// Reactive state
const messages = ref<ChatMessage[]>([]);
const inputMessage = ref('');
const isLoading = ref(false);
const isTyping = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const showScrollButton = ref(false);
const conversationId = ref<string | undefined>(undefined);
const inputField = ref<HTMLTextAreaElement | null>(null);
const useRAGContext = ref(true);
const isExecutingTool = ref(false);
const currentToolName = ref('');
const currentToolParams = ref<Record<string, unknown>>({});
const toolResult = ref<Record<string, unknown> | null>(null);
const showToolResult = ref(false);
const streamError = ref<string | null>(null);

/**
 * Load chat history when component mounts
 */
onMounted(async () => {
  await loadChatHistory();
  scrollToBottom();
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
 * Load chat history from backend
 */
async function loadChatHistory() {
  try {
    const response = await getChatHistory(conversationId.value);
    if (response.success && response.data) {
      messages.value = response.data.messages;
    }
  } catch (error) {
    console.error('Error loading chat history:', error);
  }
}

/**
 * Send a message to the AI
 */
async function handleSendMessage() {
  if (!inputMessage.value.trim() || isLoading.value) return;

  const userMessageContent = inputMessage.value.trim();
  inputMessage.value = '';
  isLoading.value = true;
  isTyping.value = true;
  streamError.value = null;

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
    conversationId: conversationId.value || 'pending'
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
      conversationId: conversationId.value || 'pending'
    };
    
    // Add placeholder message
    messages.value.push(assistantMessage);

    // Use unified streaming function with RAG flag
    await streamChatMessage(
      userMessageContent,
      (chunk: ChatStreamChunk) => {
        // Handle different event types
        const eventType = chunk.eventType;

        switch (eventType) {
          case 'token':
            // Append token content and display immediately
            assistantContent += chunk.content;
            const lastMessage = messages.value[messages.value.length - 1];
            if (lastMessage && lastMessage.role === 'assistant' && lastMessage.id === assistantMessageId) {
              lastMessage.content = assistantContent;
            }
            scrollToBottom();
            break;

          case 'tool_call':
            // Show tool execution indicator
            isExecutingTool.value = true;
            currentToolName.value = chunk.toolName || 'Unknown Tool';
            currentToolParams.value = chunk.toolParams || {};
            isTyping.value = false; // Pause typing indicator during tool execution
            break;

          case 'tool_result':
            // Hide tool execution indicator and show result
            isExecutingTool.value = false;
            if (chunk.toolResult) {
              toolResult.value = chunk.toolResult;
              showToolResult.value = true;
            }
            isTyping.value = true; // Resume typing indicator
            break;

          case 'conversation_start':
            // Update conversation ID if provided and update all pending messages
            if (chunk.conversationId) {
              conversationId.value = chunk.conversationId;
              
              // Update conversationId for all messages with 'pending' conversationId
              messages.value.forEach(msg => {
                if (msg.conversationId === 'pending') {
                  msg.conversationId = chunk.conversationId!;
                }
              });
            }
            break;

          case 'pong':
            // Keep-alive, no action needed
            break;

          default:
            // Handle unknown or unspecified event types as tokens
            if (chunk.content) {
              assistantContent += chunk.content;
              const msg = messages.value[messages.value.length - 1];
              if (msg && msg.role === 'assistant' && msg.id === assistantMessageId) {
                msg.content = assistantContent;
              }
              scrollToBottom();
            }
            break;
        }
      },
      () => {
        // Stream complete - only handle cleanup, content is already updated
        // No need to update content again since we've been updating it as tokens arrived
        
        // Reset all states
        isTyping.value = false;
        isLoading.value = false;
        isExecutingTool.value = false;
        showToolResult.value = false;
        scrollToBottom();
      },
      conversationId.value,
      undefined, // model
      useRAGContext.value, // useRAG flag
      3 // ragLimit
    );
  } catch (error) {
    console.error('Error sending message:', error);
    streamError.value = error instanceof Error ? error.message : 'Failed to send message';
    isTyping.value = false;
    isLoading.value = false;
    isExecutingTool.value = false;
    
    // Show error message
    const errorMessage: ChatMessage = {
      id: `error-${Date.now()}`,
      role: 'assistant',
      content: `Error: ${streamError.value}`,
      timestamp: new Date(),
      conversationId: conversationId.value || 'error'
    };
    messages.value.push(errorMessage);
    scrollToBottom();
  }
}

/**
 * Clear chat history
 */
async function handleClearChat() {
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

/* Tool Result Styles */
.tool-result {
  background-color: rgba(76, 175, 80, 0.08) !important;
  border: 1px solid rgba(76, 175, 80, 0.3);
}

.tool-result-header {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
  color: rgb(76, 175, 80);
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
</style>

