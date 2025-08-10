<template>
  <v-container fluid>
    <!-- Header -->
    <v-row class="mb-4">
      <v-col cols="12">
        <div class="d-flex align-center justify-space-between">
          <div>
            <h2 class="text-h4 font-weight-bold">
              <v-icon class="mr-2">mdi-cog</v-icon>
              Platform Management
            </h2>
            <p class="text-subtitle-1 text-medium-emphasis">
              Manage scraping platforms and their configurations
            </p>
          </div>
          <v-btn
            color="primary"
            prepend-icon="mdi-plus"
            @click="openCreatePlatformDialog"
          >
            Add Platform
          </v-btn>
        </div>
      </v-col>
    </v-row>

    <!-- Platform Cards -->
    <v-row>
      <v-col cols="12" v-if="loading">
        <v-card>
          <v-card-text class="text-center">
            <v-progress-circular indeterminate color="primary" />
            <div class="mt-2">Loading platforms...</div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col
        v-for="platform in platforms"
        :key="platform.id"
        cols="12"
        md="6"
        lg="4"
      >
        <v-card>
          <v-card-title class="d-flex align-center justify-space-between">
            <div class="d-flex align-center">
              <v-icon class="mr-2">{{ getPlatformIcon(platform.name) }}</v-icon>
              {{ platform.name }}
            </div>
            <v-chip
              :color="platform.is_active ? 'success' : 'error'"
              size="small"
              variant="tonal"
            >
              {{ platform.is_active ? 'Active' : 'Inactive' }}
            </v-chip>
          </v-card-title>
          
          <v-card-text>
            <p class="text-body-2">{{ platform.description }}</p>
            <div class="mt-2">
              <v-chip
                v-for="tag in platform.tags"
                :key="tag"
                size="small"
                variant="outlined"
                class="mr-1 mb-1"
              >
                {{ tag }}
              </v-chip>
            </div>
          </v-card-text>
          
          <v-card-actions>
            <v-btn
              size="small"
              color="primary"
              variant="text"
              @click="editPlatform(platform)"
            >
              Edit
            </v-btn>
            <v-btn
              size="small"
              color="info"
              variant="text"
              @click="viewConfig(platform)"
            >
              Config
            </v-btn>
            <v-btn
              size="small"
              color="warning"
              variant="text"
              @click="togglePlatform(platform)"
            >
              {{ platform.is_active ? 'Disable' : 'Enable' }}
            </v-btn>
            <v-btn
              size="small"
              color="error"
              variant="text"
              @click="deletePlatform(platform)"
            >
              Delete
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <!-- Statistics Section -->
    <v-row v-if="statistics" class="mb-4">
      <v-col cols="12">
        <v-card>
          <v-card-title>Platform Statistics</v-card-title>
          <v-card-text>
            <v-row>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h4 font-weight-bold text-primary">{{ statistics.total }}</div>
                  <div class="text-subtitle-2">Total Platforms</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h4 font-weight-bold text-success">{{ statistics.active }}</div>
                  <div class="text-subtitle-2">Active Platforms</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h4 font-weight-bold text-warning">{{ statistics.inactive }}</div>
                  <div class="text-subtitle-2">Inactive Platforms</div>
                </div>
              </v-col>
              <v-col cols="12" md="3">
                <div class="text-center">
                  <div class="text-h4 font-weight-bold text-info">{{ Object.keys(statistics.byCountry || {}).length }}</div>
                  <div class="text-subtitle-2">Countries</div>
                </div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Create/Edit Platform Dialog -->
    <v-dialog v-model="platformDialog.show" max-width="600" persistent>
      <v-card>
        <v-card-title>
          {{ platformDialog.isEdit ? 'Edit Platform' : 'Add Platform' }}
        </v-card-title>
        <v-card-text>
          <PlatformForm
            :platform="platformDialog.platform"
            :is-edit="platformDialog.isEdit"
            :loading="platformDialog.loading"
            @submit="handlePlatformSubmit"
            @cancel="closePlatformDialog"
          />
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Config Viewer Dialog -->
    <v-dialog v-model="configDialog.show" max-width="800">
      <v-card>
        <v-card-title>Platform Configuration</v-card-title>
        <v-card-text>
          <v-tabs v-model="configDialog.activeTab">
            <v-tab value="json">JSON</v-tab>
            <v-tab value="form">Form</v-tab>
          </v-tabs>
          
          <v-window v-model="configDialog.activeTab">
            <v-window-item value="json">
              <v-textarea
                v-model="configDialog.jsonConfig"
                label="Configuration JSON"
                rows="15"
                readonly
              />
            </v-window-item>
            
            <v-window-item value="form">
              <PlatformConfigForm
                :config="configDialog.config"
                @update="updateConfig"
              />
            </v-window-item>
          </v-window>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" @click="saveConfig">Save Config</v-btn>
          <v-btn color="secondary" @click="configDialog.show = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import PlatformForm from './PlatformForm.vue'
import PlatformConfigForm from './PlatformConfigForm.vue'
import { 
  getPlatformList, 
  getPlatformDetail, 
  createPlatform, 
  updatePlatform, 
  deletePlatform, 
  validatePlatform, 
  getPlatformStatistics, 
  togglePlatform 
} from '@/views/api/platform'
import { PlatformConfig } from '@/interfaces/IPlatformConfig'

// Reactive data
const platforms = ref<PlatformConfig[]>([])
const loading = ref(false)
const statistics = ref<any>(null)

// Dialogs
const platformDialog = ref({
  show: false,
  isEdit: false,
  platform: null,
  loading: false
})

const configDialog = ref({
  show: false,
  activeTab: 'json',
  config: {},
  jsonConfig: ''
})

// Methods
const loadPlatforms = async () => {
  try {
    loading.value = true
    platforms.value = await getPlatformList()
  } catch (error) {
    console.error('Failed to load platforms:', error)
  } finally {
    loading.value = false
  }
}

const loadStatistics = async () => {
  try {
    statistics.value = await getPlatformStatistics()
  } catch (error) {
    console.error('Failed to load statistics:', error)
  }
}

const openCreatePlatformDialog = () => {
  platformDialog.value = {
    show: true,
    isEdit: false,
    platform: null,
    loading: false
  }
}

const editPlatform = (platform: PlatformConfig) => {
  platformDialog.value = {
    show: true,
    isEdit: true,
    platform: { ...platform },
    loading: false
  }
}

const closePlatformDialog = () => {
  platformDialog.value.show = false
}

const handlePlatformSubmit = async (platformData: PlatformConfig) => {
  try {
    platformDialog.value.loading = true
    
    if (platformDialog.value.isEdit) {
      // Update existing platform
      await updatePlatform(platformData.id, platformData)
      const index = platforms.value.findIndex(p => p.id === platformData.id)
      if (index !== -1) {
        platforms.value[index] = { ...platforms.value[index], ...platformData }
      }
    } else {
      // Create new platform
      const newPlatform = await createPlatform(platformData)
      platforms.value.push(newPlatform)
    }
    
    closePlatformDialog()
    await loadStatistics() // Refresh statistics
  } catch (error) {
    console.error('Failed to save platform:', error)
    throw error
  } finally {
    platformDialog.value.loading = false
  }
}

const viewConfig = (platform: PlatformConfig) => {
  configDialog.value = {
    show: true,
    activeTab: 'json',
    config: platform,
    jsonConfig: JSON.stringify(platform, null, 2),
    platformId: platform.id
  }
}

const updateConfig = (config: any) => {
  configDialog.value.config = config
  configDialog.value.jsonConfig = JSON.stringify(config, null, 2)
}

const saveConfig = async () => {
  try {
    // Update the platform with the new config
    const platform = platforms.value.find(p => p.id === configDialog.value.platformId)
    if (platform) {
      await updatePlatform(platform.id, {
        ...platform,
        ...configDialog.value.config
      })
      
      // Update local state
      const index = platforms.value.findIndex(p => p.id === platform.id)
      if (index !== -1) {
        platforms.value[index] = { ...platforms.value[index], ...configDialog.value.config }
      }
    }
    
    configDialog.value.show = false
  } catch (error) {
    console.error('Failed to save config:', error)
    throw error
  }
}

const togglePlatform = async (platform: PlatformConfig) => {
  try {
    await togglePlatform(platform.id)
    // Update local state
    const index = platforms.value.findIndex(p => p.id === platform.id)
    if (index !== -1) {
      platforms.value[index].is_active = !platforms.value[index].is_active
    }
    await loadStatistics() // Refresh statistics
  } catch (error) {
    console.error('Failed to toggle platform:', error)
    throw error
  }
}

const deletePlatform = async (platform: PlatformConfig) => {
  try {
    await deletePlatform(platform.id)
    // Remove from local state
    const index = platforms.value.findIndex(p => p.id === platform.id)
    if (index !== -1) {
      platforms.value.splice(index, 1)
    }
    await loadStatistics() // Refresh statistics
  } catch (error) {
    console.error('Failed to delete platform:', error)
    throw error
  }
}

const getPlatformIcon = (name: string) => {
  const icons: { [key: string]: string } = {
    google: 'mdi-google',
    linkedin: 'mdi-linkedin',
    facebook: 'mdi-facebook',
    twitter: 'mdi-twitter',
    instagram: 'mdi-instagram',
    youtube: 'mdi-youtube',
    yellowpages: 'mdi-phone',
    yelp: 'mdi-star',
    bing: 'mdi-magnify'
  }
  return icons[name.toLowerCase()] || 'mdi-web'
}

// Lifecycle
onMounted(() => {
  loadPlatforms()
  loadStatistics()
})
</script>

<style scoped>
.v-container {
  max-width: 1200px;
  margin: 0 auto;
}
</style>
