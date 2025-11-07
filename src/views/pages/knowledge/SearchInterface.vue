<template>
  <div class="search-interface">
    <div class="header">
      <h2>Search Knowledge Base</h2>
    </div>

    <!-- Search Input -->
    <div class="search-input-container">
      <v-text-field
        v-model="searchQuery"
        label="Search your knowledge base..."
        prepend-inner-icon="mdi-magnify"
        clearable
        @keyup.enter="performSearch"
        @input="onQueryChange"
        class="search-field"
      >
        <template v-slot:append>
          <v-btn
            color="primary"
            @click="performSearch"
            :loading="searching"
            :disabled="!searchQuery.trim()"
          >
            Search
          </v-btn>
        </template>
      </v-text-field>
    </div>

    <!-- Search Suggestions -->
    <div v-if="suggestions.length > 0 && showSuggestions" class="suggestions">
      <v-list dense>
        <v-list-item
          v-for="(suggestion, index) in suggestions"
          :key="index"
          @click="selectSuggestion(suggestion)"
          class="suggestion-item"
        >
          <v-list-item-content>
            <v-list-item-title>{{ suggestion }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </div>

    <!-- Search Filters -->
    <div class="search-filters">
      <v-expansion-panels>
        <v-expansion-panel>
          <v-expansion-panel-header>
            <v-icon left>mdi-filter</v-icon>
            Advanced Filters
          </v-expansion-panel-header>
          <v-expansion-panel-content>
            <v-row>
              <v-col cols="12" md="4">
                <v-select
                  v-model="filters.documentTypes"
                  :items="documentTypeOptions"
                  label="Document Types"
                  multiple
                  chips
                />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field
                  v-model="filters.authors"
                  label="Authors"
                  hint="Comma-separated list"
                />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field
                  v-model="filters.tags"
                  label="Tags"
                  hint="Comma-separated list"
                />
              </v-col>
            </v-row>
            <v-row>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="filters.dateFrom"
                  label="Date From"
                  type="date"
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="filters.dateTo"
                  label="Date To"
                  type="date"
                />
              </v-col>
            </v-row>
            <v-row>
              <v-col cols="12" md="6">
                <v-slider
                  v-model="filters.confidenceThreshold"
                  label="Confidence Threshold"
                  min="0"
                  max="1"
                  step="0.1"
                  thumb-label
                />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="filters.maxResults"
                  label="Max Results"
                  type="number"
                  min="1"
                  max="100"
                />
              </v-col>
            </v-row>
          </v-expansion-panel-content>
        </v-expansion-panel>
      </v-expansion-panels>
    </div>

    <!-- Search Results -->
    <div v-if="searchResults.length > 0" class="search-results">
      <div class="results-header">
        <h3>Search Results ({{ searchResults.length }})</h3>
        <div class="result-actions">
          <v-btn
            text
            @click="exportResults"
            :disabled="searchResults.length === 0"
          >
            <v-icon left>mdi-download</v-icon>
            Export
          </v-btn>
          <v-btn
            text
            @click="clearResults"
          >
            <v-icon left>mdi-close</v-icon>
            Clear
          </v-btn>
        </div>
      </div>

      <v-list>
        <v-list-item
          v-for="(result, index) in searchResults"
          :key="index"
          class="result-item"
        >
          <v-list-item-content>
            <div class="result-header">
              <v-list-item-title class="result-title">
                {{ result.documentName }}
              </v-list-item-title>
              <v-chip
                :color="getRelevanceColor(result.relevanceScore)"
                small
                class="relevance-score"
              >
                {{ Math.round(result.relevanceScore * 100) }}% match
              </v-chip>
            </div>
            <v-list-item-subtitle class="result-meta">
              {{ result.fileType.toUpperCase() }} • {{ result.author }} • {{ formatDate(result.uploadedAt) }}
            </v-list-item-subtitle>
            <div class="result-content">
              {{ result.content }}
            </div>
            <div class="result-actions">
              <v-btn
                text
                small
                @click="viewDocument(result)"
              >
                <v-icon left small>mdi-eye</v-icon>
                View Document
              </v-btn>
              <v-btn
                text
                small
                @click="copyContent(result.content)"
              >
                <v-icon left small>mdi-content-copy</v-icon>
                Copy
              </v-btn>
            </div>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </div>

    <!-- No Results -->
    <div v-else-if="hasSearched && !searching" class="no-results">
      <v-icon size="64" color="grey">mdi-magnify</v-icon>
      <h3>No results found</h3>
      <p>Try adjusting your search terms or filters</p>
    </div>

    <!-- Search History -->
    <div v-if="searchHistory.length > 0" class="search-history">
      <h3>Recent Searches</h3>
      <v-chip-group>
        <v-chip
          v-for="(query, index) in searchHistory"
          :key="index"
          @click="selectHistoryQuery(query)"
          close
          @click:close="removeFromHistory(index)"
        >
          {{ query }}
        </v-chip>
      </v-chip-group>
    </div>
  </div>
</template>

<script>
import { defineComponent, ref, onMounted, watch } from 'vue';

export default defineComponent({
  name: 'SearchInterface',
  setup() {
    const searchQuery = ref('');
    const searchResults = ref([]);
    const suggestions = ref([]);
    const searching = ref(false);
    const hasSearched = ref(false);
    const showSuggestions = ref(false);
    const searchHistory = ref([]);

    const filters = ref({
      documentTypes: [],
      authors: '',
      tags: '',
      dateFrom: '',
      dateTo: '',
      confidenceThreshold: 0.5,
      maxResults: 20
    });

    const documentTypeOptions = [
      { text: 'PDF', value: 'pdf' },
      { text: 'Text', value: 'txt' },
      { text: 'Word', value: 'doc' },
      { text: 'HTML', value: 'html' },
      { text: 'Markdown', value: 'md' }
    ];

    const performSearch = async () => {
      if (!searchQuery.value.trim()) return;

      searching.value = true;
      hasSearched.value = true;
      showSuggestions.value = false;

      try {
        // Mock search - replace with actual API call
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        searchResults.value = [
          {
            id: 1,
            documentName: 'AI Research Paper',
            fileType: 'pdf',
            author: 'Dr. Smith',
            uploadedAt: new Date('2024-01-15'),
            content: 'This paper discusses the latest advances in artificial intelligence and machine learning...',
            relevanceScore: 0.95,
            documentId: 1,
            chunkId: 1
          },
          {
            id: 2,
            documentName: 'Meeting Notes',
            fileType: 'txt',
            author: 'Jane Doe',
            uploadedAt: new Date('2024-01-14'),
            content: 'During today\'s meeting, we discussed the implementation of the new RAG system...',
            relevanceScore: 0.87,
            documentId: 2,
            chunkId: 3
          },
          {
            id: 3,
            documentName: 'Technical Documentation',
            fileType: 'md',
            author: 'John Developer',
            uploadedAt: new Date('2024-01-13'),
            content: 'The RAG system architecture consists of several key components including...',
            relevanceScore: 0.78,
            documentId: 3,
            chunkId: 5
          }
        ];

        // Add to search history
        if (!searchHistory.value.includes(searchQuery.value)) {
          searchHistory.value.unshift(searchQuery.value);
          if (searchHistory.value.length > 10) {
            searchHistory.value.pop();
          }
        }
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        searching.value = false;
      }
    };

    const onQueryChange = () => {
      if (searchQuery.value.length > 2) {
        // Mock suggestions
        suggestions.value = [
          'artificial intelligence',
          'machine learning',
          'RAG system',
          'document processing',
          'vector search'
        ].filter(s => s.toLowerCase().includes(searchQuery.value.toLowerCase()));
        showSuggestions.value = true;
      } else {
        showSuggestions.value = false;
      }
    };

    const selectSuggestion = (suggestion) => {
      searchQuery.value = suggestion;
      showSuggestions.value = false;
      performSearch();
    };

    const selectHistoryQuery = (query) => {
      searchQuery.value = query;
      performSearch();
    };

    const removeFromHistory = (index) => {
      searchHistory.value.splice(index, 1);
    };

    const viewDocument = (result) => {
      console.log('Viewing document:', result);
      // Navigate to document view
    };

    const copyContent = async (content) => {
      try {
        await navigator.clipboard.writeText(content);
        // Show success message
        console.log('Content copied to clipboard');
      } catch (error) {
        console.error('Failed to copy content:', error);
      }
    };

    const exportResults = () => {
      const data = searchResults.value.map(result => ({
        document: result.documentName,
        content: result.content,
        relevance: result.relevanceScore,
        author: result.author,
        date: result.uploadedAt
      }));
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'search-results.json';
      a.click();
      URL.revokeObjectURL(url);
    };

    const clearResults = () => {
      searchResults.value = [];
      hasSearched.value = false;
    };

    const getRelevanceColor = (score) => {
      if (score >= 0.8) return 'green';
      if (score >= 0.6) return 'orange';
      return 'red';
    };

    const formatDate = (date) => {
      return new Date(date).toLocaleDateString();
    };

    // Load search history from localStorage
    onMounted(() => {
      const savedHistory = localStorage.getItem('searchHistory');
      if (savedHistory) {
        searchHistory.value = JSON.parse(savedHistory);
      }
    });

    // Save search history to localStorage
    watch(searchHistory, (newHistory) => {
      localStorage.setItem('searchHistory', JSON.stringify(newHistory));
    }, { deep: true });

    return {
      searchQuery,
      searchResults,
      suggestions,
      searching,
      hasSearched,
      showSuggestions,
      searchHistory,
      filters,
      documentTypeOptions,
      performSearch,
      onQueryChange,
      selectSuggestion,
      selectHistoryQuery,
      removeFromHistory,
      viewDocument,
      copyContent,
      exportResults,
      clearResults,
      getRelevanceColor,
      formatDate
    };
  }
});
</script>

<style scoped>
.search-interface {
  padding: 20px;
}

.header {
  margin-bottom: 20px;
}

.search-input-container {
  margin-bottom: 20px;
}

.search-field {
  font-size: 1.1rem;
}

.suggestions {
  position: absolute;
  z-index: 1000;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  max-height: 200px;
  overflow-y: auto;
  width: 100%;
}

.suggestion-item {
  cursor: pointer;
}

.suggestion-item:hover {
  background-color: #f5f5f5;
}

.search-filters {
  margin-bottom: 20px;
}

.search-results {
  margin-top: 20px;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.result-actions {
  display: flex;
  gap: 10px;
}

.result-item {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-bottom: 16px;
  padding: 16px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.result-title {
  font-weight: 600;
  color: #1976d2;
}

.relevance-score {
  margin-left: 10px;
}

.result-meta {
  color: #666;
  margin-bottom: 12px;
}

.result-content {
  color: #333;
  line-height: 1.5;
  margin-bottom: 12px;
  max-height: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-actions {
  display: flex;
  gap: 8px;
}

.no-results {
  text-align: center;
  padding: 40px;
  color: #666;
}

.search-history {
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid #e0e0e0;
}

.search-history h3 {
  margin-bottom: 15px;
  color: #333;
}
</style>
