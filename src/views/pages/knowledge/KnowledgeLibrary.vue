<template>
  <div class="knowledge-library">
    <!-- Header -->
    <div class="knowledge-header">
      <h1 class="knowledge-title">
        <v-icon class="mr-2">mdi-book-open-variant</v-icon>
        {{ t('route.knowledge_library') }}
      </h1>
      <div class="knowledge-actions">
        <v-btn
          color="primary"
          prepend-icon="mdi-upload"
          @click="showUploadDialog = true"
        >
          {{ t('knowledge.upload_document') }}
        </v-btn>
        <v-btn
          color="info"
          prepend-icon="mdi-cog"
          @click="openSettingsDialog"
        >
          {{ t('knowledge.settings') }}
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
          {{ t('knowledge.documents') }}
        </v-tab>

        <!-- Search Tab -->
        <v-tab value="search">
          <v-icon class="mr-2">mdi-magnify</v-icon>
          {{ t('route.search') }}
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


        </v-window>
      </v-card-text>
    </v-card>

    <!-- Upload Dialog -->
    <v-dialog v-model="showUploadDialog" max-width="700px" persistent>
      <v-card>
        <v-card-title class="text-h5">
          {{ t('knowledge.upload_document') }}
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
                {{ isDragOver ? t('knowledge.drop_files_here') : t('knowledge.drag_drop_files') }}
              </div>
              
              <div class="text-body-2 text-grey">
                PDF, TXT, DOC, DOCX, MD, HTML files supported
              </div>
              
              <v-btn
                color="primary"
                variant="outlined"
                class="mt-3 mr-2"
                @click.stop="triggerFileInput"
              >
                {{ t('knowledge.browse_files') }}
              </v-btn>
              
              <v-btn
                color="secondary"
                variant="outlined"
                class="mt-3"
                @click.stop="selectFilesNative"
              >
                Native Dialog
              </v-btn>
            </div>
          </div>

          <!-- Hidden file input -->
          <input
            ref="fileInput"
            type="file"
            multiple
            accept=".pdf,.txt,.doc,.docx,.md,.html,.htm"
            style="display: none"
            @change="onFileSelect"
          />
          
          <!-- Selected Files List -->
          <div v-if="uploadFiles.length > 0" class="selected-files mt-4">
            <div class="text-subtitle-1 mb-2">
              {{ t('knowledge.selected_files') }} ({{ uploadFiles.length }})
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
            variant="text"
            @click="cancelUpload"
          >
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            @click="confirmUpload"
            :loading="uploading"
            :disabled="!uploadFiles || uploadFiles.length === 0"
          >
            {{ t('knowledge.upload') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>


    <!-- Settings Dialog -->
    <v-dialog v-model="showSettingsDialog" max-width="600">
      <v-card>
        <v-card-title>{{ t('knowledge.settings') }}</v-card-title>
        <v-card-text>
          <v-form>
            <v-select
              v-model="selectedEmbeddingModel"
              :items="availableModels"
              :label="t('knowledge.embedding_model')"
              :loading="loadingModels"
              item-title="name"
              item-value="name"
              :hint="t('knowledge.embedding_model_hint')"
              persistent-hint
            >
              <template v-slot:item="{ props, item }">
                <v-list-item v-bind="props">
                  <template v-slot:title>
                    {{ item.raw.name }}
                  </template>
                  <template v-slot:subtitle>
                    {{ item.raw.description }} - 
                    {{ t('knowledge.max_dimensions') }}: {{ item.raw.max_dimensions }}
                  </template>
                </v-list-item>
              </template>
            </v-select>
            
            <v-alert
              v-if="currentModel"
              type="info"
              variant="tonal"
              class="mt-4"
            >
              {{ t('knowledge.current_model') }}: {{ currentModel }}
            </v-alert>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showSettingsDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn 
            color="primary" 
            @click="handleUpdateEmbeddingModel" 
            :loading="updatingModel"
            :disabled="!selectedEmbeddingModel || selectedEmbeddingModel === currentModel"
          >
            {{ t('knowledge.update_model') }}
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

// Expose t function to template
const { t } = useI18n();

// Type declaration for template
//declare const t: (key: string, ...args: any[]) => string;

import DocumentManagement from '@/views/pages/knowledge/DocumentManagement.vue';
import SearchInterface from '@/views/pages/knowledge/SearchInterface.vue';
import { initializeRAG, getRAGStats, uploadDocument, selectFilesNative as selectFilesNativeAPI, copyFileToTemp as copyFileToTempAPI, chunkAndEmbedDocument, getAvailableEmbeddingModelsWithDefault, updateEmbeddingModel } from '@/views/api/rag';
import type { SaveTempFileResponse, UploadedDocument } from '@/entityTypes/commonType';
import { ModelInfo } from '@/api/ragConfigApi';

// i18n setup

// Reactive data
const activeTab = ref('documents');
const showUploadDialog = ref(false);
const showSettingsDialog = ref(false);
const isLoading = ref(false);
const loadingMessage = ref('');
const loadingSubMessage = ref('');
const statusMessage = ref('');
const statusType = ref<'success' | 'error' | 'warning' | 'info'>('info');

// Settings related variables
const availableModels = ref<ModelInfo[]>([]);
const selectedEmbeddingModel = ref<string>('');
const currentModel = ref<string>('');
const loadingModels = ref(false);
const updatingModel = ref(false);

// Upload dialog data
const uploadFiles = ref<File[]>([]);
const uploading = ref(false);
const uploadError = ref('');
const isDragOver = ref(false);
const fileInput = ref<HTMLInputElement>();

// Component refs
const documentManagement = ref();
const searchInterface = ref();

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
function handleDocumentUploaded(document: UploadedDocument) {
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

function handleSearchCompleted(results: { totalResults: number; [key: string]: any }) {
  showStatus(t('knowledge.found_results', { count: results.totalResults }), 'success');
}


async function handleUploadSuccess(document: UploadedDocument) {
  showUploadDialog.value = false;
  
  // Provide detailed feedback based on document status
  if (document.status === 'completed') {
    showStatus(t('knowledge.document_uploaded_successfully', { name: document.name }), 'success');
  } else if (document.status === 'pending') {
    showStatus(t('knowledge.document_uploaded_pending_processing', { name: document.name }), 'info');
  } else {
    showStatus(t('knowledge.document_uploaded_successfully', { name: document.name }), 'success');
  }
  
  console.log('📄 Document processed:', document);
  
  // Automatically start chunking and embedding process
  if (document.id) {
    try {
      setLoading(true, t('knowledge.processing_document'), t('knowledge.chunking_and_embedding_document'));
      
      const chunkEmbedResult = await chunkAndEmbedDocument(document.id);
      
      if (chunkEmbedResult.success && chunkEmbedResult.data) {
        const { chunksCreated, embeddingsGenerated, processingTime } = chunkEmbedResult.data;
        showStatus(
          t('knowledge.document_processed_successfully', { 
            name: document.name, 
            chunks: chunksCreated, 
            embeddings: embeddingsGenerated 
          }), 
          'success'
        );
        console.log(`✅ Document ${document.name} processed: ${chunksCreated} chunks, ${embeddingsGenerated} embeddings in ${processingTime}ms`);
      } else {
        showStatus(
          t('knowledge.document_processing_failed', { 
            name: document.name, 
            error: chunkEmbedResult.message 
          }), 
          'warning'
        );
        console.warn(`⚠️ Document ${document.name} processing failed:`, chunkEmbedResult.message);
      }
    } catch (error) {
      console.error(`❌ Error processing document ${document.name}:`, error);
      showStatus(
        t('knowledge.document_processing_error', { 
          name: document.name, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        }), 
        'error'
      );
    } finally {
      setLoading(false);
    }
  }
  
  // Refresh document management if available
  // if (documentManagement.value) {
  //   documentManagement.value.refreshDocuments();
  // }
}

function handleUploadError(error: string) {
  showStatus(`${t('knowledge.upload_failed')}: ${error}`, 'error');
}


function handleError(error: string) {
  showStatus(`${t('knowledge.error')}: ${error}`, 'error');
}

// Settings functions
async function loadAvailableModels() {
  loadingModels.value = true;
  try {
    const response = await getAvailableEmbeddingModelsWithDefault();
    console.log('🔍 Available models response:', response);
    if (response && response.data) {
      availableModels.value = response.data.models;
      // Set the default model from system settings
      if (response.data.defaultModel) {
        currentModel.value = response.data.defaultModel;
        selectedEmbeddingModel.value = response.data.defaultModel;
      }
      console.log('✅ Available models loaded:', availableModels.value.length);
      console.log('✅ Default model set:', response.data.defaultModel);
    } else {
      console.error('❌ Failed to load available models');
      availableModels.value = [];
    }
  } catch (error) {
    console.error('❌ Error loading available models:', error);
    availableModels.value = [];
  } finally {
    loadingModels.value = false;
  }
}

async function handleUpdateEmbeddingModel() {
  if (!selectedEmbeddingModel.value) return;
  
  updatingModel.value = true;
  try {
    const response = await updateEmbeddingModel(selectedEmbeddingModel.value);
    console.log(response)
    if (response) {
      currentModel.value = selectedEmbeddingModel.value;
      console.log('✅ Embedding model updated successfully');
      showSettingsDialog.value = false;
      showStatus(t('knowledge.embedding_model_updated_successfully'), 'success');
    } else {
      console.error('❌ Failed to update embedding model:');
      showStatus(`${t('knowledge.failed_to_update_embedding_model')}`, 'error');
    }
  } catch (error) {
    console.error('❌ Error updating embedding model:', error);
    showStatus(`${t('knowledge.failed_to_update_embedding_model')}: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  } finally {
    updatingModel.value = false;
  }
}

async function openSettingsDialog() {
  showSettingsDialog.value = true;
  await loadAvailableModels();
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

// Alternative: Use Electron's native file dialog
async function selectFilesNative() {
  try {
    const files = await selectFilesNativeAPI();
    uploadFiles.value = files;
  } catch (error) {
    console.error('Error selecting files:', error);
    uploadError.value = 'Failed to select files';
  }
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
    // Upload each file
    const uploadPromises = uploadFiles.value.map(async (file): Promise<UploadedDocument | null> => {
      // For Electron, we can access the file path directly if available
      // Otherwise, use the webkitRelativePath or create a temporary file
      let filePath = (file as any).path || file.webkitRelativePath;
      let copyResult: { filePath: string; uploadResult: SaveTempFileResponse } | null = null;
      let needsUpload = true;
      
      if (!filePath) {
        // Fallback: create temporary file for browser-like behavior
        // This will automatically save to database via SAVE_TEMP_FILE handler
        copyResult = await copyFileToTemp(file, {
          title: file.name.replace(/\.[^/.]+$/, ""),
          description: `Uploaded document: ${file.name}`,
          tags: ['uploaded', 'knowledge'],
          author: 'User'
        });
        filePath = copyResult.filePath;
        needsUpload = !copyResult.uploadResult.databaseSaved; // Only skip if database save was successful
      }
      
      // Return document info from temp file upload result (already processed)
      if (copyResult?.uploadResult.document) {
        return copyResult.uploadResult.document;
      } else {
        // Fallback document info if no database document available
        return {
          id: Date.now(), // Temporary ID
          name: file.name,
          title: file.name.replace(/\.[^/.]+$/, ""),
          filePath: filePath,
          status: 'pending',
          description: `Uploaded document: ${file.name}`,
          tags: ['uploaded', 'knowledge'],
          author: 'User'
        } as UploadedDocument;
      }
    });

    const uploadedDocuments = await Promise.all(uploadPromises);
    
    // Handle successful uploads (filter out null values)
    uploadedDocuments.filter(doc => doc !== null).forEach(doc => {
      if (doc) {
        handleUploadSuccess(doc);
      }
    });
    
    cancelUpload();
  } catch (error) {
    uploadError.value = t('knowledge.upload_failed') + ': ' + (error instanceof Error ? error.message : 'Unknown error');
    console.error('Upload error:', error);
  } finally {
    uploading.value = false;
  }
}

// Helper function to copy file to temporary location
async function copyFileToTemp(file: File, metadata?: {
  title?: string;
  description?: string;
  tags?: string[];
  author?: string;
}): Promise<{ filePath: string; uploadResult: SaveTempFileResponse }> {
  try {
    const uploadResult: SaveTempFileResponse = await copyFileToTempAPI(file, metadata);
    
    // Check upload results and provide user feedback
    if (uploadResult.databaseSaved && uploadResult.document) {
      console.log('✅ File and database save successful:', uploadResult.document.name);
      showStatus(
        t('knowledge.document_uploaded_successfully', { name: uploadResult.document.name }), 
        'success'
      );
      
      // Automatically start chunking and embedding process for database-saved documents
      if (uploadResult.document.id) {
        try {
          setLoading(true, t('knowledge.processing_document'), t('knowledge.chunking_and_embedding_document'));
          
          const chunkEmbedResult = await chunkAndEmbedDocument(uploadResult.document.id);
          
          if (chunkEmbedResult.success && chunkEmbedResult.data) {
            const { chunksCreated, embeddingsGenerated, processingTime } = chunkEmbedResult.data;
            showStatus(
              t('knowledge.document_processed_successfully', { 
                name: uploadResult.document.name, 
                chunks: chunksCreated, 
                embeddings: embeddingsGenerated 
              }), 
              'success'
            );
            console.log(`✅ Document ${uploadResult.document.name} processed: ${chunksCreated} chunks, ${embeddingsGenerated} embeddings in ${processingTime}ms`);
          } else {
            showStatus(
              t('knowledge.document_processing_failed', { 
                name: uploadResult.document.name, 
                error: chunkEmbedResult.message 
              }), 
              'warning'
            );
            console.warn(`⚠️ Document ${uploadResult.document.name} processing failed:`, chunkEmbedResult.message);
          }
        } catch (error) {
          console.error(`❌ Error processing document ${uploadResult.document.name}:`, error);
          showStatus(
            t('knowledge.document_processing_error', { 
              name: uploadResult.document.name, 
              error: error instanceof Error ? error.message : 'Unknown error' 
            }), 
            'error'
          );
        } finally {
          setLoading(false);
        }
      }
    } else if (uploadResult.databaseError) {
      console.warn('⚠️ File saved but database error:', uploadResult.databaseError);
      showStatus(
        `${t('knowledge.file_saved_but_database_error')}: ${uploadResult.databaseError}`, 
        'warning'
      );
    } else {
      console.log('📁 File saved to temp location only');
    }
    
    return { 
      filePath: uploadResult.tempFilePath, 
      uploadResult 
    };
  } catch (error) {
    console.error('❌ Error copying file to temp location:', error);
    throw error;
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
  
}

.knowledge-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  
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
