<template>
  <div class="knowledge-library">
    <!-- Header -->
    <div class="knowledge-header">
      <h1 class="knowledge-title">
        <v-icon class="mr-2">mdi-book-open-variant</v-icon>
        {{ $t('route.knowledge_library') }}
      </h1>
      <div class="knowledge-actions">
        <v-btn
          color="primary"
          prepend-icon="mdi-upload"
          @click="showUploadDialog = true"
        >
          {{ $t('knowledge.upload_document') }}
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
          {{ $t('knowledge.documents') }}
        </v-tab>

        <!-- Search Tab -->
        <v-tab value="search">
          <v-icon class="mr-2">mdi-magnify</v-icon>
          {{ $t('route.search') }}
        </v-tab>

        <!-- Chat Tab -->
        <v-tab value="chat">
          <v-icon class="mr-2">mdi-chat</v-icon>
          {{ $t('knowledge.chat') }}
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

        </v-window>
      </v-card-text>
    </v-card>

    <!-- Upload Dialog -->
    <v-dialog v-model="showUploadDialog" max-width="700px" persistent>
      <v-card>
        <v-card-title class="text-h5">
          {{ $t('knowledge.upload_document') }}
        </v-card-title>
        
        <v-card-text>
          <!-- Drag and Drop Area -->
          <div
            class="upload-drop-zone"
            :class="{ 'drag-over': isDragOver, 'has-files': uploadFiles.length > 0 }"
            @drop="onFileDrop"
            @dragover.prevent="onDragOver"
            @dragenter.prevent="onDragEnter"
            @dragleave.prevent="onDragLeave"
            @click="triggerFileInput"
          >
            <div class="drop-zone-content">
              <v-icon 
                size="48" 
                :color="isDragOver ? 'primary' : 'grey'"
                class="mb-3"
              >
                mdi-cloud-upload
              </v-icon>
              
              <div class="text-h6 mb-2">
                {{ isDragOver ? $t('knowledge.drop_files_here') : $t('knowledge.drag_drop_files') }}
              </div>
              
              <div class="text-body-2 text-grey">
                {{ $t('knowledge.supported_formats') }}
              </div>
              
              <v-btn
                color="primary"
                variant="outlined"
                class="mt-3"
                @click.stop="triggerFileInput"
              >
                {{ $t('knowledge.browse_files') }}
              </v-btn>
            </div>
          </div>

          <!-- Hidden file input -->
          <input
            ref="fileInput"
            type="file"
            multiple
            accept=".pdf,.txt,.doc,.docx,.md"
            style="display: none"
            @change="onFileSelect"
          />
          
          <!-- Selected Files List -->
          <div v-if="uploadFiles.length > 0" class="selected-files mt-4">
            <div class="text-subtitle-1 mb-2">
              {{ $t('knowledge.selected_files') }} ({{ uploadFiles.length }})
            </div>
            <v-list density="compact">
              <v-list-item
                v-for="(file, index) in uploadFiles"
                :key="index"
                class="file-item"
              >
                <template v-slot:prepend>
                  <v-icon color="primary">mdi-file-document</v-icon>
                </template>
                
                <v-list-item-title>{{ file.name }}</v-list-item-title>
                <v-list-item-subtitle>{{ formatFileSize(file.size) }}</v-list-item-subtitle>
                
                <template v-slot:append>
                  <v-btn
                    icon="mdi-close"
                    size="small"
                    variant="text"
                    @click="removeFile(index)"
                  />
                </template>
              </v-list-item>
            </v-list>
          </div>
          
          <v-alert
            v-if="uploadError"
            type="error"
            class="mt-3"
            dismissible
            @input="uploadError = ''"
          >
            {{ uploadError }}
          </v-alert>
        </v-card-text>
        
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            color="grey"
            text
            @click="cancelUpload"
          >
            {{ $t('common.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            @click="confirmUpload"
            :loading="uploading"
            :disabled="!uploadFiles || uploadFiles.length === 0"
          >
            {{ $t('knowledge.upload') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>


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
import { useI18n } from 'vue-i18n';
import DocumentManagement from '@/views/pages/knowledge/DocumentManagement.vue';
import SearchInterface from '@/views/pages/knowledge/SearchInterface.vue';
import ChatInterface from '@/views/pages/knowledge/ChatInterface.vue';
import { initializeRAG, getRAGStats } from '@/views/api/rag';

// i18n setup
const { t } = useI18n();

// Reactive data
const activeTab = ref('documents');
const showUploadDialog = ref(false);
const isLoading = ref(false);
const loadingMessage = ref('');
const loadingSubMessage = ref('');
const statusMessage = ref('');
const statusType = ref<'success' | 'error' | 'warning' | 'info'>('info');

// Upload dialog data
const uploadFiles = ref<File[]>([]);
const uploading = ref(false);
const uploadError = ref('');
const isDragOver = ref(false);
const fileInput = ref<HTMLInputElement>();

// Component refs
const documentManagement = ref();
const searchInterface = ref();
const chatInterface = ref();

// Lifecycle hooks
onMounted(async () => {
  await initializeRAGSystem();
});

onUnmounted(() => {
  // Cleanup if needed
});

// Methods
async function initializeRAGSystem() {
  try {
    setLoading(true, t('knowledge.initializing_rag_system'), t('knowledge.setting_up_knowledge_library'));
    
    // Check if RAG is already initialized
    const response = await getRAGStats();
    console.log(response)
    // if (!response.success) {
    //   // Initialize with default configuration
    //   //await initializeWithDefaultConfig();
    // }
    
    setLoading(false);
    //showStatus(t('knowledge.rag_system_initialized_successfully'), 'success');
  } catch (error) {
    console.error('Failed to initialize RAG system:', error);
    setLoading(false);
    showStatus(`${t('knowledge.failed_to_initialize_rag_system')}: ${error}`, 'error');
  }
}

// async function initializeWithDefaultConfig() {
//   const embeddingConfig = {
//     provider: 'openai',
//     model: 'text-embedding-ada-002',
//     apiKey: process.env.OPENAI_API_KEY || '',
//   };

//   const llmConfig = {
//     model: 'gpt-3.5-turbo',
//     apiKey: process.env.OPENAI_API_KEY || '',
//   };

//   const response = await initializeRAG({
//     embedding: embeddingConfig,
//     llm: llmConfig,
//   });

//   if (!response.success) {
//     throw new Error(response.message);
//   }
// }

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
  showStatus(t('knowledge.document_uploaded_successfully', { name: document.name }), 'success');
  // Refresh document management if needed
  if (documentManagement.value) {
    documentManagement.value.refreshDocuments();
  }
}

function handleDocumentDeleted(documentId: number) {
  showStatus(t('knowledge.document_deleted_successfully'), 'success');
  // Refresh document management if needed
  if (documentManagement.value) {
    documentManagement.value.refreshDocuments();
  }
}

function handleSearchCompleted(results: any) {
  showStatus(t('knowledge.found_results', { count: results.totalResults }), 'success');
}

function handleMessageSent(message: any) {
  // Handle message sent event if needed
}

function handleUploadSuccess(document: any) {
  showUploadDialog.value = false;
  showStatus(t('knowledge.document_uploaded_successfully', { name: document.name }), 'success');
  // Refresh document management
  if (documentManagement.value) {
    documentManagement.value.refreshDocuments();
  }
}

function handleUploadError(error: string) {
  showStatus(`${t('knowledge.upload_failed')}: ${error}`, 'error');
}


function handleError(error: string) {
  showStatus(`${t('knowledge.error')}: ${error}`, 'error');
}

// Upload dialog methods
function onFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files) {
    uploadFiles.value = Array.from(target.files);
    uploadError.value = '';
  }
}

function triggerFileInput() {
  fileInput.value?.click();
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = true;
}

function onDragEnter(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = true;
}

function onDragLeave(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = false;
}

function onFileDrop(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = false;
  
  if (event.dataTransfer?.files) {
    const files = Array.from(event.dataTransfer.files);
    uploadFiles.value = files;
    uploadError.value = '';
  }
}

function removeFile(index: number) {
  uploadFiles.value.splice(index, 1);
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function cancelUpload() {
  showUploadDialog.value = false;
  uploadFiles.value = [];
  uploadError.value = '';
  uploading.value = false;
  isDragOver.value = false;
}

async function confirmUpload() {
  if (!uploadFiles.value || uploadFiles.value.length === 0) {
    uploadError.value = t('knowledge.no_files_selected');
    return;
  }

  uploading.value = true;
  uploadError.value = '';

  try {
    // TODO: Implement actual file upload logic
    // For now, simulate upload
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Simulate successful upload
    const uploadedDocument = {
      name: uploadFiles.value[0].name,
      size: uploadFiles.value[0].size
    };
    
    handleUploadSuccess(uploadedDocument);
    cancelUpload();
  } catch (error) {
    uploadError.value = t('knowledge.upload_failed');
    console.error('Upload error:', error);
  } finally {
    uploading.value = false;
  }
}

// Expose methods for parent components
defineExpose({
  refreshData: () => {
    if (documentManagement.value) documentManagement.value.refreshDocuments();
  },
  switchToTab: (tab: string) => {
    activeTab.value = tab;
  },
  uploadDocument: () => {
    showUploadDialog.value = true;
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

/* Upload Dialog Styles */
.upload-drop-zone {
  border: 2px dashed #e0e0e0;
  border-radius: 12px;
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background-color: #fafafa;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-drop-zone:hover {
  border-color: #1976d2;
  background-color: #f5f5f5;
}

.upload-drop-zone.drag-over {
  border-color: #1976d2;
  background-color: #e3f2fd;
  transform: scale(1.02);
}

.upload-drop-zone.has-files {
  border-color: #4caf50;
  background-color: #f1f8e9;
}

.drop-zone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.selected-files {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  background-color: #f9f9f9;
}

.file-item {
  border-bottom: 1px solid #e0e0e0;
}

.file-item:last-child {
  border-bottom: none;
}
</style>
