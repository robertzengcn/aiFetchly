<template>
  <div class="knowledge-library">
    <!-- Header -->
    <div class="knowledge-header">
      <h1 class="knowledge-title">
        <v-icon class="mr-2">mdi-book-open-variant</v-icon>
        Knowledge Library
      </h1>
      <div class="knowledge-actions">
        <v-btn
          color="primary"
          prepend-icon="mdi-upload"
          @click="showUploadDialog = true"
        >
          Upload Document
        </v-btn>
        <v-btn
          color="secondary"
          prepend-icon="mdi-cog"
          @click="showSettingsDialog = true"
        >
          Settings
        </v-btn>
      </div>
    </div>

    <!-- Status Bar -->
    <v-alert
      v-if="statusMessage"
      :type="statusType"
      class="mb-4"
      dismissible
      @input="statusMessage = ''"
    >
      {{ statusMessage }}
    </v-alert>

    <!-- Main Content -->
    <v-card class="knowledge-content">
      <v-tabs
        v-model="activeTab"
        class="knowledge-tabs"
        color="primary"
      >
        <!-- Documents Tab -->
        <v-tab value="documents">
          <v-icon class="mr-2">mdi-file-document-multiple</v-icon>
          Documents
        </v-tab>

        <!-- Search Tab -->
        <v-tab value="search">
          <v-icon class="mr-2">mdi-magnify</v-icon>
          Search
        </v-tab>

        <!-- Chat Tab -->
        <v-tab value="chat">
          <v-icon class="mr-2">mdi-chat</v-icon>
          Chat
        </v-tab>

        <!-- Analytics Tab -->
        <v-tab value="analytics">
          <v-icon class="mr-2">mdi-chart-line</v-icon>
          Analytics
        </v-tab>
      </v-tabs>

      <v-card-text class="pa-0">
        <v-window v-model="activeTab">
          <!-- Documents Window -->
          <v-window-item value="documents">
            <DocumentManagement
              ref="documentManagement"
              @document-uploaded="handleDocumentUploaded"
              @document-deleted="handleDocumentDeleted"
              @error="handleError"
            />
          </v-window-item>

          <!-- Search Window -->
          <v-window-item value="search">
            <SearchInterface
              ref="searchInterface"
              @search-completed="handleSearchCompleted"
              @error="handleError"
            />
          </v-window-item>

          <!-- Chat Window -->
          <v-window-item value="chat">
            <ChatInterface
              ref="chatInterface"
              @message-sent="handleMessageSent"
              @error="handleError"
            />
          </v-window-item>

          <!-- Analytics Window -->
          <v-window-item value="analytics">
            <AnalyticsDashboard
              ref="analyticsDashboard"
              @error="handleError"
            />
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>

    <!-- Upload Dialog -->
    <DocumentUploadDialog
      v-model="showUploadDialog"
      @upload-success="handleUploadSuccess"
      @upload-error="handleUploadError"
    />

    <!-- Settings Dialog -->
    <SettingsDialog
      v-model="showSettingsDialog"
      @settings-saved="handleSettingsSaved"
      @error="handleError"
    />

    <!-- Loading Overlay -->
    <v-overlay
      v-model="isLoading"
      class="align-center justify-center"
    >
      <v-progress-circular
        color="primary"
        indeterminate
        size="64"
      />
      <div class="mt-4 text-center">
        <div class="text-h6">{{ loadingMessage }}</div>
        <div class="text-caption">{{ loadingSubMessage }}</div>
      </div>
    </v-overlay>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import DocumentManagement from '@/components/rag/DocumentManagement.vue';
import SearchInterface from '@/components/rag/SearchInterface.vue';
import ChatInterface from '@/components/rag/ChatInterface.vue';
import AnalyticsDashboard from '@/components/rag/AnalyticsDashboard.vue';
import DocumentUploadDialog from '@/components/rag/DocumentUploadDialog.vue';
import SettingsDialog from '@/components/rag/SettingsDialog.vue';

// Reactive data
const activeTab = ref('documents');
const showUploadDialog = ref(false);
const showSettingsDialog = ref(false);
const isLoading = ref(false);
const loadingMessage = ref('');
const loadingSubMessage = ref('');
const statusMessage = ref('');
const statusType = ref<'success' | 'error' | 'warning' | 'info'>('info');

// Component refs
const documentManagement = ref();
const searchInterface = ref();
const chatInterface = ref();
const analyticsDashboard = ref();

// Lifecycle hooks
onMounted(async () => {
  await initializeRAG();
});

onUnmounted(() => {
  // Cleanup if needed
});

// Methods
async function initializeRAG() {
  try {
    setLoading(true, 'Initializing RAG System', 'Setting up knowledge library...');
    
    // Check if RAG is already initialized
    const response = await window.electronAPI.invoke('rag:get-stats');
    
    if (!response.success) {
      // Initialize with default configuration
      await initializeWithDefaultConfig();
    }
    
    setLoading(false);
    showStatus('RAG system initialized successfully', 'success');
  } catch (error) {
    setLoading(false);
    showStatus(`Failed to initialize RAG system: ${error}`, 'error');
  }
}

async function initializeWithDefaultConfig() {
  const embeddingConfig = {
    provider: 'openai',
    model: 'text-embedding-ada-002',
    apiKey: process.env.OPENAI_API_KEY || '',
  };

  const llmConfig = {
    model: 'gpt-3.5-turbo',
    apiKey: process.env.OPENAI_API_KEY || '',
  };

  const response = await window.electronAPI.invoke('rag:initialize', {
    embedding: embeddingConfig,
    llm: llmConfig,
  });

  if (!response.success) {
    throw new Error(response.message);
  }
}

function setLoading(loading: boolean, message = '', subMessage = '') {
  isLoading.value = loading;
  loadingMessage.value = message;
  loadingSubMessage.value = subMessage;
}

function showStatus(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') {
  statusMessage.value = message;
  statusType.value = type;
  
  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusMessage.value = '';
    }, 3000);
  }
}

// Event handlers
function handleDocumentUploaded(document: any) {
  showStatus(`Document "${document.name}" uploaded successfully`, 'success');
  // Refresh document management if needed
  if (documentManagement.value) {
    documentManagement.value.refreshDocuments();
  }
}

function handleDocumentDeleted(documentId: number) {
  showStatus('Document deleted successfully', 'success');
  // Refresh document management if needed
  if (documentManagement.value) {
    documentManagement.value.refreshDocuments();
  }
}

function handleSearchCompleted(results: any) {
  showStatus(`Found ${results.totalResults} results`, 'success');
}

function handleMessageSent(message: any) {
  // Handle message sent event if needed
}

function handleUploadSuccess(document: any) {
  showUploadDialog.value = false;
  showStatus(`Document "${document.name}" uploaded successfully`, 'success');
  // Refresh document management
  if (documentManagement.value) {
    documentManagement.value.refreshDocuments();
  }
}

function handleUploadError(error: string) {
  showStatus(`Upload failed: ${error}`, 'error');
}

function handleSettingsSaved(settings: any) {
  showSettingsDialog.value = false;
  showStatus('Settings saved successfully', 'success');
  // Reinitialize RAG with new settings if needed
  initializeRAG();
}

function handleError(error: string) {
  showStatus(`Error: ${error}`, 'error');
}

// Expose methods for parent components
defineExpose({
  refreshData: () => {
    if (documentManagement.value) documentManagement.value.refreshDocuments();
    if (analyticsDashboard.value) analyticsDashboard.value.refreshAnalytics();
  },
  switchToTab: (tab: string) => {
    activeTab.value = tab;
  },
  uploadDocument: () => {
    showUploadDialog.value = true;
  },
  openSettings: () => {
    showSettingsDialog.value = true;
  }
});
</script>

<style scoped>
.knowledge-library {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
}

.knowledge-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: white;
  border-bottom: 1px solid #e0e0e0;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.knowledge-title {
  display: flex;
  align-items: center;
  margin: 0;
  color: #1976d2;
  font-size: 1.5rem;
  font-weight: 500;
}

.knowledge-actions {
  display: flex;
  gap: 12px;
}

.knowledge-content {
  flex: 1;
  margin: 16px;
  overflow: hidden;
}

.knowledge-tabs {
  border-bottom: 1px solid #e0e0e0;
}

.knowledge-tabs .v-tab {
  text-transform: none;
  font-weight: 500;
}

.knowledge-tabs .v-tab--selected {
  color: #1976d2;
}

/* Responsive design */
@media (max-width: 768px) {
  .knowledge-header {
    flex-direction: column;
    gap: 16px;
    align-items: stretch;
  }

  .knowledge-actions {
    justify-content: center;
  }

  .knowledge-content {
    margin: 8px;
  }
}

/* Loading overlay styles */
.v-overlay {
  background-color: rgba(0, 0, 0, 0.7);
}

/* Status alert styles */
.v-alert {
  margin: 16px;
  border-radius: 8px;
}

/* Tab content styles */
.v-window-item {
  height: calc(100vh - 200px);
  overflow-y: auto;
}

/* Custom scrollbar */
.v-window-item::-webkit-scrollbar {
  width: 8px;
}

.v-window-item::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.v-window-item::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 4px;
}

.v-window-item::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
