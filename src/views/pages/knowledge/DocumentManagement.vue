<template>
  <div class="document-management">
    <div class="header">
      <h2>Document Management</h2>
      <div class="actions">
        <v-btn color="primary" @click="showUploadDialog = true">
          <v-icon left>mdi-upload</v-icon>
          Upload Document
        </v-btn>
        <v-btn color="secondary" @click="refreshDocuments">
          <v-icon left>mdi-refresh</v-icon>
          Refresh
        </v-btn>
      </div>
    </div>

    <!-- Filters -->
    <div class="filters">
      <v-row>
        <v-col cols="12" md="3">
          <v-text-field
            v-model="filters.name"
            label="Search by name"
            prepend-inner-icon="mdi-magnify"
            clearable
            @input="applyFilters"
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="filters.status"
            :items="statusOptions"
            label="Status"
            clearable
            @change="applyFilters"
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-select
            v-model="filters.fileType"
            :items="fileTypeOptions"
            label="File Type"
            clearable
            @change="applyFilters"
          />
        </v-col>
        <v-col cols="12" md="3">
          <v-text-field
            v-model="filters.author"
            label="Author"
            clearable
            @input="applyFilters"
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
        {{ formatDate(item.uploadedAt) }}
      </template>

      <template v-slot:item.actions="{ item }">
        <v-btn
          icon
          small
          @click="handlePreviewDocument(item)"
        >
          <v-icon>mdi-eye</v-icon>
        </v-btn>
        <v-btn
          icon
          small
          @click="editDocument(item)"
        >
          <v-icon>mdi-pencil</v-icon>
        </v-btn>
        <v-btn
          icon
          small
          color="error"
          @click="deleteDocument(item)"
        >
          <v-icon>mdi-delete</v-icon>
        </v-btn>
      </template>
    </v-data-table>

    <!-- Bulk Actions -->
    <div v-if="selectedDocuments.length > 0" class="bulk-actions">
      <v-btn color="error" @click="bulkDelete">
        <v-icon left>mdi-delete</v-icon>
        Delete Selected ({{ selectedDocuments.length }})
      </v-btn>
      <v-btn color="warning" @click="bulkUpdateStatus('archived')">
        <v-icon left>mdi-archive</v-icon>
        Archive Selected
      </v-btn>
    </div>

    <!-- Upload Dialog -->
    <v-dialog v-model="showUploadDialog" max-width="600">
      <v-card>
        <v-card-title>Upload Document</v-card-title>
        <v-card-text>
          <v-file-input
            v-model="uploadFile"
            label="Select file"
            accept=".pdf,.txt,.doc,.docx,.html,.md"
            show-size
            @change="onFileSelected"
          />
          <v-text-field
            v-model="uploadData.title"
            label="Title"
            class="mt-4"
          />
          <v-textarea
            v-model="uploadData.description"
            label="Description"
            rows="3"
          />
          <v-text-field
            v-model="uploadData.author"
            label="Author"
          />
          <v-combobox
            v-model="uploadData.tags"
            label="Tags"
            multiple
            chips
            hint="Press Enter to add tags"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showUploadDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="uploadDocument" :loading="uploading">
            Upload
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
            <p>Loading content...</p>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showPreviewDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { defineComponent, ref, onMounted, computed } from 'vue';

export default defineComponent({
  name: 'DocumentManagement',
  setup() {
    const documents = ref([]);
    const selectedDocuments = ref([]);
    const loading = ref(false);
    const showUploadDialog = ref(false);
    const showPreviewDialog = ref(false);
    const previewDocument = ref(null);
    const previewContent = ref('');
    const uploading = ref(false);
    const uploadFile = ref(null);
    const uploadData = ref({
      title: '',
      description: '',
      author: '',
      tags: []
    });

    const filters = ref({
      name: '',
      status: '',
      fileType: '',
      author: ''
    });

    const headers = [
      { text: 'Name', value: 'name', sortable: true },
      { text: 'Title', value: 'title', sortable: true },
      { text: 'Status', value: 'status', sortable: true },
      { text: 'Processing', value: 'processingStatus', sortable: true },
      { text: 'File Type', value: 'fileType', sortable: true },
      { text: 'Size', value: 'fileSize', sortable: true },
      { text: 'Author', value: 'author', sortable: true },
      { text: 'Uploaded', value: 'uploadedAt', sortable: true },
      { text: 'Actions', value: 'actions', sortable: false }
    ];

    const statusOptions = [
      { text: 'Active', value: 'active' },
      { text: 'Archived', value: 'archived' },
      { text: 'Processing', value: 'processing' }
    ];

    const fileTypeOptions = [
      { text: 'PDF', value: 'pdf' },
      { text: 'Text', value: 'txt' },
      { text: 'Word', value: 'doc' },
      { text: 'HTML', value: 'html' },
      { text: 'Markdown', value: 'md' }
    ];

    const loadDocuments = async () => {
      loading.value = true;
      try {
        // Mock data for now
        documents.value = [
          {
            id: 1,
            name: 'sample.pdf',
            title: 'Sample Document',
            status: 'active',
            processingStatus: 'completed',
            fileType: 'pdf',
            fileSize: 1024000,
            author: 'John Doe',
            uploadedAt: new Date('2024-01-15'),
            tags: ['research', 'ai']
          },
          {
            id: 2,
            name: 'notes.txt',
            title: 'Meeting Notes',
            status: 'active',
            processingStatus: 'completed',
            fileType: 'txt',
            fileSize: 51200,
            author: 'Jane Smith',
            uploadedAt: new Date('2024-01-14'),
            tags: ['meeting', 'notes']
          }
        ];
      } catch (error) {
        console.error('Error loading documents:', error);
      } finally {
        loading.value = false;
      }
    };

    const applyFilters = () => {
      // Filter logic would go here
      console.log('Applying filters:', filters.value);
    };

    const refreshDocuments = () => {
      loadDocuments();
    };

    const onFileSelected = (file) => {
      if (file) {
        uploadData.value.title = file.name.replace(/\.[^/.]+$/, '');
      }
    };

    const uploadDocument = async () => {
      if (!uploadFile.value) return;
      
      uploading.value = true;
      try {
        // Mock upload
        console.log('Uploading file:', uploadFile.value);
        console.log('Upload data:', uploadData.value);
        
        // Simulate upload delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        showUploadDialog.value = false;
        uploadFile.value = null;
        uploadData.value = { title: '', description: '', author: '', tags: [] };
        
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
      if (confirm(`Are you sure you want to delete "${doc.name}"?`)) {
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
      if (confirm(`Are you sure you want to delete ${selectedDocuments.value.length} documents?`)) {
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

    return {
      documents,
      selectedDocuments,
      loading,
      showUploadDialog,
      showPreviewDialog,
      previewDocument,
      previewContent,
      uploading,
      uploadFile,
      uploadData,
      filters,
      headers,
      statusOptions,
      fileTypeOptions,
      loadDocuments,
      applyFilters,
      refreshDocuments,
      onFileSelected,
      uploadDocument,
      handlePreviewDocument,
      editDocument,
      deleteDocument,
      bulkDelete,
      bulkUpdateStatus,
      getFileTypeIcon,
      getFileTypeColor,
      getStatusColor,
      getProcessingStatusColor,
      formatFileSize,
      formatDate
    };
  }
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
