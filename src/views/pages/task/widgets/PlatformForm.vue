<template>
  <v-form ref="form" @submit.prevent="handleSubmit">
    <v-container fluid>
      <v-row>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.name"
            label="Platform Name"
            required
            :rules="[rules.required]"
            placeholder="e.g., Google, LinkedIn"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.id"
            label="Platform ID"
            required
            :rules="[rules.required, rules.validId]"
            placeholder="e.g., google, linkedin"
            :readonly="isEdit"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12">
          <v-textarea
            v-model="formData.description"
            label="Description"
            rows="3"
            placeholder="Describe the platform and its purpose"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12">
          <v-combobox
            v-model="formData.tags"
            :items="availableTags"
            label="Tags"
            multiple
            chips
            closable-chips
            placeholder="Add tags to categorize the platform"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.config.baseUrl"
            label="Base URL"
            required
            :rules="[rules.required, rules.url]"
            placeholder="https://www.example.com"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.config.searchEndpoint"
            label="Search Endpoint"
            placeholder="/search"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12">
          <h4 class="text-h6 mb-2">CSS Selectors</h4>
          <v-row>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="formData.config.selectors.results"
                label="Results Container"
                placeholder=".search-results"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="formData.config.selectors.title"
                label="Title Selector"
                placeholder="h3, .title"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="formData.config.selectors.url"
                label="URL Selector"
                placeholder="a[href]"
              />
            </v-col>
          </v-row>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12">
          <v-switch
            v-model="formData.is_active"
            label="Active"
            color="success"
            hide-details
          />
        </v-col>
      </v-row>

      <!-- Form Actions -->
      <v-row>
        <v-col cols="12" class="d-flex justify-end">
          <v-btn
            color="secondary"
            variant="outlined"
            @click="$emit('cancel')"
            class="mr-2"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            type="submit"
            :loading="loading"
            :disabled="!isFormValid"
          >
            {{ isEdit ? 'Update Platform' : 'Create Platform' }}
          </v-btn>
        </v-col>
      </v-row>
    </v-container>
  </v-form>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

// Props
interface Props {
  platform?: any
  isEdit?: boolean
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  platform: null,
  isEdit: false,
  loading: false
})

// Emits
const emit = defineEmits<{
  submit: [data: any]
  cancel: []
}>()

// Form ref
const form = ref<HTMLFormElement>()

// Form data
const formData = ref({
  id: '',
  name: '',
  description: '',
  tags: [],
  is_active: true,
  config: {
    baseUrl: '',
    searchEndpoint: '',
    selectors: {
      results: '',
      title: '',
      url: ''
    }
  }
})

// Available tags
const availableTags = ref([
  'search',
  'social',
  'professional',
  'web',
  'mobile',
  'api',
  'scraping',
  'automation'
])

// Validation rules
const rules = {
  required: (value: any) => !!value || 'This field is required',
  validId: (value: string) => /^[a-z0-9-]+$/.test(value) || 'ID must contain only lowercase letters, numbers, and hyphens',
  url: (value: string) => {
    try {
      new URL(value)
      return true
    } catch {
      return 'Please enter a valid URL'
    }
  }
}

// Computed properties
const isFormValid = computed(() => {
  if (!form.value) return false
  return form.value.validate()
})

// Methods
const handleSubmit = () => {
  if (!isFormValid.value) return

  const submitData = {
    ...formData.value,
    id: formData.value.id.toLowerCase().replace(/\s+/g, '-')
  }

  emit('submit', submitData)
}

const initializeForm = () => {
  if (props.platform && props.isEdit) {
    formData.value = {
      ...props.platform,
      tags: [...(props.platform.tags || [])]
    }
  }
}

// Lifecycle
onMounted(() => {
  initializeForm()
})
</script>

<style scoped>
.v-form {
  max-width: 800px;
  margin: 0 auto;
}

.v-text-field,
.v-select,
.v-textarea {
  margin-bottom: 16px;
}
</style>
