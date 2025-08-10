<template>
  <v-form ref="form" @submit.prevent="handleSubmit">
    <v-container fluid>
      <!-- Basic Information -->
      <v-row>
        <v-col cols="12">
          <h3 class="text-h6 mb-4">
            <v-icon class="mr-2">mdi-information</v-icon>
            Task Information
          </h3>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.name"
            label="Task Name"
            required
            :rules="[rules.required]"
            placeholder="Enter task name"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="formData.platform"
            :items="platformOptions"
            label="Platform"
            required
            :rules="[rules.required]"
            @update:model-value="handlePlatformChange"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12">
          <v-textarea
            v-model="formData.description"
            label="Description"
            rows="3"
            placeholder="Enter task description"
          />
        </v-col>
      </v-row>

      <!-- Search Parameters -->
      <v-row>
        <v-col cols="12">
          <h3 class="text-h6 mb-4">
            <v-icon class="mr-2">mdi-magnify</v-icon>
            Search Parameters
          </h3>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12">
          <v-textarea
            v-model="formData.keywords"
            label="Keywords"
            required
            :rules="[rules.required]"
            rows="4"
            placeholder="Enter keywords (one per line)"
            hint="Enter each keyword on a new line"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.location"
            label="Location"
            placeholder="Enter location (optional)"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.numPages"
            label="Number of Pages"
            type="number"
            min="1"
            max="100"
            :rules="[rules.positive]"
            placeholder="10"
          />
        </v-col>
      </v-row>

      <!-- Advanced Settings -->
      <v-row>
        <v-col cols="12">
          <h3 class="text-h6 mb-4">
            <v-icon class="mr-2">mdi-cog</v-icon>
            Advanced Settings
          </h3>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="formData.concurrency"
            label="Concurrency"
            type="number"
            min="1"
            max="10"
            :rules="[rules.positive]"
            placeholder="3"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-switch
            v-model="formData.showBrowser"
            label="Show Browser"
            color="primary"
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
            Create Task
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
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
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
  name: '',
  description: '',
  platform: '',
  keywords: '',
  location: '',
  numPages: 10,
  concurrency: 3,
  showBrowser: true
})

// Platform options
const platformOptions = ref([
  { title: 'Google', value: 'google' },
  { title: 'Bing', value: 'bing' },
  { title: 'LinkedIn', value: 'linkedin' },
  { title: 'Facebook', value: 'facebook' },
  { title: 'Twitter', value: 'twitter' },
  { title: 'Instagram', value: 'instagram' }
])

// Validation rules
const rules = {
  required: (value: any) => !!value || 'This field is required',
  positive: (value: number) => value > 0 || 'Must be a positive number'
}

// Computed properties
const isFormValid = computed(() => {
  if (!form.value) return false
  return form.value.validate()
})

// Methods
const handlePlatformChange = () => {
  // Platform-specific logic can be added here
  console.log('Platform changed to:', formData.value.platform)
}

const handleSubmit = () => {
  if (!isFormValid.value) return

  const submitData = {
    ...formData.value,
    keywords: formData.value.keywords.split('\n').filter(k => k.trim()),
    numPages: Number(formData.value.numPages),
    concurrency: Number(formData.value.concurrency)
  }

  emit('submit', submitData)
}

const loadPlatforms = async () => {
  try {
    // TODO: Load platforms from API
    // const platforms = await getPlatformList()
    // platformOptions.value = platforms.map(p => ({
    //   title: p.name,
    //   value: p.id
    // }))
  } catch (error) {
    console.error('Failed to load platforms:', error)
  }
}

// Lifecycle
onMounted(() => {
  loadPlatforms()
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
