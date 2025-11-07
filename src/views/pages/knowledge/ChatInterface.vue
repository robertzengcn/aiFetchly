<template>
  <div class="chat-interface">
    <div class="header">
      <h2>Chat with Knowledge Base</h2>
      <div class="header-actions">
        <v-btn
          icon
          @click="clearChat"
          :disabled="messages.length === 0"
        >
          <v-icon>mdi-delete-sweep</v-icon>
        </v-btn>
        <v-btn
          icon
          @click="exportChat"
          :disabled="messages.length === 0"
        >
          <v-icon>mdi-download</v-icon>
        </v-btn>
      </div>
    </div>

    <!-- Chat Messages -->
    <div class="chat-container" ref="chatContainer">
      <div class="messages">
        <div
          v-for="(message, index) in messages"
          :key="index"
          :class="['message', message.type]"
        >
          <div class="message-avatar">
            <v-avatar
              :color="message.type === 'user' ? 'primary' : 'secondary'"
              size="32"
            >
              <v-icon v-if="message.type === 'user'">mdi-account</v-icon>
              <v-icon v-else>mdi-robot</v-icon>
            </v-avatar>
          </div>
          <div class="message-content">
            <div class="message-header">
              <span class="message-sender">
                {{ message.type === 'user' ? 'You' : 'AI Assistant' }}
              </span>
              <span class="message-time">
                {{ formatTime(message.timestamp) }}
              </span>
            </div>
            <div class="message-text" v-html="formatMessage(message.content)"></div>
            
            <!-- Sources for AI messages -->
            <div v-if="message.sources && message.sources.length > 0" class="message-sources">
              <v-expansion-panels>
                <v-expansion-panel>
                  <v-expansion-panel-header>
                    <v-icon left>mdi-source-branch</v-icon>
                    Sources ({{ message.sources.length }})
                  </v-expansion-panel-header>
                  <v-expansion-panel-content>
                    <div
                      v-for="(source, sourceIndex) in message.sources"
                      :key="sourceIndex"
                      class="source-item"
                    >
                      <div class="source-header">
                        <strong>{{ source.documentName }}</strong>
                        <v-chip
                          :color="getRelevanceColor(source.relevanceScore)"
                          small
                        >
                          {{ Math.round(source.relevanceScore * 100) }}% match
                        </v-chip>
                      </div>
                      <div class="source-content">{{ source.content }}</div>
                      <div class="source-actions">
                        <v-btn
                          text
                          small
                          @click="viewSource(source)"
                        >
                          <v-icon left small>mdi-eye</v-icon>
                          View Document
                        </v-btn>
                        <v-btn
                          text
                          small
                          @click="copySource(source.content)"
                        >
                          <v-icon left small>mdi-content-copy</v-icon>
                          Copy
                        </v-btn>
                      </div>
                    </div>
                  </v-expansion-panel-content>
                </v-expansion-panel>
              </v-expansion-panels>
            </div>

            <!-- Message Actions -->
            <div class="message-actions">
              <v-btn
                v-if="message.type === 'ai'"
                text
                small
                @click="copyMessage(message.content)"
              >
                <v-icon left small>mdi-content-copy</v-icon>
                Copy
              </v-btn>
              <v-btn
                v-if="message.type === 'ai'"
                text
                small
                @click="regenerateResponse(index)"
                :loading="regenerating === index"
              >
                <v-icon left small>mdi-refresh</v-icon>
                Regenerate
              </v-btn>
              <v-btn
                text
                small
                @click="likeMessage(index)"
                :color="message.liked ? 'primary' : ''"
              >
                <v-icon left small>{{ message.liked ? 'mdi-thumb-up' : 'mdi-thumb-up-outline' }}</v-icon>
                {{ message.likes || 0 }}
              </v-btn>
            </div>
          </div>
        </div>

        <!-- Typing Indicator -->
        <div v-if="isTyping" class="message ai">
          <div class="message-avatar">
            <v-avatar color="secondary" size="32">
              <v-icon>mdi-robot</v-icon>
            </v-avatar>
          </div>
          <div class="message-content">
            <div class="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Chat Input -->
    <div class="chat-input-container">
      <div class="input-wrapper">
        <v-textarea
          v-model="inputMessage"
          placeholder="Ask a question about your knowledge base..."
          rows="1"
          auto-grow
          @keydown.enter.exact.prevent="sendMessage"
          @keydown.enter.shift.exact="inputMessage += '\n'"
          :disabled="isTyping"
          class="message-input"
        />
        <div class="input-actions">
          <v-btn
            icon
            @click="attachDocument"
            :disabled="isTyping"
          >
            <v-icon>mdi-paperclip</v-icon>
          </v-btn>
          <v-btn
            icon
            @click="sendMessage"
            :disabled="!inputMessage.trim() || isTyping"
            :loading="isTyping"
            color="primary"
          >
            <v-icon>mdi-send</v-icon>
          </v-btn>
        </div>
      </div>
      
      <!-- Quick Actions -->
      <div class="quick-actions">
        <v-chip
          v-for="suggestion in quickSuggestions"
          :key="suggestion"
          @click="selectSuggestion(suggestion)"
          class="suggestion-chip"
        >
          {{ suggestion }}
        </v-chip>
      </div>
    </div>

    <!-- Settings Dialog -->
    <v-dialog v-model="showSettings" max-width="500">
      <v-card>
        <v-card-title>Chat Settings</v-card-title>
        <v-card-text>
          <v-select
            v-model="settings.model"
            :items="modelOptions"
            label="AI Model"
          />
          <v-slider
            v-model="settings.temperature"
            label="Creativity"
            min="0"
            max="1"
            step="0.1"
            thumb-label
          />
          <v-text-field
            v-model="settings.maxTokens"
            label="Max Response Length"
            type="number"
            min="100"
            max="4000"
          />
          <v-switch
            v-model="settings.includeSources"
            label="Include Sources in Responses"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showSettings = false">Cancel</v-btn>
          <v-btn color="primary" @click="saveSettings">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { defineComponent, ref, onMounted, nextTick, watch } from 'vue';

export default defineComponent({
  name: 'ChatInterface',
  setup() {
    const messages = ref([]);
    const inputMessage = ref('');
    const isTyping = ref(false);
    const regenerating = ref(null);
    const chatContainer = ref(null);
    const showSettings = ref(false);

    const settings = ref({
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 1000,
      includeSources: true
    });

    const modelOptions = [
      { text: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
      { text: 'GPT-4', value: 'gpt-4' },
      { text: 'Claude 3', value: 'claude-3' }
    ];

    const quickSuggestions = ref([
      'What is the main topic of the uploaded documents?',
      'Can you summarize the key points?',
      'What are the latest updates mentioned?',
      'How does this relate to AI and machine learning?'
    ]);

    const sendMessage = async () => {
      if (!inputMessage.value.trim() || isTyping.value) return;

      const userMessage = {
        type: 'user',
        content: inputMessage.value.trim(),
        timestamp: new Date(),
        liked: false,
        likes: 0
      };

      messages.value.push(userMessage);
      const currentInput = inputMessage.value;
      inputMessage.value = '';

      await nextTick();
      scrollToBottom();

      // Simulate AI response
      isTyping.value = true;
      await new Promise(resolve => setTimeout(resolve, 2000));

      const aiMessage = {
        type: 'ai',
        content: `I understand you're asking about "${currentInput}". Based on the knowledge base, here's what I found: This is a mock response that would normally be generated by the RAG system. The actual implementation would search through your documents and provide relevant information based on the context.`,
        timestamp: new Date(),
        sources: [
          {
            documentName: 'AI Research Paper',
            content: 'Relevant content from the document...',
            relevanceScore: 0.95,
            documentId: 1,
            chunkId: 1
          },
          {
            documentName: 'Technical Documentation',
            content: 'Additional relevant information...',
            relevanceScore: 0.87,
            documentId: 2,
            chunkId: 3
          }
        ],
        liked: false,
        likes: 0
      };

      messages.value.push(aiMessage);
      isTyping.value = false;

      await nextTick();
      scrollToBottom();
    };

    const selectSuggestion = (suggestion) => {
      inputMessage.value = suggestion;
    };

    const regenerateResponse = async (messageIndex) => {
      regenerating.value = messageIndex;
      
      // Simulate regeneration
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      messages.value[messageIndex].content = `This is a regenerated response for: "${messages.value[messageIndex - 1].content}". The RAG system would provide a different perspective or more detailed information based on the same query.`;
      
      regenerating.value = null;
    };

    const likeMessage = (messageIndex) => {
      const message = messages.value[messageIndex];
      if (message.liked) {
        message.liked = false;
        message.likes = Math.max(0, message.likes - 1);
      } else {
        message.liked = true;
        message.likes = (message.likes || 0) + 1;
      }
    };

    const copyMessage = async (content) => {
      try {
        await navigator.clipboard.writeText(content);
        console.log('Message copied to clipboard');
      } catch (error) {
        console.error('Failed to copy message:', error);
      }
    };

    const copySource = async (content) => {
      try {
        await navigator.clipboard.writeText(content);
        console.log('Source copied to clipboard');
      } catch (error) {
        console.error('Failed to copy source:', error);
      }
    };

    const viewSource = (source) => {
      console.log('Viewing source:', source);
      // Navigate to document view
    };

    const clearChat = () => {
      if (confirm('Are you sure you want to clear the chat history?')) {
        messages.value = [];
      }
    };

    const exportChat = () => {
      const chatData = {
        timestamp: new Date().toISOString(),
        messages: messages.value.map(msg => ({
          type: msg.type,
          content: msg.content,
          timestamp: msg.timestamp,
          sources: msg.sources || []
        }))
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const attachDocument = () => {
      console.log('Attach document functionality');
      // Implement document attachment
    };

    const saveSettings = () => {
      console.log('Saving settings:', settings.value);
      showSettings.value = false;
    };

    const scrollToBottom = () => {
      if (chatContainer.value) {
        chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
      }
    };

    const formatTime = (timestamp) => {
      return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatMessage = (content) => {
      // Simple markdown-like formatting
      return content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    };

    const getRelevanceColor = (score) => {
      if (score >= 0.8) return 'green';
      if (score >= 0.6) return 'orange';
      return 'red';
    };

    // Load chat history from localStorage
    onMounted(() => {
      const savedMessages = localStorage.getItem('chatHistory');
      if (savedMessages) {
        try {
          messages.value = JSON.parse(savedMessages);
        } catch (error) {
          console.error('Failed to load chat history:', error);
        }
      }
    });

    // Save chat history to localStorage
    watch(messages, (newMessages) => {
      localStorage.setItem('chatHistory', JSON.stringify(newMessages));
    }, { deep: true });

    return {
      messages,
      inputMessage,
      isTyping,
      regenerating,
      chatContainer,
      showSettings,
      settings,
      modelOptions,
      quickSuggestions,
      sendMessage,
      selectSuggestion,
      regenerateResponse,
      likeMessage,
      copyMessage,
      copySource,
      viewSource,
      clearChat,
      exportChat,
      attachDocument,
      saveSettings,
      formatTime,
      formatMessage,
      getRelevanceColor
    };
  }
});
</script>

<style scoped>
.chat-interface {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #e0e0e0;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.chat-container {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background-color: #fafafa;
}

.messages {
  padding: 20px;
}

.message {
  display: flex;
  margin-bottom: 20px;
  align-items: flex-start;
}

.message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  margin: 0 12px;
  flex-shrink: 0;
}

.message-content {
  flex: 1;
  max-width: 70%;
}

.message.user .message-content {
  text-align: right;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.message-sender {
  font-weight: 600;
  color: #333;
}

.message-time {
  font-size: 0.8rem;
  color: #666;
}

.message-text {
  background-color: white;
  padding: 12px 16px;
  border-radius: 18px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  line-height: 1.4;
}

.message.user .message-text {
  background-color: #1976d2;
  color: white;
}

.message-sources {
  margin-top: 12px;
}

.source-item {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
  background-color: white;
}

.source-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.source-content {
  color: #666;
  font-size: 0.9rem;
  margin-bottom: 8px;
  max-height: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-actions {
  display: flex;
  gap: 8px;
}

.message-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.typing-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #666;
  animation: typing 1.4s infinite ease-in-out;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
  }
  30% {
    transform: translateY(-10px);
  }
}

.chat-input-container {
  border-top: 1px solid #e0e0e0;
  padding-top: 20px;
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-bottom: 12px;
}

.message-input {
  flex: 1;
}

.input-actions {
  display: flex;
  gap: 8px;
}

.quick-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.suggestion-chip {
  cursor: pointer;
}

.suggestion-chip:hover {
  background-color: #e3f2fd;
}
</style>
