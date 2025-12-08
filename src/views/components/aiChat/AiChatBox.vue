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
        v-for="message in messages"
        :key="message.id"
        class="message-wrapper"
        :class="[message.role, message.messageType || MESSAGE_TYPE.MESSAGE]"
      >
        <div class="message-content">
          <div class="message-avatar">
            <v-icon v-if="message.role === 'user'" color="primary">mdi-account</v-icon>
            <v-icon v-else-if="message.messageType === MESSAGE_TYPE.TOOL_CALL" color="purple">mdi-toolbox</v-icon>
            <v-icon v-else-if="message.messageType === MESSAGE_TYPE.TOOL_RESULT" color="success">mdi-check-circle</v-icon>
            <v-icon v-else color="purple">mdi-robot</v-icon>
          </div>
          <div class="message-bubble" :class="{
            'assistant-message': message.role === 'assistant' && message.messageType === MESSAGE_TYPE.MESSAGE,
            'tool-call-message': message.messageType === MESSAGE_TYPE.TOOL_CALL,
            'tool-result-message': message.messageType === MESSAGE_TYPE.TOOL_RESULT
          }">
            <!-- Tool Call Message -->
            <template v-if="message.messageType === MESSAGE_TYPE.TOOL_CALL">
              <div class="tool-call-header">
                <v-icon size="small" color="purple" class="mr-1">mdi-toolbox</v-icon>
                <span><strong>Tool Call</strong></span>
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
import { ref, onMounted, nextTick, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { sendChatMessage, streamChatMessage, getChatHistory, clearChatHistory, getConversations, ConversationMetadata } from '@/views/api/aiChat';
import { ChatMessage, ChatStreamChunk } from '@/entityTypes/commonType';
import { MessageType } from '@/entityTypes/commonType';
import MCPToolManager from './MCPToolManager.vue';

// Message type constants for template use
const MESSAGE_TYPE = {
    MESSAGE: MessageType.MESSAGE,
    TOOL_CALL: MessageType.TOOL_CALL,
    TOOL_RESULT: MessageType.TOOL_RESULT
} as const;

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
const isLoadingHistory = ref(false);
const isTyping = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const showScrollButton = ref(false);
const conversationId = ref<string | undefined>(undefined);
const inputField = ref<HTMLTextAreaElement | null>(null);
const useRAGContext = ref(false);
const isExecutingTool = ref(false);
const currentToolName = ref('');
const currentToolParams = ref<Record<string, unknown>>({});
const toolResult = ref<Record<string, unknown> | null>(null);
const showToolResult = ref(false);
const streamError = ref<string | null>(null);
const showConversationsDialog = ref(false);
const conversations = ref<ConversationMetadata[]>([]);
const isLoadingConversations = ref(false);
const copiedMessageId = ref<string | null>(null);
const showMCPToolManager = ref(false);
const activeStreamConversationId = ref<string | undefined>(undefined);
const streamChunkHandler = ref<((chunk: ChatStreamChunk) => void) | null>(null);
const streamCompleteHandler = ref<(() => void) | null>(null);

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
 * Watch for conversationId changes to reload history
 */
watch(conversationId, (newId, oldId) => {
  if (newId && newId !== oldId && newId !== 'pending') {
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
      messages.value = response.data.messages;
      
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
 * Send a message to the AI
 */
async function handleSendMessage() {
  if (!inputMessage.value.trim() || isLoading.value) return;

  const userMessageContent = inputMessage.value.trim();
  inputMessage.value = '';
  isLoading.value = true;
  isTyping.value = true;
  streamError.value = null;

  // Track the conversation ID for this stream
  const streamConversationId = conversationId.value || 'pending';
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
        // Validate that this chunk belongs to the current active conversation
        // Ignore chunks from old conversations that are still streaming
        
        // If no active stream is expected, ignore all chunks
        if (!activeStreamConversationId.value) {
          console.log('Ignoring chunk: no active stream expected');
          return;
        }
        
        const chunkConvId = chunk.conversationId;
        const activeConvId = activeStreamConversationId.value;
        
        // If chunk has a conversationId, it must match the active stream
        if (chunkConvId) {
          // Allow matching if:
          // 1. Exact match
          // 2. Both are 'pending' (initial stream setup)
          // 3. Chunk is 'pending' and active is the actual ID (transition period)
          if (chunkConvId !== activeConvId && 
              !(chunkConvId === 'pending' && activeConvId === 'pending') &&
              !(chunkConvId === 'pending' && activeConvId !== 'pending')) {
            console.log('Ignoring chunk from different conversation:', {
              chunkConvId,
              activeConvId,
              eventType: chunk.eventType
            });
            return;
          }
        } else {
          // Chunk without conversationId - only accept if active stream is 'pending'
          // (legacy chunks or initial stream setup)
          if (activeConvId !== 'pending') {
            console.log('Ignoring chunk without conversationId when active stream has ID:', {
              activeConvId,
              eventType: chunk.eventType
            });
            return;
          }
        }
        
        // Handle different event types
        const eventType = chunk.eventType;
        console.log('chunk', chunk);
        switch (eventType) {
          case 'token':
            console.log('token', chunk);
            console.log('messages.value', messages.value);
            // Hide typing indicator once content starts arriving
            // isTyping.value = false;
            
            // Append token content and display immediately
            assistantContent += chunk.content;
            
            // Find and update the assistant message
            let lastIndex = messages.value.length - 1;
            // console.log('lastIndex', lastIndex);
            // console.log('messages.value[lastIndex].role', messages.value[lastIndex].role);
            // console.log('messages.value[lastIndex].id', messages.value[lastIndex].id);
            // If the last message is 'user', push a new empty assistant message and reset lastIndex
            if (messages.value[lastIndex].role === 'user') {
              const newAssistantMessageId = `assistant-${Date.now()}`;
              const newAssistantMessage: ChatMessage = {
                id: newAssistantMessageId,
                role: 'assistant',
                content: '',
                timestamp: new Date(),
                conversationId: conversationId.value || 'pending'
              };
              messages.value.push(newAssistantMessage);
              lastIndex = messages.value.length - 1;
            }
            // console.log('messages.value[lastIndex].role', messages.value[lastIndex].role);
            // console.log('messages.value[lastIndex].id', messages.value[lastIndex].id);
            // console.log('assistantMessageId', assistantMessageId);
            if ( 
                messages.value[lastIndex].role === 'assistant') {
              // Replace the entire message object to trigger Vue reactivity
              // console.log('replay message')
              messages.value[lastIndex] = {
                ...messages.value[lastIndex],
                content: assistantContent
              };
            }
            
            nextTick(() => {
              scrollToBottom();
            });
            break;

          case 'tool_call':
            console.log('tool_call', chunk);
            // Show tool execution indicator
            isExecutingTool.value = true;
            currentToolName.value = chunk.toolName || 'Unknown Tool';
            currentToolParams.value = chunk.toolParams || {};
            isTyping.value = false; // Pause typing indicator during tool execution
            break;

          case 'tool_result':
            console.log('tool_result', chunk);
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
              
              // Update active stream conversation ID if it was 'pending'
              if (activeStreamConversationId.value === 'pending') {
                activeStreamConversationId.value = chunk.conversationId;
              }
              
              // Update conversationId for all messages with 'pending' conversationId
              messages.value.forEach(msg => {
                if (msg.conversationId === 'pending') {
                  msg.conversationId = chunk.conversationId!;
                }
              });
            // Push an empty assistant message as the last message at conversation start
            // messages.value.push({
            //   id: 'assistant_' + Date.now(),
            //   role: 'assistant',
            //   content: '',
            //   timestamp: new Date(),
            //   conversationId: chunk.conversationId || 'pending'
            // });
            }
            break;

          case 'conversation_end':
            console.log('conversation_end', chunk);
            // Conversation ended - check if last assistant message is empty and remove it if so
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

          default:
            // Handle unknown or unspecified event types as tokens
            console.log('default', chunk);
            if (chunk.content) {
              isTyping.value = false;
              
              assistantContent += chunk.content;
              
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
      () => {
        // Stream complete - only handle cleanup, content is already updated
        // No need to update content again since we've been updating it as tokens arrived
        
        // Only reset states if this is still the active stream
        if (activeStreamConversationId.value === streamConversationId) {
          // Reset all states
          isTyping.value = false;
          isLoading.value = false;
          isExecutingTool.value = false;
          // showToolResult.value = false;
          scrollToBottom();
        }
        
        // Clear active stream tracking if this was the active stream
        if (activeStreamConversationId.value === streamConversationId) {
          activeStreamConversationId.value = undefined;
        }
      },
      streamConversationId,
      undefined, // model
      useRAGContext.value, // useRAG flag
      5 // ragLimit
    );
  } catch (error) {
    console.error('Error sending message:', error);
    
    // Only show error if this is still the active stream
    if (activeStreamConversationId.value === streamConversationId) {
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
    
    // Clear active stream tracking
    if (activeStreamConversationId.value === streamConversationId) {
      activeStreamConversationId.value = undefined;
    }
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
  
  // Reset tool-related states
  isExecutingTool.value = false;
  currentToolName.value = '';
  currentToolParams.value = {};
  toolResult.value = null;
  showToolResult.value = false;
  
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
</style>

