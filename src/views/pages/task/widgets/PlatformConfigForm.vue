<template>
  <v-container fluid>
    <v-row>
      <v-col cols="12">
        <h4 class="text-h6 mb-4">Configuration Settings</h4>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="configData.baseUrl"
          label="Base URL"
          @update:model-value="updateConfig"
          placeholder="https://www.example.com"
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="configData.searchEndpoint"
          label="Search Endpoint"
          @update:model-value="updateConfig"
          placeholder="/search"
        />
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12">
        <h5 class="text-subtitle-1 mb-2">CSS Selectors</h5>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="4">
        <v-text-field
          v-model="configData.selectors.results"
          label="Results Container"
          @update:model-value="updateConfig"
          placeholder=".search-results"
        />
      </v-col>
      <v-col cols="12" md="4">
        <v-text-field
          v-model="configData.selectors.title"
          label="Title Selector"
          @update:model-value="updateConfig"
          placeholder="h3, .title"
        />
      </v-col>
      <v-col cols="12" md="4">
        <v-text-field
          v-model="configData.selectors.url"
          label="URL Selector"
          @update:model-value="updateConfig"
          placeholder="a[href]"
        />
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12">
        <h5 class="text-subtitle-1 mb-2">Advanced Settings</h5>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="configData.timeout"
          label="Request Timeout (ms)"
          type="number"
          @update:model-value="updateConfig"
          placeholder="30000"
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="configData.retryAttempts"
          label="Retry Attempts"
          type="number"
          @update:model-value="updateConfig"
          placeholder="3"
        />
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12">
        <v-textarea
          v-model="configData.headers"
          label="Custom Headers (JSON)"
          rows="4"
          @update:model-value="updateConfig"
          placeholder='{"User-Agent": "Custom Bot", "Accept": "text/html"}'
        />
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12">
        <v-textarea
          v-model="configData.cookies"
          label="Cookies (JSON)"
          rows="4"
          @update:model-value="updateConfig"
          placeholder='{"session": "value", "auth": "token"}'
        />
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'

// Props
interface Props {
  config: any
}

const props = defineProps<Props>()

// Emits
const emit = defineEmits<{
  update: [config: any]
}>()

// Reactive data
const configData = ref({
  baseUrl: '',
  searchEndpoint: '',
  selectors: {
    results: '',
    title: '',
    url: ''
  },
  timeout: 30000,
  retryAttempts: 3,
  headers: '{}',
  cookies: '{}'
})

// Methods
const updateConfig = () => {
  try {
    const config = {
      ...configData.value,
      headers: JSON.parse(configData.value.headers || '{}'),
      cookies: JSON.parse(configData.value.cookies || '{}')
    }
    emit('update', config)
  } catch (error) {
    console.error('Invalid JSON in headers or cookies:', error)
  }
}

const initializeConfig = () => {
  if (props.config) {
    configData.value = {
      baseUrl: props.config.baseUrl || '',
      searchEndpoint: props.config.searchEndpoint || '',
      selectors: {
        results: props.config.selectors?.results || '',
        title: props.config.selectors?.title || '',
        url: props.config.selectors?.url || ''
      },
      timeout: props.config.timeout || 30000,
      retryAttempts: props.config.retryAttempts || 3,
      headers: JSON.stringify(props.config.headers || {}, null, 2),
      cookies: JSON.stringify(props.config.cookies || {}, null, 2)
    }
  }
}

// Watchers
watch(() => props.config, initializeConfig, { deep: true })

// Lifecycle
onMounted(() => {
  initializeConfig()
})
</script>

<style scoped>
.v-container {
  max-width: 800px;
  margin: 0 auto;
}

.v-text-field,
.v-textarea {
  margin-bottom: 16px;
}
</style>
