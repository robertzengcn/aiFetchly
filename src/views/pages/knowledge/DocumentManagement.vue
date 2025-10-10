<template>
  <div class="document-management">
    <div class="header">
      <div class="header-left">
        <h2>{{ t('knowledge.document_management') }}</h2>
        <div v-if="lastRefreshTime" class="last-refresh">
          <v-icon size="small" color="grey">mdi-clock-outline</v-icon>
          <span class="text-caption text-grey ml-1">
            {{ t('knowledge.last_refresh') }}: {{ formatLastRefresh(lastRefreshTime) }}
          </span>
        </div>
      </div>
      <!-- <div class="actions"> -->
        <!-- Auto-refresh controls -->
        <!-- <div class="auto-refresh-controls">
          <v-switch
            v-model="autoRefreshEnabled"
            :label="t('knowledge.auto_refresh')"
            color="primary"
            density="compact"
            hide-details
            @change="toggleAutoRefresh"
          />
          <v-select
            v-model="refreshInterval"
            :items="refreshIntervalOptions"
            item-title="text"
            item-value="value"
            density="compact"
            variant="outlined"
            hide-details
            :disabled="!autoRefreshEnabled"
            @change="updateRefreshInterval"
            style="min-width: 120px; margin-left: 8px;"
          />
        </div> -->
        
        <!-- <v-btn color="primary" @click="showUploadDialog = true">
          <v-icon left>mdi-upload</v-icon>
          {{ t('knowledge.upload_document') }}
        </v-btn> -->
        <!-- <v-btn 
          color="secondary" 
          @click="refreshDocuments"
          :loading="loading"
        >
          <v-icon left>mdi-refresh</v-icon>
          {{ t('common.refresh') }}
        </v-btn> -->
      <!-- </div> -->
    </div>

    <!-- Filters -->
    <div class="filters">
      <v-row>
        <v-col cols="12" md="3">
          <v-text-field
            v-model="filters.name"
            :label="t('knowledge.search_by_name')"
            prepend-inner-icon="mdi-magnify"
            clearable
            @input="applyFilters"
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="filters.status"
            :items="statusOptions"
            item-title="name"
            item-value="key"
            :label="t('knowledge.status')"
            clearable
            @change="applyFilters"
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="filters.fileType"
            :items="fileTypeOptions"
            item-title="name"
            item-value="key"
            :label="t('knowledge.file_type')"
            clearable
            @change="applyFilters"
          />
        </v-col>
      </v-row>
    </div>

    <!-- Document Table -->
    <v-data-table
      v-model="selectedDocuments"
      :headers="headers"
      :items="documents"
      :loading="loading"
      :items-per-page="10"
      show-select
      class="document-table"
    >
      <template v-slot:item.name="{ item }">
        <div class="document-name">
          <v-icon :color="getFileTypeColor(item.fileType)">
            {{ getFileTypeIcon(item.fileType) }}
          </v-icon>
          <span class="ml-2">{{ item.name }}</span>
        </div>
      </template>

      <template v-slot:item.status="{ item }">
        <v-chip
          :color="getStatusColor(item.status)"
          small
        >
          {{ item.status }}
        </v-chip>
      </template>

      <template v-slot:item.processingStatus="{ item }">
        <v-chip
          :color="getProcessingStatusColor(item.processingStatus)"
          small
        >
          {{ item.processingStatus }}
        </v-chip>
      </template>

      <template v-slot:item.fileSize="{ item }">
        {{ formatFileSize(item.fileSize) }}
      </template>

      <template v-slot:item.uploadDate="{ item }">
        {{ formatDate(item.uploadDate) }}
      </template>

      <template v-slot:item.actions="{ item }">
        <v-btn
          icon
          size="small"
          variant="text"
          @click="handleDownloadDocument(item)"
        >
          <v-icon size="small">mdi-download</v-icon>
        </v-btn>
        <!-- <v-btn
          icon
          size="small"
          variant="text"
          @click="editDocument(item)"
        >
          <v-icon size="small">mdi-pencil</v-icon>
        </v-btn> -->
        <v-btn
          icon
          size="small"
          variant="text"
          color="primary"
          @click="reembedDocument(item)"
          :loading="reembeddingDocIds.includes(item.id)"
        >
          <v-icon size="small">mdi-reload</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          color="error"
          @click="deleteDocument(item)"
        >
          <v-icon size="small">mdi-delete</v-icon>
        </v-btn>
      </template>
    </v-data-table>

    <!-- Bulk Actions -->
    <div v-if="selectedDocuments.length > 0" class="bulk-actions">
      <v-btn color="error" @click="bulkDelete">
        <v-icon left>mdi-delete</v-icon>
        {{ t('knowledge.delete_selected', { count: selectedDocuments.length }) }}
      </v-btn>
      <v-btn color="warning" @click="bulkUpdateStatus('archived')">
        <v-icon left>mdi-archive</v-icon>
        {{ t('knowledge.archive_selected') }}
      </v-btn>
    </div>

    <!-- Upload Dialog -->
    <v-dialog v-model="showUploadDialog" max-width="600">
      <v-card>
        <v-card-title>{{ t('knowledge.upload_document') }}</v-card-title>
        <v-card-text>
          <v-file-input
            v-model="uploadFile"
            :label="t('knowledge.select_file')"
            accept=".pdf,.txt,.doc,.docx,.html,.md"
            show-size
            @change="onFileSelected"
          />
          <v-text-field
            v-model="uploadData.title"
            :label="t('knowledge.title')"
            class="mt-4"
          />
          <v-textarea
            v-model="uploadData.description"
            :label="t('knowledge.description')"
            rows="3"
          />
          <v-combobox
            v-model="uploadData.tags"
            :label="t('knowledge.tags')"
            multiple
            chips
            :hint="t('knowledge.tags_hint')"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showUploadDialog = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" @click="uploadDocument" :loading="uploading">
            {{ t('knowledge.upload') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { getDocuments, type DocumentInfo, chunkAndEmbedDocument, getRAGStats, downloadDocument, deleteDocument as deleteDocumentAPI } from '@/views/api/rag';
import { Header } from "@/entityTypes/commonType"
const headers = ref<Array<Header>>([])
// i18n setup
const { t } = useI18n();
    const documents = ref<DocumentInfo[]>([]);
    const selectedDocuments = ref<DocumentInfo[]>([]);
    const loading = ref(false);
    const showUploadDialog = ref(false);
    const uploading = ref(false);
    const uploadFile = ref<File | File[] | undefined>(undefined);
    const uploadData = ref({
      title: '',
      description: '',
      tags: []
    });
    const reembeddingDocIds = ref<number[]>([]);

    const filters = ref({
      name: '',
      status: '',
      fileType: ''
    });

    // Auto-refresh functionality
    const autoRefreshEnabled = ref(false);
    const refreshInterval = ref(5000); // 5 seconds default
    const lastRefreshTime = ref<Date | null>(null);
    const refreshTimer = ref<NodeJS.Timeout | null>(null);
    const isTabVisible = ref(true);

    // Refresh interval options (in milliseconds)
    const refreshIntervalOptions = ref([
      { text: t('knowledge.refresh_10_seconds'), value: 10000 },
      { text: t('knowledge.refresh_30_seconds'), value: 30000 },
      { text: t('knowledge.refresh_1_minute'), value: 60000 },
      { text: t('knowledge.refresh_2_minutes'), value: 120000 },
      { text: t('knowledge.refresh_5_minutes'), value: 300000 }
    ]);

    headers.value = [
      { title: t('knowledge.name'), sortable: true, key: 'name' },
      { title: t('knowledge.title'), sortable: true, key: 'title' },
      { title: t('knowledge.status'), sortable: true, key: 'status' },
      { title: t('knowledge.processing'), sortable: true, key: 'processingStatus' },
      { title: t('knowledge.file_type'), sortable: true, key: 'fileType' },
      { title: t('knowledge.size'), sortable: true, key: 'fileSize' },
      { title: t('knowledge.uploaded'), sortable: true, key: 'uploadDate' },
      { title: t('knowledge.actions'), sortable: false, key: 'actions' }
    ];

    const statusOptions = ref([
      { key: 'active', name: t('knowledge.status_active') },
      { key: 'archived', name: t('knowledge.status_archived') },
      { key: 'processing', name: t('knowledge.status_processing') }
    ]);

    const fileTypeOptions = ref([
      { key: 'pdf', name: 'PDF' },
      { key: 'txt', name: t('knowledge.file_type_text') },
      { key: 'doc', name: t('knowledge.file_type_word') },
      { key: 'html', name: 'HTML' },
      { key: 'md', name: t('knowledge.file_type_markdown') }
    ]);

    const loadDocuments = async (isAutoRefresh = false) => {
      // Skip auto-refresh if tab is not visible
      if (isAutoRefresh && !isTabVisible.value) {
        console.log('⏭️ Skipping auto-refresh - tab not visible');
        return;
      }

      loading.value = true;
      try {
        // Get documents using IPC method
        const documentsList = await getDocuments(filters.value);
        console.log('📄 Documents response:', documentsList);
        
        if (documentsList && Array.isArray(documentsList)) {
          documents.value = documentsList;
          lastRefreshTime.value = new Date();
          console.log('✅ Documents loaded successfully:', documents.value.length);
        } else {
          console.error('❌ Failed to load documents: Invalid response format');
          documents.value = [];
        }
      } catch (error) {
        console.error('❌ Error loading documents:', error);
        documents.value = [];
      } finally {
        loading.value = false;
      }
    };

    const applyFilters = () => {
      // Reload documents with new filters
      console.log('Applying filters:', filters.value);
      loadDocuments();
    };

    const refreshDocuments = () => {
      loadDocuments();
    };

    // Auto-refresh methods
    const startAutoRefresh = () => {
      if (refreshTimer.value) {
        clearInterval(refreshTimer.value);
      }
      
      refreshTimer.value = setInterval(() => {
        console.log('🔄 Auto-refreshing documents...');
        loadDocuments(true);
      }, refreshInterval.value);
      
      console.log(`✅ Auto-refresh started (${refreshInterval.value}ms interval)`);
    };

    const stopAutoRefresh = () => {
      if (refreshTimer.value) {
        clearInterval(refreshTimer.value);
        refreshTimer.value = null;
        console.log('⏹️ Auto-refresh stopped');
      }
    };

    const toggleAutoRefresh = () => {
      if (autoRefreshEnabled.value) {
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    };

    const updateRefreshInterval = () => {
      if (autoRefreshEnabled.value) {
        startAutoRefresh(); // Restart with new interval
      }
    };

    // Tab visibility handling
    const handleVisibilityChange = () => {
      isTabVisible.value = !document.hidden;
      console.log('👁️ Tab visibility changed:', isTabVisible.value ? 'visible' : 'hidden');
    };

    // Format last refresh time
    const formatLastRefresh = (date: Date) => {
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      
      if (seconds < 60) {
        return t('knowledge.just_now');
      } else if (minutes < 60) {
        return t('knowledge.minutes_ago', { count: minutes });
      } else {
        return date.toLocaleTimeString();
      }
    };

    const onFileSelected = (file: File | File[] | null) => {
      if (file && !Array.isArray(file)) {
        uploadData.value.title = file.name.replace(/\.[^/.]+$/, '');
      }
    };

    const uploadDocument = async () => {
      if (!uploadFile.value || Array.isArray(uploadFile.value)) return;
      
      uploading.value = true;
      try {
        // Mock upload
        console.log('Uploading file:', uploadFile.value);
        console.log('Upload data:', uploadData.value);
        
        // Simulate upload delay
        //await new Promise(resolve => setTimeout(resolve, 2000));
        
        showUploadDialog.value = false;
        uploadFile.value = undefined;
        uploadData.value = { title: '', description: '', tags: [] };
        
        // Refresh documents
        loadDocuments();
      } catch (error) {
        console.error('Upload error:', error);
      } finally {
        uploading.value = false;
      }
    };

    const handleDownloadDocument = async (doc: DocumentInfo) => {
      try {
        console.log('Downloading document:', doc);
        
        // Use API method to download document
        const result = await downloadDocument(doc.id, doc.name);
        
        if (result.success) {
          if (result.data?.downloaded) {
            console.log('✅ Document downloaded successfully:', doc.name);
          } else {
            console.log('ℹ️ Download canceled by user');
          }
        } else {
          console.error('❌ Document download failed:', result.message);
          alert(t('knowledge.download_error', { 
            name: doc.name,
            error: result.message || 'Unknown error'
          }));
        }
      } catch (error) {
        console.error('Download error:', error);
        alert(t('knowledge.download_error', { 
          name: doc.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    };

    // const editDocument = (doc) => {
    //   console.log('Edit document:', doc);
    //   // Edit logic would go here
    // };

    const deleteDocument = async (doc: DocumentInfo) => {
      if (confirm(t('knowledge.confirm_delete_document', { name: doc.name }))) {
        try {
          console.log('Deleting document:', doc);
          
          // Call the delete API with deleteFile=true to also remove the physical file and vector index
          const result = await deleteDocumentAPI(doc.id, true);
          
          if (result.success) {
            console.log('✅ Document deleted successfully:', doc.name);
            alert(t('knowledge.delete_success', { name: doc.name }));
            
            // Refresh documents list
            await loadDocuments();
          } else {
            console.error('❌ Document deletion failed:', result.message);
            alert(t('knowledge.delete_error', { 
              name: doc.name,
              error: result.message || 'Unknown error'
            }));
          }
        } catch (error) {
          console.error('Delete error:', error);
          alert(t('knowledge.delete_error', { 
            name: doc.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          }));
        }
      }
    };

    const reembedDocument = async (doc: DocumentInfo) => {
      if (confirm(t('knowledge.confirm_reembed_document', { name: doc.name }))) {
        try {
          // Add document ID to reembedding list to show loading state
          reembeddingDocIds.value.push(doc.id);
          
          console.log('Re-embedding document:', doc);
          
          // Get default embedding model from stats
          const stats = await getRAGStats();
          // const modelName = stats.data?.defaultEmbeddingModel || 'Qwen/Qwen3-Embedding-4B';
          
          // console.log('Using embedding model:', modelName);
          
          // Call the chunk and embed API with model name
          const result = await chunkAndEmbedDocument(doc.id);
          
          if (result.success) {
            console.log('✅ Re-embedding successful:', result.data);
            alert(t('knowledge.reembed_success', { 
              name: doc.name,
              chunks: result.data?.chunksCreated || 0,
              embeddings: result.data?.embeddingsGenerated || 0
            }));
            
            // Refresh documents to get updated status
            await loadDocuments();
          } else {
            console.error('❌ Re-embedding failed:', result.message);
            alert(t('knowledge.reembed_error', { 
              name: doc.name,
              error: result.message || 'Unknown error'
            }));
          }
        } catch (error) {
          console.error('Re-embedding error:', error);
          alert(t('knowledge.reembed_error', { 
            name: doc.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          }));
        } finally {
          // Remove document ID from reembedding list
          const index = reembeddingDocIds.value.indexOf(doc.id);
          if (index > -1) {
            reembeddingDocIds.value.splice(index, 1);
          }
        }
      }
    };

    const bulkDelete = async () => {
      if (confirm(t('knowledge.confirm_bulk_delete', { count: selectedDocuments.value.length }))) {
        try {
          console.log('Bulk deleting:', selectedDocuments.value);
          
          // Delete all selected documents
          const deletePromises = selectedDocuments.value.map(doc => 
            deleteDocumentAPI(doc.id, true)
          );
          
          const results = await Promise.allSettled(deletePromises);
          
          // Count successes and failures
          const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
          const failureCount = results.length - successCount;
          
          if (failureCount > 0) {
            alert(t('knowledge.bulk_delete_partial', { 
              success: successCount, 
              failed: failureCount 
            }));
          } else {
            alert(t('knowledge.bulk_delete_success', { count: successCount }));
          }
          
          selectedDocuments.value = [];
          await loadDocuments();
        } catch (error) {
          console.error('Bulk delete error:', error);
          alert(t('knowledge.bulk_delete_error', { 
            error: error instanceof Error ? error.message : 'Unknown error'
          }));
        }
      }
    };

    const bulkUpdateStatus = async (status) => {
      try {
        // Mock bulk status update
        console.log('Bulk updating status to:', status, selectedDocuments.value);
        selectedDocuments.value = [];
        loadDocuments();
      } catch (error) {
        console.error('Bulk update error:', error);
      }
    };

    const getFileTypeIcon = (fileType) => {
      const icons = {
        pdf: 'mdi-file-pdf',
        txt: 'mdi-file-document',
        doc: 'mdi-file-word',
        docx: 'mdi-file-word',
        html: 'mdi-file-code',
        md: 'mdi-file-markdown'
      };
      return icons[fileType] || 'mdi-file';
    };

    const getFileTypeColor = (fileType) => {
      const colors = {
        pdf: 'red',
        txt: 'blue',
        doc: 'blue',
        docx: 'blue',
        html: 'orange',
        md: 'green'
      };
      return colors[fileType] || 'grey';
    };

    const getStatusColor = (status) => {
      const colors = {
        active: 'green',
        archived: 'grey',
        processing: 'orange'
      };
      return colors[status] || 'grey';
    };

    const getProcessingStatusColor = (status) => {
      const colors = {
        completed: 'green',
        processing: 'orange',
        failed: 'red',
        pending: 'blue'
      };
      return colors[status] || 'grey';
    };

    const formatFileSize = (bytes) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (date) => {
      return new Date(date).toLocaleDateString();
    };

    onMounted(() => {
      loadDocuments();
      
      // Set up tab visibility listener
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      // Load auto-refresh settings from localStorage
      const savedAutoRefresh = localStorage.getItem('documentManagement.autoRefresh');
      const savedInterval = localStorage.getItem('documentManagement.refreshInterval');
      
      if (savedAutoRefresh === 'true') {
        autoRefreshEnabled.value = true;
        if (savedInterval) {
          refreshInterval.value = parseInt(savedInterval);
        }
        startAutoRefresh();
      }
    });

    onUnmounted(() => {
      // Clean up auto-refresh timer
      stopAutoRefresh();
      
      // Remove event listeners
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      
      // Save settings to localStorage
      localStorage.setItem('documentManagement.autoRefresh', autoRefreshEnabled.value.toString());
      localStorage.setItem('documentManagement.refreshInterval', refreshInterval.value.toString());
    });
</script>

<style scoped>
.document-management {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.header-left h2 {
  margin: 0;
}

.last-refresh {
  display: flex;
  align-items: center;
  font-size: 0.75rem;
}

.actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.auto-refresh-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #f5f5f5;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
}

.filters {
  margin-bottom: 20px;
  padding: 20px;
  
  border-radius: 8px;
}

.document-table {
  margin-bottom: 20px;
}

.document-name {
  display: flex;
  align-items: center;
}

.bulk-actions {
  padding: 10px;
  background-color: #e3f2fd;
  border-radius: 4px;
  display: flex;
  gap: 10px;
}

/* Responsive design */
@media (max-width: 768px) {
  .header {
    flex-direction: column;
    gap: 16px;
    align-items: stretch;
  }
  
  .actions {
    flex-direction: column;
    gap: 12px;
  }
  
  .auto-refresh-controls {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  
  .auto-refresh-controls .v-select {
    margin-left: 0 !important;
    min-width: auto !important;
  }
}
</style>
