<template>
  <AppPageShell
    page-id="knowledge-library"
    title-key="route.knowledge_library"
    content-width="full"
  >
    <!-- One primary action; website import and settings are infrequent →
         overflow (IPR-004/006). -->
    <template #primary-action>
      <v-btn
        color="primary"
        prepend-icon="mdi-upload"
        data-testid="knowledge-upload-primary"
        @click="showUploadDialog = true"
      >
        {{ t('knowledge.upload_document') }}
      </v-btn>
    </template>
    <template #overflow>
      <v-menu location="bottom end">
        <template #activator="{ props: menuProps }">
          <v-btn icon v-bind="menuProps" variant="text" data-testid="knowledge-overflow">
            <v-icon>mdi-dots-horizontal</v-icon>
          </v-btn>
        </template>
        <v-list density="compact" role="menu">
          <v-list-item
            role="menuitem"
            :title="t('knowledge.import_website')"
            prepend-icon="mdi-web"
            :disabled="checkingEmbeddingRuntime"
            data-testid="knowledge-overflow-import-website"
            @click="openWebsiteImportDialog"
          />
          <v-list-item
            role="menuitem"
            :title="t('knowledge.settings')"
            prepend-icon="mdi-cog"
            data-testid="knowledge-overflow-settings"
            @click="openSettingsDialog"
          />
        </v-list>
      </v-menu>
    </template>

    <!-- Status Snackbar (floating, non-intrusive) -->
    <v-snackbar
      v-model="showSnackbar"
      :color="statusType"
      :timeout="3000"
      location="top"
      variant="tonal"
      density="compact"
      class="status-snackbar"
    >
      <div class="d-flex align-center">
        <v-icon
          :icon="statusIcon"
          size="small"
          class="mr-2"
        />
        <span class="text-body-2">{{ statusMessage }}</span>
      </div>
    </v-snackbar>

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

        <!-- Search Tab (Hidden - set v-if="true" to show) -->
        <v-tab v-if="false" value="search">
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
              :ensure-embedding-ready="() => ensureCurrentEmbeddingRuntimeReady(null)"
              @document-uploaded="handleDocumentUploaded"
              @document-deleted="handleDocumentDeleted"
              @error="handleError"
            />
          </v-window-item>

          <!-- Search Window (Hidden - matches tab visibility) -->
          <v-window-item v-if="false" value="search">
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
                PDF, TXT, DOC, DOCX, MD, HTML, CSV, Excel files supported
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
            accept=".pdf,.txt,.doc,.docx,.md,.html,.htm,.csv,.xlsx,.xls,.pptx,.ppt"
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
                
                <!-- Progress indicator for current uploading file -->
                <div v-if="currentUploadingFile === file.name && uploadProgress.has(file.name)" class="mt-2">
                  <v-progress-linear
                    :model-value="uploadProgress.get(file.name)?.progress || 0"
                    color="primary"
                    height="4"
                    rounded
                  />
                  <div class="text-caption mt-1">
                    {{ uploadProgress.get(file.name)?.message || 'Processing...' }}
                  </div>
                </div>
                
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


    <!-- Website Import Dialog -->
    <WebsiteImportDialog
      v-model="showWebsiteImportDialog"
      :before-import="() => ensureCurrentEmbeddingRuntimeReady(null)"
      @completed="handleWebsiteImportCompleted"
      @local-runtime-required="handleLocalRuntimeRequired"
    />

    <!-- Duplicate Confirmation Dialog -->
    <v-dialog v-model="showDuplicateDialog" max-width="550px" persistent>
      <v-card>
        <v-card-title class="text-h6">
          <v-icon color="warning" class="mr-2">mdi-alert-circle</v-icon>
          {{ t('knowledge.duplicate_detected') }}
        </v-card-title>

        <v-card-text>
          <p class="mb-3">
            {{ t('knowledge.duplicate_files_found') }}
          </p>
          <v-list density="compact" class="bg-grey-lighten-4">
            <v-list-item
              v-for="(dup, idx) in duplicateFiles"
              :key="idx"
            >
              <template v-slot:prepend>
                <v-icon color="warning" size="small">mdi-file-alert</v-icon>
              </template>
              <v-list-item-title>{{ dup.fileName }}</v-list-item-title>
              <v-list-item-subtitle>
                {{ formatFileSize(dup.fileSize) }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn color="grey" variant="text" @click="cancelUpload">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn color="warning" variant="outlined" @click="handleSkipDuplicates">
            {{ t('knowledge.skip_duplicates') }}
          </v-btn>
          <v-btn color="primary" @click="handleUploadAnyway">
            {{ t('knowledge.upload_anyway') }}
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
              item-title="displayName"
              item-value="name"
              :hint="t('knowledge.embedding_model_hint')"
              persistent-hint
            >
              <template v-slot:item="{ props, item }">
                <v-list-item v-bind="props">
                  <template v-slot:title>
                    {{ item.raw.displayName || item.raw.name }}
                  </template>
                  <template v-slot:subtitle>
                    {{ item.raw.description }} -
                    {{ t('knowledge.max_dimensions') }}: {{ item.raw.dimensions }}
                  </template>
                  <template v-slot:append>
                    <v-chip
                      v-if="item.raw.is_free"
                      size="x-small"
                      variant="tonal"
                      color="success"
                      class="ml-2"
                    >
                      {{ t('knowledge.model_free') }}
                    </v-chip>
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

    <!-- Local AI Runtime Download Dialog -->
    <v-dialog v-model="showRuntimeDownloadDialog" max-width="520">
      <v-card>
        <v-card-title>
          <v-icon left class="mr-2" color="warning">mdi-download-circle</v-icon>
          {{ t('knowledge.local_runtime_not_installed_title') }}
        </v-card-title>
        <v-card-text>
          <p class="mb-2">
            {{ t('knowledge.local_runtime_not_installed_message', {
              model: selectedEmbeddingModel,
              runtime: LOCAL_EMBEDDING_RUNTIME_ID,
            }) }}
          </p>
          <div v-if="runtimeInstallOffer" class="text-caption text-medium-emphasis mb-2">
            {{ t('knowledge.local_runtime_download_size', {
              size: formatRuntimeBytes(runtimeInstallOffer.archiveSizeBytes),
            }) }}
          </div>
          <v-alert
            v-if="runtimeDownloadError"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-2"
          >
            {{ runtimeDownloadError }}
          </v-alert>
          <template v-if="runtimeDownloading && runtimeDownloadProgress && isActiveRuntimeProgress(runtimeDownloadProgress.phase)">
            <v-progress-linear
              :model-value="runtimeDownloadProgress.percent ?? 0"
              height="8"
              color="primary"
              rounded
              class="mt-3"
            />
            <div class="text-caption mt-1">
              {{ runtimePhaseLabel(runtimeDownloadProgress.phase) }}
              <span v-if="runtimeDownloadProgress.totalBytes" class="ml-2">
                {{ formatRuntimeBytes(runtimeDownloadProgress.downloadedBytes ?? 0) }} / {{ formatRuntimeBytes(runtimeDownloadProgress.totalBytes) }}
              </span>
            </div>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <template v-if="!runtimeDownloading">
            <v-btn variant="text" @click="showRuntimeDownloadDialog = false">
              {{ t('common.cancel') }}
            </v-btn>
            <v-btn
              color="primary"
              :disabled="preparingRuntime || runtimeDownloading"
              :loading="preparingRuntime || runtimeDownloading"
              @click="onDownloadRuntime"
            >
              {{ t('knowledge.local_runtime_download') }}
            </v-btn>
          </template>
          <template v-else>
            <v-btn
              v-if="runtimeDownloadProgress && runtimeDownloadProgress.phase === 'downloading'"
              variant="text"
              @click="onCancelRuntimeDownload"
            >
              {{ t('localAiRuntime.cancel') }}
            </v-btn>
          </template>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Update Model Result Dialog -->
    <v-dialog v-model="showUpdateResultDialog" max-width="500">
      <v-card>
        <v-card-title>
          <v-icon :color="updateResultType" left>{{ updateResultIcon }}</v-icon>
          {{ updateResultTitle }}
        </v-card-title>
        <v-card-text>
          <div v-if="updateResultType === 'success' && updateResult">
            <p><strong>{{ t('knowledge.model') }}:</strong> {{ updateResult.modelName }}</p>
            <p><strong>{{ t('knowledge.dimensions') }}:</strong> {{ updateResult.dimension }}</p>
          </div>
          <p v-else>{{ updateResultMessage }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" @click="showUpdateResultDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

  </AppPageShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import AppPageShell from '@/views/components/pageTemplates/AppPageShell.vue';

// Expose t function to template
const { t } = useI18n();

// Type declaration for template
//declare const t: (key: string, ...args: any[]) => string;

import DocumentManagement from '@/views/pages/knowledge/DocumentManagement.vue';
import SearchInterface from '@/views/pages/knowledge/SearchInterface.vue';
import WebsiteImportDialog from '@/views/pages/knowledge/WebsiteImportDialog.vue';
import type { ImportKnowledgeWebsiteResult } from '@/entityTypes/knowledgeLibraryAiToolTypes';
import { getRAGStats, selectFilesNative as selectFilesNativeAPI, copyFileToTemp as copyFileToTempAPI, chunkAndEmbedDocument, getAvailableEmbeddingModelsWithDefault, updateEmbeddingModel, FileUploadProgress, FileUploadComplete, checkDocumentDuplicate } from '@/views/api/rag';
import type { SaveTempFileResponse, UploadedDocument } from '@/entityTypes/commonType';
import { ModelInfo } from '@/api/ragConfigApi';
import { DocumentMetadata } from '@/entityTypes/metadataType';
import { getLocalAiRuntimeStatus, prepareLocalAiRuntimeInstall, installLocalAiRuntime, cancelLocalAiRuntimeInstall, onLocalAiRuntimeProgress } from '@/views/api/localAiRuntime';
import type { LocalAiRuntimeDownloadPhase, LocalAiRuntimeDownloadProgress, LocalAiRuntimeId, LocalAiRuntimeInstallOffer } from '@/entityTypes/localAiRuntimeTypes';
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  LOCAL_XENOVA_PROVIDER_PREFIX,
  isLocalXenovaModelId,
} from '@/service/embedding/LocalEmbeddingModels';

const LOCAL_EMBEDDING_RUNTIME_ID: LocalAiRuntimeId = 'embedding-xenova';

// i18n setup

// Reactive data
const activeTab = ref('documents');
const showUploadDialog = ref(false);
const showWebsiteImportDialog = ref(false);
const showSettingsDialog = ref(false);
const statusMessage = ref('');
const statusType = ref<'success' | 'error' | 'warning' | 'info'>('info');
const showSnackbar = ref(false);

const statusIcon = computed(() => {
  const icons: Record<string, string> = {
    success: 'mdi-check-circle',
    error: 'mdi-alert-circle',
    warning: 'mdi-alert',
    info: 'mdi-information',
  };
  return icons[statusType.value] || 'mdi-information';
});

// Settings related variables
const availableModels = ref<ModelInfo[]>([]);
const selectedEmbeddingModel = ref<string>('');
const currentModel = ref<string>('');
const loadingModels = ref(false);
const updatingModel = ref(false);

// Update result dialog variables
const showUpdateResultDialog = ref(false);
const updateResultType = ref<'success' | 'error'>('success');
const updateResult = ref<{ modelName: string; dimension: number } | null>(null);
const updateResultMessage = ref('');
const updateResultTitle = ref('');
const updateResultIcon = ref('mdi-check-circle');

// Local AI runtime download dialog variables
const showRuntimeDownloadDialog = ref(false);
const runtimeDownloading = ref(false);
const preparingRuntime = ref(false);
const checkingEmbeddingRuntime = ref(false);
const runtimeDownloadError = ref('');
const runtimeDownloadProgress = ref<LocalAiRuntimeDownloadProgress | null>(null);
const runtimeInstallOffer = ref<LocalAiRuntimeInstallOffer | null>(null);
/** What to resume after a successful runtime install (settings update vs open import). */
type RuntimeInstallResume = 'update-model' | 'open-website-import' | null;
const pendingRuntimeAction = ref<RuntimeInstallResume>(null);
let unsubscribeRuntimeProgress: (() => void) | null = null;

// Upload dialog data
const uploadFiles = ref<File[]>([]);
const uploading = ref(false);
const uploadError = ref('');
const isDragOver = ref(false);
const fileInput = ref<HTMLInputElement>();

// Progress tracking
const uploadProgress = ref<Map<string, FileUploadProgress>>(new Map());
const currentUploadingFile = ref<string>('');

// Duplicate check state
const showDuplicateDialog = ref(false);
const duplicateFiles = ref<Array<{ fileName: string; fileSize: number; existingId: number; existingUploadedAt: string }>>([]);
const pendingUploadAfterDuplicateCheck = ref<File[]>([]);

// Component refs
const documentManagement = ref();
const searchInterface = ref();

// Lifecycle hooks
onMounted(async () => {
  unsubscribeRuntimeProgress = onLocalAiRuntimeProgress((progress) => {
    if (progress.runtimeId !== LOCAL_EMBEDDING_RUNTIME_ID) return;
    runtimeDownloadProgress.value = progress;
    if (progress.phase === 'error') {
      runtimeDownloadError.value = runtimeErrorMessage(progress.errorMessage ?? 'download failed');
    }
  });
  await initializeRAGSystem();
});

onUnmounted(() => {
  if (unsubscribeRuntimeProgress) {
    unsubscribeRuntimeProgress();
    unsubscribeRuntimeProgress = null;
  }
});

// Methods
async function initializeRAGSystem() {
  try {
    // windowInvoke unwraps IPC `{ status, data }` — getRAGStats returns RagStatsResponse.
    const stats = await getRAGStats();
    console.log('RAG Stats Response:', stats);

    if (stats.defaultEmbeddingModel) {
      currentModel.value = stats.defaultEmbeddingModel;
      selectedEmbeddingModel.value = stats.defaultEmbeddingModel;
      console.log('✅ Default embedding model set from stats:', stats.defaultEmbeddingModel);
    }
  } catch (error) {
    console.error('Failed to initialize RAG system:', error);
    showStatus(`${t('knowledge.failed_to_initialize_rag_system')}: ${error}`, 'error');
  }
}


function showStatus(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') {
  statusMessage.value = message;
  statusType.value = type;
  showSnackbar.value = true;
}

// Event handlers
function handleDocumentUploaded(document: UploadedDocument) {
  showStatus(t('knowledge.document_uploaded_successfully', { name: document.name }), 'success');
  // Refresh document management if needed
  if (documentManagement.value) {
    documentManagement.value.refreshDocuments();
  }
}

function handleDocumentDeleted() {
  showStatus(t('knowledge.document_deleted_successfully'), 'success');
  // Refresh document management if needed
  if (documentManagement.value) {
    documentManagement.value.refreshDocuments();
  }
}

function handleWebsiteImportCompleted(outcome: ImportKnowledgeWebsiteResult) {
  showStatus(
    t('knowledge.website_import_status_done', {
      imported: outcome.importedCount,
      skipped: outcome.skippedCount,
    }),
    outcome.importedCount > 0 ? 'success' : 'warning'
  );
  // Refresh the documents list only when at least one page was imported —
  // avoids a needless IPC + DB round-trip when every page was skipped.
  if (documentManagement.value && outcome.importedCount > 0) {
    documentManagement.value.refreshDocuments();
  }
}

function handleLocalRuntimeRequired(): void {
  showWebsiteImportDialog.value = false;
  void ensureLocalEmbeddingRuntime(null);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  
  
  // Refresh document management if available
  if (documentManagement.value) {
    documentManagement.value.refreshDocuments();
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      // Note: This should match the defaultEmbeddingModel from getRAGStats() since both read from system settings
      if (response.data.defaultModel) {
        currentModel.value = response.data.defaultModel;
        selectedEmbeddingModel.value = response.data.defaultModel;
        console.log('✅ Default model set from available models:', response.data.defaultModel);
      }
      console.log('✅ Available models loaded:', availableModels.value.length);
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
  
  // Local embedding models (Xenova/all-MiniLM-L6-v2) require the
  // downloadable "embedding-xenova" Local AI Component. If the runtime is not
  // installed/ready, offer an inline download instead of updating.
  if (isLocalXenovaModelId(selectedEmbeddingModel.value)) {
    if (!(await ensureLocalEmbeddingRuntime('update-model'))) {
      return;
    }
  }
  
  await performUpdateEmbeddingModel();
}

/**
 * Gate for import/upload/re-embed: if the current default embedding model is
 * local-xenova, require the embedding-xenova runtime to be ready (or show the
 * install dialog). Remote models pass through without a runtime check.
 */
async function ensureCurrentEmbeddingRuntimeReady(
  resume: RuntimeInstallResume = null
): Promise<boolean> {
  checkingEmbeddingRuntime.value = true;
  try {
    // Always refresh — do not trust a stale/empty currentModel (windowInvoke
    // returns unwrapped stats, so older `.data?.defaultEmbeddingModel` reads
    // never populated the model and skipped this gate).
    try {
      const stats = await getRAGStats();
      if (stats.defaultEmbeddingModel) {
        currentModel.value = stats.defaultEmbeddingModel;
        selectedEmbeddingModel.value = stats.defaultEmbeddingModel;
      }
    } catch (error) {
      console.error('Failed to load current embedding model for runtime check:', error);
    }

    if (!isLocalXenovaModelId(currentModel.value)) {
      return true;
    }

    return ensureLocalEmbeddingRuntime(resume);
  } finally {
    checkingEmbeddingRuntime.value = false;
  }
}

async function openWebsiteImportDialog(): Promise<void> {
  if (!(await ensureCurrentEmbeddingRuntimeReady('open-website-import'))) {
    return;
  }
  showWebsiteImportDialog.value = true;
}

async function performUpdateEmbeddingModel() {
  updatingModel.value = true;
  try {
    const result = await updateEmbeddingModel(selectedEmbeddingModel.value);
    console.log('Update embedding model result:', result);
    
    if (result) {
      currentModel.value = result.modelName;
      console.log(`✅ Embedding model updated successfully to ${result.modelName} with dimension ${result.dimension}`);
      
      // Show success dialog
      updateResultType.value = 'success';
      updateResultTitle.value = t('knowledge.embedding_model_updated_successfully');
      updateResultIcon.value = 'mdi-check-circle';
      updateResult.value = result;
      updateResultMessage.value = '';
      showUpdateResultDialog.value = true;
      
      // Close settings dialog
      showSettingsDialog.value = false;
    } else {
      console.error('❌ Failed to update embedding model: No data returned');
      
      // Show error dialog
      updateResultType.value = 'error';
      updateResultTitle.value = t('knowledge.failed_to_update_embedding_model');
      updateResultIcon.value = 'mdi-alert-circle';
      updateResult.value = null;
      updateResultMessage.value = t('knowledge.failed_to_update_embedding_model');
      showUpdateResultDialog.value = true;
    }
  } catch (error) {
    console.error('❌ Error updating embedding model:', error);
    
    // Show error dialog
    updateResultType.value = 'error';
    updateResultTitle.value = t('knowledge.failed_to_update_embedding_model');
    updateResultIcon.value = 'mdi-alert-circle';
    updateResult.value = null;
    updateResultMessage.value = error instanceof Error ? error.message : 'Unknown error';
    showUpdateResultDialog.value = true;
  } finally {
    updatingModel.value = false;
  }
}

/**
 * Verifies the embedding-xenova Local AI Component is ready. When it is not,
 * opens the download dialog with an inline install action. Returns true only
 * when the runtime is already ready; otherwise returns false after opening the
 * install dialog (caller should abort and let the user install first).
 */
async function ensureLocalEmbeddingRuntime(
  resume: RuntimeInstallResume = null
): Promise<boolean> {
  const runtimeStatus = await getLocalAiRuntimeStatus(LOCAL_EMBEDDING_RUNTIME_ID);
  if (runtimeStatus.state === 'ready') {
    return true;
  }
  console.warn('Local embedding runtime not ready:', runtimeStatus);
  pendingRuntimeAction.value = resume;
  runtimeDownloadError.value = '';
  runtimeDownloadProgress.value = null;
  runtimeInstallOffer.value = null;
  showRuntimeDownloadDialog.value = true;
  preparingRuntime.value = true;
  try {
    runtimeInstallOffer.value = await prepareLocalAiRuntimeInstall(LOCAL_EMBEDDING_RUNTIME_ID);
  } catch (error) {
    runtimeDownloadError.value = runtimeErrorMessage(error);
  } finally {
    preparingRuntime.value = false;
  }
  return false;
}

async function onDownloadRuntime() {
  if (runtimeDownloading.value) return;
  runtimeDownloading.value = true;
  runtimeDownloadError.value = '';
  try {
    // Issue a fresh consent grant on every attempt so a prior failed install
    // (or stale dialog state) cannot reuse a consumed offer token.
    const offer = await prepareLocalAiRuntimeInstall(LOCAL_EMBEDDING_RUNTIME_ID);
    runtimeInstallOffer.value = offer;
    await installLocalAiRuntime({
      operationId: offer.operationId,
      runtimeId: offer.runtimeId,
      expectedRuntimeVersion: offer.runtimeVersion,
      consentToken: offer.consentToken,
    });
    const runtimeStatus = await getLocalAiRuntimeStatus(LOCAL_EMBEDDING_RUNTIME_ID);
    if (runtimeStatus.state === 'ready') {
      showRuntimeDownloadDialog.value = false;
      // Clear the consumed offer token so a later attempt must obtain a fresh
      // consent grant (matches the "fresh consent grant on every attempt"
      // contract above), then dispatch the deferred action that triggered the
      // install.
      runtimeInstallOffer.value = null;
      const action = pendingRuntimeAction.value;
      pendingRuntimeAction.value = null;
      if (action === 'update-model') {
        await performUpdateEmbeddingModel();
      } else if (action === 'open-website-import') {
        showWebsiteImportDialog.value = true;
      }
    } else {
      runtimeDownloadError.value = t('knowledge.local_runtime_install_failed') as string;
    }
  } catch (error) {
    console.error('❌ Error installing local embedding runtime:', error);
    runtimeDownloadError.value = runtimeErrorMessage(error);
  } finally {
    runtimeDownloading.value = false;
  }
}

function onCancelRuntimeDownload() {
  if (runtimeDownloading.value && runtimeDownloadProgress.value) {
    cancelLocalAiRuntimeInstall(runtimeDownloadProgress.value.operationId).catch((error: unknown) => {
      runtimeDownloadError.value = runtimeErrorMessage(error);
    });
  }
  pendingRuntimeAction.value = null;
  runtimeDownloading.value = false;
  showRuntimeDownloadDialog.value = false;
}

function runtimeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/checksum|integrity/i.test(message)) return t('localAiRuntime.errors.checksum_mismatch') as string;
  if (/safety|unsafe|archive/i.test(message)) return t('localAiRuntime.errors.archive_unsafe') as string;
  if (/health/i.test(message)) return t('localAiRuntime.errors.health_check_failed') as string;
  if (/busy|in progress/i.test(message)) return t('localAiRuntime.errors.busy') as string;
  if (/catalog/i.test(message)) return t('localAiRuntime.errors.catalog_unavailable') as string;
  if (/compatible|incompat/i.test(message)) return t('localAiRuntime.errors.incompatible') as string;
  if (/download/i.test(message)) return t('localAiRuntime.errors.download_failed') as string;
  return message;
}

function isActiveRuntimeProgress(phase: LocalAiRuntimeDownloadPhase): boolean {
  return (
    phase === 'resolving' ||
    phase === 'downloading' ||
    phase === 'verifying' ||
    phase === 'extracting' ||
    phase === 'testing' ||
    phase === 'activating'
  );
}

function runtimePhaseLabel(phase: LocalAiRuntimeDownloadPhase): string {
  const key = `localAiRuntime.${phase}`;
  return (t(key) as string) || phase;
}

function formatRuntimeBytes(bytes?: number): string {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
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
  showDuplicateDialog.value = false;
  duplicateFiles.value = [];
  pendingUploadAfterDuplicateCheck.value = [];
  uploadFiles.value = [];
  uploadError.value = '';
  uploading.value = false;
  isDragOver.value = false;
  currentUploadingFile.value = '';
  uploadProgress.value.clear();
}

async function confirmUpload() {
  if (!uploadFiles.value || uploadFiles.value.length === 0) {
    uploadError.value = t('knowledge.no_files_selected');
    return;
  }

  // Local embedding models need the Xenova runtime before upload/embedding starts.
  if (!(await ensureCurrentEmbeddingRuntimeReady(null))) {
    return;
  }

  uploading.value = true;
  uploadError.value = '';
  uploadProgress.value.clear();

  try {
    // Check all files for duplicates in parallel
    const duplicateChecks = await Promise.all(
      uploadFiles.value.map(async (file): Promise<{ file: File; isDuplicate: boolean; existingDocuments: Array<{ id: number; uploadedAt: string }> }> => {
        const result = await checkDocumentDuplicate(file.name, file.size);
        return {
          file,
          isDuplicate: result.isDuplicate,
          existingDocuments: result.existingDocuments,
        };
      })
    );

    const dupes = duplicateChecks.filter((c) => c.isDuplicate);
    if (dupes.length > 0) {
      // Store info and show dialog
      duplicateFiles.value = dupes.map((d) => ({
        fileName: d.file.name,
        fileSize: d.file.size,
        existingId: d.existingDocuments[0].id,
        existingUploadedAt: d.existingDocuments[0].uploadedAt,
      }));
      pendingUploadAfterDuplicateCheck.value = uploadFiles.value;
      showDuplicateDialog.value = true;
      uploading.value = false;
      return;
    }

    // No duplicates - proceed with all files
    await doUpload(uploadFiles.value);
  } catch (error) {
    uploadError.value = t('knowledge.upload_failed') + ': ' + (error instanceof Error ? error.message : 'Unknown error');
    console.error('Upload error:', error);
  } finally {
    uploading.value = false;
    currentUploadingFile.value = '';
    uploadProgress.value.clear();
    if (documentManagement.value) {
      documentManagement.value.refreshDocuments();
    }
  }
}

function handleSkipDuplicates() {
  showDuplicateDialog.value = false;
  const dupeNames = new Set(duplicateFiles.value.map((d) => d.fileName));
  const filteredFiles = pendingUploadAfterDuplicateCheck.value.filter(
    (f) => !dupeNames.has(f.name)
  );
  if (filteredFiles.length === 0) {
    cancelUpload();
    return;
  }
  doUpload(filteredFiles);
}

function handleUploadAnyway() {
  showDuplicateDialog.value = false;
  doUpload(pendingUploadAfterDuplicateCheck.value);
}

async function doUpload(files: File[]) {
  uploading.value = true;
  uploadError.value = '';
  uploadProgress.value.clear();

  try {
    // Upload each file with progress tracking
    const uploadPromises = files.map(async (file): Promise<UploadedDocument | null> => {
      // For Electron, we can access the file path directly if available
      // Otherwise, use the webkitRelativePath or create a temporary file
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let filePath = (file as any).path || file.webkitRelativePath;
      
      if (!filePath) {
        // Set current uploading file for progress display
        currentUploadingFile.value = file.name;
        
        // Fallback: create temporary file for browser-like behavior with progress callbacks
        const uploadResult = await copyFileToTempAPI(file, {
          title: file.name.replace(/\.[^/.]+$/, ""),
          description: `Uploaded document: ${file.name}`,
          tags: ['uploaded', 'knowledge'],
          // model_name: currentModel.value
        }, 
        // Progress callback
        (progress: FileUploadProgress) => {
          uploadProgress.value.set(file.name, progress);
          console.log(`Progress for ${file.name}:`, progress);
        },
        // Complete callback
        (result: FileUploadComplete) => {
          console.log(`Complete for ${file.name}:`, result);
          uploadProgress.value.delete(file.name);
         
        });
        
        console.log("uploadResult is ready")
        console.log(uploadResult)
        filePath = uploadResult.tempFilePath;
        
        // Return document info from temp file upload result (already processed)
        if (uploadResult.document) {
          return uploadResult.document;
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
    currentUploadingFile.value = '';
    uploadProgress.value.clear();
  }
}

// Helper function to copy file to temporary location
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function copyFileToTemp(file: File, metadata?: DocumentMetadata) 
  : Promise<{ filePath: string; uploadResult: SaveTempFileResponse }> {
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
.knowledge-content {
  flex: 1;
  overflow: hidden;
}

.knowledge-tabs {
  border-bottom: 1px solid var(--app-border);
}

.knowledge-tabs .v-tab {
  text-transform: none;
  font-weight: 500;
}

.knowledge-tabs .v-tab--selected {
  color: var(--app-accent);
}

/* Status snackbar styles */
.status-snackbar {
  margin-top: 64px;
}

.status-snackbar .v-snackbar__wrapper {
  min-height: 40px !important;
  padding: 6px 16px !important;
  border-radius: 8px !important;
}

.status-snackbar :deep(.v-snackbar__content) {
  padding: 0 !important;
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
  background: var(--app-surface-variant);
  border-radius: 4px;
}

.v-window-item::-webkit-scrollbar-thumb {
  background: var(--app-border-strong);
  border-radius: 4px;
}

.v-window-item::-webkit-scrollbar-thumb:hover {
  background: var(--app-text-muted);
}

/* Upload Dialog Styles */
.upload-drop-zone {
  border: 2px dashed var(--app-border);
  border-radius: 12px;
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background-color: var(--app-surface);
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-drop-zone:hover {
  border-color: var(--app-accent);
  background-color: var(--app-surface-variant);
}

.upload-drop-zone.drag-over {
  border-color: var(--app-accent);
  background-color: var(--app-accent-soft);
  transform: scale(1.02);
}

.upload-drop-zone.has-files {
  border-color: var(--app-success);
  background-color: var(--app-success-soft);
}

.drop-zone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.selected-files {
  border: 1px solid var(--app-border);
  border-radius: 8px;
  padding: 16px;
  background-color: var(--app-surface);
}

.file-item {
  border-bottom: 1px solid var(--app-border);
}

.file-item:last-child {
  border-bottom: none;
}
</style>
