<template>
  <div class="document-management">
    <div class="header">
      <h2>{{ t('knowledge.document_management') }}</h2>
      <div class="actions">
        <v-btn color="primary" @click="showUploadDialog = true">
          <v-icon left>mdi-upload</v-icon>
          {{ t('knowledge.upload_document') }}
        </v-btn>
        <v-btn color="secondary" @click="refreshDocuments">
          <v-icon left>mdi-refresh</v-icon>
          {{ t('common.refresh') }}
        </v-btn>
      </div>
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
            :label="t('knowledge.status')"
            clearable
            @change="applyFilters"
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="filters.fileType"
            :items="fileTypeOptions"
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

      <template v-slot:item.uploadedAt="{ item }">
        {{ formatDate(item.uploadDate) }}
      </template>

      <template v-slot:item.actions="{ item }">
        <v-btn
          icon
          size="small"
          variant="text"
          @click="handlePreviewDocument(item)"
        >
          <v-icon size="small">mdi-eye</v-icon>
        </v-btn>
        <v-btn
          icon
          size="small"
          variant="text"
          @click="editDocument(item)"
        >
          <v-icon size="small">mdi-pencil</v-icon>
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

    <!-- Preview Dialog -->
    <v-dialog v-model="showPreviewDialog" max-width="800">
      <v-card>
        <v-card-title>{{ previewDocument?.name }}</v-card-title>
        <v-card-text>
          <div v-if="previewContent" class="preview-content">
            {{ previewContent }}
          </div>
          <div v-else class="text-center">
            <v-progress-circular indeterminate />
            <p>{{ t('knowledge.loading_content') }}</p>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showPreviewDialog = false">{{ t('common.close') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { getDocuments, type DocumentInfo } from '@/views/api/rag';

// i18n setup
const { t } = useI18n();
    const documents = ref<DocumentInfo[]>([]);
    const selectedDocuments = ref<DocumentInfo[]>([]);
    const loading = ref(false);
    const showUploadDialog = ref(false);
    const showPreviewDialog = ref(false);
    const previewDocument = ref<DocumentInfo | null>(null);
    const previewContent = ref('');
    const uploading = ref(false);
    const uploadFile = ref<any>(null);
    const uploadData = ref({
      title: '',
      description: '',
      tags: []
    });

    const filters = ref({
      name: '',
      status: '',
      fileType: ''
    });

    const headers = [
      { text: t('knowledge.name'), value: 'name', sortable: true },
      { text: t('knowledge.title'), value: 'title', sortable: true },
      { text: t('knowledge.status'), value: 'status', sortable: true },
      { text: t('knowledge.processing'), value: 'processingStatus', sortable: true },
      { text: t('knowledge.file_type'), value: 'fileType', sortable: true },
      { text: t('knowledge.size'), value: 'fileSize', sortable: true },
      { text: t('knowledge.uploaded'), value: 'uploadedAt', sortable: true },
      { text: t('knowledge.actions'), value: 'actions', sortable: false }
    ];

    const statusOptions = [
      { text: t('knowledge.status_active'), value: 'active' },
      { text: t('knowledge.status_archived'), value: 'archived' },
      { text: t('knowledge.status_processing'), value: 'processing' }
    ];

    const fileTypeOptions = [
      { text: 'PDF', value: 'pdf' },
      { text: t('knowledge.file_type_text'), value: 'txt' },
      { text: t('knowledge.file_type_word'), value: 'doc' },
      { text: 'HTML', value: 'html' },
      { text: t('knowledge.file_type_markdown'), value: 'md' }
    ];

    const loadDocuments = async () => {
      loading.value = true;
      try {
        // Get documents using IPC method
        const response = await getDocuments(filters.value);
        console.log('📄 Documents response:', response);
        
        if (response.success && response.data) {
          documents.value = response.data;
          console.log('✅ Documents loaded successfully:', documents.value.length);
        } else {
          console.error('❌ Failed to load documents:', response.message);
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
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        showUploadDialog.value = false;
        uploadFile.value = null;
        uploadData.value = { title: '', description: '', tags: [] };
        
        // Refresh documents
        loadDocuments();
      } catch (error) {
        console.error('Upload error:', error);
      } finally {
        uploading.value = false;
      }
    };

    const handlePreviewDocument = async (doc) => {
      previewDocument.value = doc;
      showPreviewDialog.value = true;
      previewContent.value = '';
      
      try {
        // Mock content loading
        await new Promise(resolve => setTimeout(resolve, 1000));
        previewContent.value = `This is a preview of ${doc.name}. The actual content would be loaded here.`;
      } catch (error) {
        console.error('Error loading preview:', error);
      }
    };

    const editDocument = (doc) => {
      console.log('Edit document:', doc);
      // Edit logic would go here
    };

    const deleteDocument = async (doc) => {
      if (confirm(t('knowledge.confirm_delete_document', { name: doc.name }))) {
        try {
          // Mock delete
          console.log('Deleting document:', doc);
          loadDocuments();
        } catch (error) {
          console.error('Delete error:', error);
        }
      }
    };

    const bulkDelete = async () => {
      if (confirm(t('knowledge.confirm_bulk_delete', { count: selectedDocuments.value.length }))) {
        try {
          // Mock bulk delete
          console.log('Bulk deleting:', selectedDocuments.value);
          selectedDocuments.value = [];
          loadDocuments();
        } catch (error) {
          console.error('Bulk delete error:', error);
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
    });
</script>

<style scoped>
.document-management {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.actions {
  display: flex;
  gap: 10px;
}

.filters {
  margin-bottom: 20px;
  padding: 20px;
  background-color: #f5f5f5;
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

.preview-content {
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  font-family: monospace;
  background-color: #f5f5f5;
  padding: 15px;
  border-radius: 4px;
}
</style>
